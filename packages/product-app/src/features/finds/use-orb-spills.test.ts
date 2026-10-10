// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { OrbSpillAccessPort } from "@nilx-one/application";
import type { OrbWorldInput, OrbWorldView } from "@nilx-one/application";
import { artifactSha, type ArtifactId } from "@nilx-one/artifact-contract";
import type { MapFogCell, MapOrb, MapRenderer } from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../progression/committed-sync", () => ({
  queueWorldAwards: vi.fn(async () => undefined),
}));

import { queueWorldAwards } from "../progression/committed-sync";
import { findsWithin, squareAround } from "./orb-spills";
import {
  ORB_REACH_CHECK_MS,
  useOrbSpills,
  type OrbSpillsInput,
} from "./use-orb-spills";

const NOW = Date.UTC(2026, 9, 10, 12);
const center = { longitude: 30.4469, latitude: 50.4655 };

/** A cell around `center` that holds at least one find this week. */
function cellWithFind(): MapFogCell {
  for (let size = 150; size < 2_000; size += 50) {
    const ring = squareAround(center, size);
    if (findsWithin(ring, NOW).length > 0) {
      return { id: "cell", center, boundary: ring };
    }
  }
  throw new Error("no find near the test cell");
}

function renderer(): MapRenderer & { orbs: readonly MapOrb[] } {
  const state = { orbs: [] as readonly MapOrb[] };
  return Object.assign(state, {
    setOrbs: vi.fn((orbs: readonly MapOrb[]) => {
      state.orbs = orbs;
    }),
  }) as unknown as MapRenderer & { orbs: readonly MapOrb[] };
}

/**
 * A stand-in for Core: one orb per count at the find itself, and whoever
 * stands exactly there reaches them. The rules are Core's; this only proves
 * the hook draws Core's answer and picks up what Core says is in reach.
 */
