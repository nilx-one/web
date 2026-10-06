#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

public_origin="${PUBLIC_ORIGIN:-https://nilx.one}"
map_version="${MAP_CONTRACT_VERSION:-0.1.0}"
retry="${MAP_RETRY:-12}"
retry_delay="${MAP_RETRY_DELAY:-2}"

case "$public_origin" in
  https://*) ;;
  *)
    echo "PUBLIC_ORIGIN must use HTTPS" >&2
    exit 2
    ;;
esac

case "$map_version" in
  *[!0-9A-Za-z._-]*|'')
    echo "MAP_CONTRACT_VERSION contains unsupported characters" >&2
    exit 2
    ;;
esac

case "$retry:$retry_delay" in
  *[!0-9:]*|:*|*:)
    echo "MAP_RETRY and MAP_RETRY_DELAY must be unsigned integers" >&2
    exit 2
    ;;
esac

public_origin="${public_origin%/}"
style_url="$public_origin/map/$map_version/style.json"
dark_style_url="$public_origin/map/$map_version/style-dark.json"
basemap_url="$public_origin/map/$map_version/basemap.pmtiles"
terrain_url="$public_origin/map/$map_version/terrain/12/2395/1381.png"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
style_file="$work_dir/style.json"
dark_style_file="$work_dir/style-dark.json"
range_file="$work_dir/basemap.range"
terrain_file="$work_dir/terrain.png"
terrain_file="$work_dir/terrain.png"

attempt=1
while [ "$attempt" -le "$retry" ]; do
  style_status="$(
    curl --silent --show-error \
      --connect-timeout 5 \
      --max-time 15 \
      --output "$style_file" \
      --write-out '%{http_code}' \
      "$style_url" || true
  )"

  if [ "$style_status" = 200 ] \
    && grep -Fq "pmtiles:///map/$map_version/basemap.pmtiles" "$style_file" \
    && grep -Fq "/map/$map_version/terrain/{z}/{x}/{y}.png" "$style_file"; then
    break
  fi

  if [ "$attempt" -eq "$retry" ]; then
    echo "map style public smoke failed: expected versioned PMTiles source from $style_url, got ${style_status:-request-failed}" >&2
    exit 1
  fi

  sleep "$retry_delay"
  attempt=$((attempt + 1))
done

dark_style_status="$(
  curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 15 \
    --output "$dark_style_file" \
    --write-out '%{http_code}' \
    "$dark_style_url" || true
)"

if [ "$dark_style_status" != 200 ] \
  || ! grep -Fq "pmtiles:///map/$map_version/basemap.pmtiles" "$dark_style_file" \
  || ! grep -Fq "/map/$map_version/terrain/{z}/{x}/{y}.png" "$dark_style_file"; then
  echo "map style public smoke failed: expected versioned PMTiles source from $dark_style_url, got ${dark_style_status:-request-failed}" >&2
  exit 1
fi

range_status="$(
  curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 15 \
    --header 'Range: bytes=0-16383' \
    --output "$range_file" \
    --write-out '%{http_code}' \
    "$basemap_url" || true
)"

if [ "$range_status" != 206 ]; then
  echo "map PMTiles public smoke failed: expected HTTP 206 Range response from $basemap_url, got ${range_status:-request-failed}" >&2
  exit 1
fi

test -s "$range_file" || {
  echo "map PMTiles public smoke failed: Range response was empty" >&2
  exit 1
}

printf 'PMTiles' | cmp -n 7 - "$range_file" >/dev/null 2>&1 || {
  echo "map PMTiles public smoke failed: archive header is invalid" >&2
  exit 1
}

terrain_status="$(
  curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 15 \
    --output "$terrain_file" \
    --write-out '%{http_code}' \
    "$terrain_url" || true
)"

if [ "$terrain_status" != 200 ]; then
  echo "map terrain public smoke failed: expected HTTP 200 from $terrain_url, got ${terrain_status:-request-failed}" >&2
  exit 1
fi

test -s "$terrain_file" || {
  echo "map terrain public smoke failed: terrain response was empty" >&2
  exit 1
}

signature="$(od -An -tx1 -N8 "$terrain_file" | tr -d '[:space:]')"
if [ "$signature" != "89504e470d0a1a0a" ]; then
  echo "map terrain public smoke failed: tile is not a PNG" >&2
  exit 1
fi

echo "map public boundary healthy: light style 200, dark style 200, PMTiles Range 206, terrain PNG 200"
