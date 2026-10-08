// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogField,
  MapFogMark,
  MapLandmark,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFogFieldDouble } from "../../../../../tests/support/doubles";
import {
  FOG_REVEAL_MIN_MS,
  readAuthorizedAt,
  revealRemainingMs,
  writeAuthorizedAt,
  writeRevealJobs,
  type FogRevealJob,
} from "./fog-reveal";
import type { AvaiaProximitySnapshot } from "./use-avaia-proximity";
import {
  FOG_AUTHORIZED_HEARTBEAT_MS,
  useFogReveal,
  type FogRevealInput,
} from "./use-fog-reveal";

/** What Core says for an Avaia `distance` metres away and free to work. */
function allowed(distance: number): AvaiaProximitySnapshot {
  return {
    policy: {
      distance_m: distance,
      red_m: 5_000,
      restore_below_m: 4_500,
      level: distance < 15 ? "near" : "working",
      can_reveal: true,
      duration_ms: 60_000,
    },
    durationFor: () => 60_000,
  };
}

/** What Core says once reveals are held. */
function blocked(distance: number): AvaiaProximitySnapshot {
  return {
    policy: {
      distance_m: distance,
      red_m: 5_000,
      restore_below_m: 4_500,
      level: distance >= 5_000 ? "red" : "restricted",
      can_reveal: false,
      duration_ms: null,
    },
    durationFor: () => null,
  };
}

function fogRenderer(
  fog: MapFogField,
  landmarks: readonly MapLandmark[] = [],
): MapRenderer & { readonly marks: (readonly MapFogMark[])[] } {
  const marks: (readonly MapFogMark[])[] = [];
  return {
    marks,
    fog,
    setFogMarks: (next: readonly MapFogMark[]) => void marks.push(next),
    landmarksNear: () => landmarks,
  } as unknown as MapRenderer & { readonly marks: (readonly MapFogMark[])[] };
}

const BOND: MapPointSelection = { longitude: 30.52, latitude: 50.45 };
const NEXT_DOOR: MapPointSelection = { longitude: 30.53, latitude: 50.45 };
const ACROSS: MapPointSelection = { longitude: 30.51, latitude: 50.45 };

