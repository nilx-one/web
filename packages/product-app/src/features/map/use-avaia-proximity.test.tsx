// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaProximityPolicy,
  CoreRuntimePort,
} from "@nilx-one/application";
import type { MapPointSelection } from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROXIMITY_REFRESH_MS,
  PROXIMITY_STALE_MS,
  useAvaiaProximity,
  type AvaiaProximityInput,
} from "./use-avaia-proximity";

const HERE: MapPointSelection = { longitude: 30.52, latitude: 50.45 };
/** About `metres` due east of `HERE` (one degree of longitude ≈ 71.5 km here). */
function east(metres: number): MapPointSelection {
  return {
    longitude: HERE.longitude + metres / 71_500,
    latitude: HERE.latitude,
  };
}

/**
 * A stand-in for Core's `avaia_proximity` with its documented hysteresis:
 * red blocks, the previous block holds until strictly below 4500 m.
 */
function core(): Pick<CoreRuntimePort, "avaiaProximity"> & {
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    avaiaProximity: async (distance, artifacts, previouslyBlocked) => {
      asked.push(`${distance}|${artifacts}|${previouslyBlocked}`);
      const blocked =
        distance >= 5_000 || (previouslyBlocked && distance >= 4_500);
      const policy: AvaiaProximityPolicy = {
        distance_m: distance,
        red_m: 5_000,
        restore_below_m: 4_500,
        level:
          distance >= 5_000
            ? "red"
            : distance >= 4_500
              ? "restricted"
              : distance < 15
                ? "near"
                : "working",
        can_reveal: !blocked,
        duration_ms: blocked ? null : 60_000 + artifacts * 1_000,
      };
      return policy;
    },
  };
}

type Input = AvaiaProximityInput;

