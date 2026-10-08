// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
/* global document, window, console */

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
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
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
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
    report.webgpu,
    "WebGPU fixture must execute, not silently skip: " + result,
  );
  assert.ok(report.webgl2);
  assert.equal(report.parity.alphaMismatch, 0);
  const samples = await page.evaluate(async () => {
    const { map, cell, gridDisk, cellToLatLng } = window.fogTest;
    const checks = [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 900;
    const context = canvas.getContext("2d");
    const idle = () =>
      new Promise((resolve) => {
        map.once("idle", resolve);
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
                rgb,
              });
            }
          }
    }
    return checks;
  });
  await mkdir("test-results/fog", { recursive: true });
  await page.screenshot({ path: "test-results/fog/terrain.png" });
  assert.equal(
    samples.filter((sample) => sample.clear !== sample.revealed).length,
    0,
    JSON.stringify(samples),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ ...report, geographicSamples: samples.length }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
