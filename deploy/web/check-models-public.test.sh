#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

mock_bin="$test_dir/bin"
mkdir -p "$mock_bin"

cat >"$mock_bin/curl" <<'MOCK'
#!/usr/bin/env sh
set -eu

output_file=''
header_file=''
url=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --dump-header)
      header_file="$2"
      shift 2
      ;;
    --connect-timeout|--max-time|--write-out)
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
  */manifest.json)
    printf '%s' '{"model_id":"Qwen3-0.6B-q4f16_1-MLC","revision":"1","bytes":22}' >"$output_file"
    printf '%s' "${MOCK_MANIFEST_STATUS:-200}"
    ;;
  */mlc-chat-config.json)
    printf '%s' '{"context_window_size":4096}' >"$output_file"
    printf '%s' "${MOCK_CONFIG_STATUS:-200}"
    ;;
  */model.wasm)
    if [ -n "$header_file" ]; then
      {
        printf 'HTTP/2 200\n'
        if [ "${MOCK_LIB_IMMUTABLE:-true}" = true ]; then
          printf 'cache-control: public, max-age=31536000, immutable\n'
        else
          printf 'cache-control: public, max-age=60\n'
        fi
      } >"$header_file"
    fi
    printf '%s' "${MOCK_LIB_STATUS:-200}"
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

MODEL_RETRY=1 MODEL_RETRY_DELAY=0 sh "$script_dir/check-models-public.sh" >/dev/null

MOCK_MANIFEST_STATUS=404 MODEL_RETRY=1 MODEL_RETRY_DELAY=0 \
  sh "$script_dir/check-models-public.sh" >/dev/null 2>&1 && {
  echo "check-models-public passed a missing manifest" >&2
  exit 1
}

MOCK_CONFIG_STATUS=500 MODEL_RETRY=1 MODEL_RETRY_DELAY=0 \
  sh "$script_dir/check-models-public.sh" >/dev/null 2>&1 && {
  echo "check-models-public passed a failing chat config" >&2
  exit 1
}

MOCK_LIB_IMMUTABLE=false MODEL_RETRY=1 MODEL_RETRY_DELAY=0 \
  sh "$script_dir/check-models-public.sh" >/dev/null 2>&1 && {
  echo "check-models-public passed a library served without immutable caching" >&2
  exit 1
}

PUBLIC_ORIGIN="http://nilx.one" sh "$script_dir/check-models-public.sh" >/dev/null 2>&1 && {
  echo "check-models-public accepted a plaintext origin" >&2
  exit 1
}

echo "check-models-public contract holds"
