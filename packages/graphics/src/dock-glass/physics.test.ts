// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { latticeNeighbours } from "./geometry";
import {
  STATE_FLOATS,
  TELEPORT_PX,
  panelSprings,
  ribbonSprings,
  stepNetwork,
  type NetworkFrame,
} from "./physics";

const COLUMNS = 4;
const ROWS = 3;

function panelFrame(shiftX: number, mass = 1): NetworkFrame {
  const count = COLUMNS * ROWS;
  const rest = new Float32Array(count * 2);
  const springs = new Float32Array(count * 4);
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const node = row * COLUMNS + column;
      rest.set([column * 40 + shiftX, row * 40], node * 2);
      // Rests on its lower edge.
      const s = panelSprings(1 - row / (ROWS - 1), mass);
      springs.set([s.anchor, s.coupling, s.damping, s.maxOffset], node * 4);
    }
  }
  return { rest, springs, neighbours: latticeNeighbours(COLUMNS, ROWS) };
}

function run(frames: readonly NetworkFrame[], dt = 1 / 60): Float32Array[] {
  const count = frames[0]!.rest.length / 2;
  const state = new Float32Array(count * STATE_FLOATS);
  const scratch = new Float32Array(count * STATE_FLOATS);
  return frames.map((frame, index) => {
    stepNetwork(state, scratch, frame, dt, index === 0);
    return state.slice();
  });
}

const offsetX = (state: Float32Array, node: number) =>
  state[node * STATE_FLOATS]!;

describe("the glass's spring network", () => {
  it("lags a moving block, the free edge further than the anchored one", () => {
    const frames = [0, 2, 4, 6, 8, 10].map((x) => panelFrame(x));
    const states = run(frames);
    const last = states.at(-1)!;
    const freeEdge = offsetX(last, 0);
    const anchoredEdge = offsetX(last, (ROWS - 1) * COLUMNS);
    expect(freeEdge).toBeLessThan(0);
    expect(Math.abs(freeEdge)).toBeGreaterThan(Math.abs(anchoredEdge));
  });

  it("overshoots once the block stops, then settles back to rest", () => {
    const moving = [0, 3, 6, 9, 12].map((x) => panelFrame(x));
    const resting = Array.from({ length: 240 }, () => panelFrame(12));
    const states = run([...moving, ...resting]);
    const free = states.map((state) => offsetX(state, 0));
    expect(Math.max(...free.slice(moving.length))).toBeGreaterThan(0);
    expect(Math.abs(free.at(-1)!)).toBeLessThan(0.01);
  });

  it("swings a heavier block further", () => {
    const path = [0, 2, 4, 6, 8];
    const light = run(path.map((x) => panelFrame(x, 0.8))).at(-1)!;
    const heavy = run(path.map((x) => panelFrame(x, 1.3))).at(-1)!;
    expect(Math.abs(offsetX(heavy, 0))).toBeGreaterThan(
      Math.abs(offsetX(light, 0)),
    );
  });

  it("never lets a node leave its reach", () => {
    const frames = [0, 30, 60, 90, 120].map((x) => panelFrame(x));
    for (const state of run(frames)) {
      for (let node = 0; node < COLUMNS * ROWS; node += 1) {
        const reach = Math.hypot(
          state[node * STATE_FLOATS]!,
          state[node * STATE_FLOATS + 1]!,
        );
        expect(reach).toBeLessThanOrEqual(panelSprings(1, 1).maxOffset + 1e-4);
      }
    }
  });

  it("reads a relayout as a jump, not a fling", () => {
    const states = run([panelFrame(0), panelFrame(TELEPORT_PX * 3)]);
    expect(offsetX(states[1]!, 0)).toBe(0);
  });

  it("holds a ribbon's ends and lets its middle sway", () => {
    expect(ribbonSprings(0).anchor).toBeGreaterThan(
      ribbonSprings(0.5).anchor * 10,
    );
    expect(ribbonSprings(0.5).maxOffset).toBeGreaterThan(
      panelSprings(1, 1).maxOffset,
    );
  });
});
