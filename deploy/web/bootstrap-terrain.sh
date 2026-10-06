#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
set -eu

: "${MAP_DATA_VOLUME:?MAP_DATA_VOLUME is required}"

TERRAIN_IMAGE="${TERRAIN_IMAGE:-alpine:3.22}"
TERRAIN_SOURCE_URL="${TERRAIN_SOURCE_URL:-https://s3.amazonaws.com/elevation-tiles-prod/terrarium}"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required to bootstrap terrain tiles" >&2
  exit 1
}

docker volume inspect "$MAP_DATA_VOLUME" >/dev/null 2>&1 || {
  echo "MAP_DATA_VOLUME does not exist: $MAP_DATA_VOLUME" >&2
  exit 1
}

echo "Bootstrapping regional Terrarium DEM into Docker volume: $MAP_DATA_VOLUME"
echo "Coverage bbox: 29.75,49.95,31.35,51.15; zooms: 7-12"

docker run --rm \
  --env "TERRAIN_SOURCE_URL=$TERRAIN_SOURCE_URL" \
  --volume "$MAP_DATA_VOLUME:/data" \
  "$TERRAIN_IMAGE" \
  sh -ceu '
    apk add --no-cache ca-certificates curl >/dev/null

    target=/data/terrain
    central_tile="$target/12/2395/1381.png"

    png_ok() {
      [ -s "$1" ] || return 1
      signature="$(dd if="$1" bs=1 count=8 2>/dev/null | od -An -tx1 | tr -d " \n")"
      [ "$signature" = 89504e470d0a1a0a ]
    }

    if [ -f "$target/.complete" ]; then
      png_ok "$central_tile" || {
        echo "terrain completion marker exists but the Kyiv verification tile is invalid" >&2
        exit 1
      }
      echo "Terrain already present: $target"
      exit 0
    fi

    if [ -e "$target" ]; then
      echo "terrain directory exists without a completion marker; refusing implicit replacement" >&2
      exit 1
    fi

    tmp="/data/.terrain.tmp.$$"
    cleanup() {
      rm -rf "$tmp"
    }
    trap cleanup EXIT HUP INT TERM
    mkdir -p "$tmp"

    # Exact slippy-tile ranges for 29.75,49.95,31.35,51.15. Keeping the
    # reviewed coverage table explicit makes provisioning deterministic and
    # avoids depending on a GIS runtime on the production host.
    while read -r z xmin xmax ymin ymax; do
      x="$xmin"
      while [ "$x" -le "$xmax" ]; do
        y="$ymin"
        while [ "$y" -le "$ymax" ]; do
          dir="$tmp/$z/$x"
          mkdir -p "$dir"
          part="$dir/$y.png.part"
          tile="$dir/$y.png"
          url="$TERRAIN_SOURCE_URL/$z/$x/$y.png"
          curl --fail --silent --show-error --retry 3 --connect-timeout 10 \
            --max-time 60 --output "$part" "$url"
          png_ok "$part" || {
            echo "invalid terrain PNG: $url" >&2
            exit 1
          }
          mv "$part" "$tile"
          y=$((y + 1))
        done
        x=$((x + 1))
      done
    done <<RANGES
7 74 75 42 43
8 149 150 85 86
9 298 300 171 173
10 596 601 342 347
11 1193 1202 684 695
12 2386 2404 1368 1390
RANGES

    cat >"$tmp/provenance.txt" <<EOF
dataset=Mapzen Terrain Tiles
encoding=terrarium
source=$TERRAIN_SOURCE_URL
bbox=29.75,49.95,31.35,51.15
min_zoom=7
max_zoom=12
tiles=610
EOF

    touch "$tmp/.complete"
    chmod -R a=rX,u+w "$tmp"
    mv "$tmp" "$target"
    trap - EXIT HUP INT TERM
    echo "Terrain ready: $target"
  '
