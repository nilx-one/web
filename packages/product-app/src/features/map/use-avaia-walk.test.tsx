// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaDriveAnswer,
  AvaiaDriveCommand,
  AvaiaDriveInput,
} from "@nilx-one/application";
import {
  mapDistanceMeters,
  type MapBounds,
  type MapGroundTap,
  type MapLandmark,
  type MapPointSelection,
  type MapRenderer,
  type MapRoad,
} from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvaiaWalk } from "./avaia-walk";
import {
  FOND_AT,
  FONDNESS_HALF_LIFE_MS,
  forgetAffinityCache,
  writeAffinity,
  type FondPlace,
} from "./place-affinity";
import { forgetNotebookCache, updateNotebook } from "./landmark-notebook";
import {
  POINT_B_STAND_MS,
  useAvaiaWalk,
  type AvaiaWalkInput,
} from "./use-avaia-walk";
import { readWorldMemory } from "./world-memory";

const ORIGIN = { longitude: 30.5234, latitude: 50.4501 };
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN.latitude * Math.PI) / 180);
const at = (x: number, y: number): MapPointSelection => ({
  longitude: ORIGIN.longitude + x * M_LON,
  latitude: ORIGIN.latitude + y * M_LAT,
});

/** A renderer with one long footway east of the origin, and taps on demand. */
function walkRenderer(extra: Partial<MapRenderer> = {}) {
  let listener: ((tap: MapGroundTap) => void) | undefined;
  const footway: MapRoad = {
    kind: "path",
    kindDetail: "footway",
    lines: [
      [0, 100, 200, 300, 400, 500, 600].map((x) => {
        const p = at(x, 0);
        return [p.longitude, p.latitude] as [number, number];
      }),
    ],
  };
  const renderer = {
    subscribeGroundTap: (next: (tap: MapGroundTap) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    roadsWithin: () => [footway],
    obstaclesWithin: () => [],
    ...extra,
  } as unknown as MapRenderer;
  return {
    renderer,
    tap: (point: MapPointSelection) =>
      act(() => listener?.({ ...point, ground: "open" })),
  };
}

/**
 * A stand-in for Core's drive: it records every input and answers with what
 * `script` says. The drive's own decisions are Core's and tested there; this
 * is how the hook carries them out.
 */
function scriptedCore(
  script: (input: AvaiaDriveInput) => AvaiaDriveCommand[] = () => [],
) {
  const inputs: AvaiaDriveInput[] = [];
  let count = 0;
  const avaiaDriveStep = vi.fn(
    async (
      _state: string,
      input: AvaiaDriveInput,
    ): Promise<AvaiaDriveAnswer> => {
      inputs.push(input);
      count += 1;
      return { ok: true, state: `{"step":${count}}`, commands: script(input) };
    },
  );
  return { core: { avaiaDriveStep }, inputs };
}

const props = (
  renderer: MapRenderer,
  extra: Partial<AvaiaWalkInput> = {},
): AvaiaWalkInput => ({
  renderer,
  active: true,
  observed: { ...ORIGIN, accuracyMeters: 10 },
  model: undefined,
  locale: "en",
  avaiaAddress: "avaia:test",
  owner: "0x0sky",
  zoom: 17,
  reducedMotion: true,
  ...extra,
});

function render(renderer: MapRenderer, extra: Partial<AvaiaWalkInput> = {}) {
  return renderHook((input: AvaiaWalkInput) => useAvaiaWalk(input), {
    initialProps: props(renderer, extra),
  });
}

/**
 * Lets `ms` pass a second at a time, rendering in between, the way a page
 * does: a body that walks off and back within one long jump of the clock
 * would otherwise only render the jump's first step.
 */
const advance = async (ms: number) => {
  for (let left = ms; left > 0; left -= 1_000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(1_000, left));
    });
  }
};

/** Lets queued drive steps settle without moving the clock. */
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

