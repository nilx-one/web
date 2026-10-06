#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Prepares server-owned map deployment data before a client release is
# activated. The browser never reaches the upstream terrain provider: it reads
# only the same-origin tiles Caddy serves from the persistent map-data volume.
set -Eeuo pipefail

runtime_env="${1:?runtime env output path is required}"
: "${2:?provider env path is required}"

MAP_DATA_VOLUME="${MAP_DATA_VOLUME:-nilxone-web-map-data}"
TERRAIN_BBOX="${TERRAIN_BBOX:-29.75,49.95,31.35,51.15}"
TERRAIN_MIN_ZOOM="${TERRAIN_MIN_ZOOM:-8}"
TERRAIN_MAX_ZOOM="${TERRAIN_MAX_ZOOM:-12}"
TERRAIN_CONCURRENCY="${TERRAIN_CONCURRENCY:-12}"
TERRAIN_UPSTREAM_BASE="${TERRAIN_UPSTREAM_BASE:-https://s3.amazonaws.com/elevation-tiles-prod/terrarium}"
NODE_IMAGE="${NODE_IMAGE:-node:24-alpine}"

case "$MAP_DATA_VOLUME" in
  *[!a-zA-Z0-9_.-]*|'')
    echo "MAP_DATA_VOLUME contains unsupported characters" >&2
    exit 2
    ;;
esac

for value_name in TERRAIN_MIN_ZOOM TERRAIN_MAX_ZOOM TERRAIN_CONCURRENCY; do
  value="${!value_name}"
  [[ "$value" =~ ^[0-9]+$ ]] || {
    echo "$value_name must be an unsigned integer" >&2
    exit 2
  }
done

(( TERRAIN_MIN_ZOOM <= TERRAIN_MAX_ZOOM )) || {
  echo "TERRAIN_MIN_ZOOM must not exceed TERRAIN_MAX_ZOOM" >&2
  exit 2
}
(( TERRAIN_MAX_ZOOM <= 22 )) || {
  echo "TERRAIN_MAX_ZOOM must be at most 22" >&2
  exit 2
}
(( TERRAIN_CONCURRENCY >= 1 && TERRAIN_CONCURRENCY <= 32 )) || {
  echo "TERRAIN_CONCURRENCY must be between 1 and 32" >&2
  exit 2
}
[[ "$TERRAIN_UPSTREAM_BASE" == https://* ]] || {
  echo "TERRAIN_UPSTREAM_BASE must use HTTPS" >&2
  exit 2
}

command -v docker >/dev/null 2>&1 || {
  echo "docker is required to prepare terrain data" >&2
  exit 1
}

if ! docker volume inspect "$MAP_DATA_VOLUME" >/dev/null 2>&1; then
  docker volume create "$MAP_DATA_VOLUME" >/dev/null
fi

echo "Preparing regional terrain in Docker volume: $MAP_DATA_VOLUME"
echo "Coverage bbox: $TERRAIN_BBOX; zooms: $TERRAIN_MIN_ZOOM-$TERRAIN_MAX_ZOOM"

docker run --rm -i \
  -v "$MAP_DATA_VOLUME:/data" \
  -e TERRAIN_BBOX="$TERRAIN_BBOX" \
  -e TERRAIN_MIN_ZOOM="$TERRAIN_MIN_ZOOM" \
  -e TERRAIN_MAX_ZOOM="$TERRAIN_MAX_ZOOM" \
  -e TERRAIN_CONCURRENCY="$TERRAIN_CONCURRENCY" \
  -e TERRAIN_UPSTREAM_BASE="$TERRAIN_UPSTREAM_BASE" \
  "$NODE_IMAGE" node - <<'NODE'
(async () => {
const fs = require("node:fs");
const path = require("node:path");

const PNG_SIGNATURE = "89504e470d0a1a0a";
const bbox = String(process.env.TERRAIN_BBOX ?? "")
  .split(",")
  .map(Number);
const minZoom = Number(process.env.TERRAIN_MIN_ZOOM);
const maxZoom = Number(process.env.TERRAIN_MAX_ZOOM);
const concurrency = Number(process.env.TERRAIN_CONCURRENCY);
const upstream = new URL(String(process.env.TERRAIN_UPSTREAM_BASE));

if (
  bbox.length !== 4 ||
  bbox.some((value) => !Number.isFinite(value)) ||
  !Number.isInteger(minZoom) ||
  !Number.isInteger(maxZoom) ||
  !Number.isInteger(concurrency)
) {
  throw new Error("invalid terrain bootstrap configuration");
}

const [west, south, east, north] = bbox;
if (
  !(west < east && south < north) ||
  west < -180 ||
  east > 180 ||
  south < -85.05112878 ||
  north > 85.05112878
) {
  throw new Error("terrain bbox is outside Web Mercator");
}

function tileX(longitude, zoom) {
  const scale = 2 ** zoom;
  return Math.max(
    0,
    Math.min(scale - 1, Math.floor(((longitude + 180) / 360) * scale)),
  );
}

function tileY(latitude, zoom) {
  const scale = 2 ** zoom;
  const radians = (latitude * Math.PI) / 180;
  const projected =
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale;
  return Math.max(0, Math.min(scale - 1, Math.floor(projected)));
}

function isPng(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 8) return false;
    const handle = fs.openSync(file, "r");
    const signature = Buffer.alloc(8);
    fs.readSync(handle, signature, 0, 8, 0);
    fs.closeSync(handle);
    return signature.toString("hex") === PNG_SIGNATURE;
  } catch {
    return false;
  }
}

const tiles = [];
for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
  const minX = tileX(west, zoom);
  const maxX = tileX(east, zoom);
  const minY = tileY(north, zoom);
  const maxY = tileY(south, zoom);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({ zoom, x, y });
    }
  }
}

let cursor = 0;
let fetched = 0;
let cached = 0;

async function download(tile) {
  const directory = path.join("/data/terrain", String(tile.zoom), String(tile.x));
  const target = path.join(directory, `${tile.y}.png`);
  if (isPng(target)) {
    cached += 1;
    return;
  }

  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.unlinkSync(target);
  } catch {}

  const relative = `${tile.zoom}/${tile.x}/${tile.y}.png`;
  const url = new URL(
    `${upstream.pathname.replace(/\/$/, "")}/${relative}`,
    upstream,
  );

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length < 8 ||
        bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE
      ) {
        throw new Error("response is not a PNG terrain tile");
      }
      const temporary = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
      fetched += 1;
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }
  throw new Error(`terrain tile ${relative} failed: ${String(lastError)}`);
}

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= tiles.length) return;
    await download(tiles[index]);
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, tiles.length) }, () => worker()),
);

const manifest = {
  schema: 1,
  format: "terrarium",
  bounds: bbox,
  minzoom: minZoom,
  maxzoom: maxZoom,
  tileSize: 256,
  tileCount: tiles.length,
  upstream: upstream.origin + upstream.pathname.replace(/\/$/, ""),
};
fs.mkdirSync("/data/terrain", { recursive: true });
fs.writeFileSync(
  "/data/terrain/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `terrain ready: ${tiles.length} tiles (${fetched} fetched, ${cached} cached)`,
);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

# The infra prepareEnv contract requires a non-empty output. This file is a
# readiness witness for the pre-activation step; terrain itself stays in the
# persistent map-data volume and is mounted read-only by the runtime.
install -m 0600 /dev/null "$runtime_env"
printf 'NILXONE_MAP_DATA_READY=1\n' >"$runtime_env"
