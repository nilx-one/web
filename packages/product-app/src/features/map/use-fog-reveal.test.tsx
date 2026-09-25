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
import { FOG_REVEAL_MIN_MS } from "./fog-reveal";
import { useFogReveal, type FogRevealInput } from "./use-fog-reveal";

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
      "strip:3052",
    );
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

    for (const longitude of [30.52, 30.53, 30.51]) {
      act(
        () => void result.current.handleFogTap({ longitude, latitude: 50.45 }),
      );
      act(() => void result.current.confirm());
    }
    expect(result.current.jobs).toHaveLength(3);

    let outcome: string | undefined;
    act(() => {
      outcome = result.current.handleFogTap({
        longitude: 30.54,
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

  it("offers nothing where no fog is drawn", () => {
    const { result } = render({ renderer: {} as MapRenderer });

    expect(result.current.active).toBe(false);
    expect(result.current.frontier).toEqual([]);
    expect(result.current.handleFogTap(NEXT_DOOR)).toBe("no-fog");
  });
});