const types = (inputs: readonly AvaiaDriveInput[]) =>
  inputs.map((input) => input.type);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
    ],
  });
  vi.setSystemTime(new Date(2026, 9, 3, 13, 0, 0));
  window.localStorage.clear();
  forgetAffinityCache();
  forgetNotebookCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an Avaia with no drive in Core", () => {
  it("walks where its owner taps, stands there, and does nothing of its own", async () => {
    const { renderer, tap } = walkRenderer();
    const { result } = render(renderer);
    const b = at(300, 0);

    tap(b);
    await settle();
    await advance(1);
    await settle();
    const standing = result.current.stance(performance.now());
    expect(standing?.clipId).toBe("turn_in_place");
    expect(mapDistanceMeters(standing!.point, b)).toBeLessThan(1);

    await advance(POINT_B_STAND_MS + 60 * 60 * 1000);
    const after = result.current.stance(performance.now());
    expect(after?.clipId).toBeUndefined();
    expect(mapDistanceMeters(after!.point, b)).toBeLessThan(1);
  });
});

describe("an Avaia carrying out Core's drive", () => {
  it("settles the drive on taking the wheel, and hands a tap over as a point B", async () => {
    const { renderer, tap } = walkRenderer();
    const { core, inputs } = scriptedCore((input) =>
      input.type === "tap"
        ? [
            { do: "walk", to: input.to, purpose: "tap", grass: true },
            { do: "say", line: "walk" },
          ]
        : input.type === "arrived"
          ? [{ do: "look", ms: 20_000 }]
          : [],
    );
    const { result } = render(renderer, { core });
    await settle();
    expect(types(inputs)).toEqual(["stopped"]);

    tap(at(300, 0));
    await settle();
    expect(inputs[1]).toEqual({ type: "tap", to: "b:1" });
    await advance(1);
    expect(types(inputs)).toEqual(["stopped", "tap", "arrived"]);
    const standing = result.current.stance(performance.now());
    expect(standing?.clipId).toBe("turn_in_place");
    expect(mapDistanceMeters(standing!.point, at(300, 0))).toBeLessThan(1);
    // What Core answered is what this device keeps.
    expect(readWorldMemory("0x0sky").drive).toBe('{"step":3}');
  });

  it("ticks the drive when it asks to be woken, not before", async () => {
    const { renderer } = walkRenderer();
    const { core, inputs } = scriptedCore((input) =>
      input.type === "stopped"
        ? [{ do: "wake_at", ms: Date.now() + 30_000 }]
        : [],
    );
    render(renderer, { core });
    await advance(29_000);
    expect(types(inputs)).toEqual(["stopped"]);
    await advance(2_000);
    expect(types(inputs)).toEqual(["stopped", "tick"]);
  });

  it("tells the drive a walk had no way there", async () => {
    const { renderer, tap } = walkRenderer({
      roadsWithin: () => [],
      fog: {
        isActive: () => true,
        cellAt: (point: MapPointSelection) => ({
          id: point.longitude > at(150, 0).longitude ? "far" : "near",
          center: point,
          boundary: [],
        }),
        isRevealed: () => false,
        frontier: () => [],
        reveal: () => undefined,
        subscribe: () => () => undefined,
      },
    } as unknown as Partial<MapRenderer>);
    const { core, inputs } = scriptedCore((input) =>
      input.type === "tap"
        ? [{ do: "walk", to: input.to, purpose: "tap", grass: true }]
        : [],
    );
    render(renderer, { core, observed: undefined });
    // Somewhere the body stands, then a tap past the fog line.
    await settle();
    tap(at(300, 0));
    await advance(1);
    expect(inputs.at(-1)?.type).toBe("blocked");
  });

  it("answers a stroll with paths near where it settled", async () => {
    const { renderer } = walkRenderer();
    const { core, inputs } = scriptedCore((input) =>
      input.type === "stopped"
        ? [
            {
              do: "resolve",
              what: "stroll",
              min_m: 30,
              max_m: 120,
              leash_m: 200,
            },
          ]
        : [],
    );
    render(renderer, { core });
    await settle();
    const options = inputs.find((input) => input.type === "stroll_options");
    expect(options).toEqual({
      type: "stroll_options",
      to: [expect.any(String)],
    });
    // The only node 30-120 m along the footway from the origin is at 100 m.
    const ref = (options as { readonly to: readonly string[] }).to[0]!;
    const [lon] = ref.slice(2).split(",").map(Number);
    expect(Math.round((lon! - ORIGIN.longitude) / M_LON)).toBe(100);
  });

  it("counts a walk cut short as far as it went", async () => {
    const { renderer, tap } = walkRenderer();
    const walked: AvaiaWalk[] = [];
    const { core } = scriptedCore((input) =>
      input.type === "tap"
        ? [{ do: "walk", to: input.to, purpose: "tap", grass: true }]
        : [],
    );
    const onWalkCompleted = (walk: AvaiaWalk) => walked.push(walk);
    const { result } = render(renderer, {
      core,
      reducedMotion: false,
      onWalkCompleted,
    });
    await settle();
    // Under 400 m it is a walk, at 1.4 m/s.
    tap(at(380, 0));
    await advance(100_000);
    // Partway there, a new walk cuts it short: 100 s at 1.4 m/s is 140 m.
    tap(at(0, 0));
    await settle();
    expect(walked).toHaveLength(1);
    const meters = walked[0]!.along.at(-1)!;
    expect(meters).toBeGreaterThan(130);
    expect(meters).toBeLessThan(150);
    expect(result.current.stance(performance.now())?.clipId).toBe("walk");
  });

  it("reads an outing's area ahead and answers with its targets, wanders and home", async () => {
    const museum: MapLandmark = {
      id: "poi:1",
      ...at(550, 10),
      kind: "museum",
      name: "City museum",
      facts: {},
    };
    const preloadRoads = vi.fn(async () => undefined);
    const { renderer } = walkRenderer({
      preloadRoads,
      landmarksNear: (point: MapPointSelection, radius: number) =>
        mapDistanceMeters(point, museum) <= radius ? [museum] : [],
      areasNear: () => [],
    } as unknown as Partial<MapRenderer>);
    const { core, inputs } = scriptedCore((input) =>
      input.type === "stopped"
        ? [
            {
              do: "resolve",
              what: "outing",
              min_m: 0,
              max_m: 2_500,
              wander_m: [150, 400],
            },
          ]
        : [],
    );
    render(renderer, { core });
    await settle();
    await settle();
    expect(preloadRoads).toHaveBeenCalledTimes(1);
    const [area] = preloadRoads.mock.calls[0] as unknown as [MapBounds];
    expect(
      mapDistanceMeters(
        { longitude: area.west, latitude: ORIGIN.latitude },
        { longitude: area.east, latitude: ORIGIN.latitude },
      ),
    ).toBeGreaterThan(4_900);
    const options = inputs.find((input) => input.type === "outing_options");
    expect(options).toMatchObject({
      type: "outing_options",
      targets: [
        {
          ref: expect.stringMatching(/^t:/),
          kind: "museum",
          feeling: "new",
          stay_ms: expect.any(String),
          revisit_ms: String(7 * 24 * 60 * 60 * 1000),
        },
      ],
      home: { ref: "home", meters: 0 },
    });
    const { targets, wander } = options as {
      readonly targets: readonly { meters: number; appeal: number }[];
      readonly wander: readonly string[];
    };
    expect(targets[0]!.meters).toBeGreaterThan(500);
    expect(targets[0]!.appeal).toBeGreaterThan(0);
    expect(wander.length).toBeGreaterThan(0);
  });

  it("puts a choice to its model, and answers nothing when there is none or it is slow", async () => {
    const choose: AvaiaDriveCommand = {
      do: "choose",
      what: "outing",
      menu: [
        { index: 0, action: "stay" },
        { index: 1, action: "wander" },
      ],
      default: 1,
    };
    const run = async (
      chooser: AvaiaWalkInput["chooser"],
      wait = 0,
    ): Promise<AvaiaDriveInput | undefined> => {
      const { renderer } = walkRenderer();
      const { core, inputs } = scriptedCore((input) =>
        input.type === "stopped" ? [choose] : [],
      );
      const view = render(renderer, { core, chooser });
      await settle();
      await settle();
      await advance(wait);
      view.unmount();
      return inputs.find((input) => input.type === "chosen");
    };

    expect(await run(undefined)).toEqual({ type: "chosen", index: null });
    expect(await run(async () => 0)).toEqual({ type: "chosen", index: 0 });
    const asked = vi.fn(async (command: unknown) => {
      expect(command).toEqual(choose);
      return 1;
    });
    expect(await run(asked)).toEqual({ type: "chosen", index: 1 });
    expect(
      await run(() => new Promise<number>(() => undefined), 4_000),
    ).toEqual({ type: "chosen", index: null });
  });

  it("tells the drive what a walk passes, and steps aside to look when told", async () => {
    const statue: MapLandmark = {
      id: "poi:9",
      ...at(150, 12),
      kind: "statue",
      name: "Statue",
      facts: {},
    };
    const { renderer, tap } = walkRenderer({
      landmarksNear: (point: MapPointSelection, radius: number) =>
        mapDistanceMeters(point, statue) <= radius ? [statue] : [],
      areasNear: () => [],
    } as unknown as Partial<MapRenderer>);
    const lines: string[] = [];
    let detoured = false;
    const { core, inputs } = scriptedCore((input) => {
      if (input.type === "tap") {
        return [{ do: "walk", to: input.to, purpose: "tap", grass: true }];
      }
      if (input.type === "passing" && !detoured) {
        detoured = true;
        return [
          {
            do: "walk",
            to: input.things[0]!.ref,
            purpose: "detour",
            grass: false,
          },
        ];
      }
      return input.type === "arrived" ? [{ do: "glance", at: "lm:poi:9" }] : [];
    });
    const { result } = render(renderer, {
      core,
      reducedMotion: false,
      model: "sky-study",
      onLine: ({ kind }) => lines.push(kind),
    });
    await settle();
    tap(at(500, 0));
    // A second at a time until it has looked: then it is standing there.
    for (let s = 0; s < 120 && !lines.includes("landmark.glanced"); s++) {
      await advance(1_000);
    }

    const passing = inputs.find((input) => input.type === "passing");
    expect(passing).toEqual({
      type: "passing",
      things: [
        { ref: "lm:poi:9", kind: "statue", group: "landmark", off_route_m: 12 },
      ],
    });
    // It stood in front of the statue, not on it, and said what it saw.
    const standing = result.current.stance(performance.now());
    expect(standing?.clipId).toBe("turn_in_place");
    const fromStatue = mapDistanceMeters(standing!.point, statue);
    expect(fromStatue).toBeGreaterThan(2);
    expect(fromStatue).toBeLessThan(6);
    expect(lines).toContain("landmark.glanced");
  });

  it("marks a landmark its owner walked past as one to study", async () => {
    const statue: MapLandmark = {
      id: "poi:9",
      ...at(150, 12),
      kind: "statue",
      name: "Statue",
      facts: {},
    };
    updateNotebook("0x0sky", () => ({
      noticed: [{ landmark: statue, noticedAt: Date.now() }],
      studied: [],
    }));
    const { renderer, tap } = walkRenderer({
      landmarksNear: (point: MapPointSelection, radius: number) =>
        mapDistanceMeters(point, statue) <= radius ? [statue] : [],
      areasNear: () => [],
    } as unknown as Partial<MapRenderer>);
    const { core, inputs } = scriptedCore((input) =>
      input.type === "tap"
        ? [{ do: "walk", to: input.to, purpose: "tap", grass: true }]
        : [],
    );
    render(renderer, { core, reducedMotion: false });
    await settle();
    tap(at(500, 0));
    await advance(60_000);
    expect(inputs.find((input) => input.type === "passing")).toMatchObject({
      things: [{ ref: "lm:poi:9", studyable: true }],
    });
  });

  it("says a line about a place only when it knows the place", async () => {
    const { renderer } = walkRenderer();
    const lines: string[] = [];
    const { core } = scriptedCore((input) =>
      input.type === "stopped"
        ? [
            { do: "say", line: "landmark.spotted", about: "lm:gone" },
            { do: "say", line: "stroll" },
          ]
        : [],
    );
    render(renderer, {
      core,
      model: "kai-study",
      onLine: ({ kind }) => lines.push(kind),
    });
    await settle();
    expect(lines).toEqual(["stroll"]);
  });

  it("passes on what its needs ask, with home", async () => {
    const { renderer } = walkRenderer();
    const { core, inputs } = scriptedCore();
    render(renderer, {
      core,
      life: { intent: "return_home", energy: 2_500.4, home: at(-800, 0) },
    });
    await settle();
    expect(inputs).toContainEqual({
      type: "life",
      intent: "return_home",
      energy: "2500",
      home: "home",
    });
  });

  it("keeps the drive as it was when Core refuses a step", async () => {
    const { renderer } = walkRenderer();
    const avaiaDriveStep = vi.fn(async (): Promise<AvaiaDriveAnswer> => ({
      ok: false,
      error: "invalid",
    }));
    window.localStorage.setItem(
      "nilx-one.world-memory.v1.0x0sky",
      JSON.stringify({ drive: '{"kept":true}' }),
    );
    render(renderer, { core: { avaiaDriveStep } });
    await settle();
    expect(avaiaDriveStep).toHaveBeenCalledWith(
      '{"kept":true}',
      { type: "stopped" },
      expect.any(Number),
      13,
    );
    expect(readWorldMemory("0x0sky").drive).toBe('{"kept":true}');
  });

  it("stops the drive while someone else is at the wheel", async () => {
    const { renderer } = walkRenderer();
    const { core, inputs } = scriptedCore((input) =>
      input.type === "stopped"
        ? [{ do: "wake_at", ms: Date.now() + 5_000 }]
        : [],
    );
    const { rerender } = render(renderer, { core });
    await settle();
    rerender(props(renderer, { core, active: false }));
    await advance(10_000);
    expect(types(inputs)).toEqual(["stopped"]);
  });
});

