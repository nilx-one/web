// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  LANDMARK_MAPPER_VERSION,
  landmarksFromArchive,
  mapArchiveLandmarks,
} from "./landmark-mapper";
import { LANDMARK_MAPPING } from "./landmark-normalize";
import { outingCandidates } from "./outing-targets";

const ORIGIN = { longitude: 30.5234, latitude: 50.4501 };
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN.latitude * Math.PI) / 180);

const poi = (
  id: string,
  kind: string,
  x: number,
  y: number,
  name: string | undefined = id,
): MapLandmark => ({
  id,
  kind,
  longitude: ORIGIN.longitude + x * M_LON,
  latitude: ORIGIN.latitude + y * M_LAT,
  ...(name === undefined ? {} : { name }),
  facts: {},
});

describe("which archive kinds the mapper reads", () => {
  it("drops a kind with no row instead of defaulting it", () => {
    expect(
      mapArchiveLandmarks([
        poi("h", "historic", 0, 0),
        poi("c", "cafe", 10, 0),
        poi("a", "attraction", 20, 0),
        poi("p", "park", 30, 0),
        poi("toString", "toString", 40, 0),
      ]),
    ).toEqual([]);
  });

  it("passes the archive's kind on as a row, never as a raw tag", () => {
    const [museum] = mapArchiveLandmarks([poi("m", "museum", 0, 0)]);
    expect(museum).toEqual({
      sourceId: "m",
      matches: ["museum"],
      name: "m",
      geometry: { type: "point", point: [ORIGIN.longitude, ORIGIN.latitude] },
    });
    expect(Object.keys(museum!)).not.toContain("kind");
  });
});

describe("monuments", () => {
  it("are small unless an attraction of the same name stands with them", () => {
    const landmarks = landmarksFromArchive([
      poi("Mother Motherland", "monument", 0, 0),
      poi("mother motherland!", "attraction", 20, 0),
      poi("Plain memorial", "memorial", 500, 0),
      // A same-named attraction too far away supports nothing.
      poi("Plain memorial", "landmark", 500 + 2 * 50, 0),
    ]);
    expect(landmarks.map((l) => [l.name, l.kind])).toEqual([
      ["Mother Motherland", "major_monument"],
      ["Plain memorial", "small_monument"],
    ]);
    expect(LANDMARK_MAPPING.duplicateWithinMeters).toBe(50);
  });

  it("are never promoted by an attraction with another name", () => {
    const [landmark] = landmarksFromArchive([
      poi("A", "monument", 0, 0),
      poi("B", "attraction", 5, 0),
    ]);
    expect(landmark?.kind).toBe("small_monument");
  });
});

describe("what becomes an outing target", () => {
  it("is a named walk target, and nothing from the route landmark group", () => {
    const targets = outingCandidates(
      landmarksFromArchive([
        poi("Viewpoint", "viewpoint", 0, 0),
        poi("Museum", "museum", 300, 0),
        poi("Unnamed museum", "museum", 600, 0, " "),
        poi("Statue", "statue", 900, 0),
        poi("Small memorial", "memorial", 1_200, 0),
      ]),
    );
    expect(targets.map((target) => [target.name, target.kind])).toEqual([
      ["Museum", "museum"],
      ["Viewpoint", "viewpoint"],
    ]);
  });

  it("collapses one place read from two tiles into one target", () => {
    const targets = outingCandidates(
      landmarksFromArchive([
        poi("poi:1", "castle", 0, 0, "Castle"),
        poi("poi:2", "castle", 3, 0, "Castle"),
      ]),
    );
    expect(targets).toHaveLength(1);
  });
});

describe("determinism", () => {
  it("gives the same landmarks for the same features in any order", () => {
    const features = [
      poi("Viewpoint", "viewpoint", 0, 0),
      poi("Museum", "museum", 300, 0),
      poi("Fort", "fort", 600, 40),
      poi("Monument", "monument", 900, 0),
      poi("Monument", "attraction", 905, 0),
      poi("Artwork", "artwork", 50, 50),
    ];
    const once = landmarksFromArchive(features);
    expect(landmarksFromArchive([...features].reverse())).toEqual(once);
    // Golden: changing a row changes this, and raises the version with it.
    expect({
      version: LANDMARK_MAPPER_VERSION,
      normalize: LANDMARK_MAPPING.version,
      kinds: once.map((landmark) => [landmark.name, landmark.kind]),
    }).toEqual({
      version: "1.0",
      normalize: "1.0",
      kinds: [
        ["Artwork", "artwork"],
        ["Fort", "fort"],
        ["Monument", "major_monument"],
        ["Museum", "museum"],
        ["Viewpoint", "viewpoint"],
      ],
    });
  });
});
