// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { readBondLocationControl } from "./bond-location-control";

function manualProjection(): Response {
  return new Response(
    JSON.stringify({
      role: "admin",
      location: {
        coordinate: { longitude_e7: "23522000", latitude_e7: "488566000" },
        mode: "manual",
        updated_at: "1800000000",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("readBondLocationControl", () => {
  it("reads a signed-in browser's Bond through its session cookie alone", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        manualProjection(),
    );

    await expect(
      readBondLocationControl({ fetch: fetchImpl as typeof fetch }),
    ).resolves.toEqual({
      kind: "manual",
      position: { longitude: 2.3522, latitude: 48.8566 },
    });
    const [path, init] = fetchImpl.mock.calls[0] ?? [];
    expect(path).toBe("/api/v1/location-control");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toBeUndefined();
  });

  it("carries a host's own proof when it has one", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        manualProjection(),
    );

    await readBondLocationControl({
      fetch: fetchImpl as typeof fetch,
      authorization: "discord access-1",
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "discord access-1",
    });
  });

  it("fails closed for a browser that is not signed in", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      readBondLocationControl({ fetch: fetchImpl as typeof fetch }),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});
