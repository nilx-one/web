// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import type { MapCamera } from "@nilx-one/map-contract";

import {
  BLOCK_MAX_SWAY,
  BLOCK_MAX_TILT,
  BLOCK_REST,
  cameraPush,
  cameraTilt,
  createBlockWeight,
  stepSway,
  swaySettled,
} from "./block-weight";

const camera = (overrides: Partial<MapCamera> = {}): MapCamera => ({
  center: [30.5234, 50.4501],
  zoom: 15,
  bearing: 0,
  pitch: 0,
  ...overrides,
});

function settle(mass: number, steps = 600) {
  let sway = stepSway(BLOCK_REST, { x: 400, y: 0, squash: 0 }, mass, 1 / 60);
  const path = [sway.x];
  for (let index = 0; index < steps; index += 1) {
    sway = stepSway(sway, { x: 0, y: 0, squash: 0 }, mass, 1 / 60);
    path.push(sway.x);
  }
  return { sway, path };
}

describe("stepSway", () => {
  it("leaves a block at rest alone", () => {
    expect(stepSway(BLOCK_REST, { x: 0, y: 0, squash: 0 }, 1, 1 / 60)).toEqual(
      BLOCK_REST,
    );
  });

  it("swings a pushed block past rest once and springs it back", () => {
    const { sway, path } = settle(1);

    expect(Math.max(...path)).toBeGreaterThan(0);
    expect(Math.min(...path)).toBeLessThan(0);
    expect(swaySettled(sway)).toBe(true);
  });

  it("never pushes a block further than its limit", () => {
    const sway = stepSway(
      BLOCK_REST,
      { x: 1e6, y: -1e6, squash: 1e6 },
      0.2,
      1 / 60,
    );

    expect(Math.abs(sway.x)).toBeLessThanOrEqual(BLOCK_MAX_SWAY);
    expect(Math.abs(sway.y)).toBeLessThanOrEqual(BLOCK_MAX_SWAY);
  });

  it("lets a heavier block take the same push more slowly", () => {
    const light = stepSway(
      BLOCK_REST,
      { x: 100, y: 0, squash: 0 },
      0.8,
      1 / 60,
    );
    const heavy = stepSway(
      BLOCK_REST,
      { x: 100, y: 0, squash: 0 },
      1.6,
      1 / 60,
    );

    expect(heavy.x).toBeGreaterThan(0);
    expect(heavy.x).toBeLessThan(light.x);
  });
});

describe("cameraPush", () => {
  it("is still when the camera is", () => {
    expect(cameraPush(camera(), camera())).toEqual({ x: 0, y: 0, squash: 0 });
  });

  it("pushes blocks the way the world slides across the screen", () => {
    const east = cameraPush(camera(), camera({ center: [30.5244, 50.4501] }));
    const north = cameraPush(camera(), camera({ center: [30.5234, 50.4511] }));

    // The camera moves east, so the world slides west; north slides it down.
    expect(east.x).toBeLessThan(0);
    expect(north.y).toBeGreaterThan(0);
  });

  it("squashes on a zoom out and swells on a zoom in", () => {
    expect(cameraPush(camera(), camera({ zoom: 16 })).squash).toBeGreaterThan(
      0,
    );
    expect(cameraPush(camera(), camera({ zoom: 14 })).squash).toBeLessThan(0);
  });

  it("turns the shortest way across north", () => {
    const push = cameraPush(camera({ bearing: 359 }), camera({ bearing: 1 }));

    expect(push.x).toBeCloseTo(8);
  });
});

describe("createBlockWeight", () => {
  function clock() {
    const frames: ((now: number) => void)[] = [];
    let now = 0;
    return {
      scheduler: {
        request: (callback: (now: number) => void) => frames.push(callback),
        cancel: vi.fn(),
      },
      run(count: number) {
        for (let index = 0; index < count && frames.length > 0; index += 1) {
          now += 16;
          frames.shift()?.(now);
        }
      },
      get pending() {
        return frames.length;
      },
    };
  }

  it("draws a push as transform properties and returns to rest", () => {
    const frames = clock();
    const weight = createBlockWeight(frames.scheduler, () => false);
    const element = document.createElement("div");
    weight.register(element, 1);

    weight.push({ x: 200, y: 0, squash: 0.1 });
    frames.run(1);

    expect(element.style.getPropertyValue("--block-sway-x")).not.toBe("0.00px");
    expect(
      Number(element.style.getPropertyValue("--block-squash")),
    ).toBeGreaterThan(1);

    frames.run(2_000);
    expect(frames.pending).toBe(0);
    expect(element.style.getPropertyValue("--block-sway-x")).toBe("0.00px");
    expect(element.style.getPropertyValue("--block-squash")).toBe("1.0000");
  });

  it("does not move anyone who asked not to be moved", () => {
    const frames = clock();
    const weight = createBlockWeight(frames.scheduler, () => true);
    const element = document.createElement("div");
    weight.register(element, 1);

    weight.push({ x: 200, y: 200, squash: 0.1 });

    expect(frames.pending).toBe(0);
    expect(element.style.getPropertyValue("--block-sway-x")).toBe("");
  });

  it("stops its clock when the last block leaves", () => {
    const frames = clock();
    const weight = createBlockWeight(frames.scheduler, () => false);
    const stop = weight.register(document.createElement("div"), 1);

    weight.push({ x: 50, y: 0, squash: 0 });
    stop();

    expect(frames.scheduler.cancel).toHaveBeenCalledOnce();
  });

  it("leans every block back with the camera's pitch and lists them", () => {
    const frames = clock();
    const weight = createBlockWeight(frames.scheduler, () => false);
    const element = document.createElement("div");
    weight.register(element, 1.2);

    weight.project(camera({ pitch: 85 }));

    expect(element.style.getPropertyValue("--block-tilt")).toBe(
      `${BLOCK_MAX_TILT.toFixed(3)}deg`,
    );
    expect(weight.blocks()).toEqual([{ element, mass: 1.2, sway: BLOCK_REST }]);
    const late = document.createElement("div");
    weight.register(late, 1);
    expect(late.style.getPropertyValue("--block-tilt")).toBe(
      `${BLOCK_MAX_TILT.toFixed(3)}deg`,
    );
  });
});

describe("cameraTilt", () => {
  it("stands blocks upright over a flat map and leans them as it pitches", () => {
    expect(cameraTilt(camera({ pitch: 0 }))).toBe(0);
    expect(cameraTilt(camera({ pitch: 42.5 }))).toBeCloseTo(BLOCK_MAX_TILT / 2);
    expect(cameraTilt(camera({ pitch: 120 }))).toBe(BLOCK_MAX_TILT);
    expect(cameraTilt(camera({ pitch: Number.NaN }))).toBe(0);
  });
});
