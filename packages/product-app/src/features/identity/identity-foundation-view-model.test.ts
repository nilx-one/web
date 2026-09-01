// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createIdentityFoundationViewModel,
  createPubDressAvailabilityViewState,
} from "./identity-foundation-view-model";

const browserHost = {
  kind: "browser" as const,
  available: true,
  theme: "light" as const,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  authentication: { kind: "browser-session" as const },
};

describe("createIdentityFoundationViewModel", () => {
  it("maps infrastructure absence to a visible product boundary", () => {
    expect(
      createIdentityFoundationViewModel(browserHost, {
        kind: "blocked",
        reason: "artifact-missing",
      }),
    ).toMatchObject({
      hostLabel: "browser host",
      runtime: {
        tone: "blocked",
        label: "Shared Core required",
      },
    });
  });

  it("keeps Telegram host absence distinct from Core readiness", () => {
    expect(
      createIdentityFoundationViewModel(
        {
          ...browserHost,
          kind: "telegram",
          available: false,
          authentication: {
            kind: "telegram-init-data",
            initData: "",
            verification: "required",
          },
        },
        undefined,
      ),
    ).toMatchObject({
      hostLabel: "telegram unavailable",
      registration: { kind: "provider-required" },
      runtime: {
        tone: "loading",
      },
    });
  });

  it("allows an authenticated Discord Activity to use the shared registration surface", () => {
    expect(
      createIdentityFoundationViewModel(
        {
          ...browserHost,
          kind: "discord",
          authentication: {
            kind: "discord-oauth",
            authenticated: true,
            verification: "required",
          },
        },
        { kind: "ready", contractVersion: "0.1.0" },
        { kind: "not-registered" },
      ),
    ).toMatchObject({
      hostLabel: "discord host",
      registration: { kind: "form" },
    });
  });
});

describe("createPubDressAvailabilityViewState", () => {
  const selection = { discriminator: "0", slug: "sky" };

  it("does not claim availability before the server answers", () => {
    expect(
      createPubDressAvailabilityViewState(selection, true, undefined),
    ).toEqual({ kind: "checking" });
    expect(
      createPubDressAvailabilityViewState(selection, false, undefined),
    ).toEqual({ kind: "idle" });
  });

  it("keeps available, occupied, and invalid states distinct", () => {
    expect(
      createPubDressAvailabilityViewState(selection, false, {
        kind: "available",
      }),
    ).toEqual({ kind: "available", detail: "Available" });
    expect(
      createPubDressAvailabilityViewState(selection, false, {
        kind: "unavailable",
      }),
    ).toEqual({ kind: "unavailable", detail: "Already taken" });
    expect(
      createPubDressAvailabilityViewState(selection, false, {
        kind: "rejected",
        reason: "invalid-character",
      }),
    ).toEqual({
      kind: "invalid",
      detail: "This character isn’t supported",
    });
  });
});
