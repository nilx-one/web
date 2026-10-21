// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvatarModelId } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { offsetMeters } from "../ambient-drones/ambient-drone-schedule";
import type { AmbientAnimalSighting } from "../ambient-animals/use-ambient-animals";
import type { ProductLocale } from "../../shell/localization";
import {
  AVAIA_ANIMAL_LINE_KINDS,
  AVAIA_ANIMAL_LINES,
} from "./avaia-animal-lines";
import {
  ANIMAL_REMARK_GAP_MS,
  EMPTY_REMARK_MEMORY,
  SAME_ANIMAL_GAP_MS,
  animalRemark,
} from "./avaia-animal-remarks";
import { avaiaLines, lineCue } from "./avaia-lines";
import { avaiaVoiceUrl } from "./avaia-voice";

const body = { longitude: 30.52, latitude: 50.45 };

function seen(
  id: string,
  kind: AmbientAnimalSighting["kind"],
  meters: number,
): AmbientAnimalSighting {
  const [longitude, latitude] = offsetMeters(
    [body.longitude, body.latitude],
    meters,
    0,
  );
  return { id, kind, longitude, latitude };
}

const never = () => 0.99;
const always = () => 0;

describe("an Avaia noticing the city's animals", () => {
  it("remarks on the nearest animal within a few steps", () => {
    const remark = animalRemark({
      body,
      sightings: [seen("far", "cat", 30), seen("near", "squirrel", 5)],
      nowMs: 1_000_000,
      memory: EMPTY_REMARK_MEMORY,
      random: never,
    });
    expect(remark?.kind).toBe("animal.squirrel");
    expect(remark?.memory.heard.get("near")).toBe(1_000_000);
  });

  it("notices an eagle from further off than a cat", () => {
    const sightings = [seen("e", "eagle", 50), seen("c", "cat", 50)];
    const remark = animalRemark({
      body,
      sightings,
      nowMs: 0,
      memory: EMPTY_REMARK_MEMORY,
      random: never,
    });
    expect(remark?.kind).toBe("animal.eagle");
  });

  it("is startled by dogs and eagles, never by a cat", () => {
    const at = (sighting: AmbientAnimalSighting) =>
      animalRemark({
        body,
        sightings: [sighting],
        nowMs: 0,
        memory: EMPTY_REMARK_MEMORY,
        random: always,
      })?.kind;
    expect(at(seen("d", "dog", 4))).toBe("animal.startled.dog");
    expect(at(seen("e", "eagle", 40))).toBe("animal.startled.eagle");
    expect(at(seen("c", "cat", 4))).toBe("animal.cat");
    expect(at(seen("p", "piranha", 4))).toBe("animal.piranha");
  });

  it("does not chatter, and does not repeat itself about one animal", () => {
    const first = animalRemark({
      body,
      sightings: [seen("a", "cat", 4)],
      nowMs: 0,
      memory: EMPTY_REMARK_MEMORY,
      random: never,
    });
    expect(first).toBeDefined();
    const sightings = [seen("a", "cat", 4), seen("b", "dog", 6)];
    const soon = (nowMs: number) =>
      animalRemark({
        body,
        sightings,
        nowMs,
        memory: first!.memory,
        random: never,
      });
    expect(soon(ANIMAL_REMARK_GAP_MS - 1)).toBeUndefined();
    // After the gap the cat it already spoke of is passed over for the dog.
    expect(soon(ANIMAL_REMARK_GAP_MS)?.kind).toBe("animal.dog");
    const alone = animalRemark({
      body,
      sightings: [seen("a", "cat", 4)],
      nowMs: SAME_ANIMAL_GAP_MS - 1,
      memory: first!.memory,
      random: never,
    });
    expect(alone).toBeUndefined();
  });

  it("says nothing with no animal close", () => {
    expect(
      animalRemark({
        body,
        sightings: [seen("a", "squirrel", 40)],
        nowMs: 0,
        memory: EMPTY_REMARK_MEMORY,
      }),
    ).toBeUndefined();
  });
});

describe("the lines about animals", () => {
  const locales = Object.keys(AVAIA_ANIMAL_LINES) as ProductLocale[];
  const models = Object.keys(AVAIA_ANIMAL_LINES.en) as AvatarModelId[];

  it("are written for every study, in every locale", () => {
    expect(locales.sort()).toEqual(["en", "ru-RU", "uk-UA"]);
    expect(models).toHaveLength(4);
    for (const locale of locales)
      for (const model of models)
        for (const kind of AVAIA_ANIMAL_LINE_KINDS) {
          const lines = avaiaLines(locale, model, kind);
          expect(lines.length).toBeGreaterThanOrEqual(3);
          expect(new Set(lines).size).toBe(lines.length);
          for (const line of lines) expect(line).not.toMatch(/[{}]/);
        }
  });

  it("carry a cue, and are text only until they are recorded", () => {
    for (const kind of AVAIA_ANIMAL_LINE_KINDS) {
      expect(lineCue(kind)).toBe(
        kind.startsWith("animal.startled.") ? "refuse" : "spot",
      );
      const text = avaiaLines("en", "sky-study", kind)[0]!;
      expect(
        avaiaVoiceUrl({ locale: "en", model: "sky-study", kind, text }),
      ).toBeUndefined();
    }
  });
});
