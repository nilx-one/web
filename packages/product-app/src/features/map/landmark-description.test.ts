// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  admitDescription,
  DESCRIBE_SYSTEM_PROMPT,
  describeInput,
  DESCRIPTION_MAX_CHARS,
  descriptionTemplate,
  readLandmarkFacts,
} from "./landmark-description";
import shared from "./landmark-description.json";

describe("describing a landmark, held to nilx-one/ai's cases", () => {
  it("carries the same prompt and bound", () => {
    expect(shared.system_prompt).toBe(DESCRIBE_SYSTEM_PROMPT);
    expect(shared.max_chars).toBe(DESCRIPTION_MAX_CHARS);
  });

  for (const sharedCase of shared.cases) {
    it(sharedCase.name, () => {
      const facts = readLandmarkFacts(sharedCase.input);
      expect(facts).toBeDefined();
      expect(descriptionTemplate(facts!)).toBe(sharedCase.template);
      for (const said of sharedCase.accepts) {
        expect(admitDescription(facts!, said), said).toBeDefined();
      }
      for (const said of sharedCase.refuses) {
        expect(admitDescription(facts!, said), said).toBeUndefined();
      }
    });
  }

  for (const refused of shared.refused_inputs) {
    it(`refuses ${refused.name}`, () => {
      expect(readLandmarkFacts(refused.input)).toBeUndefined();
    });
  }
});

describe("the faculty's input for a landmark the map draws", () => {
  const motherland: MapLandmark = {
    id: "poi:1",
    longitude: 30.563,
    latitude: 50.4265,
    kind: "monument",
    name: "Motherland Monument",
    facts: { "name:uk": "Батьківщина-Мати", start_date: "1981", height: 62 },
  };

  it("names it in the reader's language and carries nothing about the person", () => {
    const input = describeInput(motherland, "uk-UA", "монумент");
    expect(input).toEqual({
      locale: "uk",
      kind: "monument",
      kind_label: "монумент",
      name: "Батьківщина-Мати",
      facts: motherland.facts,
    });
    expect(descriptionTemplate(readLandmarkFacts(input)!)).toBe(
      "Батьківщина-Мати — монумент. З 1981 року. Висота — 62 м.",
    );
    expect(describeInput(motherland, "en", "monument").name).toBe(
      "Motherland Monument",
    );
  });
});
