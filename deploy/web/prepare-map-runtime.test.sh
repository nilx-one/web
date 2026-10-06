#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
set -Eeuo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Parse the embedded downloader as the same CommonJS program `node -` runs.
# This catches syntax errors without contacting the terrain provider.
awk '
  /<<'"'"'NODE'"'"'$/ { capture = 1; next }
  capture && $0 == "NODE" { exit }
  capture { print }
' "$script_dir/prepare-map-runtime.sh" >"$work/terrain-bootstrap.cjs"
node --check "$work/terrain-bootstrap.cjs"

mkdir -p "$work/bin"
cat >"$work/bin/docker" <<'MOCK'
#!/usr/bin/env sh
set -eu
printf '%s\n' "$*" >>"$MOCK_DOCKER_LOG"
case "$1 $2" in
  "volume inspect")
    [ "${MOCK_VOLUME_EXISTS:-false}" = true ]
    ;;
  "volume create")
    printf '%s\n' "$3"
    ;;
  *)
    if [ "$1" = run ]; then
      cat >"$MOCK_DOCKER_STDIN"
      exit "${MOCK_DOCKER_RUN_STATUS:-0}"
    fi
    ;;
esac
MOCK
chmod +x "$work/bin/docker"

provider="$work/provider.env"
: >"$provider"
runtime="$work/runtime.env"
log="$work/docker.log"
stdin="$work/docker.stdin"

PATH="$work/bin:$PATH" \
MOCK_DOCKER_LOG="$log" \
MOCK_DOCKER_STDIN="$stdin" \
  "$script_dir/prepare-map-runtime.sh" "$runtime" "$provider"

grep -Fxq 'NILXONE_MAP_DATA_READY=1' "$runtime"
grep -Fq 'volume create nilxone-web-map-data' "$log"
grep -Fq 'nilxone-web-map-data:/data' "$log"
grep -Fq 'node:24-alpine node -' "$log"
grep -Fq 'const PNG_SIGNATURE = "89504e470d0a1a0a";' "$stdin"
grep -Fq 'format: "terrarium"' "$stdin"

: >"$log"
PATH="$work/bin:$PATH" \
MOCK_VOLUME_EXISTS=true \
MOCK_DOCKER_LOG="$log" \
MOCK_DOCKER_STDIN="$stdin" \
  "$script_dir/prepare-map-runtime.sh" "$runtime" "$provider"
if grep -Fq 'volume create' "$log"; then
  echo "existing map-data volume was recreated" >&2
  exit 1
fi

rm -f "$runtime"
if PATH="$work/bin:$PATH" \
  MOCK_VOLUME_EXISTS=true \
  MOCK_DOCKER_RUN_STATUS=7 \
  MOCK_DOCKER_LOG="$log" \
  MOCK_DOCKER_STDIN="$stdin" \
  "$script_dir/prepare-map-runtime.sh" "$runtime" "$provider" >/dev/null 2>&1; then
  echo "terrain bootstrap unexpectedly accepted a failed downloader" >&2
  exit 1
fi
test ! -e "$runtime"

if PATH="$work/bin:$PATH" \
  MAP_DATA_VOLUME='bad/volume' \
  MOCK_DOCKER_LOG="$log" \
  MOCK_DOCKER_STDIN="$stdin" \
  "$script_dir/prepare-map-runtime.sh" "$runtime" "$provider" >/dev/null 2>&1; then
  echo "terrain bootstrap unexpectedly accepted an invalid volume name" >&2
  exit 1
fi
