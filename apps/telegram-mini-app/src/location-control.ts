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

function parsePoint(value: unknown): TelegramLocationPoint | undefined {
  if (
    !isRecord(value) ||
    typeof value.longitude !== "number" ||
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    !Number.isFinite(value.latitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    value.latitude < -90 ||
    value.latitude > 90
  ) {
    return undefined;
  }
  return {
    longitude: value.longitude,
    latitude: value.latitude,
  };
}

/**
 * Reads the server-owned control mode before the world is composed. A failed
 * or malformed answer is deliberately not treated as `live`: if the service
 * might hold a manual point, enabling device geolocation on uncertainty could
 * reveal the real position the manual mode was meant to replace on the map.
 *
 * `404` is the one safe live answer: an unregistered Telegram account owns no
 * Bond and therefore cannot have persisted manual control state yet.
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
    if (response.status === 404) {
      return { kind: "live" };
    }
    if (!response.ok) {
      return { kind: "unavailable" };
    }

    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return { kind: "unavailable" };
    }
    if (body.mode === "live") {
      return { kind: "live" };
    }
    if (body.mode === "manual") {
      const position = parsePoint(body.position);
      return position === undefined
        ? { kind: "unavailable" }
        : { kind: "manual", position };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Manual location is presentation state, never a fabricated host observation.
 * The base renderer's explicit point marker is reused for the selected manual
 * point while every observed-position write is suppressed. If an editor opens,
 * its point temporarily wins; clearing the editor restores the manual point.
 */
export function createManualLocationMapRenderer(
  renderer: TelegramMapRenderer,
  manualPosition: TelegramLocationPoint,
): TelegramMapRenderer {
  const manual = { ...manualPosition };
  renderer.setObservedPosition(null);
  renderer.setObservedPositionLabel(null);
  renderer.setSelectionPoint(manual);

  return {
    avatars: renderer.avatars,
    mount(container) {
      renderer.mount(container);
      renderer.setObservedPosition(null);
      renderer.setObservedPositionLabel(null);
      renderer.setSelectionPoint(manual);
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
      renderer.setSelectionPoint(point === null ? manual : point);
    },
    subscribePointSelection(listener: PointSelectionListener) {
      return renderer.subscribePointSelection(listener);
    },
    subscribeBodyActivation(listener: BodyActivationListener) {
      return renderer.subscribeBodyActivation(listener);
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
