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
      printf '%s\n' "$*" >>"${MOCK_CURL_LOG:-/dev/null}"
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
MOCK_CURL_LOG="$test_dir/curl.log"
export PATH MOCK_CURL_LOG

root="$test_dir/srv/models"
mkdir -p "$root"

MODEL_ROOT="$root" MODEL_ID="Qwen3-0.6B-q4f16_1-MLC" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/first.log"

revision_dir="$root/Qwen3-0.6B-q4f16_1-MLC/resolve/2"

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
assert manifest["revision"] == "2", manifest
# Eight plus four bytes of shards, ten bytes of library.
assert manifest["bytes"] == 22, manifest
assert manifest["shards"] == ["params_shard_0.bin", "params_shard_1.bin"], manifest
for key in ("config", "model_lib"):
    assert manifest["integrity"][key].startswith("sha256-"), manifest
assert manifest["integrity"]["tokenizer"]["tokenizer.json"].startswith("sha256-"), manifest
assert manifest["licence"] == "apache-2.0", manifest
assert manifest["licence_files"] == ["LICENSE"], manifest
assert manifest["notices"][0].startswith("Qwen3-0.6B by Qwen, licensed under the Apache License 2.0"), manifest
# The weights come from the conversion commit the catalog pins, not from main.
assert manifest["source"]["weights"].endswith("/resolve/8c14ce481d4c692769976ad52afea453a102df19"), manifest
assert manifest["source"]["model_lib"].endswith("/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm"), manifest
PY

grep -q "Apache License" "$revision_dir/LICENSE" || {
  echo "bootstrap-models did not serve the Apache-2.0 text beside the weights" >&2
  exit 1
}

# Llama: the licence copy, the Notice file and the notices its licence obliges.
MODEL_ROOT="$root" MODEL_ID="Llama-3.2-1B-Instruct-q4f16_1-MLC" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/llama.log"
llama_dir="$root/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/1"

grep -q "LLAMA 3.2 COMMUNITY LICENSE AGREEMENT" "$llama_dir/LICENSE" || {
  echo "bootstrap-models did not place the Llama 3.2 Community License" >&2
  exit 1
}
grep -Fqx "Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved." "$llama_dir/NOTICE" || {
  echo "bootstrap-models did not place the Llama Notice text file" >&2
  exit 1
}
python3 - "$llama_dir/manifest.json" <<'PY'
import json, sys

manifest = json.load(open(sys.argv[1]))
assert manifest["licence"] == "llama3.2", manifest
assert manifest["licence_files"] == ["LICENSE", "NOTICE"], manifest
assert manifest["attribution"] == "Built with Llama", manifest
assert manifest["notices"][0] == "Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.", manifest
assert any("https://www.llama.com/llama3_2/use-policy" in n for n in manifest["notices"]), manifest
PY
grep -q "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm" "$MOCK_CURL_LOG" || {
  echo "bootstrap-models did not derive the Llama library from the catalog" >&2
  exit 1
}

# A model_id the catalog does not serve is refused before anything is fetched.
: >"$MOCK_CURL_LOG"
if MODEL_ROOT="$root" MODEL_ID="gemma3-1b-it-q4f16_1-MLC" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/unknown.log" 2>&1; then
  echo "bootstrap-models mirrored a model whose licence nobody read" >&2
  exit 1
fi
test ! -s "$MOCK_CURL_LOG" || {
  echo "bootstrap-models fetched something for a model it refused" >&2
  exit 1
}

# A vendored licence text that is not the one that was read is refused, and nothing lands.
tampered="$test_dir/tampered"
mkdir -p "$tampered/deploy/web/third_party/apache-2.0"
printf '%s\n' "not the licence" >"$tampered/deploy/web/third_party/apache-2.0/LICENSE"
if MODEL_ROOT="$root" MODEL_ID="SmolLM2-360M-Instruct-q4f16_1-MLC" \
  MODEL_REPO_ROOT="$tampered" \
  MODEL_CATALOG="$script_dir/../../packages/narration-webllm/src/model-catalog.json" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/tampered.log" 2>&1; then
  echo "bootstrap-models served a licence text nobody read" >&2
  exit 1
fi
test ! -d "$root/SmolLM2-360M-Instruct-q4f16_1-MLC/resolve/1" || {
  echo "bootstrap-models left a revision behind after refusing its licence" >&2
  exit 1
}

# The catalog is the only artifact definition: a run that tries to override one field of it
# is refused before anything is fetched, so no manifest pairs one entry's licence with
# another artifact's bytes.
for retired in MODEL_REVISION=3 MODEL_SOURCE=https://example.invalid/other/resolve/main \
  MODEL_LIB_URL=https://example.invalid/other.wasm; do
  : >"$MOCK_CURL_LOG"
  if env "$retired" MODEL_ROOT="$root" MODEL_ID="SmolLM2-360M-Instruct-q4f16_1-MLC" \
    sh "$script_dir/bootstrap-models.sh" >"$test_dir/override.log" 2>&1; then
    echo "bootstrap-models let $retired override the catalog" >&2
    exit 1
  fi
  test ! -s "$MOCK_CURL_LOG" || {
    echo "bootstrap-models fetched something for a refused override ($retired)" >&2
    exit 1
  }
done
test ! -d "$root/SmolLM2-360M-Instruct-q4f16_1-MLC" || {
  echo "bootstrap-models placed a model under a refused override" >&2
  exit 1
}

# A second run must not refetch: the revision directory is immutable once it exists.
MODEL_ROOT="$root" MODEL_ID="Qwen3-0.6B-q4f16_1-MLC" \
  sh "$script_dir/bootstrap-models.sh" >"$test_dir/second.log"

grep -Fq "Model already present" "$test_dir/second.log" || {
  echo "bootstrap-models refetched an existing revision" >&2
  exit 1
}

# A shard that does not match the size its manifest declares fails the run.
if MODEL_ROOT="$root" MODEL_ID="OLMo-2-0425-1B-Instruct-q4f16_1-MLC" \
  MOCK_SHORT_SHARD=true sh "$script_dir/bootstrap-models.sh" >"$test_dir/short.log" 2>&1; then
  echo "bootstrap-models accepted a shard of the wrong size" >&2
  exit 1
fi

test -d "$root/OLMo-2-0425-1B-Instruct-q4f16_1-MLC" && {
  echo "bootstrap-models left a half-written revision in place" >&2
  exit 1
}

# A relative root is refused before anything is fetched.
if MODEL_ROOT="relative/path" MODEL_ID="Qwen3-0.6B-q4f16_1-MLC" sh "$script_dir/bootstrap-models.sh" >/dev/null 2>&1; then
  echo "bootstrap-models accepted a relative MODEL_ROOT" >&2
  exit 1
fi

echo "bootstrap-models contract holds"
