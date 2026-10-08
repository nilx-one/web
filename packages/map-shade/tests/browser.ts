// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { addProtocol, type MapOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createFogAtlas } from "../src/fog-atlas";
import {
  createWebGlFog,
  createWebGpuFog,
  type FogBackend,
} from "../src/fog-backend";
import { fogParameters } from "../src/fog-material";
import { DARK_FOG_PALETTE } from "../src/fog-palette";
import { createShadeMapFactory, type ShadeRuntime } from "../src/map-factory";

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
const copy = (frame: HTMLCanvasElement) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = atlas.size;
  const context = canvas.getContext("2d")!;
  context.drawImage(frame, 0, 0);
  return {
    canvas,
    pixels: context.getImageData(0, 0, atlas.size, atlas.size).data,
  };
};

async function main() {
  const backends: FogBackend[] = [createWebGlFog(atlas.size, () => {})];
  // `?webgpu=0` keeps WebGPU out of the page: where a failed WebGPU attempt
  // drops the GPU instance (headless SwiftShader), it blanks every 2D canvas
  // in the page, MapLibre's drape included. The checker reads parity from one
  // page and geography from another.
  const webgpu = new URLSearchParams(location.search).get("webgpu") !== "0";
  if (webgpu)
    try {
      backends.push(await createWebGpuFog(atlas.size, () => {}));
    } catch (error) {
      report.webgpuUnavailable = String(error);
    }
  else report.webgpuSkipped = true;
  const frames: Uint8ClampedArray[] = [];
  for (const backend of backends) {
    // Read each frame where production does: in the task it was drawn in.
    let presented: ReturnType<typeof copy> | undefined;
    const present = (frame: HTMLCanvasElement) => {
      presented = copy(frame);
    };
    try {
      await backend.render(
        atlas.mask,
        fogParameters(atlas, DARK_FOG_PALETTE, [], 0, 0.97),
        true,
        present,
      );
    } catch (error) {
      if (backend.kind !== "webgpu") throw error;
      report.webgpuUnavailable = String(error);
      backend.dispose();
      continue;
    }
    const first = presented!;
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
      present,
    );
    const later = presented!.pixels;
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
  // canvases; the DEM fixture stays in a software canvas.
  const dc = dem.getContext("2d", { willReadFrequently: true })!;
  dc.fillStyle = "rgb(1, 142, 112)";
  dc.fillRect(0, 0, 256, 256); // 200m, Mapbox RGB
  const blob = await new Promise<Blob>((resolve) =>
    dem.toBlob((value) => resolve(value!)),
  );
  const bytes = await blob.arrayBuffer();
  addProtocol("fogdem", async () => ({ data: bytes.slice(0) }));
  // The geographic samples go through the production composition, under
  // terrain from the start. As in production, the journal settles after the
  // map has drawn its terrain, so a drape is cached before any fog frame.
  // WebGPU parity is checked above. Here a slow handshake that finds no
  // adapter stands in for a real device: the map keeps drawing its blank fog
  // canvas meanwhile, as a phone does, and no software device is left to fail
  // and reset the GPU process (which would redraw every drape and hide a stale
  // one).
  Object.defineProperty(navigator, "gpu", {
    value: {
      requestAdapter: () =>
        new Promise((resolve) => setTimeout(() => resolve(null), 1_000)),
    },
  });
  let settle: (runtime: ShadeRuntime) => void = () => undefined;
  const runtime = new Promise<ShadeRuntime>((resolve) => (settle = resolve));
  const createMap = createShadeMapFactory({
    runtime,
    anchor,
    fogPalettes: { light: DARK_FOG_PALETTE, dark: DARK_FOG_PALETTE },
    prefersReducedMotion: () => true,
  });
  const map = createMap({
    container: "map",
    // Start where the stale drape was seen on a phone, 6 km from the anchor.
    center: { lng: 30.44, lat: 50.475 },
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
      terrain: { source: "dem", exaggeration: 1 },
      layers: [
        {
          id: "ground",
          type: "background",
          paint: { "background-color": "#ffffff" },
        },
      ],
    },
  } as MapOptions);
  await new Promise<void>((resolve) => map.on("load", () => resolve()));
  await new Promise((resolve) => {
    map.once("idle", resolve);
    map.triggerRepaint();
  });
  settle({
    source: {
      litCells: () => [cell],
      isLit: (candidate) => candidate === cell,
      onCellLit: () => () => undefined,
    },
    store: {
      append: async () => undefined,
      listCells: async () => [cell],
      recordsForCell: async () => [],
      subscribe: () => () => undefined,
    },
  });
  const errors: string[] = [];
  map.on("error", (event) => errors.push(String(event.error)));
  // The fog renders asynchronously (WebGPU first, WebGL after). Wait for the
  // unrevealed screen centre to turn foggy: under terrain this proves a fog
  // frame published after attachment reaches the already-draped ground.
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const probeContext = probe.getContext("2d", { willReadFrequently: true })!;
  const deadline = performance.now() + 20_000;
  for (;;) {
    map.triggerRepaint();
    await new Promise((resolve) => map.once("render", resolve));
    const point = map.project(map.getCenter());
    const ratio = map.getCanvas().width / map.getContainer().clientWidth;
    probeContext.clearRect(0, 0, 1, 1);
    probeContext.drawImage(
      map.getCanvas(),
      Math.round(point.x * ratio),
      Math.round(point.y * ratio),
      1,
      1,
      0,
      0,
      1,
      1,
    );
    const [r, g, b] = probeContext.getImageData(0, 0, 1, 1).data;
    if (r! < 200 || g! < 200 || b! < 200) break;
    check(errors.length === 0, errors.join("; "));
    check(performance.now() < deadline, "Fog frame never reached the map");
  }
  Object.assign(window, {
    fogTest: { report, map, errors, cell, cellToLatLng, gridDisk },
  });
  result.textContent = JSON.stringify(report, null, 2);
  document.documentElement.dataset.result = "passed";
}
void main().catch((error: unknown) => {
  result.textContent = String(error);
  document.documentElement.dataset.result = "failed";
});
