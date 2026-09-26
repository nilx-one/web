// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

const GEO_E7_SCALE = 10_000_000;
const LOCATION_CONTROL_REQUEST_TIMEOUT_MS = 2_000;

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

interface TelegramLocationControlReadOptions {
  readonly timeoutMs?: number;
}

const BOND_ROLES: ReadonlySet<unknown> = new Set(["user", "admin", "business"]);

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

async function fetchLocationControl(
  initData: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  try {
    const timeout = new Promise<Response>((_resolve, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        controller.abort();
        reject(new Error("Telegram location control request timed out"));
      }, timeoutMs);
    });

    return await Promise.race([
      fetchImpl("/api/v1/location-control", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { authorization: `tma ${initData}` },
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

/**
 * Reads authenticated Bond location control before the world is composed.
 *
 * Only a valid `live`/empty location answer enables device geolocation. A
 * malformed, unavailable, or slow response fails closed because the service
 * might hold a manual point whose purpose is to suppress the real device
 * position. Startup is bounded so an optional location projection can never
 * leave the Mini App on an empty root indefinitely.
 */
export async function readTelegramLocationControl(
  initData: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  options: TelegramLocationControlReadOptions = {},
): Promise<TelegramLocationControlState> {
  if (initData.length === 0) {
    return { kind: "unavailable" };
  }

  try {
    const response = await fetchLocationControl(
      initData,
      fetchImpl,
      options.timeoutMs ?? LOCATION_CONTROL_REQUEST_TIMEOUT_MS,
    );
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
      !BOND_ROLES.has(body.role) ||
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
