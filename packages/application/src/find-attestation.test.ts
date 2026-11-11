// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { hasFindAttestation } from "./find-attestation";

// Reading the service's answers is Core's (`nilxone-api`); its fixtures pin
// it, and packages/core-wasm checks the decoding of Core's readings.
describe("Identity's attested-finds port", () => {
  it("recognises a port only by all three operations", () => {
    const noop = async () => undefined;
    expect(
      hasFindAttestation({ attestFind: noop, sellFind: noop, payCraft: noop }),
    ).toBe(true);
    expect(hasFindAttestation({ attestFind: noop, sellFind: noop })).toBe(
      false,
    );
  });
});
