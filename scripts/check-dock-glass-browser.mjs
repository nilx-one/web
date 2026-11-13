// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
/* global document, window, console */

import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,WebGPU",
      "--use-vulkan=swiftshader",
      "--use-webgpu-adapter=swiftshader",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(
    "http://127.0.0.1:4178/packages/graphics/tests/dock-glass.html",
  );
  await page.waitForFunction(() => document.documentElement.dataset.result, {
    timeout: 60_000,
  });
  const report = await page.evaluate(() => window.dockGlassTest);
  console.log(JSON.stringify(report, null, 2));
  assert.equal(
    await page.locator("html").getAttribute("data-result"),
    "passed",
    JSON.stringify(report),
  );
  assert.ok(
    report.webgpu || report.webgpuUnavailable,
    "WebGPU must execute or report its runtime failure",
  );
  if (report.webgpu) {
    // The block's free edge trails the slide, then springs back to rest.
    assert.ok(report.lagged > 1, `lattice did not lag: ${report.lagged}`);
    assert.ok(
      report.settled < 0.05,
      `lattice did not settle: ${report.settled}`,
    );
    // The red world shows through the glass; nothing is drawn far from it.
    const [red, green, blue, alpha] = report.inside;
    assert.ok(
      red > green + 40 && red > blue + 20,
      `no refraction: ${report.inside}`,
    );
    assert.ok(alpha > 160, `glass too thin: ${report.inside}`);
    assert.ok(report.outside[3] < 8, `drawn outside: ${report.outside}`);
  } else {
    console.warn(
      "Dock glass not verified on WebGPU:",
      report.webgpuUnavailable,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
