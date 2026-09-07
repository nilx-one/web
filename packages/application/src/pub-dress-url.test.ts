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
      ascii: "0xda-sha",
      source: "0xda-sha",
      folded: false,
    });
  });

  it("reports the fold so the Bond sees the case it loses", () => {
    expect(derivePubDressLabelStem("0xdA-Sha")).toEqual({
      kind: "stem",
      stem: "0xda-sha",
      ascii: "0xda-sha",
      source: "0xdA-Sha",
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

  it("encodes a Cyrillic address instead of refusing it", () => {
    expect(derivePubDressLabelStem("0x0небо")).toEqual({
      kind: "stem",
      stem: "0x0небо",
      ascii: "xn--0x0-dddt1cj",
      source: "0x0небо",
      folded: false,
    });
  });

  it("folds case across scripts, so Cyrillic collides exactly as ASCII does", () => {
    const upper = derivePubDressLabelStem("0x0Небо");
    const lower = derivePubDressLabelStem("0x0небо");

    expect(upper).toMatchObject({ stem: "0x0небо", folded: true });
    expect(lower).toMatchObject({ stem: "0x0небо", folded: false });
    expect(upper.kind === "stem" && lower.kind === "stem").toBe(true);
    if (upper.kind === "stem" && lower.kind === "stem") {
      expect(upper.ascii).toBe(lower.ascii);
    }
  });

  it("keeps the deviation characters on their non-transitional reading", () => {
    // Under transitional processing these become `0x0strasse` and a different
    // sigma encoding — two different addresses for one identity.
    expect(derivePubDressLabelStem("0x0straße")).toMatchObject({
      ascii: "xn--0x0strae-wya",
    });
    expect(derivePubDressLabelStem("0x0ςigma")).toMatchObject({
      ascii: "xn--0x0igma-zpf",
    });
  });

  it("refuses a symbol that punycode would happily encode", () => {
    expect(derivePubDressLabelStem("0x0a🌍")).toEqual({
      kind: "unrepresentable",
      reason: "disallowed-scalar",
    });
  });

  it("refuses a right-to-left address, which the 0x prefix cannot carry", () => {
    for (const rtl of ["0x0aא", "0x0aء"]) {
      expect(derivePubDressLabelStem(rtl)).toEqual({
        kind: "unrepresentable",
        reason: "bidi-rule",
      });
    }
  });

  it("measures length on the encoded form, not on the address typed", () => {
    // 32 scalars is a valid pub_dress slug; encoded it reaches 105 octets.
    const slug = Array.from({ length: 32 }, (_, index) =>
      String.fromCodePoint(0x4e00 + ((index * 997) % 0x3000)),
    ).join("");

    expect([...slug]).toHaveLength(32);
    expect(derivePubDressLabelStem(`0x0${slug}`)).toEqual({
      kind: "unrepresentable",
      reason: "too-long",
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
      ascii: "0xda-sha",
      url: "https://0xda-sha.nilx.one",
    });
  });

  it("keeps the readable form in the URL and the encoded form beside it", () => {
    expect(composePubDressLabel("0x0небо")).toEqual({
      kind: "label",
      label: "0x0небо",
      ascii: "xn--0x0-dddt1cj",
      url: "https://0x0небо.nilx.one",
    });
  });

  it("composes before encoding, so the suffix does not break the encoding", () => {
    const composed = composePubDressLabel("0x0небо", "7412");

    expect(composed).toMatchObject({
      label: "0x0небо7412",
      ascii: "xn--0x07412-dgg9a9en",
      url: "https://0x0небо7412.nilx.one",
    });
  });

  it("appends the suffix the Bond chose after a collision", () => {
    expect(composePubDressLabel("0xda-sha", "7412")).toEqual({
      kind: "label",
      label: "0xda-sha7412",
      ascii: "0xda-sha7412",
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

describe("agreement with the encoder", () => {
  // Every case here previously produced an address the contract would not
  // allocate, or named the wrong cause for a refusal.

  it("never shows a readable form whose encoding differs from the real label", () => {
    // `toLowerCase` applies Final_Sigma and gives `ς` where UTS-46 gives `σ`,
    // which are two different addresses. The readable form is dropped rather
    // than shown wrong.
    const derived = derivePubDressLabelStem("0x0ΟΔΟΣ");

    expect(derived).toMatchObject({ kind: "stem", ascii: "xn--0x0-2xc8cb2a" });
    if (derived.kind === "stem") {
      expect(derived.stem).toBe(derived.ascii);
    }
  });

  it("folds compatibility forms onto the label their ASCII twin holds", () => {
    const wide = derivePubDressLabelStem("0x0ａｂ");
    const plain = derivePubDressLabelStem("0x0ab");

    expect(wide).toMatchObject({ stem: "0x0ab", ascii: "0x0ab", folded: true });
    expect(plain).toMatchObject({ ascii: "0x0ab", folded: false });
  });

  it("keeps the suffix ASCII whatever the stem's script", () => {
    expect(composePubDressLabel("0x0sky", "Éé")).toEqual({
      kind: "rejected",
      reason: "unsupported-character",
    });
    expect(normalizePubDressUrlSuffix("Éé")).toBe("Éé");
  });

  it("composes on the identity as typed, not on the folded form", () => {
    expect(composePubDressLabel("0x0Небо", "7412")).toEqual({
      kind: "label",
      label: "0x0небо7412",
      ascii: "xn--0x07412-dgg9a9en",
      url: "https://0x0небо7412.nilx.one",
    });
  });

  it("tolerates a zone given in another case", () => {
    expect(derivePubDressLabelStem("0x0sky", "NILX.ONE")).toMatchObject({
      kind: "stem",
      ascii: "0x0sky",
    });
  });
});
