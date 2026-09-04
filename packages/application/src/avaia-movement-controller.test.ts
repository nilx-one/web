// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { createAvaiaMovementController } from "./avaia-movement-controller";

describe("Avaia movement controller", () => {
  it("moves deterministically toward the target", () => {
    const controller = createAvaiaMovementController({
      initialPosition: { longitude: 30.5234, latitude: 50.4501 },
      speedMetersPerSecond: 1.4,
      arrivalRadiusMeters: 0,
    });

    controller.navigateTo({ longitude: 30.5234, latitude: 50.4511 });
    const first = controller.tick(1);
    const second = controller.tick(1);

    expect(first.kind).toBe("moving");
    expect(second.kind).toBe("moving");
    expect(second.position.latitude).toBeGreaterThan(first.position.latitude);
    expect(second.position.longitude).toBeCloseTo(30.5234, 8);
  });

  it("snaps to the exact target when the next step reaches it", () => {
    const controller = createAvaiaMovementController({
      initialPosition: { longitude: 30.5234, latitude: 50.4501 },
      speedMetersPerSecond: 10_000,
    });
    const target = { longitude: 30.5235, latitude: 50.4502 } as const;

    controller.navigateTo(target);

    expect(controller.tick(1)).toEqual({ kind: "arrived", position: target });
  });

  it("stop cancels movement without changing position", () => {
    const controller = createAvaiaMovementController({
      initialPosition: { longitude: 30.5234, latitude: 50.4501 },
    });
    controller.navigateTo({ longitude: 30.5244, latitude: 50.4501 });
    const moving = controller.tick(1);

    controller.stop();

    expect(controller.getState()).toEqual({
      kind: "idle",
      position: moving.position,
    });
  });

  it("rejects invalid positions and time deltas", () => {
    const controller = createAvaiaMovementController({
      initialPosition: { longitude: 30.5234, latitude: 50.4501 },
    });

    expect(() =>
      controller.navigateTo({ longitude: 181, latitude: 0 }),
    ).toThrow("invalid-world-position");
    expect(() => controller.tick(-1)).toThrow("invalid-delta-seconds");
  });
});
