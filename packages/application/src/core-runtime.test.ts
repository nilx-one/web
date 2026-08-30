// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { ReadRuntimeReadiness, type CoreRuntimePort } from "./core-runtime";

describe("ReadRuntimeReadiness", () => {
  it("preserves a ready Core contract projection", async () => {
    const core: CoreRuntimePort = {
      probe: async () => ({
        kind: "ready",
        contractVersion: "fixture-contract",
      }),
    };

    await expect(new ReadRuntimeReadiness(core).execute()).resolves.toEqual({
      kind: "ready",
      contractVersion: "fixture-contract",
    });
  });

  it("keeps a missing artifact visibly blocked", async () => {
    const core: CoreRuntimePort = {
      probe: async () => ({
        kind: "unavailable",
        reason: "artifact-missing",
      }),
    };

    await expect(new ReadRuntimeReadiness(core).execute()).resolves.toEqual({
      kind: "blocked",
      reason: "artifact-missing",
    });
  });

  it("fails closed when an adapter throws", async () => {
    const core: CoreRuntimePort = {
      probe: () => Promise.reject(new Error("fixture load failure")),
    };

    await expect(new ReadRuntimeReadiness(core).execute()).resolves.toEqual({
      kind: "blocked",
      reason: "load-failed",
    });
  });
});
