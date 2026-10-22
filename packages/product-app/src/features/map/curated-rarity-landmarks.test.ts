// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import type { CoreLandmarkMapRequest } from "@nilx-one/application";
import {
  curatedLandmarkPins,
  curatedLandmarkPinsFromPublication,
  MAX_LANDMARK_MAP_BATCH,
} from "./curated-rarity-landmarks";

const labels = [
  {
    id: "a",
    longitudeE7: "305000000",
    latitudeE7: "504500000",
    title: "Alpha",
    kind: "monument",
  },
  {
    id: "b",
    longitudeE7: "305100000",
    latitudeE7: "504510000",
    title: "Beta",
    kind: "sacred",
  },
  {
    id: "c",
    longitudeE7: "305200000",
    latitudeE7: "504520000",
    title: "Gamma",
    kind: "civic",
  },
] as const;

const view = JSON.stringify({
  ok: true,
  registry: 2,
  landmarks: [
    {
      id: "a",
      at: { longitude_e7: "305000000", latitude_e7: "504500000" },
      rarity: "rare",
    },
    {
      id: "b",
      at: { longitude_e7: "305100000", latitude_e7: "504510000" },
      rarity: "special",
    },
    {
      id: "c",
      at: { longitude_e7: "305200000", latitude_e7: "504520000" },
      rarity: "exclusive",
    },
  ],
});

describe("Core curated landmark map projection", () => {
  it("keeps every verified Rare+ archive landmark", () => {
    const pins = curatedLandmarkPins(view, labels);
    expect(pins.map(({ id, rarity }) => [id, rarity])).toEqual([
      ["a", "rare"],
      ["b", "special"],
      ["c", "exclusive"],
    ]);
    expect(pins[1]?.latitude).toBe(50.451);
    expect(pins[2]?.weight).toBe(1);
  });

  it("rejects missing, displaced and duplicated archive IDs", () => {
    expect(() => curatedLandmarkPins(view, labels.slice(0, 2))).toThrow();
    const displaced = [{ ...labels[0], longitudeE7: "0" }, ...labels.slice(1)];
    expect(() => curatedLandmarkPins(view, displaced)).toThrow();
    expect(() => curatedLandmarkPins(view, [...labels, labels[0]])).toThrow();
    expect(() =>
      curatedLandmarkPins(view.replace('"id":"b"', '"id":"fake"'), labels),
    ).toThrow();
  });

  it("fails closed for errors and unsupported rarity", () => {
    expect(() =>
      curatedLandmarkPins('{"ok":false,"error":"invalid"}', labels),
    ).toThrow();
    expect(
      curatedLandmarkPins('{"ok":true,"registry":1,"landmarks":[]}', labels),
    ).toEqual([]);
    expect(() =>
      curatedLandmarkPins(view.replace('"rare"', '"common"'), labels),
    ).toThrow();
  });
});

describe("complete archive batches through Core Wasm", () => {
  const labels = Array.from(
    { length: MAX_LANDMARK_MAP_BATCH + 1 },
    (_, index) => ({
      id: `archive_${index.toString().padStart(5, "0")}`,
      longitudeE7: String(305000000 + index),
      latitudeE7: "504500000",
      title: `Archive subject ${index}`,
      kind: "monument" as const,
    }),
  );
  const publication = {
    archiveRevision: "verified-publisher-revision-7",
    registry: 2,
    labels,
  };
  it("projects every Core-curated feature across page boundaries without a map top-N", async () => {
    const calls: CoreLandmarkMapRequest[] = [];
    const core = {
      landmarkMapView: async (request: CoreLandmarkMapRequest) => {
        calls.push(request);
        return JSON.stringify({
          ok: true,
          registry: request.registry,
          landmarks: request.landmarks
            .filter(
              (subject) =>
                subject.id === labels[0]?.id ||
                subject.id === labels[MAX_LANDMARK_MAP_BATCH]?.id,
            )
            .map((subject) => ({
              id: subject.id,
              at: subject.at,
              rarity: "rare",
            })),
        });
      },
    };
    const pins = await curatedLandmarkPinsFromPublication(core, publication);
    expect(calls.map(({ landmarks }) => landmarks.length)).toEqual([
      MAX_LANDMARK_MAP_BATCH,
      1,
    ]);
    expect(pins.map(({ id }) => id)).toEqual([
      labels[0]?.id,
      labels[MAX_LANDMARK_MAP_BATCH]?.id,
    ]);
  });

  it("rejects duplicates spanning Core pages before projecting any page", async () => {
    let calls = 0;
    const core = {
      landmarkMapView: async () => {
        calls += 1;
        return '{"ok":true,"registry":2,"landmarks":[]}';
      },
    };
    await expect(
      curatedLandmarkPinsFromPublication(core, {
        ...publication,
        labels: [...labels.slice(0, -1), labels[0]!],
      }),
    ).rejects.toThrow("duplicate");
    expect(calls).toBe(0);
  });

  it("validates registry and runtime even when the archive has no labels", async () => {
    let calls = 0;
    await expect(
      curatedLandmarkPinsFromPublication(
        {
          landmarkMapView: async (request: CoreLandmarkMapRequest) => {
            calls += 1;
            expect(request.landmarks).toEqual([]);
            return '{"ok":false,"error":"invalid"}';
          },
        },
        { ...publication, labels: [] },
      ),
    ).rejects.toThrow("registry mismatch");
    expect(calls).toBe(1);
  });

  it("rejects a registry mismatch or failed page atomically", async () => {
    await expect(
      curatedLandmarkPinsFromPublication(
        {
          landmarkMapView: async () =>
            '{"ok":true,"registry":1,"landmarks":[]}',
        },
        { ...publication, labels: labels.slice(0, 1) },
      ),
    ).rejects.toThrow("registry mismatch");
    let attempts = 0;
    await expect(
      curatedLandmarkPinsFromPublication(
        {
          landmarkMapView: async () => {
            if (++attempts > 1) throw new Error("unavailable Core");
            return '{"ok":true,"registry":2,"landmarks":[]}';
          },
        },
        publication,
      ),
    ).rejects.toThrow("unavailable Core");
    expect(attempts).toBe(2);
  });
});
