// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { createMapLibreRenderer } from "@nilx-one/map-maplibre";

type TelegramMapRenderer = ReturnType<typeof createMapLibreRenderer>;

type PointSelectionListener = Parameters<
  NonNullable<TelegramMapRenderer["subscribePointSelection"]>
>[0];
type BodyActivationListener = Parameters<
  NonNullable<TelegramMapRenderer["subscribeBodyActivation"]>
>[0];

const GEO_E7_SCALE = 10_000_000;

export interface TelegramLocationPoint {
  readonly longitude: number;
  readonly latitude: number;
}

export type TelegramLocationControlState =
  | { readonly kind: "live" }
  | {
      readonly kind: "manual";
      readonly position: TelegramLocationPoint;
    }
  | { readonly kind: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCanonicalE7(value: unknown): number | undefined {
  if (
    typeof value !== "string" ||
    !/^-?(0|[1-9][0-9]*)$/.test(value) ||
    value === "-0"
  ) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function parseCoordinate(value: unknown): TelegramLocationPoint | undefined {
  if (!isRecord(value)) return undefined;
  const longitudeE7 = parseCanonicalE7(value.longitude_e7);
  const latitudeE7 = parseCanonicalE7(value.latitude_e7);
  if (
    longitudeE7 === undefined ||
    latitudeE7 === undefined ||
    longitudeE7 < -180 * GEO_E7_SCALE ||
    longitudeE7 > 180 * GEO_E7_SCALE ||
    latitudeE7 < -90 * GEO_E7_SCALE ||
    latitudeE7 > 90 * GEO_E7_SCALE
  ) {
    return undefined;
  }
  return {
    longitude: longitudeE7 / GEO_E7_SCALE,
    latitude: latitudeE7 / GEO_E7_SCALE,
  };
}

/**
 * Reads authenticated Bond location control before the world is composed.
 *
 * Only a valid `live`/empty location answer enables device geolocation. A
 * malformed or unavailable response fails closed because the service might
 * hold a manual point whose purpose is to suppress the real device position.
 */
export async function readTelegramLocationControl(
  initData: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<TelegramLocationControlState> {
  if (initData.length === 0) {
    return { kind: "unavailable" };
  }

  try {
    const response = await fetchImpl("/api/v1/location-control", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: `tma ${initData}` },
    });
    // An unregistered Telegram account owns no Bond and therefore cannot hold
    // a manual Bond location. Registration may still use ordinary host GPS.
    if (response.status === 404) {
      return { kind: "live" };
    }
    if (!response.ok) {
      return { kind: "unavailable" };
    }

    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      (body.role !== "user" && body.role !== "admin") ||
      !("location" in body)
    ) {
      return { kind: "unavailable" };
    }
    if (body.location === null) {
      return { kind: "live" };
    }
    if (!isRecord(body.location) || !validTimestamp(body.location.updated_at)) {
      return { kind: "unavailable" };
    }
    const position = parseCoordinate(body.location.coordinate);
    if (position === undefined) {
      return { kind: "unavailable" };
    }
    if (body.location.mode === "live") {
      return { kind: "live" };
    }
    if (body.location.mode === "manual") {
      return { kind: "manual", position };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Manual Bond location is presentation state, never a fabricated host
 * observation. The base renderer's explicit editor-point marker is reused for
 * the declared point while every observed-position write is suppressed. If an
 * editor opens, its point temporarily wins; clearing it restores the manual
 * Bond location.
 */
export function createManualLocationMapRenderer(
  renderer: TelegramMapRenderer,
  manualPosition: TelegramLocationPoint,
): TelegramMapRenderer {
  const manual = { ...manualPosition };
  renderer.setObservedPosition(null);
  renderer.setObservedPositionLabel(null);
  renderer.setSelectionPoint?.(manual);

  return {
    avatars: renderer.avatars,
    mount(container) {
      renderer.mount(container);
      renderer.setObservedPosition(null);
      renderer.setObservedPositionLabel(null);
      renderer.setSelectionPoint?.(manual);
    },
    unmount() {
      renderer.unmount();
    },
    getStatus() {
      return renderer.getStatus();
    },
    subscribe(listener) {
      return renderer.subscribe(listener);
    },
    getCamera() {
      return renderer.getCamera();
    },
    setCamera(camera, options) {
      renderer.setCamera(camera, options);
    },
    subscribeCamera(listener) {
      return renderer.subscribeCamera(listener);
    },
    setAppearance(appearance) {
      renderer.setAppearance(appearance);
    },
    setDimension(dimension) {
      renderer.setDimension(dimension);
    },
    setObservedPosition() {
      renderer.setObservedPosition(null);
    },
    setObservedPositionLabel() {
      renderer.setObservedPositionLabel(null);
    },
    setSelectionPoint(point) {
      renderer.setSelectionPoint?.(point === null ? manual : point);
    },
    subscribePointSelection(listener: PointSelectionListener) {
      return renderer.subscribePointSelection?.(listener) ?? (() => undefined);
    },
    subscribeBodyActivation(listener: BodyActivationListener) {
      return renderer.subscribeBodyActivation?.(listener) ?? (() => undefined);
    },
  };
}

export function locationControlFingerprint(
  state: TelegramLocationControlState,
): string {
  switch (state.kind) {
    case "live":
    case "unavailable":
      return state.kind;
    case "manual":
      return `manual:${state.position.longitude}:${state.position.latitude}`;
  }
}
