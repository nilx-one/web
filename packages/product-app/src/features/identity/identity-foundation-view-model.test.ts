// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createIdentityFoundationViewModel,
  createNativeIdentityViewState,
  createProviderIdentityViewState,
  createPubDressStatusViewState,
} from "./identity-foundation-view-model";

const browserHost = {
  kind: "browser" as const,
  available: true,
  theme: "light" as const,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  authentication: { kind: "browser-session" as const },
};

describe("identity foundation view state", () => {
  it("maps runtime absence independently from native identity state", () => {
    const identity = createNativeIdentityViewState(
      { kind: "anonymous" },
      { kind: "idle", detail: "Case-sensitive · 2–32 characters" },
      undefined,
      undefined,
      false,
    );
    expect(
      createIdentityFoundationViewModel(
        browserHost,
        { kind: "blocked", reason: "artifact-missing" },
        identity,
      ),
    ).toMatchObject({
      hostLabel: "browser host",
      identity: { kind: "form", mode: "initial" },
      runtime: { tone: "blocked", label: "Shared Core required" },
      showProviderRow: true,
    });
  });

  it("turns remembered public identity into a password-only state", () => {
    expect(
      createNativeIdentityViewState(
        { kind: "remembered", pubDress: "0x0sky" },
        { kind: "idle", detail: "Case-sensitive · 2–32 characters" },
        undefined,
        undefined,
        false,
      ),
    ).toMatchObject({
      kind: "form",
      mode: "remembered",
      rememberedPubDress: "0x0sky",
      status: { kind: "registered" },
    });
  });

  it("does not authenticate a registration before recovery acknowledgement", () => {
    expect(
      createNativeIdentityViewState(
        { kind: "anonymous" },
        { kind: "available", detail: "Available — create this identity" },
        {
          kind: "recovery-key-required",
          identity: { pubDress: "0x0sky" },
          recoveryKey: "0x1-rk-secret",
          challenge: "0x1c-secret",
        },
        undefined,
        false,
      ),
    ).toMatchObject({
      kind: "recovery-key",
      pubDress: "0x0sky",
      recoveryKey: "0x1-rk-secret",
    });
  });

  it("reuses the shared address form for an authenticated provider", () => {
    expect(
      createProviderIdentityViewState(
        {
          ...browserHost,
          kind: "telegram",
          authentication: {
            kind: "telegram-init-data",
            initData: "signed",
            verification: "required",
          },
        },
        { kind: "not-registered" },
        undefined,
        { kind: "available", detail: "Available — create this identity" },
        false,
      ),
    ).toMatchObject({
      kind: "form",
      mode: "provider-register",
      status: { kind: "available" },
    });
  });
});

describe("pub_dress status", () => {
  const selection = { discriminator: "0", slug: "sky" };

  it("never claims availability before an exact server result", () => {
    expect(createPubDressStatusViewState(selection, true, undefined)).toEqual({
      kind: "checking",
      detail: "Checking availability…",
    });
    expect(createPubDressStatusViewState(selection, false, undefined)).toEqual({
      kind: "idle",
      detail: "Case-sensitive · 2–32 characters",
    });
  });

  it("keeps registered and available facts distinct", () => {
    expect(
      createPubDressStatusViewState(selection, false, {
        kind: "available",
        pubDress: "0x0sky",
      }),
    ).toMatchObject({ kind: "available" });
    expect(
      createPubDressStatusViewState(selection, false, {
        kind: "registered",
        pubDress: "0x0sky",
      }),
    ).toEqual({
      kind: "registered",
      detail: "Bond found — sign in",
    });
  });

  it("routes an occupied creation address into native sign-in", () => {
    expect(
      createNativeIdentityViewState(
        { kind: "anonymous" },
        {
          kind: "registered",
          detail: "Bond found — sign in",
        },
        undefined,
        undefined,
        false,
      ),
    ).toMatchObject({
      kind: "form",
      mode: "sign-in",
      status: { kind: "registered" },
    });
  });
});
