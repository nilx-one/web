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
    model_id="$(printf '%s' "$url" | sed 's#.*/models/\([^/]*\)/resolve/.*#\1#')"
    printf '{"model_id":"%s","bytes":22}' "$model_id" >"$output_file"
    printf '%s' "${MOCK_MANIFEST_STATUS:-200}"
    printf '%s\n' "$url" >>"${MOCK_CURL_LOG:-/dev/null}"
    ;;
  */LICENSE|*/NOTICE)
    : >"$output_file"
    case "$url" in
      *Llama*/NOTICE) printf '%s' "${MOCK_LLAMA_NOTICE_STATUS:-200}" ;;
      *) printf '%s' 200 ;;
    esac
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
MOCK_CURL_LOG="$test_dir/curl.log"
export PATH MOCK_CURL_LOG

MODEL_RETRY=1 MODEL_RETRY_DELAY=0 sh "$script_dir/check-models-public.sh" >/dev/null

# Every served entry is asked about, each at the revision the catalog names.
test "$(wc -l <"$MOCK_CURL_LOG")" -eq 5 || {
  echo "check-models-public did not cover every served entry" >&2
  exit 1
}
grep -Fq "/models/Qwen3-0.6B-q4f16_1-MLC/resolve/2/manifest.json" "$MOCK_CURL_LOG" || {
  echo "check-models-public did not ask for the default at its catalog revision" >&2
  exit 1
}

MOCK_LLAMA_NOTICE_STATUS=404 MODEL_RETRY=1 MODEL_RETRY_DELAY=0 \
  sh "$script_dir/check-models-public.sh" >/dev/null 2>&1 && {
  echo "check-models-public passed Llama weights served without their Notice file" >&2
  exit 1
}

MODEL_ID="gemma3-1b-it-q4f16_1-MLC" MODEL_RETRY=1 MODEL_RETRY_DELAY=0 \
  sh "$script_dir/check-models-public.sh" >/dev/null 2>&1 && {
  echo "check-models-public passed a model the catalog does not serve" >&2
  exit 1
}

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
