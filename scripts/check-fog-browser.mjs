// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
/* global document, window, console */

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  // MapLibre's worker is a separate module: Vite's dependency optimizer
  // otherwise rewrites it to a missing node_modules/.vite/deps URL.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: { host: "127.0.0.1", port: 4177, strictPort: true },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    args: [
      "--enable-unsafe-webgpu",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  let page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "http://127.0.0.1:4177/packages/map-shade/tests/browser.html",
  );
  await page.waitForFunction(() => document.documentElement.dataset.result, {
    timeout: 60_000,
  });
  const result = await page.locator("#result").innerText();
  assert.equal(
    await page.locator("html").getAttribute("data-result"),
    "passed",
    result,
  );
  const report = await page.evaluate(() => window.fogTest.report);
  assert.ok(
    report.webgpu || report.webgpuUnavailable,
    "WebGPU must execute or report its runtime failure: " + result,
  );
  assert.ok(report.webgl2);
  if (report.webgpu) assert.equal(report.parity.alphaMismatch, 0);
  else console.warn("WebGPU parity not verified:", report.webgpuUnavailable);
  // Geography is read from a fresh page that never touches WebGPU: a failed
  // WebGPU attempt can blank the page's 2D canvases, the fog drape included.
  await page.close();
  page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "http://127.0.0.1:4177/packages/map-shade/tests/browser.html?webgpu=0",
  );
  await page.waitForFunction(() => document.documentElement.dataset.result, {
    timeout: 60_000,
  });
  assert.equal(
    await page.locator("html").getAttribute("data-result"),
    "passed",
    await page.locator("#result").innerText(),
  );
  const samples = await page.evaluate(async () => {
    const { map, cell, gridDisk, cellToLatLng } = window.fogTest;
    const checks = [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 900;
    const context = canvas.getContext("2d");
    const idle = () =>
      new Promise((resolve, reject) => {
        const onIdle = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        const timeout = window.setTimeout(() => {
          map.off("idle", onIdle);
          reject(
            new Error(
              `MapLibre idle timeout (tiles loaded: ${map.areTilesLoaded()})`,
            ),
          );
        }, 30_000);
        map.once("idle", onIdle);
        map.triggerRepaint();
      });
    await idle();
    for (const terrain of [false, true]) {
      map.setTerrain(terrain ? { source: "dem", exaggeration: 1 } : null);
      for (const zoom of [16, 18])
        for (const pitch of [0, 60])
          for (const bearing of [0, 130]) {
            for (const [id, revealed] of [
              [cell, true],
              [gridDisk(cell, 1)[1], false],
            ]) {
              const [lat, lng] = cellToLatLng(id);
              // Move the camera away from the sample too: screen-centred holes fail.
              map.jumpTo({
                center: [lng + 0.0002, lat - 0.0001],
                zoom,
                pitch,
                bearing,
              });
              await idle();
              const point = map.project([lng, lat]);
              const inside =
                point.x >= 0 && point.y >= 0 && point.x < 900 && point.y < 900;
              context.clearRect(0, 0, 900, 900);
              context.drawImage(map.getCanvas(), 0, 0, 900, 900);
              const rgb = Array.from(
                context.getImageData(
                  Math.round(point.x),
                  Math.round(point.y),
                  1,
                  1,
                ).data,
              );
              const clear = rgb[0] > 245 && rgb[1] > 245 && rgb[2] > 245;
              checks.push({
                terrain,
                zoom,
                pitch,
                bearing,
                revealed,
                clear,
                inside,
                rgb,
              });
            }
          }
    }
    // Far beyond the atlas there is no atlas canvas: the world fog alone
    // must cover the ground there, with and without terrain.
    const [lat, lng] = cellToLatLng(cell);
    for (const terrain of [false, true]) {
      map.setTerrain(terrain ? { source: "dem", exaggeration: 1 } : null);
      map.jumpTo({ center: [lng + 0.4, lat], zoom: 14, pitch: 0, bearing: 0 });
      await idle();
      context.clearRect(0, 0, 900, 900);
      context.drawImage(map.getCanvas(), 0, 0, 900, 900);
      const rgb = Array.from(context.getImageData(450, 450, 1, 1).data);
      checks.push({
        terrain,
        zoom: 14,
        pitch: 0,
        bearing: 0,
        revealed: false,
        clear: rgb[0] > 245 && rgb[1] > 245 && rgb[2] > 245,
        inside: true,
        rgb,
        beyondAtlas: true,
      });
    }
    return checks;
  });
  await mkdir("test-results/fog", { recursive: true });
  await page.screenshot({ path: "test-results/fog/terrain.png" });
  // The atlas edge, zoomed out: its mist settles into the world fog.
  await page.evaluate(async () => {
    const { map, cell, cellToLatLng } = window.fogTest;
    const [lat, lng] = cellToLatLng(cell);
    map.setTerrain(null);
    map.jumpTo({ center: [lng + 0.14, lat], zoom: 11, pitch: 0, bearing: 0 });
    await new Promise((resolve) => {
      map.once("idle", resolve);
      map.triggerRepaint();
    });
  });
  await page.screenshot({ path: "test-results/fog/atlas-edge.png" });
  assert.equal(
    samples.filter(
      (sample) => !sample.inside || sample.clear !== sample.revealed,
    ).length,
    0,
    JSON.stringify(samples),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.fogTest.errors), []);
  console.log(
    JSON.stringify({ ...report, geographicSamples: samples.length }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
