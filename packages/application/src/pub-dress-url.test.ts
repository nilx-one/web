// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  formatPubDressUrl,
  normalizePubDressUrlSuffix,
  projectCorePubDressLabel,
  projectCorePubDressLabelComposition,
  suggestPubDressUrlSuffix,
} from "./pub-dress-url";

describe("Core-backed pub_dress URL presentation", () => {
  it("shows an unchanged ASCII Core label directly", () => {
    expect(
      projectCorePubDressLabel("0xda-sha", {
        kind: "label",
        label: "0xda-sha",
      }),
    ).toEqual({
      kind: "stem",
      stem: "0xda-sha",
      ascii: "0xda-sha",
      source: "0xda-sha",
      folded: false,
    });
  });

  it("makes an ASCII fold visible without reimplementing it", () => {
    expect(
      projectCorePubDressLabel("0xdA-Sha", {
        kind: "label",
        label: "0xda-sha",
      }),
    ).toEqual({
      kind: "stem",
      stem: "0xda-sha",
      ascii: "0xda-sha",
      source: "0xdA-Sha",
      folded: true,
    });
  });

  it("keeps exact Cyrillic identity readable while DNS uses Core A-label", () => {
    expect(
      projectCorePubDressLabel("0x0небо", {
        kind: "label",
        label: "xn--0x0-dddt1cj",
      }),
    ).toEqual({
      kind: "stem",
      stem: "0x0небо",
      ascii: "xn--0x0-dddt1cj",
      source: "0x0небо",
      folded: false,
    });
  });

  it("maps Core rejection codes into presentation without classifying Unicode", () => {
    expect(
      projectCorePubDressLabel("0x0a🌍", {
        kind: "error",
        code: "disallowed_scalar",
      }),
    ).toEqual({
      kind: "unrepresentable",
      reason: "disallowed-scalar",
    });
    expect(
      projectCorePubDressLabel("0x0aא", {
        kind: "error",
        code: "bidi_rule",
      }),
    ).toEqual({ kind: "unrepresentable", reason: "bidi-rule" });
  });

  it("presents a Core-composed Unicode label without encoding it again", () => {
    expect(
      projectCorePubDressLabelComposition(
        "0x0небо",
        "7412",
        { kind: "label", label: "xn--0x07412-dgg9a9en" },
      ),
    ).toEqual({
      kind: "label",
      label: "0x0небо7412",
      ascii: "xn--0x07412-dgg9a9en",
      url: "https://0x0небо7412.nilx.one",
    });
  });

  it("keeps Core composition errors typed", () => {
    expect(
      projectCorePubDressLabelComposition("0x0sky", "123456789", {
        kind: "error",
        code: "suffix_too_long",
      }),
    ).toEqual({ kind: "rejected", reason: "too-long" });
  });
});

describe("presentation-only URL helpers", () => {
  it("normalizes only ASCII case in a suffix", () => {
    expect(normalizePubDressUrlSuffix("  A2 ")).toBe("a2");
    expect(normalizePubDressUrlSuffix("Éé")).toBe("Éé");
  });

  it("formats a URL against an explicit zone", () => {
    expect(formatPubDressUrl("0x0sky", "example.test")).toBe(
      "https://0x0sky.example.test",
    );
  });

  it("draws the requested number of decimal suffix digits", () => {
    const draws = [0.12, 0.34, 0.56, 0.78];
    let index = 0;

    expect(suggestPubDressUrlSuffix(() => draws[index++] ?? 0)).toBe("1357");
    expect(suggestPubDressUrlSuffix(() => 1, 3)).toBe("999");
    expect(suggestPubDressUrlSuffix(() => 0, 3)).toBe("000");
  });
});
