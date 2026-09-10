// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapObservedPosition,
  MapObservedPositionLabel,
  MapPointSelection,
  MapRenderer,
  MapRendererStatus,
} from "@nilx-one/map-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createManualLocationMapRenderer,
  readTelegramLocationControl,
} from "./location-control";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeRenderer() {
  let status: MapRendererStatus = { kind: "unmounted" };
  const observed: Array<MapObservedPosition | null> = [];
  const labels: Array<MapObservedPositionLabel | null> = [];
  const selections: Array<MapPointSelection | null> = [];
  const camera: MapCamera = {
    center: [30.5234, 50.4501],
    zoom: 11,
    bearing: 0,
    pitch: 0,
  };
  const renderer: MapRenderer = {
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
  };
  return { renderer, observed, labels, selections };
}

describe("Telegram location control", () => {
  it("accepts a validated manual point", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        mode: "manual",
        position: { longitude: 2.3522, latitude: 48.8566 },
      }),
    );

    await expect(
      readTelegramLocationControl("signed", fetchImpl as typeof fetch),
    ).resolves.toEqual({
      kind: "manual",
      position: { longitude: 2.3522, latitude: 48.8566 },
    });
  });

  it("fails closed when manual state is malformed or unavailable", async () => {
    const malformed = vi.fn(async () =>
      jsonResponse(200, {
        mode: "manual",
        position: { longitude: 2.3522, latitude: 91 },
      }),
    );
    const unavailable = vi.fn(async () => jsonResponse(503, {}));

    await expect(
      readTelegramLocationControl("signed", malformed as typeof fetch),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      readTelegramLocationControl("signed", unavailable as typeof fetch),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("treats an unregistered Telegram account as live", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}));
    await expect(
      readTelegramLocationControl("signed", fetchImpl as typeof fetch),
    ).resolves.toEqual({ kind: "live" });
  });

  it("never presents an observed position while manual mode is active", () => {
    const base = fakeRenderer();
    const manual = { longitude: 2.3522, latitude: 48.8566 };
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
