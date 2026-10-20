// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  descriptionOf,
  EMPTY_NOTEBOOK,
  keepDescription,
  landmarksToStudy,
  nextLandmarkToStudy,
  noticeLandmarks,
  readNotebook,
  seeLandmark,
  seenBy,
  studiedBy,
  studyLandmark,
  writeNotebook,
  type NotebookStorage,
} from "./landmark-notebook";

function landmark(id: string, longitude: number): MapLandmark {
  return { id, longitude, latitude: 50.45, kind: "monument", facts: {} };
}

function memoryStorage(): NotebookStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const near = landmark("poi:near", 30.524);
const far = landmark("poi:far", 30.53);
const beyond = landmark("poi:beyond", 31.5);
const from = { longitude: 30.5234, latitude: 50.45 };

describe("the landmark notebook", () => {
  it("lists every landmark still to study, nearest first, for curiosity's menu", () => {
    const notebook = noticeLandmarks(EMPTY_NOTEBOOK, [far, beyond, near], 1);
    expect(
      landmarksToStudy(notebook, "x0skai", from).map(
        ({ landmark }) => landmark.id,
      ),
    ).toEqual(["poi:near", "poi:far"]);
    const [first] = landmarksToStudy(notebook, "x0skai", from);
    expect(first?.meters).toBeGreaterThan(0);
    expect(first?.landmark.id).toBe(
      nextLandmarkToStudy(notebook, "x0skai", from)?.id,
    );
    const studied = studyLandmark(notebook, near, "x0skai", 2);
    expect(
      landmarksToStudy(studied, "x0skai", from).map(
        ({ landmark }) => landmark.id,
      ),
    ).toEqual(["poi:far"]);
  });

  it("keeps the first time each landmark was noticed", () => {
    const once = noticeLandmarks(EMPTY_NOTEBOOK, [near], 1);
    const twice = noticeLandmarks(once, [near, far], 2);

    expect(twice.noticed).toEqual([
      { landmark: near, noticedAt: 1 },
      { landmark: far, noticedAt: 2 },
    ]);
    // Nothing new is no change at all.
    expect(noticeLandmarks(twice, [near], 3)).toBe(twice);
  });

  it("sends an Avaia to the nearest thing it has not studied, within reach", () => {
    const notebook = noticeLandmarks(EMPTY_NOTEBOOK, [far, near, beyond], 1);

    expect(nextLandmarkToStudy(notebook, "x0skai", from)?.id).toBe("poi:near");

    const studied = studyLandmark(notebook, near, "x0skai", 2);
    expect(nextLandmarkToStudy(studied, "x0skai", from)?.id).toBe("poi:far");
    // A landmark standing in the fog waits until its ground is open.
    expect(
      nextLandmarkToStudy(
        notebook,
        "x0skai",
        from,
        undefined,
        (point) => point.longitude !== near.longitude,
      )?.id,
    ).toBe("poi:far");
    // Another Avaia has its own notes.
    expect(nextLandmarkToStudy(studied, "0other", from)?.id).toBe("poi:near");

    const done = studyLandmark(studied, far, "x0skai", 3);
    // What is out of reach stays where it is.
    expect(nextLandmarkToStudy(done, "x0skai", from)).toBeUndefined();
    expect(studiedBy(done, "x0skai").map((entry) => entry.landmark.id)).toEqual(
      ["poi:far", "poi:near"],
    );
  });

  it("only goes where its owner has been", () => {
    expect(nextLandmarkToStudy(EMPTY_NOTEBOOK, "x0skai", from)).toBeUndefined();
  });

  it("survives a reload, and forgets rather than breaks on a bad record", () => {
    const storage = memoryStorage();
    const notebook = studyLandmark(
      noticeLandmarks(EMPTY_NOTEBOOK, [near], 1),
      near,
      "x0skai",
      2,
    );

    writeNotebook("0x0sky", notebook, storage);
    expect(readNotebook("0x0sky", storage)).toEqual(notebook);
    expect(readNotebook("0xother", storage)).toEqual(EMPTY_NOTEBOOK);

    storage.data.set(
      [...storage.data.keys()][0] ?? "",
      JSON.stringify({ noticed: [{ landmark: { id: 1 } }], studied: "no" }),
    );
    expect(readNotebook("0x0sky", storage)).toEqual(EMPTY_NOTEBOOK);

    storage.data.set([...storage.data.keys()][0] ?? "", "{not json");
    expect(readNotebook("0x0sky", storage)).toEqual(EMPTY_NOTEBOOK);
  });

  it("keeps what an Avaia described as seen, never as studied", () => {
    const notebook = seeLandmark(
      seeLandmark(
        seeLandmark(EMPTY_NOTEBOOK, near, "x0skai", 1),
        far,
        "x0skai",
        2,
      ),
      near,
      "x0skai",
      3,
    );
    // Seeing it again moves it to the latest, once.
    expect(
      seenBy(notebook, "x0skai").map((entry) => entry.landmark.id),
    ).toEqual(["poi:near", "poi:far"]);
    expect(seenBy(notebook, "other")).toEqual([]);
    // Seen is not studied, and never sends it back to study.
    expect(studiedBy(notebook, "x0skai")).toEqual([]);
    expect(landmarksToStudy(notebook, "x0skai", from)).toEqual([]);
    // Once studied, it is listed with what it studied.
    const studied = studyLandmark(
      noticeLandmarks(notebook, [near], 4),
      near,
      "x0skai",
      5,
    );
    expect(seenBy(studied, "x0skai").map((entry) => entry.landmark.id)).toEqual(
      ["poi:far"],
    );
  });

  it("reads a notebook kept before seen as having seen nothing", () => {
    const storage = memoryStorage();
    storage.data.set(
      "nilx-one.avaia.landmarks.v1.0x0sky",
      JSON.stringify({
        noticed: [{ landmark: near, noticedAt: 1 }],
        studied: [],
      }),
    );
    expect(readNotebook("0x0sky", storage)).toEqual({
      noticed: [{ landmark: near, noticedAt: 1 }],
      studied: [],
      seen: [],
      descriptions: [],
    });
    const seen = seeLandmark(EMPTY_NOTEBOOK, near, "x0skai", 2);
    writeNotebook("0x0sky", seen, storage);
    expect(readNotebook("0x0sky", storage)).toEqual(seen);
  });

  it("keeps one description per landmark, the latest", () => {
    const first = keepDescription(EMPTY_NOTEBOOK, {
      landmarkId: "poi:near",
      text: "Near — monument.",
      producedBy: "template",
      templateVersion: 1,
      describedAt: 1,
    });
    const second = keepDescription(first, {
      landmarkId: "poi:near",
      text: "Near is a monument.",
      producedBy: "Qwen3-0.6B-q4f16_1-MLC",
      templateVersion: 1,
      describedAt: 2,
    });
    expect(second.descriptions).toHaveLength(1);
    expect(descriptionOf(second, "poi:near")?.text).toBe("Near is a monument.");
    expect(descriptionOf(second, "poi:far")).toBeUndefined();

    const storage = memoryStorage();
    writeNotebook("0x0sky", second, storage);
    expect(readNotebook("0x0sky", storage)).toEqual(second);
  });
});