const core = {
  orbWorld: vi.fn(async (world: OrbWorldInput): Promise<OrbWorldView> => {
    const orbs = world.spills.flatMap((spill) =>
      Array.from({ length: spill.count }, (_, index) => ({
        id: `orb:${spill.artifact_id}:${index}`,
        kind: "orb" as const,
        at: spill.to,
        lands_at: spill.appeared_at,
      })).filter(
        (orb, index) =>
          !spill.taken.includes(index) && !world.picked.includes(orb.id),
      ),
    );
    const reach = (at: OrbWorldInput["avaia"]) =>
      at === null
        ? []
        : orbs
            .filter(
              (orb) =>
                orb.at.longitude_e7 === at.longitude_e7 &&
                orb.at.latitude_e7 === at.latitude_e7,
            )
            .map((orb) => orb.id);
    return {
      orbs,
      bond_reach: reach(world.bond),
      avaia_reach: reach(world.avaia),
      next_expiry: null,
    };
  }),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useOrbSpills", () => {
  it("spills the finds of an opened cell, draws them, and lets the Avaia pick them up", async () => {
    const cell = cellWithFind();
    const [roll] = findsWithin(cell.boundary, NOW);
    const id = roll!.artifactId as ArtifactId;
    const sha = await artifactSha(id);
    const port: OrbSpillAccessPort = {
      spillOrbs: vi.fn(async (artifactId: string) => ({
        kind: "spilled" as const,
        spill: {
          sha: artifactId === id ? sha : "f".repeat(64),
          count: 7,
          expiresAt: NOW + 30 * 60_000,
          taken: [],
        },
      })),
      readOrbSpills: vi.fn(async () => ({ kind: "read" as const, spills: [] })),
    };
    const world = renderer();
    const avaia: {
      point?: { readonly longitude: number; readonly latitude: number };
    } = {};
    const { result } = renderHook(() =>
      useOrbSpills({
        owner: "0x0sky",
        port,
        core,
        renderer: world,
        near: undefined,
        bond: undefined,
        avaiaPoint: () => avaia.point,
      }),
    );

    await act(async () => {
      result.current.spill(cell);
      await vi.advanceTimersByTimeAsync(1);
    });
    // The spill is kept, then Core is asked about it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(port.spillOrbs).toHaveBeenCalledWith(id);
    const drawn = world.orbs.filter(
      (orb) => orb.kind === "orb" && orb.id.startsWith(`orb:${id}:`),
    );
    expect(drawn).toHaveLength(7);

    avaia.point = {
      longitude: drawn[0]!.longitude,
      latitude: drawn[0]!.latitude,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORB_REACH_CHECK_MS);
    });
    expect(queueWorldAwards).toHaveBeenCalledWith(
      "0x0sky",
      expect.arrayContaining([
        {
          record: {
            kind: "orb_picked_up",
            earner: "avaia",
            subject: drawn[0]!.id,
            at: expect.any(Number),
          },
        },
      ]),
    );
    // Picked up, it is no longer Core's to draw.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(world.orbs.map((orb) => orb.id)).not.toContain(drawn[0]!.id);
  });

  it.each([
    { mode: "manual position", accuracyMeters: 999, declared: true },
    { mode: "accurate GPS", accuracyMeters: 10, declared: false },
  ])("lets a driving Bond collect orbs at $mode", async ({ accuracyMeters, declared }) => {
    const cell = cellWithFind();
    const [roll] = findsWithin(cell.boundary, NOW);
    const sha = await artifactSha(roll!.artifactId);
    const port: OrbSpillAccessPort = {
      spillOrbs: vi.fn(async () => ({
        kind: "spilled" as const,
        spill: {
          sha,
          count: 7,
          expiresAt: NOW + 30 * 60_000,
          taken: [],
        },
      })),
      readOrbSpills: vi.fn(async () => ({ kind: "read" as const, spills: [] })),
    };
    const world = renderer();
    const { result, rerender } = renderHook(
      ({ bond }: { bond: OrbSpillsInput["bond"] }) =>
        useOrbSpills({
          owner: "0x0sky",
          port,
          core,
          renderer: world,
          near: center,
          bond,
          avaiaPoint: () => undefined,
        }),
      { initialProps: { bond: undefined as OrbSpillsInput["bond"] } },
    );

    await act(async () => {
      result.current.spill(cell);
      await vi.advanceTimersByTimeAsync(2);
    });
    const orb = world.orbs.find((item) => item.kind === "orb");
    expect(orb).toBeDefined();

    rerender({
      bond: {
        longitude: orb!.longitude,
        latitude: orb!.latitude,
        accuracyMeters,
        ...(declared ? { declared: true } : {}),
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(queueWorldAwards).toHaveBeenCalledWith(
      "0x0sky",
      expect.arrayContaining([
        {
          record: {
            kind: "orb_picked_up",
            earner: "bond",
            subject: orb!.id,
            at: expect.any(Number),
          },
        },
      ]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(world.orbs.map((item) => item.id)).not.toContain(orb!.id);
  });

  it("refuses imprecise GPS fixes and a Bond not driving", async () => {
    const cell = cellWithFind();
    const [roll] = findsWithin(cell.boundary, NOW);
    const sha = await artifactSha(roll!.artifactId);
    const port: OrbSpillAccessPort = {
      spillOrbs: vi.fn(async () => ({
        kind: "spilled" as const,
        spill: {
          sha,
          count: 7,
          expiresAt: NOW + 30 * 60_000,
          taken: [],
        },
      })),
      readOrbSpills: vi.fn(async () => ({ kind: "read" as const, spills: [] })),
    };
    const world = renderer();
    const { result, rerender } = renderHook(
      ({ bond }: { bond: OrbSpillsInput["bond"] }) =>
        useOrbSpills({
          owner: "0x0sky",
          port,
          core,
          renderer: world,
          near: center,
          bond,
          avaiaPoint: () => undefined,
        }),
      { initialProps: { bond: undefined as OrbSpillsInput["bond"] } },
    );

    await act(async () => {
      result.current.spill(cell);
      await vi.advanceTimersByTimeAsync(2);
    });
    const orb = world.orbs.find((item) => item.kind === "orb");
    expect(orb).toBeDefined();

    rerender({
      bond: {
        longitude: orb!.longitude,
        latitude: orb!.latitude,
        accuracyMeters: 90,
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(queueWorldAwards).not.toHaveBeenCalled();

    rerender({ bond: undefined }); // Wheel belongs to Avaia, or handover underway.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORB_REACH_CHECK_MS);
    });
    expect(queueWorldAwards).not.toHaveBeenCalled();
  });

  it("draws nothing on a host without spills", () => {
    const world = renderer();
    const { result } = renderHook(() =>
      useOrbSpills({
        owner: "0x0sky",
        port: {},
        core,
        renderer: world,
        near: center,
        bond: undefined,
        avaiaPoint: () => undefined,
      }),
    );
    result.current.spill(cellWithFind());
    expect(world.orbs).toEqual([]);
  });
});
