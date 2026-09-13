#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

mock_bin="$test_dir/bin"
mkdir -p "$mock_bin"

# Stands in for the artifact host: two small shards, one tokenizer, one config, one library.
cat >"$mock_bin/curl" <<'MOCK'
#!/usr/bin/env sh
set -eu

output_file=''
url=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --connect-timeout|--max-time)
      shift 2
      ;;
    --*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

case "$url" in
  */ndarray-cache.json)
    printf '%s' '{"records":[{"dataPath":"params_shard_0.bin","nbytes":8},{"dataPath":"params_shard_1.bin","nbytes":4}]}' >"$output_file"
    ;;
  */mlc-chat-config.json)
    printf '%s' '{"context_window_size":4096}' >"$output_file"
    ;;
  */tokenizer.json)
    printf '%s' '{"model":{}}' >"$output_file"
    ;;
  */params_shard_0.bin)
    printf '%s' 'ABCDEFGH' >"$output_file"
    ;;
  */params_shard_1.bin)
    if [ "${MOCK_SHORT_SHARD:-false}" = true ]; then
      printf '%s' 'IJ' >"$output_file"
    else
      printf '%s' 'IJKL' >"$output_file"
    fi
    ;;
  *.wasm)
    printf '%s' 'wasm-bytes' >"$output_file"
    ;;
  *)
    echo "unexpected url $url" >&2
    exit 22
    ;;
esac
MOCK
chmod +x "$mock_bin/curl"

PATH="$mock_bin:$PATH"
export PATH

root="$test_dir/srv/models"
mkdir -p "$root"

MODEL_ROOT="$root" MODEL_ID="Qwen3-0.6B-q4f16_1-MLC" MODEL_REVISION="1" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/first.log"

revision_dir="$root/Qwen3-0.6B-q4f16_1-MLC/resolve/1"

for file in manifest.json mlc-chat-config.json tokenizer.json ndarray-cache.json \
  params_shard_0.bin params_shard_1.bin model.wasm; do
  test -s "$revision_dir/$file" || {
    echo "bootstrap-models did not place $file" >&2
    exit 1
  }
done

python3 - "$revision_dir/manifest.json" <<'PY'
import json, sys

manifest = json.load(open(sys.argv[1]))

assert manifest["model_id"] == "Qwen3-0.6B-q4f16_1-MLC", manifest
assert manifest["revision"] == "1", manifest
# Eight plus four bytes of shards, ten bytes of library.
assert manifest["bytes"] == 22, manifest
assert manifest["shards"] == ["params_shard_0.bin", "params_shard_1.bin"], manifest
for key in ("config", "model_lib"):
    assert manifest["integrity"][key].startswith("sha256-"), manifest
assert manifest["integrity"]["tokenizer"]["tokenizer.json"].startswith("sha256-"), manifest
assert manifest["notices"], manifest
PY

# A second run must not refetch: the revision directory is immutable once it exists.
MODEL_ROOT="$root" MODEL_ID="Qwen3-0.6B-q4f16_1-MLC" MODEL_REVISION="1" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/second.log"

grep -Fq "Model already present" "$test_dir/second.log" || {
  echo "bootstrap-models refetched an existing revision" >&2
  exit 1
}

# A shard that does not match the size its manifest declares fails the run.
if MODEL_ROOT="$root" MODEL_ID="Qwen3-0.6B-q4f16_1-MLC" MODEL_REVISION="2" \
  MOCK_SHORT_SHARD=true sh "$script_dir/bootstrap-models.sh" >"$test_dir/short.log" 2>&1; then
  echo "bootstrap-models accepted a shard of the wrong size" >&2
  exit 1
fi

test -d "$root/Qwen3-0.6B-q4f16_1-MLC/resolve/2" && {
  echo "bootstrap-models left a half-written revision in place" >&2
  exit 1
}

# A relative root is refused before anything is fetched.
if MODEL_ROOT="relative/path" sh "$script_dir/bootstrap-models.sh" >/dev/null 2>&1; then
  echo "bootstrap-models accepted a relative MODEL_ROOT" >&2
  exit 1
fi

echo "bootstrap-models contract holds"
