// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { CONFETTI_PIECES, confettiBurst } from "./guide-confetti";

describe("the burst experience lands with", () => {
  it("is the same burst every time for the same achievement", () => {
    expect(confettiBurst("bond", "avaia-configured")).toEqual(
      confettiBurst("bond", "avaia-configured"),
    );
    expect(confettiBurst("bond", "avaia-configured")).not.toEqual(
      confettiBurst("avaia", "avaia-configured"),
    );
  });

  it("goes off upwards, like a popper, then falls", () => {
    const burst = confettiBurst("avaia", "avaia-configured");
    expect(burst).toHaveLength(CONFETTI_PIECES);
    const upwards = burst.filter((piece) => piece.dy < 0).length;
    expect(upwards / burst.length).toBeGreaterThan(0.8);
    for (const piece of burst) expect(piece.fall).toBeGreaterThan(0);
  });

  it("carries every shape, the x included", () => {
    const shapes = new Set(
      confettiBurst("bond", "avaia-configured").map((piece) => piece.shape),
    );
    expect(shapes).toEqual(new Set(["ribbon", "dot", "x", "spark"]));
  });
});
