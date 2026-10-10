// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapPointSelection } from "@nilx-one/map-contract";

/**
 * Where a Bond and its Avaia were last seen on this device, so a world that
 * is opened again — a host that dropped the page while it was in the
 * background, a reload — picks up where it was left instead of at the
 * bootstrap camera with the Avaia back at its owner's feet.
 *
 * It is one Bond's own and never evidence of presence. Nothing sends it
 * anywhere today. It is transport-eligible — a position the world may reopen
 * on from another device — and it is not a `Bond.location` and not synced
 * state. A remembered
 * Bond point only places the camera before the first fix; it is never drawn
 * as an observation.
 */
export interface RememberedPoint extends MapPointSelection {
  readonly bearingDeg: number;
}

export interface WorldMemory {
  readonly bond?: MapPointSelection;
  readonly avaia?: RememberedPoint;
  /** Last admin journey applied to this device's Avaia body. */
  readonly travelRevision?: string;
  /**
   * When the Avaia last decided on an outing, wall-clock milliseconds, so a
   * reload does not send it out again before the interval is up.
   */
  readonly lastOutingAt?: number;
  /**
   * The Avaia's drive as Core last answered it (`docs/avaia-drive.md` in
   * core), opaque here: only Core reads it.
   */
  readonly drive?: string;
}

export interface WorldMemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "nilx-one.world-memory.v1.";

const EMPTY: WorldMemory = {};

function defaultStorage(): WorldMemoryStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePoint(value: unknown): MapPointSelection | undefined {
  if (!isRecord(value)) return undefined;
  const { longitude, latitude } = value;
  if (
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return undefined;
  }
  return { longitude, latitude };
}

function parseRemembered(value: unknown): RememberedPoint | undefined {
  const point = parsePoint(value);
  if (point === undefined || !isRecord(value)) return undefined;
  const bearingDeg =
    typeof value.bearingDeg === "number" && Number.isFinite(value.bearingDeg)
      ? value.bearingDeg
      : 0;
  return { ...point, bearingDeg };
}

/** What this device remembers for one Bond. Never throws, never guesses. */
export function readWorldMemory(
  owner: string,
  storage: WorldMemoryStorage | undefined = defaultStorage(),
): WorldMemory {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY;
    const bond = parsePoint(parsed.bond);
    const avaia = parseRemembered(parsed.avaia);
    const travelRevision =
      typeof parsed.travelRevision === "string" &&
      /^[1-9][0-9]*$/.test(parsed.travelRevision)
        ? parsed.travelRevision
        : undefined;
    const lastOutingAt =
      typeof parsed.lastOutingAt === "number" &&
      Number.isFinite(parsed.lastOutingAt)
        ? parsed.lastOutingAt
        : undefined;
    const drive =
      typeof parsed.drive === "string" && parsed.drive.length > 0
        ? parsed.drive
        : undefined;
    return {
      ...(bond === undefined ? {} : { bond }),
      ...(avaia === undefined ? {} : { avaia }),
      ...(travelRevision === undefined ? {} : { travelRevision }),
      ...(lastOutingAt === undefined ? {} : { lastOutingAt }),
      ...(drive === undefined ? {} : { drive }),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Merges one side of the memory into what is stored. `undefined` forgets
 * that side; a key left out keeps it.
 */
export function rememberWorld(
  owner: string,
  change: {
    bond?: MapPointSelection;
    avaia?: RememberedPoint | undefined;
    travelRevision?: string;
    lastOutingAt?: number;
    drive?: string;
  },
  storage: WorldMemoryStorage | undefined = defaultStorage(),
): void {
  try {
    const { bond, avaia, travelRevision, lastOutingAt, drive } =
      readWorldMemory(owner, storage);
    const nextBond = change.bond ?? bond;
    const nextAvaia = "avaia" in change ? change.avaia : avaia;
    const nextTravelRevision = change.travelRevision ?? travelRevision;
    const nextOuting = change.lastOutingAt ?? lastOutingAt;
    const next: WorldMemory = {
      ...(nextBond === undefined
        ? {}
        : {
            bond: {
              longitude: nextBond.longitude,
              latitude: nextBond.latitude,
            },
          }),
      ...(nextAvaia === undefined
        ? {}
        : {
            avaia: {
              longitude: nextAvaia.longitude,
              latitude: nextAvaia.latitude,
              bearingDeg: nextAvaia.bearingDeg,
            },
          }),
      ...(nextTravelRevision === undefined
        ? {}
        : { travelRevision: nextTravelRevision }),
      ...(nextOuting === undefined ? {} : { lastOutingAt: nextOuting }),
      ...((change.drive ?? drive) === undefined
        ? {}
        : { drive: change.drive ?? drive }),
    };
    storage?.setItem(STORAGE_PREFIX + owner, JSON.stringify(next));
  } catch {
    // Remembering is best-effort: a full or blocked store forgets, it never breaks the world.
  }
}