function setup(initial: Partial<Input> = {}) {
  const port = core();
  let avaia: MapPointSelection | undefined = HERE;
  const props: Input = {
    core: port,
    owner: "0x0sky",
    bondPoint: HERE,
    getAvaiaPoint: () => avaia,
    ...initial,
  };
  const hook = renderHook((input: Input) => useAvaiaProximity(input), {
    initialProps: props,
  });
  return {
    port,
    ...hook,
    props,
    moveAvaia: (point: MapPointSelection | undefined) => {
      avaia = point;
    },
  };
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the Bond–Avaia proximity", () => {
  it("measures at once when the first position arrives, not a beat later", async () => {
    const { result, rerender, props } = setup({ bondPoint: undefined });
    await settle();
    expect(result.current).toBeUndefined();
    rerender({ ...props, bondPoint: HERE });
    await settle();
    expect(result.current?.policy).toMatchObject({
      distance_m: 0,
      level: "near",
      can_reveal: true,
    });
  });

  it("re-measures as the Bond moves between beats", async () => {
    const { result, rerender, props } = setup();
    await settle();
    expect(result.current?.policy.distance_m).toBe(0);
    rerender({ ...props, bondPoint: east(300) });
    await settle();
    expect(result.current?.policy.distance_m).toBeGreaterThan(290);
    expect(result.current?.policy.level).toBe("working");
  });

  it("knows nothing about an Avaia with no place, never assuming the Bond's", async () => {
    const { result, port } = setup({ getAvaiaPoint: () => undefined });
    await settle(PROXIMITY_REFRESH_MS);
    expect(result.current).toBeUndefined();
    expect(port.asked).toEqual([]);
  });

  it("does nothing without a Core binding, and drops a failing one", async () => {
    const none = setup({ core: undefined });
    await settle(PROXIMITY_REFRESH_MS);
    expect(none.result.current).toBeUndefined();

    const failing = setup({
      core: {
        avaiaProximity: async () => {
          throw new Error("0x1 Core Wasm proximity binding is missing");
        },
      },
    });
    await settle(PROXIMITY_REFRESH_MS);
    expect(failing.result.current).toBeUndefined();
  });

  it("refuses an answer that is not for the distance it asked about", async () => {
    const lying: Pick<CoreRuntimePort, "avaiaProximity"> = {
      avaiaProximity: async (_distance, artifacts) => ({
        distance_m: 1,
        red_m: 5_000,
        restore_below_m: 4_500,
        level: "near",
        can_reveal: true,
        duration_ms: 60_000 + artifacts,
      }),
    };
    const { result } = setup({ core: lying, bondPoint: east(100) });
    await settle();
    expect(result.current).toBeUndefined();
  });

  it("carries Core's blocked bit: open outward through the band, held on the way back", async () => {
    const { result, rerender, props, port } = setup();
    // Out: 0 → 4 600 m (inside the band) → 5 100 m (red).
    await settle();
    rerender({ ...props, bondPoint: east(4_600) });
    await settle();
    expect(result.current?.policy).toMatchObject({
      level: "restricted",
      can_reveal: true,
    });
    rerender({ ...props, bondPoint: east(5_100) });
    await settle();
    expect(result.current?.policy).toMatchObject({
      level: "red",
      can_reveal: false,
    });
    // Back: still held at 4 600 m, restored below 4 500 m.
    rerender({ ...props, bondPoint: east(4_600) });
    await settle();
    expect(result.current?.policy).toMatchObject({
      level: "restricted",
      can_reveal: false,
    });
    expect(result.current?.durationFor(3)).toBeNull();
    rerender({ ...props, bondPoint: east(4_400) });
    await settle();
    expect(result.current?.policy.can_reveal).toBe(true);
    // The first question had no history, so it said "blocked".
    expect(port.asked[0]).toMatch(/\|true$/);
  });

  it("starts blocked: a cold start inside the band authorizes nothing", async () => {
    const { result } = setup({ bondPoint: east(4_700) });
    await settle();
    expect(result.current?.policy).toMatchObject({
      level: "restricted",
      can_reveal: false,
    });
  });

  it("forgets the history when the answer goes stale, so the band stays shut", async () => {
    const { result, rerender, props, moveAvaia } = setup();
    await settle();
    rerender({ ...props, bondPoint: east(4_600) });
    await settle();
    expect(result.current?.policy.can_reveal).toBe(true);
    // Avaia vanishes (no place): the answer expires and history is lost.
    moveAvaia(undefined);
    await settle(PROXIMITY_STALE_MS + PROXIMITY_REFRESH_MS);
    expect(result.current).toBeUndefined();
    moveAvaia(HERE);
    await settle(PROXIMITY_REFRESH_MS);
    expect(result.current?.policy).toMatchObject({
      level: "restricted",
      can_reveal: false,
    });
  });

  it("lets an answer expire when nothing renews it", async () => {
    const stuck = core();
    let calls = 0;
    const { result } = setup({
      core: {
        avaiaProximity: (...args) => {
          calls += 1;
          // One answer, then Core never answers again.
          return calls <= 6
            ? stuck.avaiaProximity!(...args)
            : new Promise<never>(() => undefined);
        },
      },
      bondPoint: east(40),
    });
    await settle();
    expect(result.current?.policy.can_reveal).toBe(true);
    // Moving makes the old key stale; the unanswered question must not leave
    // the old authorization standing forever.
    await settle(PROXIMITY_STALE_MS + 1);
    expect(result.current).toBeUndefined();
  });

  it("quotes each artifact count from Core and caps nothing itself", async () => {
    const { result } = setup({ bondPoint: east(40) });
    await settle();
    const snapshot = result.current!;
    expect(snapshot.durationFor(0)).toBe(60_000);
    expect(snapshot.durationFor(2)).toBe(62_000);
    // Core counts at most five; the hook just indexes what Core quoted.
    expect(snapshot.durationFor(5)).toBe(65_000);
    expect(snapshot.durationFor(99)).toBe(65_000);
    expect(snapshot.durationFor(-3)).toBe(60_000);
  });

  it("does not ask Core again while neither body has moved", async () => {
    const { port } = setup({ bondPoint: east(40) });
    await settle();
    const first = port.asked.length;
    await settle(PROXIMITY_REFRESH_MS * 2);
    // The carried bit settled after the first answer: one more question at
    // most, then silence.
    expect(port.asked.length).toBeLessThanOrEqual(first * 2);
    const settled = port.asked.length;
    await settle(PROXIMITY_REFRESH_MS * 3);
    expect(port.asked.length).toBe(settled);
  });

  it("keeps one Bond's answer from another's", async () => {
    const { result, rerender, props } = setup();
    await settle();
    expect(result.current).toBeDefined();
    rerender({ ...props, owner: "0x1sky" });
    expect(result.current).toBeUndefined();
    await settle();
    expect(result.current).toBeDefined();
  });
});
