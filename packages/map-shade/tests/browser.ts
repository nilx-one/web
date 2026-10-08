// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { Map as MapLibreMap, addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createFogAtlas } from "../src/fog-atlas";
import {
  createWebGlFog,
  createWebGpuFog,
  type FogBackend,
} from "../src/fog-backend";
import { fogParameters } from "../src/fog-material";
import { DARK_FOG_PALETTE } from "../src/fog-palette";

// Run with `pnpm exec vite --host 127.0.0.1`, then open this HTML. All
// geography and terrain are local, deterministic fixtures; no tile service.
const anchor = { lng: 30.5234, lat: 50.4501 };
const cell = latLngToCell(anchor.lat, anchor.lng, 9);
const atlas = createFogAtlas(anchor, 4_000, 512);
atlas.add(cell);
const result = document.querySelector("#result")!;
const report: Record<string, unknown> = {};
const check = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const copy = (backend: FogBackend) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = atlas.size;
  const context = canvas.getContext("2d")!;
  context.drawImage(backend.canvas, 0, 0);
  return {
    canvas,
    pixels: context.getImageData(0, 0, atlas.size, atlas.size).data,
  };
};

async function main() {
  const backends: FogBackend[] = [createWebGlFog(atlas.size, () => {})];
  try {
    backends.push(await createWebGpuFog(atlas.size, () => {}));
  } catch (error) {
    report.webgpuUnavailable = String(error);
  }
  const frames: Uint8ClampedArray[] = [];
  let displayPixels: Uint8ClampedArray<ArrayBuffer> | undefined;
  for (const backend of backends) {
    try {
      await backend.render(
        atlas.mask,
        fogParameters(atlas, DARK_FOG_PALETTE, [], 0, 0.97),
        true,
      );
    } catch (error) {
      if (backend.kind !== "webgpu") throw error;
      report.webgpuUnavailable = String(error);
      backend.dispose();
      continue;
    }
    const first = copy(backend);
    displayPixels = first.pixels;
    frames.push(first.pixels);
    const pixel = (lng: number, lat: number) => {
      const [x, y] = atlas.project(lng, lat);
      return (Math.floor(y) * atlas.size + Math.floor(x)) * 4;
    };
    const [lat, lng] = cellToLatLng(cell);
    check(
      first.pixels[pixel(lng, lat) + 3] === 0,
      `${backend.kind}: occupied cell not clear`,
    );
    const neighbour = gridDisk(cell, 1)[1]!;
    const [nextLat, nextLng] = cellToLatLng(neighbour);
    check(
      first.pixels[pixel(nextLng, nextLat) + 3]! > 240,
      `${backend.kind}: unrevealed neighbour is clear`,
    );
    await backend.render(
      atlas.mask,
      fogParameters(atlas, DARK_FOG_PALETTE, [], 120, 0.97),
      false,
    );
    const later = copy(backend).pixels;
    let changedCoverage = 0;
    for (let index = 3; index < later.length; index += 4)
      if (later[index] !== first.pixels[index]) changedCoverage++;
    check(changedCoverage === 0, `${backend.kind}: animation moved coverage`);
    report[backend.kind] = {
      occupiedAlpha: first.pixels[pixel(lng, lat) + 3],
      neighbourAlpha: first.pixels[pixel(nextLng, nextLat) + 3],
      changedCoverage,
    };
    backend.dispose();
  }
  if (frames.length === 2) {
    let max = 0;
    let alphaMismatch = 0;
    for (let index = 0; index < frames[0]!.length; index++) {
      max = Math.max(max, Math.abs(frames[0]![index]! - frames[1]![index]!));
      if (index % 4 === 3 && frames[0]![index] !== frames[1]![index])
        alphaMismatch++;
    }
    report.parity = { maxChannelDifference: max, alphaMismatch };
    check(alphaMismatch === 0, "Backend coverage mismatch");
    check(max <= 3, "Backend colour mismatch");
  }
  const dem = document.createElement("canvas");
  dem.width = dem.height = 256;
  // A failed WebGPU device can reset the GPU process and wipe accelerated 2D
  // canvases. Fixtures stay in software canvases, and the fog frame is rebuilt
  // from pixels read back before any later backend could fail.
  const dc = dem.getContext("2d", { willReadFrequently: true })!;
  dc.fillStyle = "rgb(1, 142, 112)";
  dc.fillRect(0, 0, 256, 256); // 200m, Mapbox RGB
  const blob = await new Promise<Blob>((resolve) =>
    dem.toBlob((value) => resolve(value!)),
  );
  const bytes = await blob.arrayBuffer();
  addProtocol("fogdem", async () => ({ data: bytes.slice(0) }));
  const map = new MapLibreMap({
    container: "map",
    center: anchor,
    zoom: 16,
    pitch: 60,
    bearing: 30,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    style: {
      version: 8,
      sources: {
        dem: {
          type: "raster-dem",
          tiles: ["fogdem:///{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 14,
          encoding: "mapbox",
        },
      },
      layers: [
        {
          id: "ground",
          type: "background",
          paint: { "background-color": "#ffffff" },
        },
      ],
    },
  });
  await new Promise<void>((resolve) => map.on("load", () => resolve()));
  map.setTerrain({ source: "dem", exaggeration: 1 });
  const display = document.createElement("canvas");
  display.width = display.height = atlas.size;
  display
    .getContext("2d", { willReadFrequently: true })!
    .putImageData(new ImageData(displayPixels!, atlas.size, atlas.size), 0, 0);
  map.addSource("fog", {
    type: "canvas",
    canvas: display,
    coordinates: atlas.coordinates,
    animate: false,
  });
  map.addLayer({
    id: "fog",
    type: "raster",
    source: "fog",
    paint: { "raster-fade-duration": 0 },
  });
  Object.assign(window, {
    fogTest: { report, map, atlas, cell, cellToLatLng, gridDisk },
  });
  result.textContent = JSON.stringify(report, null, 2);
  document.documentElement.dataset.result = "passed";
}
void main().catch((error: unknown) => {
  result.textContent = String(error);
  document.documentElement.dataset.result = "failed";
});
