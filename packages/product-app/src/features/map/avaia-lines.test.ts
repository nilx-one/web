// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_MODEL_IDS, type MapLandmark } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "../../shell/localization";
import {
  avaiaLines,
  blockedLineKind,
  landmarkLabel,
  lineCue,
  pickAvaiaLine,
  type AvaiaLineKind,
} from "./avaia-lines";

const KINDS: readonly AvaiaLineKind[] = [
  "walk",
  "stroll",
  "blocked.building",
  "blocked.water",
  "blocked.fog",
  "landmark.spotted",
  "landmark.studied",
  "landmark.loved",
  "landmark.longing",
  "fog.reveal",
  "fog.revealed",
  "fog.busy",
];

const monument: MapLandmark = {
  id: "poi:1",
  longitude: 30.5,
  latitude: 50.4,
  kind: "monument",
  name: "Volodymyr the Great",
  facts: { "name:uk": "Володимир Великий" },
};

describe("what an Avaia says to itself", () => {
  it("gives every study its own walking lines, in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const voices = new Set<string>();
      for (const model of AVATAR_MODEL_IDS) {
        const walk = avaiaLines(locale, model, "walk");
        expect(walk.length).toBeGreaterThanOrEqual(5);
        expect(walk.length).toBeLessThanOrEqual(10);
        expect(new Set(walk).size).toBe(walk.length);
        voices.add(walk.join("|"));
        for (const kind of KINDS) {
          expect(avaiaLines(locale, model, kind).length).toBeGreaterThan(0);
        }
      }
      // A study is a voice: no two share one.
      expect(voices.size).toBe(AVATAR_MODEL_IDS.length);
    }
  });

  it("names the landmark in every line about one", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const model of AVATAR_MODEL_IDS) {
        for (const kind of [
          "landmark.spotted",
          "landmark.studied",
          "landmark.loved",
          "landmark.longing",
        ] as const) {
          for (const line of avaiaLines(locale, model, kind)) {
            expect(line).toContain("{landmark}");
          }
        }
      }
    }
  });

  it("never repeats the line it just said when it has another", () => {
    const first = pickAvaiaLine({
      locale: "en",
      model: "kai-study",
      kind: "walk",
      random: () => 0,
    });
    const second = pickAvaiaLine({
      locale: "en",
      model: "kai-study",
      kind: "walk",
      previous: first,
      random: () => 0,
    });

    expect(second).not.toBe(first);
  });

  it("calls a landmark by its name in the reader's language, or by what it is", () => {
    expect(landmarkLabel("uk-UA", monument)).toBe("«Володимир Великий»");
    expect(landmarkLabel("en", monument)).toBe("“Volodymyr the Great”");

    const unnamed: MapLandmark = {
      id: monument.id,
      longitude: monument.longitude,
      latitude: monument.latitude,
      kind: monument.kind,
      facts: {},
    };
    expect(landmarkLabel("uk-UA", unnamed)).toBe("пам’ятник");
    expect(landmarkLabel("ru-RU", unnamed)).toBe("памятник");
    expect(landmarkLabel("ru-RU", monument)).toBe("«Volodymyr the Great»");
    expect(
      landmarkLabel("ru-RU", {
        ...monument,
        facts: { "name:ru": "Владимир Великий" },
      }),
    ).toBe("«Владимир Великий»");
    expect(
      pickAvaiaLine({
        locale: "en",
        model: "sky-study",
        kind: "landmark.studied",
        landmark: unnamed,
        random: () => 0,
      }),
    ).toBe("A monument. Noted.");
  });

  it("answers each refusal with its own kind of line", () => {
    expect(blockedLineKind("building")).toBe("blocked.building");
    expect(blockedLineKind("water")).toBe("blocked.water");
    expect(blockedLineKind("fog")).toBe("blocked.fog");
  });

  it("marks what it says with a cue, and leaves a reveal to its own", () => {
    expect(lineCue("walk")).toBe("walk");
    expect(lineCue("stroll")).toBe("walk");
    expect(lineCue("fog.reveal")).toBe("walk");
    for (const ground of ["building", "water", "fog"] as const) {
      expect(lineCue(blockedLineKind(ground))).toBe("refuse");
    }
    expect(lineCue("fog.busy")).toBe("refuse");
    expect(lineCue("landmark.spotted")).toBe("spot");
    expect(lineCue("landmark.studied")).toBe("study");
    // The reveal is heard wherever it came from, so its line adds nothing.
    expect(lineCue("fog.revealed")).toBeUndefined();
  });
});
