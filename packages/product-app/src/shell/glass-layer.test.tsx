// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GlassPanel } from "@nilx-one/graphics";

import { createBlockWeight } from "./block-weight";
import {
  GlassLayer,
  pairRibbons,
  parseTint,
  readGlassPanel,
} from "./glass-layer";

function card(left: number): GlassPanel {
  return {
    quad: [
      [left, 100],
      [left + 200, 100],
      [left + 200, 300],
      [left, 300],
    ],
    width: 200,
    height: 200,
    radius: 28,
    tint: [1, 1, 1],
    active: 0,
    opacity: 1,
    mass: 1,
    anchor: "bottom",
    tile: false,
    halo: 1,
    swayX: 0,
  };
}

describe("GlassLayer", () => {
  it("draws nothing and leaves the CSS glass where WebGPU is missing", () => {
    const subscribeFrame = vi.fn(() => () => undefined);
    const { container } = render(
      <div className="app-shell">
        <GlassLayer
          weight={createBlockWeight()}
          renderer={{ getCamera: vi.fn(), subscribeFrame }}
          leader="avaia"
        />
      </div>,
    );

    const canvas = container.querySelector("canvas.glass-layer");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".app-shell")).not.toHaveAttribute(
      "data-glass",
    );
    expect(subscribeFrame).not.toHaveBeenCalled();
  });
});

describe("the glass a block is drawn with", () => {
  it("reads the block's box, its seat's colour and whether that seat drives", () => {
    const shell = document.createElement("div");
    shell.className = "app-shell__bottom";
    const element = document.createElement("div");
    element.dataset.seat = "avaia";
    element.innerHTML = '<button class="bond-dock__bond--active"></button>';
    shell.append(element);
    document.body.append(shell);
    Object.defineProperties(element, {
      offsetWidth: { value: 200 },
      offsetHeight: { value: 176 },
    });
    element.getBoundingClientRect = () =>
      ({ left: 24, top: 500, width: 200, height: 176 }) as DOMRect;

    const panel = readGlassPanel(element, 1.15, 3, false)!;

    expect(panel.quad[0]).toEqual([24, 500]);
    expect(panel.quad[2]).toEqual([224, 676]);
    expect(panel.active).toBe(1);
    expect(panel.anchor).toBe("bottom");
    expect(panel.tint[2]).toBeGreaterThan(panel.tint[1]);
    expect(panel.mass).toBe(1.15);
    shell.remove();
  });

  it("skips a block the page has not laid out", () => {
    expect(
      readGlassPanel(document.createElement("div"), 1, 0, false),
    ).toBeUndefined();
  });

  it("parses a CSS colour, and falls back to the warm key light", () => {
    expect(parseTint("rgba(55, 215, 229, 0.28)")).toEqual([
      55 / 255,
      215 / 255,
      229 / 255,
    ]);
    expect(parseTint("var(--unknown)")).toEqual([1, 0.72, 0.4]);
  });
});

describe("pairRibbons", () => {
  it("flows from whoever drives to whoever follows, in their colours", () => {
    const avaiaLeads = pairRibbons(card(0), card(280), "avaia");
    const bondLeads = pairRibbons(card(0), card(280), "bond");

    expect(avaiaLeads.map((ribbon) => ribbon.flow)).toEqual([1, 1]);
    expect(bondLeads.map((ribbon) => ribbon.flow)).toEqual([-1, -1]);
    expect(avaiaLeads[0]!.leader).toEqual(bondLeads[0]!.follower);
    expect(avaiaLeads[0]!.follower).toEqual(bondLeads[0]!.leader);
  });
});
