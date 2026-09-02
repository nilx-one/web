#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

mock_bin="$test_dir/bin"
mkdir -p "$mock_bin"

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
  https://nilx.one/|https://nilx.one/telegram/|https://nilx.one/discord/)
    printf '%s\n' '<div id="root"></div>' >"$output_file"
    printf '%s' "${MOCK_CLIENT_STATUS:-200}"
    ;;
  *)
    printf '%s\n' 'unexpected URL' >"$output_file"
    printf '%s' 404
    ;;
esac
MOCK
chmod +x "$mock_bin/curl"

for target_path in 'web /' 'telegram /telegram/' 'discord /discord/'; do
  set -- $target_path
  PATH="$mock_bin:$PATH" \
    CLIENT_NAME="$1" \
    PUBLIC_PATH="$2" \
    HEALTH_RETRY=1 \
    sh "$(dirname "$0")/check-public.sh"
done

failure_log="$test_dir/failure.log"
if PATH="$mock_bin:$PATH" \
  CLIENT_NAME=discord \
  PUBLIC_PATH=/discord/ \
  MOCK_CLIENT_STATUS=502 \
  HEALTH_RETRY=1 \
  sh "$(dirname "$0")/check-public.sh" >"$failure_log" 2>&1; then
  echo "client public smoke unexpectedly accepted 502" >&2
  exit 1
fi

grep -Fq 'discord expected 200' "$failure_log"
