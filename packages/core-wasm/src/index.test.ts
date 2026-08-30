// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { createCoreWasmClient } from "./index";

describe("CoreWasmClient", () => {
  it("reports the absent generated artifact", async () => {
    await expect(createCoreWasmClient().probe()).resolves.toEqual({
      kind: "unavailable",
      reason: "artifact-missing",
    });
  });

  it("reports a versioned generated binding", async () => {
    const client = createCoreWasmClient({
      loadBindings: async () => ({
        contractVersion: () => " fixture-contract ",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      kind: "ready",
      contractVersion: "fixture-contract",
    });
  });

  it("rejects an empty binding version", async () => {
    const client = createCoreWasmClient({
      loadBindings: async () => ({
        contractVersion: () => " ",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      kind: "unavailable",
      reason: "binding-invalid",
    });
  });
});
