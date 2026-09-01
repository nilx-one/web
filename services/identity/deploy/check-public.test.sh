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
  https://nilx.one/)
    printf '%s\n' '<div id="root"></div>' >"$output_file"
    printf '%s' 200
    ;;
  https://nilx.one/telegram/|https://nilx.one/discord/)
    printf '%s\n' 'not found' >"$output_file"
    printf '%s' 404
    ;;
  https://nilx.one/api/v1/identity)
    printf '%s\n' '{"error":{"code":"provider_authentication_required"}}' >"$output_file"
    printf '%s' "${MOCK_IDENTITY_STATUS:-401}"
    ;;
  *)
    printf '%s\n' 'unexpected URL' >"$output_file"
    printf '%s' 404
    ;;
esac
MOCK
chmod +x "$mock_bin/curl"

PATH="$mock_bin:$PATH" \
  HEALTH_RETRY=1 \
  sh "$(dirname "$0")/check-public.sh"

failure_log="$test_dir/failure.log"
if PATH="$mock_bin:$PATH" \
  MOCK_IDENTITY_STATUS=502 \
  HEALTH_RETRY=1 \
  sh "$(dirname "$0")/check-public.sh" >"$failure_log" 2>&1; then
  echo "public smoke unexpectedly accepted identity 502" >&2
  exit 1
fi

grep -Fq 'identity-auth-boundary expected 401' "$failure_log"
