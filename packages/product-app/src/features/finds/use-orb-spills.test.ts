// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { OrbSpillAccessPort } from "@nilx-one/application";
import {
  artifactSha,
  orbCount,
  type ArtifactId,
} from "@nilx-one/artifact-contract";
import type { MapFogCell, MapOrb, MapRenderer } from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../progression/committed-sync", () => ({
  queueWorldAwards: vi.fn(async () => undefined),
}));

import { queueWorldAwards } from "../progression/committed-sync";
import { findsWithin, squareAround } from "./orb-spills";
import { ORB_REACH_CHECK_MS, useOrbSpills } from "./use-orb-spills";

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
          count: orbCount(artifactId as ArtifactId),
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
        renderer: world,
        near: undefined,
        bond: undefined,
        avaiaPoint: () => avaia.point,
      }),
    );

    await act(async () => {
      result.current.spill(cell);
      await vi.runOnlyPendingTimersAsync();
    });
    expect(port.spillOrbs).toHaveBeenCalledWith(id);
    const drawn = world.orbs.filter(
      (orb) => orb.kind === "orb" && orb.id.startsWith(`orb:${id}:`),
    );
    expect(drawn).toHaveLength(orbCount(id));

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
    expect(world.orbs.map((orb) => orb.id)).not.toContain(drawn[0]!.id);
  });

  it("draws nothing on a host without spills", () => {
    const world = renderer();
    const { result } = renderHook(() =>
      useOrbSpills({
        owner: "0x0sky",
        port: {},
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