function render(input: Partial<FogRevealInput> & { renderer: MapRenderer }) {
  return renderHook((props: FogRevealInput) => useFogReveal(props), {
    initialProps: {
      bondPoint: BOND,
      observed: undefined,
      owner: "0x0sky",
      ...input,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("revealing the fog around a Bond", () => {
  it("marks what is in reach and asks before sending the Avaia", () => {
    const fog = createFogFieldDouble(0.01);
    const renderer = fogRenderer(fog);
    const { result } = render({ renderer });

    expect(result.current.frontier.map((cell) => cell.id)).toContain(
      "strip:3053",
    );
    // The Bond is never in the fog: the ground under it is not offered.
    expect(result.current.frontier.map((cell) => cell.id)).not.toContain(
      "strip:3052",
    );
    expect(result.current.handleFogTap(BOND)).toBe("out-of-reach");
    expect(
      renderer.marks.at(-1)?.every((mark) => mark.state === "available"),
    ).toBe(true);

    let outcome: string | undefined;
    act(() => {
      outcome = result.current.handleFogTap(NEXT_DOOR);
    });
    expect(outcome).toBe("offered");
    expect(result.current.prompt).toMatchObject({
      cell: { id: "strip:3053" },
      landmarks: 0,
      durationMs: FOG_REVEAL_MIN_MS,
      busy: false,
    });
    expect(
      result.current.handleFogTap({ longitude: 31, latitude: 50.45 }),
    ).toBe("out-of-reach");
  });

  it("reveals a confirmed cell after its time, and says so", () => {
    const fog = createFogFieldDouble(0.01);
    const onRevealed = vi.fn();
    const landmark: MapLandmark = {
      id: "poi:1",
      longitude: 30.53,
      latitude: 50.45,
      kind: "monument",
      facts: {},
    };
    const { result } = render({
      renderer: fogRenderer(fog, [landmark]),
      onRevealed,
    });

    act(() => void result.current.handleFogTap(NEXT_DOOR));
    // One landmark in the cell is one more minute.
    expect(result.current.prompt?.durationMs).toBe(2 * 60_000);
    act(() => void result.current.confirm());
    expect(result.current.prompt).toBeUndefined();
    expect(result.current.jobs).toHaveLength(1);

    act(() => vi.advanceTimersByTime(2 * 60_000 - 1));
    expect(fog.isRevealed("strip:3053")).toBe(false);
    act(() => vi.advanceTimersByTime(1));

    expect(fog.isRevealed("strip:3053")).toBe(true);
    expect(result.current.jobs).toEqual([]);
    expect(onRevealed).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "strip:3053" }),
      "avaia",
    );
  });

  it("works three cells at once and no more", () => {
    const fog = createFogFieldDouble(0.01);
    const { result } = render({ renderer: fogRenderer(fog) });

    for (const longitude of [30.54, 30.53, 30.51]) {
      act(
        () => void result.current.handleFogTap({ longitude, latitude: 50.45 }),
      );
      act(() => void result.current.confirm());
    }
    expect(result.current.jobs).toHaveLength(3);

    let outcome: string | undefined;
    act(() => {
      outcome = result.current.handleFogTap({
        longitude: 30.5,
        latitude: 50.45,
      });
    });
    expect(outcome).toBe("busy");
    expect(result.current.prompt?.busy).toBe(true);
    act(() => void result.current.confirm());
    expect(result.current.jobs).toHaveLength(3);
    expect(
      result.current.handleFogTap({ longitude: 30.53, latitude: 50.45 }),
    ).toBe("revealing");
  });

  it("reveals the cell this device walks into at once, with no Avaia", () => {
    const fog = createFogFieldDouble(0.01);
    const onRevealed = vi.fn();
    const renderer = fogRenderer(fog);
    const { result, rerender } = render({ renderer, onRevealed });
    act(() => void result.current.handleFogTap(NEXT_DOOR));
    act(() => void result.current.confirm());

    rerender({
      renderer,
      bondPoint: NEXT_DOOR,
      observed: { ...NEXT_DOOR, accuracyMeters: 12 },
      owner: "0x0sky",
      onRevealed,
    });

    expect(fog.isRevealed("strip:3053")).toBe(true);
    expect(onRevealed).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "strip:3053" }),
      "approach",
    );
    // The reveal working on that cell has nothing left to do.
    expect(result.current.jobs).toEqual([]);
  });

  it("does not reveal on a vague observation", () => {
    const fog = createFogFieldDouble(0.01);
    render({
      renderer: fogRenderer(fog),
      observed: { ...NEXT_DOOR, accuracyMeters: 400 },
    });

    expect(fog.revealed.size).toBe(0);
  });

  it("keeps a reveal going across a reopened page", () => {
    const fog = createFogFieldDouble(0.01);
    const renderer = fogRenderer(fog);
    const first = render({ renderer });
    act(() => void first.result.current.handleFogTap(NEXT_DOOR));
    act(() => void first.result.current.confirm());
    first.unmount();

    act(() => vi.advanceTimersByTime(FOG_REVEAL_MIN_MS * 2));
    const second = render({ renderer });
    // It lands on the next tick after the page opens, not a minute later.
    act(() => vi.advanceTimersByTime(0));

    expect(fog.isRevealed("strip:3053")).toBe(true);
    expect(second.result.current.jobs).toEqual([]);
  });

  it("never lets one Bond inherit cells revealed by another Bond on the same device", () => {
    const fog = createFogFieldDouble(0.01);
    const renderer = fogRenderer(fog);
    const sky = render({ renderer, owner: "0x0sky" });
    act(() => void sky.result.current.handleFogTap(NEXT_DOOR));
    act(() => void sky.result.current.confirm());
    act(() => vi.advanceTimersByTime(FOG_REVEAL_MIN_MS));
    expect(fog.isRevealed("strip:3053")).toBe(true);
    sky.unmount();

    // Alice signs into the same device: the field is rebound to her Bond,
    // and Sky's revealed cell must not come with it — the frontier still
    // offers it, and revealing a cell of her own must not silently answer
    // for Sky's.
    const alice = render({ renderer, owner: "0x0alice" });
    expect(alice.result.current.frontier.map((cell) => cell.id)).toContain(
      "strip:3053",
    );
    act(() => void alice.result.current.handleFogTap(ACROSS));
    act(() => void alice.result.current.confirm());
    act(() => vi.advanceTimersByTime(FOG_REVEAL_MIN_MS));
    expect(fog.isRevealed("strip:3051")).toBe(true);
    alice.unmount();

    // Sky signs back in: her own reveal is exactly as she left it, unmixed
    // with what Alice revealed in between.
    const skyAgain = render({ renderer, owner: "0x0sky" });
    expect(fog.isRevealed("strip:3053")).toBe(true);
    expect(
      skyAgain.result.current.frontier.map((cell) => cell.id),
    ).not.toContain("strip:3053");
    expect(skyAgain.result.current.frontier.map((cell) => cell.id)).toContain(
      "strip:3051",
    );
  });

  it("sends the Avaia to the cell's edge on open ground, never into the fog", () => {
    const fog = createFogFieldDouble(0.01);
    const renderer = fogRenderer(fog);
    const { result } = render({ renderer });
    act(() => void result.current.handleFogTap(NEXT_DOOR));
    act(() => void result.current.confirm());
    const cell = fog.cellAt(NEXT_DOOR);
    expect(result.current.jobs.map((job) => job.cell.id)).toEqual([cell.id]);

    const stand = result.current.approach(cell);
    expect(fog.cellAt(stand).id).not.toBe(cell.id);
    // The Bond's own ground is where it approaches from.
    expect(fog.cellAt(stand).id).toBe("strip:3052");
  });

  it("fails closed without Core and pauses work when Avaia exceeds the distance boundary", async () => {
    const fog = createFogFieldDouble(0.01);
    const renderer = fogRenderer(fog);
    const near = allowed(15);
    const red = blocked(5_000);
    const base: FogRevealInput = {
      renderer,
      bondPoint: BOND,
      observed: undefined,
      owner: "0x0sky",
      enforceProximity: true,
    };
    const { result, rerender } = renderHook(
      (props: FogRevealInput) => useFogReveal(props),
      {
        initialProps: base,
      },
    );
    expect(result.current.handleFogTap(NEXT_DOOR)).toBe("out-of-reach");
    rerender({ ...base, proximity: near });
    act(() => void result.current.handleFogTap(NEXT_DOOR));
    expect(result.current.prompt?.durationMs).toBe(60_000);
    act(() => void result.current.confirm());
    expect(result.current.jobs).toHaveLength(1);
    act(() => vi.advanceTimersByTime(10_000));

    await act(async () => {
      rerender({ ...base, proximity: red });
    });
    expect(result.current.handleFogTap(ACROSS)).toBe("out-of-reach");
    expect(result.current.jobs[0]?.pausedAt).toBeDefined();
    act(() => vi.advanceTimersByTime(3_600_000));
    expect(fog.isRevealed("strip:3053")).toBe(false);
    await act(async () => {
      rerender({ ...base, proximity: near });
    });
    expect(result.current.jobs[0]?.pausedAt).toBeUndefined();
    act(() => vi.advanceTimersByTime(49_999));
    expect(fog.isRevealed("strip:3053")).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fog.isRevealed("strip:3053")).toBe(true);
  });

  it("quotes Core's duration for the cell's landmarks, never its own table", () => {
    const fog = createFogFieldDouble(0.01);
    const durations: number[] = [];
    const proximity = {
      ...allowed(2_000),
      durationFor: (artifacts: number) => {
        durations.push(artifacts);
        return 90_000 + artifacts * 1_000;
      },
    };
    const renderer = fogRenderer(fog, [
      { id: "a", name: "A", longitude: 30.53, latitude: 50.45 },
    ] as unknown as MapLandmark[]);
    const { result } = render({
      renderer,
      enforceProximity: true,
      proximity,
    });
    act(() => void result.current.handleFogTap(NEXT_DOOR));
    const asked = result.current.prompt!;
    expect(durations.length).toBeGreaterThan(0);
    expect(new Set(durations)).toEqual(new Set([asked.landmarks]));
    expect(asked.durationMs).toBe(90_000 + asked.landmarks * 1_000);
    act(() => void result.current.confirm());
    expect(result.current.jobs[0]?.durationMs).toBe(asked.durationMs);
  });

  it("starts on Core's quote at the moment of the yes, not the one from the tap", () => {
    const fog = createFogFieldDouble(0.01);
    const quoting = (ms: number | null): AvaiaProximitySnapshot => ({
      ...allowed(2_000),
      durationFor: () => ms,
    });
    const base: FogRevealInput = {
      renderer: fogRenderer(fog),
      bondPoint: BOND,
      observed: undefined,
      owner: "0x0sky",
      enforceProximity: true,
      proximity: quoting(60_000),
    };
    const { result, rerender } = renderHook(
      (props: FogRevealInput) => useFogReveal(props),
      { initialProps: base },
    );
    act(() => void result.current.handleFogTap(NEXT_DOOR));
    expect(result.current.prompt?.durationMs).toBe(60_000);

    // Avaia walks away while the question is open: the prompt follows Core.
    rerender({ ...base, proximity: quoting(180_000) });
    expect(result.current.prompt?.durationMs).toBe(180_000);
    let job: FogRevealJob | undefined;
    act(() => {
      job = result.current.confirm();
    });
    expect(job?.durationMs).toBe(180_000);
  });

  it("closes the question and starts nothing once Core's quote is gone", () => {
    const fog = createFogFieldDouble(0.01);
    const quoting = (ms: number | null): AvaiaProximitySnapshot => ({
      ...allowed(2_000),
      durationFor: () => ms,
    });
    const base: FogRevealInput = {
      renderer: fogRenderer(fog),
      bondPoint: BOND,
      observed: undefined,
      owner: "0x0sky",
      enforceProximity: true,
      proximity: quoting(60_000),
    };
    const { result, rerender } = renderHook(
      (props: FogRevealInput) => useFogReveal(props),
      { initialProps: base },
    );
    act(() => void result.current.handleFogTap(NEXT_DOOR));
    expect(result.current.prompt).toBeDefined();
    // Still "can reveal", but no quote for this cell any more.
    rerender({ ...base, proximity: quoting(null) });
    expect(result.current.prompt).toBeUndefined();
    let job: FogRevealJob | undefined;
    act(() => {
      job = result.current.confirm();
    });
    expect(job).toBeUndefined();
    expect(result.current.jobs).toHaveLength(0);
  });

  it("offers nothing when Core quotes no duration, whatever its table says", () => {
    const fog = createFogFieldDouble(0.01);
    const { result } = render({
      renderer: fogRenderer(fog),
      enforceProximity: true,
      proximity: { ...allowed(15), durationFor: () => null },
    });
    expect(result.current.handleFogTap(NEXT_DOOR)).toBe("out-of-reach");
    expect(result.current.prompt).toBeUndefined();
  });

  describe("when the page is reopened", () => {
    const OWNER = "0x0sky";
    const CLOSED = 1_800_000_000_000;

    function stored(job: Partial<FogRevealJob> = {}): FogRevealJob {
      const cell = createFogFieldDouble(0.01).cellAt(NEXT_DOOR);
      return {
        cell,
        startedAt: CLOSED,
        durationMs: 600_000,
        landmarks: 0,
        ...job,
      };
    }

    async function reopen(
      proximity: ReturnType<typeof allowed> | undefined,
      hoursClosed: number,
    ) {
      vi.setSystemTime(CLOSED + hoursClosed * 3_600_000);
      const renderer = fogRenderer(createFogFieldDouble(0.01));
      const hook = renderHook((props: FogRevealInput) => useFogReveal(props), {
        initialProps: {
          renderer,
          bondPoint: BOND,
          observed: undefined,
          owner: OWNER,
          enforceProximity: true,
          proximity,
        } as FogRevealInput,
      });
      await act(async () => {});
      return hook;
    }

    it("never works the hours it was closed, however near Avaia is now", async () => {
      writeRevealJobs(OWNER, [stored()]);
      writeAuthorizedAt(OWNER, CLOSED + 120_000); // last allowed 2 min in
      const { result } = await reopen(allowed(15), 5);
      const job = result.current.jobs[0]!;
      expect(job.pausedAt).toBeUndefined();
      // 10 min asked, 2 min worked: 8 min remain, not zero.
      expect(revealRemainingMs(job, Date.now())).toBe(480_000);
      expect(result.current.jobs).toHaveLength(1);
      act(() => vi.advanceTimersByTime(479_999));
      expect(result.current.jobs).toHaveLength(1);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.jobs).toHaveLength(0);
    });

    it("stays frozen while Core is blocked or has not answered", async () => {
      writeRevealJobs(OWNER, [stored()]);
      writeAuthorizedAt(OWNER, CLOSED + 120_000);
      for (const proximity of [undefined, blocked(5_000)]) {
        const { result, unmount } = await reopen(proximity, 5);
        expect(result.current.jobs[0]?.pausedAt).toBe(CLOSED + 120_000);
        act(() => vi.advanceTimersByTime(3_600_000));
        expect(result.current.jobs).toHaveLength(1);
        unmount();
      }
    });

    it("credits nothing without a heartbeat", async () => {
      writeRevealJobs(OWNER, [stored()]);
      const { result } = await reopen(allowed(15), 5);
      expect(revealRemainingMs(result.current.jobs[0]!, Date.now())).toBe(
        600_000,
      );
    });

    it("records authorization while running, and stops when blocked", async () => {
      writeRevealJobs(OWNER, [stored()]);
      writeAuthorizedAt(OWNER, CLOSED);
      const { result, rerender } = await reopen(allowed(15), 0);
      act(() => vi.advanceTimersByTime(FOG_AUTHORIZED_HEARTBEAT_MS * 2));
      const beat = readAuthorizedAt(OWNER)!;
      expect(beat).toBeGreaterThanOrEqual(
        CLOSED + FOG_AUTHORIZED_HEARTBEAT_MS * 2,
      );
      rerender({
        renderer: fogRenderer(createFogFieldDouble(0.01)),
        bondPoint: BOND,
        observed: undefined,
        owner: OWNER,
        enforceProximity: true,
        proximity: blocked(5_000),
      });
      await act(async () => {});
      act(() => vi.advanceTimersByTime(60_000));
      expect(readAuthorizedAt(OWNER)).toBe(beat);
      expect(result.current.jobs[0]?.pausedAt).toBeDefined();
    });
  });

  it("offers nothing where no fog is drawn", () => {
    const { result } = render({ renderer: {} as MapRenderer });

    expect(result.current.active).toBe(false);
    expect(result.current.frontier).toEqual([]);
    expect(result.current.handleFogTap(NEXT_DOOR)).toBe("no-fog");
  });
});
