// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { createMapLibreRenderer } from "@nilx-one/map-maplibre";
import { describe, expect, it, vi } from "vitest";

import {
  createManualLocationMapRenderer,
  readTelegramLocationControl,
  type TelegramLocationPoint,
} from "./location-control";

type TelegramMapRenderer = ReturnType<typeof createMapLibreRenderer>;
type MapStatus = ReturnType<TelegramMapRenderer["getStatus"]>;
type MapCamera = ReturnType<TelegramMapRenderer["getCamera"]>;
type ObservedPosition = Parameters<
  TelegramMapRenderer["setObservedPosition"]
>[0];
type ObservedPositionLabel = Parameters<
  TelegramMapRenderer["setObservedPositionLabel"]
>[0];
type SelectedPoint = Parameters<
  NonNullable<TelegramMapRenderer["setSelectionPoint"]>
>[0];

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

function fakeRenderer() {
  let status: MapStatus = { kind: "unmounted" };
  const observed: ObservedPosition[] = [];
  const labels: ObservedPositionLabel[] = [];
  const selections: SelectedPoint[] = [];
  const camera: MapCamera = {
    center: [30.5234, 50.4501],
    zoom: 11,
    bearing: 0,
    pitch: 0,
  };
  const renderer: TelegramMapRenderer = {
    avatars: {
      upsert() {},
      remove() {},
      setCamera() {},
    },
    mount() {
      status = { kind: "ready" };
    },
    unmount() {
      status = { kind: "unmounted" };
    },
    getStatus() {
      return status;
    },
    subscribe() {
      return () => undefined;
    },
    getCamera() {
      return camera;
    },
    setCamera() {},
    subscribeCamera() {
      return () => undefined;
    },
    setAppearance() {},
    setDimension() {},
    setObservedPosition(position) {
      observed.push(position);
    },
    setObservedPositionLabel(label) {
      labels.push(label);
    },
    setSelectionPoint(point) {
      selections.push(point);
    },
    subscribePointSelection() {
      return () => undefined;
    },
    subscribeBodyActivation() {
      return () => undefined;
    },
  };
  return { renderer, observed, labels, selections };
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

  it("never presents an observed position while manual mode is active", () => {
    const base = fakeRenderer();
    const manual: TelegramLocationPoint = {
      longitude: 2.3522,
      latitude: 48.8566,
    };
    const renderer = createManualLocationMapRenderer(base.renderer, manual);

    renderer.setObservedPosition({
      center: [30.5234, 50.4501],
      accuracyMeters: 10,
    });
    renderer.setObservedPositionLabel({ title: "0x0sky" });
    renderer.setSelectionPoint?.({ longitude: 1, latitude: 2 });
    renderer.setSelectionPoint?.(null);

    expect(base.observed.at(-1)).toBeNull();
    expect(base.labels.at(-1)).toBeNull();
    expect(base.selections).toEqual([
      manual,
      { longitude: 1, latitude: 2 },
      manual,
    ]);
  });
});
