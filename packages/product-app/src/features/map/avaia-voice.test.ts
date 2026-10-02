// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { avaiaLines } from "./avaia-lines";
import { AVAIA_VOICE_VERSION, avaiaVoiceUrl } from "./avaia-voice";

describe("where an Avaia's line can be heard", () => {
  it("finds the recording of a fixed line by the line it is", () => {
    const text = avaiaLines("uk-UA", "kai-study", "walk")[3]!;
    expect(
      avaiaVoiceUrl({
        locale: "uk-UA",
        model: "kai-study",
        kind: "walk",
        text,
      }),
    ).toBe(`/voices/${AVAIA_VOICE_VERSION}/uk-UA/kai-study/walk.3.mp3`);
  });

  it("has none for a line about a landmark, whose name only the moment knows", () => {
    const template = avaiaLines("en", "sky-study", "landmark.spotted")[0]!;
    expect(
      avaiaVoiceUrl({
        locale: "en",
        model: "sky-study",
        kind: "landmark.spotted",
        text: template.replace("{landmark}", "Golden Gate"),
      }),
    ).toBeUndefined();
  });

  it("has none in a locale no licensed voice speaks", () => {
    const text = avaiaLines("ru-RU", "dasha-study", "walk")[0]!;
    expect(
      avaiaVoiceUrl({
        locale: "ru-RU",
        model: "dasha-study",
        kind: "walk",
        text,
      }),
    ).toBeUndefined();
  });

  it("has none for text that is not one of the study's own lines", () => {
    expect(
      avaiaVoiceUrl({
        locale: "en",
        model: "dasha-study",
        kind: "walk",
        text: "Something nobody wrote.",
      }),
    ).toBeUndefined();
  });
});
