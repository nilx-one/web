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

  it("previews the address before anything is known about it", () => {
    expect(state()).toMatchObject({
      kind: "preview",
      pubDress: "0xda-sha",
      stem: "0xda-sha",
      folded: false,
      url: "https://0xda-sha.nilx.one",
      status: "unresolved",
    });
  });

  it("shows the Bond the case its address loses", () => {
    const view = state({ selection: { discriminator: "d", slug: "A-Sha" } });

    expect(view).toMatchObject({
      kind: "preview",
      pubDress: "0xdA-Sha",
      stem: "0xda-sha",
      folded: true,
    });
    expect(view.kind === "preview" && view.detail).toContain("Lowercased");
  });

  it("says the address is already lowercase when nothing was folded", () => {
    expect(state()).toMatchObject({
      detail: "This address is already lowercase",
    });
  });

  it("opens the editable part when another Bond holds the label", () => {
    const view = state({ resolution: taken });

    expect(view).toMatchObject({
      kind: "suffix",
      stem: "0xda-sha",
      suffix: "",
      status: "taken",
    });
    expect(view.kind === "suffix" && view.detail).toContain("Another Bond");
  });

  it("keeps the stem fixed and composes the chosen part into the URL", () => {
    expect(state({ resolution: taken, suffix: "7412" })).toMatchObject({
      kind: "suffix",
      stem: "0xda-sha",
      suffix: "7412",
      url: "https://0xda-sha7412.nilx.one",
    });
  });

  it("keeps the editable part open after the chosen address resolves free", () => {
    expect(
      state({
        suffix: "7412",
        resolution: { kind: "available", label: "0xda-sha7412" },
      }),
    ).toMatchObject({
      kind: "suffix",
      status: "available",
      detail: "This address is free",
    });
  });

  it("reports a part that cannot appear in an address", () => {
    const view = state({ resolution: taken, suffix: "7-" });

    expect(view).toMatchObject({ kind: "suffix", status: "invalid" });
    // No URL is offered while the composed label is not one a resolver would
    // accept, so nothing can present an unreachable address as reachable.
    expect(view).not.toHaveProperty("url");
  });

  it("reports the pending check while the service answers", () => {
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

  it("gives a Cyrillic identity a readable address and its encoded form", () => {
    expect(
      state({ selection: { discriminator: "0", slug: "небо" } }),
    ).toMatchObject({
      kind: "preview",
      pubDress: "0x0небо",
      stem: "0x0небо",
      ascii: "xn--0x0-dddt1cj",
      url: "https://0x0небо.nilx.one",
    });
  });

  it("omits the encoded form when it is the address itself", () => {
    expect(state()).not.toHaveProperty("ascii");
  });

  it("refuses a right-to-left identity, naming the prefix as the cause", () => {
    const view = state({ selection: { discriminator: "0", slug: "אבג" } });

    expect(view).toMatchObject({
      kind: "unrepresentable",
      reason: "bidi-rule",
    });
    expect(view.kind === "unrepresentable" && view.detail).toContain(
      "0x prefix",
    );
  });

  it("refuses a symbol rather than promising an address registration denies", () => {
    expect(
      state({ selection: { discriminator: "0", slug: "🌍🌎" } }),
    ).toMatchObject({ kind: "unrepresentable", reason: "disallowed-scalar" });
  });
});