describe("the favourites on the Avaia's screen", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const fond = (id: string, fields: Partial<FondPlace>): FondPlace => ({
    id,
    kind: "monument",
    longitude: ORIGIN.longitude,
    latitude: ORIGIN.latitude,
    fondness: 0.5,
    visits: 2,
    firstAt: Date.now() - 50 * DAY,
    lastAt: Date.now(),
    ...fields,
  });
  const keep = (...places: FondPlace[]) =>
    writeAffinity("0x0sky", { by: "avaia:test", places, taste: {} });

  it("reads them at the time the world opens, however long ago the visits were", () => {
    keep(
      fond("faded", { lastAt: Date.now() - 40 * DAY }),
      fond("loved", {
        fondness: 0.7,
        visits: 4,
        lastAt: Date.now() - 40 * DAY,
        lovedAt: Date.now() - 41 * DAY,
      }),
    );
    const { result } = render(walkRenderer().renderer);
    expect(result.current.favourites.map((place) => place.id)).toEqual([
      "loved",
    ]);
  });

  it("lets a favourite fade out while the page stays open", async () => {
    keep(
      fond("fading", {
        fondness: FOND_AT * 2 ** (HOUR / FONDNESS_HALF_LIFE_MS),
      }),
    );
    const { result } = render(walkRenderer().renderer);
    expect(result.current.favourites.map((place) => place.id)).toEqual([
      "fading",
    ]);

    await advance(HOUR + 1_000);
    expect(result.current.favourites).toEqual([]);
  });
});
