// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { aisSignInHref, readAisSignInFailure } from "./ais-sign-in";

describe("aiaiaiai sign-in", () => {
  it("points at the host start route and keeps only a same-origin return", () => {
    expect(aisSignInHref()).toBe("/api/v1/auth/aiaiaiai/start?return=%2F");
    expect(aisSignInHref("/map?x=1")).toBe(
      "/api/v1/auth/aiaiaiai/start?return=%2Fmap%3Fx%3D1",
    );
    for (const hostile of [
      "//attacker.example",
      "https://attacker.example",
      "/a\\b",
      `/${"x".repeat(600)}`,
    ]) {
      expect(aisSignInHref(hostile)).toBe(
        "/api/v1/auth/aiaiaiai/start?return=%2F",
      );
    }
  });

  it("names why a return from aiaiaiai did not sign the person in", () => {
    expect(readAisSignInFailure("")).toBeUndefined();
    expect(readAisSignInFailure("?auth_error=")).toBeUndefined();
    expect(readAisSignInFailure("?auth_error=bond_address_taken")).toBe(
      "address-taken",
    );
    expect(readAisSignInFailure("?auth_error=bond_address_missing")).toBe(
      "address-missing",
    );
    expect(readAisSignInFailure("?auth_error=bond_unavailable")).toBe(
      "unavailable",
    );
    expect(
      readAisSignInFailure("?x=1&auth_error=aiaiaiai_sign_in_invalid"),
    ).toBe("other");
  });
});
