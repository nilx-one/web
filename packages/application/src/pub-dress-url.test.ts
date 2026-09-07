// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  PUB_DRESS_URL_SUFFIX_MAX_LENGTH,
  composePubDressLabel,
  derivePubDressLabelStem,
  formatPubDressUrl,
  normalizePubDressUrlSuffix,
  suggestPubDressUrlSuffix,
} from "./pub-dress-url";

describe("pub_dress URL derivation", () => {
  it("keeps an already lowercase address unchanged", () => {
    expect(derivePubDressLabelStem("0xda-sha")).toEqual({
      kind: "stem",
      stem: "0xda-sha",
      folded: false,
    });
  });

  it("reports the fold so the Bond sees the case it loses", () => {
    expect(derivePubDressLabelStem("0xdA-Sha")).toEqual({
      kind: "stem",
      stem: "0xda-sha",
      folded: true,
    });
  });

  it("folds two case-distinct identities onto one label", () => {
    const upper = derivePubDressLabelStem("0x0Sky");
    const lower = derivePubDressLabelStem("0x0sky");

    expect(upper).toMatchObject({ kind: "stem", stem: "0x0sky" });
    expect(lower).toMatchObject({ kind: "stem", stem: "0x0sky" });
  });

  it("refuses input that is not a canonical pub_dress", () => {
    expect(derivePubDressLabelStem("sky")).toEqual({
      kind: "unrepresentable",
      reason: "not-a-pub-dress",
    });
    expect(derivePubDressLabelStem("0xgsky")).toEqual({
      kind: "unrepresentable",
      reason: "not-a-pub-dress",
    });
  });

  it("leaves the discriminator out of the fold, because it is already lowercase hexadecimal", () => {
    expect(derivePubDressLabelStem("0xDsky")).toEqual({
      kind: "unrepresentable",
      reason: "not-a-pub-dress",
    });
  });

  it("refuses a non-ASCII address instead of transliterating it", () => {
    expect(derivePubDressLabelStem("0x0небо")).toEqual({
      kind: "unrepresentable",
      reason: "non-ascii",
    });
  });

  it("names an unsupported ASCII character separately from a non-ASCII one", () => {
    expect(derivePubDressLabelStem("0x0sky_one")).toEqual({
      kind: "unrepresentable",
      reason: "unsupported-character",
    });
  });

  it("refuses a label that would end on a hyphen", () => {
    expect(derivePubDressLabelStem("0x0sky-")).toEqual({
      kind: "unrepresentable",
      reason: "boundary-hyphen",
    });
  });

  it("never folds onto a service host, because every stem keeps 0x", () => {
    for (const reserved of ["www", "api", "admin", "mail"]) {
      const stem = derivePubDressLabelStem(`0x0${reserved}`);
      expect(stem).toMatchObject({ kind: "stem" });
      if (stem.kind === "stem") {
        expect(stem.stem).not.toBe(reserved);
        expect(stem.stem.startsWith("0x")).toBe(true);
      }
    }
  });
});

describe("pub_dress URL composition", () => {
  it("composes the zone URL without a suffix", () => {
    expect(composePubDressLabel("0xda-sha")).toEqual({
      kind: "label",
      label: "0xda-sha",
      url: "https://0xda-sha.nilx.one",
    });
  });

  it("appends the suffix the Bond chose after a collision", () => {
    expect(composePubDressLabel("0xda-sha", "7412")).toEqual({
      kind: "label",
      label: "0xda-sha7412",
      url: "https://0xda-sha7412.nilx.one",
    });
  });

  it("folds a suffix typed in upper case", () => {
    expect(composePubDressLabel("0x0sky", "TWO")).toMatchObject({
      label: "0x0skytwo",
    });
  });

  it("rejects a suffix that pushes the label past the suffix budget", () => {
    const suffix = "1".repeat(PUB_DRESS_URL_SUFFIX_MAX_LENGTH + 1);

    expect(composePubDressLabel("0x0sky", suffix)).toEqual({
      kind: "rejected",
      reason: "too-long",
    });
  });

  it("rejects a suffix that would leave a trailing hyphen", () => {
    expect(composePubDressLabel("0x0sky", "2-")).toEqual({
      kind: "rejected",
      reason: "boundary-hyphen",
    });
  });

  it("rejects a suffix carrying an unsupported character", () => {
    expect(composePubDressLabel("0x0sky", "a.b")).toEqual({
      kind: "rejected",
      reason: "unsupported-character",
    });
  });

  it("trims and folds a suffix before validating it", () => {
    expect(normalizePubDressUrlSuffix("  A2 ")).toBe("a2");
  });

  it("formats a URL against an explicit zone", () => {
    expect(formatPubDressUrl("0x0sky", "example.test")).toBe(
      "https://0x0sky.example.test",
    );
  });
});

describe("collision suffix suggestion", () => {
  it("draws the requested number of digits", () => {
    const draws = [0.12, 0.34, 0.56, 0.78];
    let index = 0;

    expect(suggestPubDressUrlSuffix(() => draws[index++] ?? 0)).toBe("1357");
  });

  it("stays a digit even when the source returns its bounds", () => {
    expect(suggestPubDressUrlSuffix(() => 1, 3)).toBe("999");
    expect(suggestPubDressUrlSuffix(() => 0, 3)).toBe("000");
  });

  it("always composes into a valid label", () => {
    let seed = 0;
    const suffix = suggestPubDressUrlSuffix(() => {
      seed += 0.17;
      return seed % 1;
    });

    expect(composePubDressLabel("0xda-sha", suffix)).toMatchObject({
      kind: "label",
    });
  });
});
