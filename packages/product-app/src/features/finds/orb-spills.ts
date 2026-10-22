// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellSpillView,
  OrbCoordinate,
  OrbSpillView,
  OrbWorldCell,
  OrbWorldInput,
  OrbWorldView,
} from "@nilx-one/application";
import {
  epochOf,
  FIND_PACK_ID,
  findPoint,
  rollSegment,
  ROLL_TABLE,
  segmentsWithin,
  type ArtifactId,
  type FindRoll,
  type LonLat,
} from "@nilx-one/artifact-contract";
import {
  mapDistanceMeters,
  type MapFogField,
  type MapLandmark,
  type MapOrb,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * Orb spills as this device holds them. Every orb rule is Core's
 * (`orb_world`, nilx-one/core `docs/orb-spills.md`): how many, where, when
 * each lands, how long a spill lives, what is within reach. This module only
 * keeps what the service answered and translates between the map's degrees
 * and Core's wire.
 */
export interface KnownSpill {
  readonly artifactId: ArtifactId;
  readonly sha: string;
  readonly count: number;
  /** Wall-clock milliseconds the service says the spill is gone at. */
  readonly expiresAt: number;
  /** Orbs someone has picked up already, as the service last answered. */
  readonly taken: readonly number[];
  /** Where the trail starts: the middle of the cell the find lies in. */
  readonly from: LonLat;
  /** A real archive landmark in the find's cell, never the find itself. */
  readonly via?: LonLat;
  /** The find the trail leads to. */
  readonly to: LonLat;
  /** When this device first drew it, so its orbs fall once, then lie. */
  readonly appearedAt: number;
}

/**
 * A cell that opened for this Bond, as the service answered its spill
 * (`docs/exp-orbs.md`). It is the Bond's own and stays on this device: it
 * lies until its orbs are picked up.
 */
export interface KnownCell {
  /** The fog cell, as the fog names it. */
  readonly cell: string;
  readonly key: string;
  readonly center: OrbCoordinate;
  readonly registry: number;
  readonly ratedLandmarks: CellSpillView["ratedLandmarks"];
  /** When this device first drew it, so its orbs fall once, then lie. */
  readonly appearedAt: number;
}

/** A cell's spill as this device keeps it, first drawn at `appearedAt`. */
export function knownCell(
  cell: string,
  view: CellSpillView,
  appearedAt: number,
): KnownCell {
  return {
    cell,
    key: view.key,
    center: view.center,
    registry: view.registry,
    ratedLandmarks: view.ratedLandmarks,
    appearedAt,
  };
}

/** The cell a cell orb id was laid in, by the key it names. */
export function cellOfOrb(
  cells: Iterable<KnownCell>,
  orbId: string,
): KnownCell | undefined {
  for (const cell of cells) {
    if (orbId.startsWith(`orb:cell:${cell.key}:`)) return cell;
  }
  return undefined;
}

/**
 * What this device keeps of its opened cells' orbs, for one Bond. Nothing in
 * it is ever evicted to make room: a cell's orbs lie until they are picked
 * up, and only then does the cell leave `cells` for `done`.
 *
 * - `cells`: spills the service answered, whose orbs may still lie;
 * - `picked`: cell orbs picked up while their cell still lies;
 * - `done`: cells whose every orb was picked up. A done cell is never asked
 *   for or drawn again, so its deterministic orbs cannot come back;
 * - `pending`: cells that opened whose spill is not answered yet, retried
 *   until it is, across reloads.
 */
export interface CellOrbStore {
  readonly cells: ReadonlyMap<string, KnownCell>;
  readonly picked: ReadonlySet<string>;
  readonly done: ReadonlySet<string>;
  readonly pending: ReadonlySet<string>;
}

export const EMPTY_CELL_ORB_STORE: CellOrbStore = {
  cells: new Map(),
  picked: new Set(),
  done: new Set(),
  pending: new Set(),
};

const CELLS_STORAGE = "nilx-one.orbs.cells.v1.";

function isKnownCell(value: unknown): value is KnownCell {
  if (typeof value !== "object" || value === null) return false;
  const cell = value as Partial<KnownCell>;
  return (
    typeof cell.cell === "string" &&
    typeof cell.key === "string" &&
    /^[0-9a-f]{64}$/.test(cell.key) &&
    typeof cell.center?.longitude_e7 === "string" &&
    typeof cell.center.latitude_e7 === "string" &&
    typeof cell.registry === "number" &&
    Array.isArray(cell.ratedLandmarks) &&
    typeof cell.appearedAt === "number"
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** What this device kept for `owner`; an unreadable store reads as empty. */
export function readCellOrbStore(owner: string): CellOrbStore {
  let stored: unknown;
  try {
    const raw = globalThis.localStorage?.getItem(CELLS_STORAGE + owner);
    stored = raw === null || raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    stored = undefined;
  }
  if (typeof stored !== "object" || stored === null) {
    return EMPTY_CELL_ORB_STORE;
  }
  const { cells, picked, done, pending } = stored as Record<string, unknown>;
  const kept = Array.isArray(cells) ? cells.filter(isKnownCell) : [];
  const finished = new Set(strings(done));
  return {
    cells: new Map(
      kept
        .filter((cell) => !finished.has(cell.cell))
        .map((cell) => [cell.cell, cell]),
    ),
    picked: new Set(strings(picked).filter((id) => id.startsWith("orb:cell:"))),
    done: finished,
    pending: new Set(strings(pending).filter((id) => !finished.has(id))),
  };
}

/**
 * Writes the whole store for `owner`. `false` when the browser refused it
 * (full or blocked storage): nothing is dropped, the caller keeps the store
 * in memory and writes it again on its next change.
 */
export function writeCellOrbStore(owner: string, store: CellOrbStore): boolean {
  try {
    globalThis.localStorage?.setItem(
      CELLS_STORAGE + owner,
      JSON.stringify({
        cells: [...store.cells.values()],
        picked: [...store.picked],
        done: [...store.done],
        pending: [...store.pending],
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** A cell opened: its spill is owed, unless it is answered or done. */
export function openCell(store: CellOrbStore, cell: string): CellOrbStore {
  if (
    store.cells.has(cell) ||
    store.done.has(cell) ||
    store.pending.has(cell)
  ) {
    return store;
  }
  return { ...store, pending: new Set([...store.pending, cell]) };
}

/** The service answered a cell's spill: it lies, unless it is done. */
export function answerCell(store: CellOrbStore, cell: KnownCell): CellOrbStore {
  const pending = new Set(store.pending);
  pending.delete(cell.cell);
  if (store.done.has(cell.cell) || store.cells.has(cell.cell)) {
    return { ...store, pending };
  }
  return {
    ...store,
    pending,
    cells: new Map([...store.cells, [cell.cell, cell]]),
  };
}

/** Cell orbs picked up: kept so a reload does not draw them again. */
export function pickCellOrbs(
  store: CellOrbStore,
  ids: readonly string[],
): CellOrbStore {
  const fresh = ids.filter(
    (id) => id.startsWith("orb:cell:") && !store.picked.has(id),
  );
  return fresh.length === 0
    ? store
    : { ...store, picked: new Set([...store.picked, ...fresh]) };
}

/**
 * Settles what Core just laid: every cell in `projected` (the cells that
 * answer was asked about) with no orb left in `lying` is done, and its
 * picked orbs are let go with it. A cell Core was not asked about is not
 * judged.
 */
export function settleCells(
  store: CellOrbStore,
  projected: Iterable<string>,
  lying: ReadonlySet<string>,
): CellOrbStore {
  const finished: KnownCell[] = [];
  for (const id of projected) {
    const cell = store.cells.get(id);
    if (cell === undefined) continue;
    const prefix = `orb:cell:${cell.key}:`;
    if (![...lying].some((orb) => orb.startsWith(prefix))) finished.push(cell);
  }
  if (finished.length === 0) return store;
  const cells = new Map(store.cells);
  for (const cell of finished) cells.delete(cell.cell);
  const picked = new Set(
    [...store.picked].filter(
      (orb) =>
        !finished.some((cell) => orb.startsWith(`orb:cell:${cell.key}:`)),
    ),
  );
  return {
    ...store,
    cells,
    picked,
    done: new Set([...store.done, ...finished.map((cell) => cell.cell)]),
  };
}

/** How far around a Bond the spills of its finds are read. */
export const SPILL_READ_RADIUS_METERS = 450;

const METERS_PER_DEGREE = 111_195;

/** The finds a ring holds this week, by the public roll. */
export function findsWithin(
  ring: readonly (readonly [number, number])[],
  nowMs: number,
): FindRoll[] {
  const epoch = epochOf(nowMs);
  return segmentsWithin(ring).flatMap((segment) => {
    const roll = rollSegment({
      packId: FIND_PACK_ID,
      packVersion: ROLL_TABLE.version,
      epoch,
      segment,
    });
    return roll === null ? [] : [roll];
  });
}

/** A square ring `radius` metres to each side of a point. */
export function squareAround(
  point: MapPointSelection,
  radiusMeters: number,
): readonly (readonly [number, number])[] {
  const dLat = radiusMeters / METERS_PER_DEGREE;
  const dLng =
    radiusMeters /
    (METERS_PER_DEGREE *
      Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
  const { longitude: x, latitude: y } = point;
  return [
    [x - dLng, y - dLat],
    [x + dLng, y - dLat],
    [x + dLng, y + dLat],
    [x - dLng, y + dLat],
  ];
}

/** Degrees as Core's E7 decimal strings. */
export function toCoordinate([longitude, latitude]: LonLat): OrbCoordinate {
  const e7 = (degrees: number) => String(Math.round(degrees * 1e7) || 0);
  return { longitude_e7: e7(longitude), latitude_e7: e7(latitude) };
}

/** Core's E7 decimal strings as degrees. */
export function fromCoordinate(at: OrbCoordinate): LonLat {
  return [Number(at.longitude_e7) / 1e7, Number(at.latitude_e7) / 1e7];
}

/** Prefer monuments and memorials, then other real local landmarks. */
const HERITAGE_KINDS: ReadonlySet<string> = new Set([
  "monument",
  "memorial",
  "artwork",
  "museum",
  "historic",
  "archaeological_site",
]);

/**
 * Deterministic navigation waypoint, only from the same archive cell as
 * the original artifact. No invented POI and no change to artifact placement.
 * The cache may legitimately have no landmark, giving the legacy trail.
 */
type LandmarkLookup = (
  point: MapPointSelection,
  radiusMeters: number,
) => readonly MapLandmark[];

export function landmarkWaypoint(
  roll: Pick<FindRoll, "segment" | "placement">,
  fog: MapFogField | undefined,
  near: LandmarkLookup | undefined,
): LonLat | undefined {
  if (fog === undefined || near === undefined) return undefined;
  const [longitude, latitude] = findPoint(roll);
  const cell = fog.cellAt({ longitude, latitude });
  const candidates = near(cell.center, 220)
    .filter(
      (landmark) =>
        Number.isFinite(landmark.longitude) &&
        Number.isFinite(landmark.latitude) &&
        fog.cellAt(landmark).id === cell.id,
    )
    .sort((a, b) => {
      const preferred =
        Number(HERITAGE_KINDS.has(b.kind)) - Number(HERITAGE_KINDS.has(a.kind));
      if (preferred !== 0) return preferred;
      const target = { longitude, latitude };
      return (
        mapDistanceMeters(target, a) - mapDistanceMeters(target, b) ||
        a.id.localeCompare(b.id)
      );
    });
  const selected = candidates[0];
  return selected === undefined
    ? undefined
    : [selected.longitude, selected.latitude];
}

/** A spill as the service answered it, for a find this device rolled. */
export function knownSpill(
  view: OrbSpillView,
  roll: Pick<FindRoll, "artifactId" | "segment" | "placement">,
  cellCenter: (point: LonLat) => LonLat | undefined,
  appearedAt: number,
  via?: LonLat,
): KnownSpill {
  const to = findPoint(roll);
  return {
    artifactId: roll.artifactId,
    sha: view.sha,
    count: view.count,
    expiresAt: view.expiresAt,
    taken: [...view.taken],
    from: cellCenter(to) ?? to,
    ...(via === undefined ? {} : { via }),
    to,
    appearedAt,
  };
}

/** A newer answer for a spill already drawn: who took what, nothing else. */
export function refreshSpill(
  spill: KnownSpill,
  view: OrbSpillView,
): KnownSpill {
  return {
    ...spill,
    count: view.count,
    expiresAt: view.expiresAt,
    taken: [...view.taken],
  };
}

/** A kept cell in Core's orb world `cells` shape. */
export function orbWorldCell(cell: KnownCell): OrbWorldCell {
  return {
    key: cell.key,
    center: cell.center,
    registry: cell.registry,
    rated_landmarks: [...cell.ratedLandmarks],
    appeared_at: String(Math.max(0, Math.trunc(cell.appearedAt))),
  };
}

/** What Core is asked: the spills, this device's pick-ups, and who stands where. */
export function orbWorldInput(
  spills: readonly KnownSpill[],
  picked: ReadonlySet<string>,
  bond: MapPointSelection | undefined,
  avaia: MapPointSelection | undefined,
  waypointsEnabled = false,
  cells: readonly KnownCell[] = [],
): OrbWorldInput {
  const at = (point: MapPointSelection | undefined) =>
    point === undefined
      ? null
      : toCoordinate([point.longitude, point.latitude]);
  return {
    spills: spills.map((spill) => ({
      artifact_id: spill.artifactId,
      from: toCoordinate(spill.from),
      ...(waypointsEnabled && spill.via !== undefined
        ? { via: toCoordinate(spill.via) }
        : {}),
      to: toCoordinate(spill.to),
      appeared_at: String(Math.max(0, Math.trunc(spill.appearedAt))),
      expires_at: String(Math.max(0, Math.trunc(spill.expiresAt))),
      count: spill.count,
      taken: [...spill.taken],
    })),
    // Only a v4 runtime is handed cells: an older one refuses the field.
    ...(cells.length === 0 ? {} : { cells: cells.map(orbWorldCell) }),
    picked: [...picked],
    bond: at(bond),
    avaia: at(avaia),
  };
}

/** What the world draws, exactly as Core laid it. */
export function mapOrbs(view: OrbWorldView): MapOrb[] {
  return view.orbs.map((orb) => {
    const [longitude, latitude] = fromCoordinate(orb.at);
    return {
      id: orb.id,
      longitude,
      latitude,
      kind: orb.kind,
      landsAt: Number(orb.lands_at),
      ...(orb.rarity === undefined ? {} : { rarity: orb.rarity }),
    };
  });
}

/** A rarity's tier, Common 1 to Exclusive 5, as a cell orb award keeps it. */
export function rarityTier(rarity: MapOrb["rarity"]): 1 | 2 | 3 | 4 | 5 {
  switch (rarity) {
    case "uncommon":
      return 2;
    case "rare":
      return 3;
    case "special":
      return 4;
    case "exclusive":
      return 5;
    default:
      return 1;
  }
}
