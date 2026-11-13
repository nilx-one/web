// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createDockGlass,
  type GlassPanel,
  type GlassScene,
} from "../src/dock-glass";

// Run with `pnpm exec vite --host 127.0.0.1`, then open this HTML. One block
// slides along and stops over a red world; the GPU's own state and pixels
// are read back to prove the glass lags, settles and refracts that world.
const result = document.querySelector("#result")!;
const canvas = document.querySelector<HTMLCanvasElement>("#glass")!;
const report: Record<string, unknown> = {};
const errors: string[] = [];
const STATE_FLOATS = 8;

function panel(x: number): GlassPanel {
  return {
    quad: [
      [x, 100],
      [x + 160, 100],
      [x + 160, 220],
      [x, 220],
    ],
    width: 160,
    height: 120,
    radius: 24,
    tint: [0.6, 0.4, 1],
    active: 0,
    opacity: 1,
    mass: 1,
    anchor: "bottom",
    tile: false,
    halo: 1,
    swayX: 0,
  };
}

function scene(x: number): GlassScene {
  return {
    panels: [panel(x)],
    ribbons: [],
    bearing: 0,
    pitch: 0,
    dark: true,
    motion: true,
    time: 0,
    dt: 1 / 60,
  };
}

function furthest(state: Float32Array): number {
  let reach = 0;
  for (let node = 0; node < state.length / STATE_FLOATS; node += 1) {
    reach = Math.max(
      reach,
      Math.hypot(state[node * STATE_FLOATS]!, state[node * STATE_FLOATS + 1]!),
    );
  }
  return reach;
}

/** The glass canvas's pixel at (x, y), read through WebGL in the drawing task. */
function readPixel(x: number, y: number): number[] {
  const reader = document.createElement("canvas");
  const gl = reader.getContext("webgl2")!;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const pixel = new Uint8Array(4);
  const ratio = canvas.width / canvas.clientWidth;
  gl.readPixels(
    Math.round(x * ratio),
    Math.round(y * ratio),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  return [...pixel];
}

async function main() {
  let glass;
  try {
    glass = await createDockGlass(canvas, () => errors.push("device lost"));
  } catch (error) {
    report.webgpuUnavailable = String(error);
    return;
  }
  report.webgpu = true;

  const world = document.createElement("canvas");
  world.width = 400;
  world.height = 300;
  const gl = world.getContext("webgl2")!;
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  glass.world(world, { left: 0, top: 0, width: 400, height: 300 });

  glass.draw(scene(60));
  for (let x = 66; x <= 120; x += 6) glass.draw(scene(x));
  report.lagged = furthest(await glass.readState());
  for (let frame = 0; frame < 240; frame += 1) glass.draw(scene(120));
  report.settled = furthest(await glass.readState());

  glass.draw(scene(120));
  report.inside = readPixel(200, 160);
  report.outside = readPixel(380, 20);
  glass.dispose();
}

main()
  .catch((error: unknown) => errors.push(String(error)))
  .finally(() => {
    report.errors = errors;
    result.textContent = JSON.stringify(report, null, 2);
    document.documentElement.dataset.result =
      errors.length === 0 ? "passed" : "failed";
    (window as unknown as { dockGlassTest: unknown }).dockGlassTest = report;
  });
