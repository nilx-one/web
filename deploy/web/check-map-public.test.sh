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
range_request=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --header)
      [ "$2" = 'Range: bytes=0-16383' ] && range_request=true
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
  https://nilx.one/map/0.1.0/style.json)
    printf '%s\n' '{"sources":{"basemap":{"url":"pmtiles:///map/0.1.0/basemap.pmtiles"}}}' >"$output_file"
    printf '%s' "${MOCK_STYLE_STATUS:-200}"
    ;;
  https://nilx.one/map/0.1.0/style-dark.json)
    printf '%s\n' '{"sources":{"basemap":{"url":"pmtiles:///map/0.1.0/basemap.pmtiles"}}}' >"$output_file"
    printf '%s' "${MOCK_DARK_STYLE_STATUS:-200}"
    ;;
  https://nilx.one/map/0.1.0/basemap.pmtiles)
    if [ "$range_request" = true ]; then
      printf 'PMTilesfixture' >"$output_file"
      printf '%s' "${MOCK_RANGE_STATUS:-206}"
    else
      : >"$output_file"
      printf '%s' 400
    fi
    ;;
  *)
    : >"$output_file"
    printf '%s' 404
    ;;
esac
MOCK
chmod +x "$mock_bin/curl"

PATH="$mock_bin:$PATH" \
  MAP_RETRY=1 \
  sh "$(dirname "$0")/check-map-public.sh"

failure_log="$test_dir/failure.log"
if PATH="$mock_bin:$PATH" \
  MOCK_RANGE_STATUS=200 \
  MAP_RETRY=1 \
  sh "$(dirname "$0")/check-map-public.sh" >"$failure_log" 2>&1; then
  echo "map public smoke unexpectedly accepted a non-Range response" >&2
  exit 1
fi

grep -Fq 'expected HTTP 206 Range response' "$failure_log"

if PATH="$mock_bin:$PATH" \
  MOCK_STYLE_STATUS=404 \
  MAP_RETRY=1 \
  sh "$(dirname "$0")/check-map-public.sh" >"$failure_log" 2>&1; then
  echo "map public smoke unexpectedly accepted a missing style" >&2
  exit 1
fi

grep -Fq 'map style public smoke failed' "$failure_log"

if PATH="$mock_bin:$PATH" \
  MOCK_DARK_STYLE_STATUS=404 \
  MAP_RETRY=1 \
  sh "$(dirname "$0")/check-map-public.sh" >"$failure_log" 2>&1; then
  echo "map public smoke unexpectedly accepted a missing dark appearance style" >&2
  exit 1
fi

grep -Fq 'style-dark.json' "$failure_log"
