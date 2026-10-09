// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { avaiaTravelDecision } from "./avaia-travel-policy";

const home = { longitude: 30.52, latitude: 50.45 };
const nowMs = 1_800_000_000_000;
const fix = {
  longitude: 30.52,
  latitude: 50.48,
  accuracyMeters: 20,
  observedAt: nowMs - 1000,
};

describe("Avaia physical travel consent", () => {
  it("asks once when an accurate real GPS fix is far from known home", () => {
    expect(
      avaiaTravelDecision({ home, observation: fix, askedAway: false, nowMs }),
    ).toBe("ask");
    expect(
      avaiaTravelDecision({ home, observation: fix, askedAway: true, nowMs }),
    ).toBe("hold");
  });

  it("does not ask for manual, stale, inaccurate or unknown observations", () => {
    for (const observation of [
      { ...fix, declared: true as const },
      { ...fix, observedAt: nowMs - 200_000 },
      { ...fix, accuracyMeters: 350 },
    ]) {
      expect(
        avaiaTravelDecision({ home, observation, askedAway: false, nowMs }),
      ).toBe("hold");
    }
    expect(
      avaiaTravelDecision({
        home: undefined,
        observation: fix,
        askedAway: false,
        nowMs,
      }),
    ).toBe("hold");
  });

  it("requires returning close to home before asking about another trip", () => {
    const near = { ...fix, latitude: 50.451 };
    expect(
      avaiaTravelDecision({ home, observation: near, askedAway: true, nowMs }),
    ).toBe("reset");
    expect(
      avaiaTravelDecision({
        home,
        observation: { ...fix, latitude: 50.46 },
        askedAway: true,
        nowMs,
      }),
    ).toBe("hold");
    expect(
      avaiaTravelDecision({ home, observation: fix, askedAway: false, nowMs }),
    ).toBe("ask");
  });
});
