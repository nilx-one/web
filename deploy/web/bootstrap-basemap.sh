#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
set -eu

: "${MAP_BASEMAP_PATH:?MAP_BASEMAP_PATH is required}"

PMTILES_IMAGE="${PMTILES_IMAGE:-ghcr.io/protomaps/go-pmtiles:v1.31.2}"
MAP_BBOX="${MAP_BBOX:-29.75,49.95,31.35,51.15}"
PROTOMAPS_BUILD_URL="${PROTOMAPS_BUILD_URL:-}"

case "$MAP_BASEMAP_PATH" in
  /*) ;;
  *)
    echo "MAP_BASEMAP_PATH must be absolute" >&2
    exit 1
    ;;
esac

if [ -s "$MAP_BASEMAP_PATH" ]; then
  echo "Basemap already present: $MAP_BASEMAP_PATH"
  exit 0
fi

command -v docker >/dev/null 2>&1 || {
  echo "docker is required to bootstrap the PMTiles basemap" >&2
  exit 1
}

target_dir="$(dirname "$MAP_BASEMAP_PATH")"
target_name="$(basename "$MAP_BASEMAP_PATH")"
tmp_name=".${target_name}.tmp.$$"
mkdir -p "$target_dir"

cleanup() {
  rm -f "$target_dir/$tmp_name"
}
trap cleanup EXIT HUP INT TERM

if [ -z "$PROTOMAPS_BUILD_URL" ]; then
  offset=0
  while [ "$offset" -le 7 ]; do
    build_date="$(date -u -d "-$offset day" +%Y%m%d 2>/dev/null || true)"
    if [ -z "$build_date" ]; then
      echo "Unable to resolve a recent Protomaps build date; set PROTOMAPS_BUILD_URL explicitly" >&2
      exit 1
    fi

    candidate="https://build.protomaps.com/${build_date}.pmtiles"
    if docker run --rm "$PMTILES_IMAGE" show "$candidate" >/dev/null 2>&1; then
      PROTOMAPS_BUILD_URL="$candidate"
      break
    fi
    offset=$((offset + 1))
  done
fi

if [ -z "$PROTOMAPS_BUILD_URL" ]; then
  echo "No usable Protomaps daily build found in the last 8 UTC days" >&2
  exit 1
fi

echo "Bootstrapping regional basemap from $PROTOMAPS_BUILD_URL"
echo "Coverage bbox: $MAP_BBOX"

docker run --rm \
  -v "$target_dir:/data" \
  "$PMTILES_IMAGE" \
  extract "$PROTOMAPS_BUILD_URL" "/data/$tmp_name" --bbox="$MAP_BBOX"

docker run --rm \
  -v "$target_dir:/data" \
  "$PMTILES_IMAGE" \
  verify "/data/$tmp_name"

test -s "$target_dir/$tmp_name"
mv "$target_dir/$tmp_name" "$MAP_BASEMAP_PATH"
chmod 0644 "$MAP_BASEMAP_PATH"
trap - EXIT HUP INT TERM

echo "Basemap ready: $MAP_BASEMAP_PATH"
