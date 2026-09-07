#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Prints the source layers and attributes the published PMTiles archive
# actually declares. A map style may only read what this reports: the
# published archive is the authority on the schema, not a generic vector-tile
# schema a style happens to resemble.
#
#   MAP_BASEMAP_PATH=/srv/nilx-one/map/basemap.pmtiles deploy/web/inspect-basemap.sh
set -eu

: "${MAP_BASEMAP_PATH:?MAP_BASEMAP_PATH is required}"

PMTILES_IMAGE="${PMTILES_IMAGE:-ghcr.io/protomaps/go-pmtiles:v1.31.2}"

case "$MAP_BASEMAP_PATH" in
  /*) ;;
  *)
    echo "MAP_BASEMAP_PATH must be absolute" >&2
    exit 2
    ;;
esac

if [ ! -s "$MAP_BASEMAP_PATH" ]; then
  echo "No basemap archive at $MAP_BASEMAP_PATH" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "docker is required to inspect the PMTiles basemap" >&2
  exit 1
}

archive_dir="$(dirname "$MAP_BASEMAP_PATH")"
archive_name="$(basename "$MAP_BASEMAP_PATH")"

echo "Archive: $MAP_BASEMAP_PATH"
docker run --rm \
  -v "$archive_dir:/data:ro" \
  "$PMTILES_IMAGE" \
  show "/data/$archive_name"

echo
echo "Declared source layers and attributes:"

# The tile metadata carries the archive's own vector_layers declaration. jq
# formats it when present; without jq the raw metadata is still printed, so the
# inspection never depends on a tool the server may not have.
metadata="$(docker run --rm \
  -v "$archive_dir:/data:ro" \
  "$PMTILES_IMAGE" \
  show --metadata "/data/$archive_name")"

if command -v jq >/dev/null 2>&1; then
  printf '%s' "$metadata" | jq -r '
    (.vector_layers // [])[]
    | "  \(.id) (zoom \(.minzoom // "?")-\(.maxzoom // "?"))\n"
      + ((.fields // {}) | to_entries | map("      \(.key): \(.value)") | join("\n"))
  '
else
  printf '%s\n' "$metadata"
fi
