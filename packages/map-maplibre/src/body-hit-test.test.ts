// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { MAP_BODY_TARGET_PIXELS } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { bodyAtPoint, type DrawnBody } from "./body-hit-test";

const bond: DrawnBody = {
  id: "bond",
  feet: { x: 100, y: 200 },
  heightPixels: 24,
};

describe("reaching for a body", () => {
  it("answers for a point on the body itself", () => {
    expect(bodyAtPoint([bond], { x: 100, y: 190 })).toBe("bond");
  });

  it("keeps a fingertip-sized target around a body smaller than one", () => {
    const half = MAP_BODY_TARGET_PIXELS / 2;
    const middleY = bond.feet.y - bond.heightPixels / 2;

    expect(bodyAtPoint([bond], { x: 100 + half, y: middleY })).toBe("bond");
    expect(bodyAtPoint([bond], { x: 100, y: middleY + half })).toBe("bond");
    expect(
      bodyAtPoint([bond], { x: 100 + half + 1, y: middleY }),
    ).toBeUndefined();
    expect(
      bodyAtPoint([bond], { x: 100, y: middleY + half + 1 }),
    ).toBeUndefined();
  });

  it("grows the target with a body drawn larger than it", () => {
    const tall: DrawnBody = { ...bond, heightPixels: 120 };
    expect(bodyAtPoint([tall], { x: 100, y: 200 - 60 - 59 })).toBe("bond");
    expect(bodyAtPoint([bond], { x: 100, y: 200 - 60 - 59 })).toBeUndefined();
  });

  it("answers with the nearer of two bodies mid-handover", () => {
    const avaia: DrawnBody = { ...bond, id: "avaia", feet: { x: 120, y: 200 } };
    expect(bodyAtPoint([bond, avaia], { x: 118, y: 190 })).toBe("avaia");
    expect(bodyAtPoint([bond, avaia], { x: 102, y: 190 })).toBe("bond");
  });

  it("answers with nothing for a point on open ground", () => {
    expect(bodyAtPoint([bond], { x: 400, y: 400 })).toBeUndefined();
    expect(bodyAtPoint([], { x: 100, y: 190 })).toBeUndefined();
  });
});
