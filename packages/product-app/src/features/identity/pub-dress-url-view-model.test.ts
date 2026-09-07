// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PubDressLabelResolutionResult } from "@nilx-one/application";
import { describe, expect, it } from "vitest";

import {
  createPubDressUrlViewState,
  type PubDressUrlInput,
} from "./pub-dress-url-view-model";

function state(overrides: Partial<PubDressUrlInput> = {}) {
  return createPubDressUrlViewState({
    selection: { discriminator: "d", slug: "a-sha" },
    suffix: "",
    pending: false,
    resolution: undefined,
    derivation: { kind: "label", label: "0xda-sha" },
    ...overrides,
  });
}

const taken: PubDressLabelResolutionResult = {
  kind: "registered",
  label: "0xda-sha",
};

describe("public address view state", () => {
  it("stays idle until the slug is long enough to resolve", () => {
    expect(state({ selection: { discriminator: "d", slug: "a" } })).toEqual({
      kind: "idle",
    });
  });

  it("previews the Core-derived address before allocation is known", () => {
    expect(state()).toMatchObject({
      kind: "preview",
      pubDress: "0xda-sha",
      stem: "0xda-sha",
      folded: false,
      url: "https://0xda-sha.nilx.one",
      status: "unresolved",
    });
  });

  it("shows an ASCII fold reported by the Core A-label", () => {
    const view = state({
      selection: { discriminator: "d", slug: "A-Sha" },
      derivation: { kind: "label", label: "0xda-sha" },
    });

    expect(view).toMatchObject({
      kind: "preview",
      pubDress: "0xdA-Sha",
      stem: "0xda-sha",
      folded: true,
    });
    expect(view.kind === "preview" && view.detail).toContain("Core maps");
  });

  it("fails closed while the Core derivation is unavailable", () => {
    expect(state({ derivation: undefined })).toMatchObject({
      kind: "preview",
      status: "service-unavailable",
    });
    expect(
      state({ derivation: undefined, derivationPending: true }),
    ).toMatchObject({ kind: "preview", status: "checking" });
  });

  it("opens the editable part immediately when another Bond holds the label", () => {
    const view = state({ resolution: taken });

    expect(view).toMatchObject({
      kind: "suffix",
      stem: "0xda-sha",
      suffix: "",
      status: "taken",
      detail: "Another Bond holds this address — add a distinguishing part",
    });
  });

  it("fails closed only after a suffix needs Core composition", () => {
    expect(state({ resolution: taken, suffix: "7412" })).toMatchObject({
      kind: "suffix",
      suffix: "7412",
      status: "service-unavailable",
    });
  });

  it("keeps the stem fixed and presents Core composition", () => {
    expect(
      state({
        resolution: taken,
        suffix: "7412",
        composition: { kind: "label", label: "0xda-sha7412" },
      }),
    ).toMatchObject({
      kind: "suffix",
      stem: "0xda-sha",
      suffix: "7412",
      url: "https://0xda-sha7412.nilx.one",
      status: "taken",
    });
  });

  it("keeps the editable part open after the chosen address resolves free", () => {
    expect(
      state({
        suffix: "7412",
        composition: { kind: "label", label: "0xda-sha7412" },
        resolution: { kind: "available", label: "0xda-sha7412" },
      }),
    ).toMatchObject({
      kind: "suffix",
      status: "available",
      detail: "This address is free",
    });
  });

  it("reports a Core-rejected distinguishing part", () => {
    const view = state({
      resolution: taken,
      suffix: "7-",
      composition: { kind: "error", code: "invalid_character" },
    });

    expect(view).toMatchObject({ kind: "suffix", status: "invalid" });
    expect(view).not.toHaveProperty("url");
  });

  it("reports the pending allocation check while the service answers", () => {
    expect(state({ pending: true })).toMatchObject({
      status: "checking",
      detail: "Checking this address…",
    });
  });

  it("keeps a service failure distinct from a rejected address", () => {
    expect(
      state({ resolution: { kind: "service-unavailable" } }),
    ).toMatchObject({ status: "service-unavailable" });
    expect(
      state({ resolution: { kind: "rejected", reason: "invalid-label" } }),
    ).toMatchObject({ status: "invalid" });
  });

  it("gives a Cyrillic identity its readable form and Core A-label", () => {
    expect(
      state({
        selection: { discriminator: "0", slug: "небо" },
        derivation: { kind: "label", label: "xn--0x0-dddt1cj" },
      }),
    ).toMatchObject({
      kind: "preview",
      pubDress: "0x0небо",
      stem: "0x0небо",
      ascii: "xn--0x0-dddt1cj",
      url: "https://0x0небо.nilx.one",
    });
  });

  it("omits the encoded form when Core returns the readable ASCII label", () => {
    expect(state()).not.toHaveProperty("ascii");
  });

  it("renders Core bidi refusal without local script heuristics", () => {
    const view = state({
      selection: { discriminator: "0", slug: "aאב" },
      derivation: { kind: "error", code: "bidi_rule" },
    });

    expect(view).toMatchObject({
      kind: "unrepresentable",
      reason: "bidi-rule",
    });
  });

  it("renders Core scalar refusal without local Unicode classification", () => {
    expect(
      state({
        selection: { discriminator: "0", slug: "a🌍" },
        derivation: { kind: "error", code: "disallowed_scalar" },
      }),
    ).toMatchObject({ kind: "unrepresentable", reason: "disallowed-scalar" });
  });
});
