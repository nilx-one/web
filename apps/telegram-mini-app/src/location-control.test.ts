// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { readTelegramLocationControl } from "./location-control";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function locationProjection(
  mode: "live" | "manual",
  longitudeE7: string,
  latitudeE7: string,
) {
  return {
    role: "admin",
    location: {
      coordinate: {
        longitude_e7: longitudeE7,
        latitude_e7: latitudeE7,
      },
      mode,
      updated_at: "1800000000",
    },
  };
}

describe("Telegram location control", () => {
  it("accepts a canonical manual Bond location", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, locationProjection("manual", "23522000", "488566000")),
    );

    await expect(
      readTelegramLocationControl("signed", fetchImpl as typeof fetch),
    ).resolves.toEqual({
      kind: "manual",
      position: { longitude: 2.3522, latitude: 48.8566 },
    });
  });

  it("uses ordinary live mode when the Bond has no submitted location", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { role: "user", location: null }),
    );
    await expect(
      readTelegramLocationControl("signed", fetchImpl as typeof fetch),
    ).resolves.toEqual({ kind: "live" });
  });

  it("treats a stored live Bond location as live device mode", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, locationProjection("live", "305234000", "504501000")),
    );
    await expect(
      readTelegramLocationControl("signed", fetchImpl as typeof fetch),
    ).resolves.toEqual({ kind: "live" });
  });

  it("fails closed on malformed location, role, or service state", async () => {
    const malformedCoordinate = vi.fn(async () =>
      jsonResponse(200, locationProjection("manual", "23522000", "900000001")),
    );
    const malformedRole = vi.fn(async () =>
      jsonResponse(200, { role: "owner", location: null }),
    );
    const unavailable = vi.fn(async () => jsonResponse(503, {}));

    await expect(
      readTelegramLocationControl(
        "signed",
        malformedCoordinate as typeof fetch,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      readTelegramLocationControl("signed", malformedRole as typeof fetch),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      readTelegramLocationControl("signed", unavailable as typeof fetch),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("bounds startup when location control never answers", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
      const pending = readTelegramLocationControl(
        "signed",
        fetchImpl as typeof fetch,
        { timeoutMs: 25 },
      );

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toEqual({ kind: "unavailable" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats an unregistered Telegram account as live", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}));
    await expect(
      readTelegramLocationControl("signed", fetchImpl as typeof fetch),
    ).resolves.toEqual({ kind: "live" });
  });
});
