// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Chance finds: what an Avaia may come across while it walks, rolled where it
 * walks rather than placed on the map (docs/avaia-outings.md §3).
 *
 * A find is a deterministic function of a route segment, a week, and the pack
 * that names finds. The same segment in the same week with the same pack
 * always rolls the same find or the same nothing, on every device, which is
 * the whole anti-farming rule: walking a street twice in a week pays once.
 *
 * Zero dependency, and nothing here is a record: a roll is not written to the
 * BondChain, not sent anywhere, and carries no coordinates. Who is paid the
 * experience is the caller's to decide (R2).
 */

/** A geographic point, longitude first. */
export type LonLat = readonly [longitude: number, latitude: number];

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

/** A cell of the fixed segment grid: row and column, opaque to everyone else. */
export type SegmentId = `seg:${number}:${number}`;

/** A week, counted from the first Monday of 1970, UTC. */
export type EpochId = `e${number}`;

export type PackVersion = number;

/** Which of a segment's finds this is. One find per segment today, so `0`. */
export type Slot = number;

export type ArtifactId = `art:${SegmentId}:${EpochId}:${PackVersion}:${Slot}`;

/** One tier: what a find of it pays and how often one turns up. */
export interface TierRate {
  readonly tier: Tier;
  readonly experience: number;
  /** Expected finds of this tier per kilometre walked. */
  readonly perKm: number;
}

/**
 * The rarity table. Starting values, tuned on live walking; any change to a
 * number here changes which segments roll what, so it raises `version`.
 * About one find every 2 km and 30 experience a kilometre in all; tier 6
 * once in 100 km.
 */
/** Canonical chance-find pack shared by the client and identity verifier. */
export const FIND_PACK_ID = "nilx-one.finds";

export const ROLL_TABLE = {
  version: 1,
  tiers: [
    { tier: 1, experience: 10, perKm: 0.25 },
    { tier: 2, experience: 25, perKm: 0.12 },
    { tier: 3, experience: 60, perKm: 0.06 },
    { tier: 4, experience: 150, perKm: 0.03 },
    { tier: 5, experience: 400, perKm: 0.018 },
    { tier: 6, experience: 1000, perKm: 0.01 },
  ],
} as const satisfies {
  readonly version: number;
  readonly tiers: readonly TierRate[];
};

/** The side of a segment cell, and the length of walk one roll stands for. */
export const SEGMENT_METERS = 50;

/** A find lies at most this far to either side of the walk that rolled it. */
export const FIND_OFFSET_METERS = 25;

/** A find shows only once the Avaia is this close to it. */
export const PERCEPTION_METERS = 15;

/** How long an epoch lasts: a week. */
export const EPOCH_MS = 7 * 24 * 60 * 60 * 1000;

/** The first Monday of 1970, 00:00 UTC, where epoch 0 starts. */
const EPOCH_ORIGIN_MS = Date.UTC(1970, 0, 5);

/**
 * The segment grid, in degrees. It is fixed in degrees and not in metres so
 * that every device cuts it identically: no trigonometry, which engines are
 * free to round differently. Columns are scaled for Kyiv's latitude, where
 * the archive is, so cells there are about 50 m square.
 */
const ROW_DEGREES = SEGMENT_METERS / 111_195;
const COLUMN_DEGREES = ROW_DEGREES * 1.5698;

export function epochOf(nowMs: number): EpochId {
  return `e${Math.floor((nowMs - EPOCH_ORIGIN_MS) / EPOCH_MS)}`;
}

/** A point in grid units: whole numbers are cell edges. */
function gridOf([longitude, latitude]: LonLat): readonly [
  x: number,
  y: number,
] {
  return [(longitude + 180) / COLUMN_DEGREES, (latitude + 90) / ROW_DEGREES];
}

export function segmentAt(point: LonLat): SegmentId {
  const [x, y] = gridOf(point);
  return `seg:${Math.floor(y)}:${Math.floor(x)}`;
}

/**
 * A point inside a segment: `x` and `y` are fractions, 0 to 1, of the way
 * across it from its south-west corner. Arithmetic only, like the grid.
 */
export function pointInSegment(
  segment: SegmentId,
  x: number,
  y: number,
): LonLat {
  const [, row, column] = segment.split(":").map(Number) as [
    number,
    number,
    number,
  ];
  return [(column + x) * COLUMN_DEGREES - 180, (row + y) * ROW_DEGREES - 90];
}

/**
 * Where a find rolled for ground rather than for a walk lies: inside its own
 * segment, at its placement read as fractions across it. Every device puts
 * the same find in the same place, and nothing has to be sent to agree.
 */
export function findPoint(
  roll: Pick<FindRoll, "segment" | "placement">,
): LonLat {
  return pointInSegment(
    roll.segment,
    roll.placement.along,
    (roll.placement.across + 1) / 2,
  );
}

/** The most segments one area may span; a larger ring is a caller's mistake. */
const MAX_SEGMENTS_WITHIN = 10_000;

/**
 * The segments whose centre lies inside `ring` (even-odd, one ring), row by
 * row; an area smaller than a segment still holds the segment under its
 * middle. Arithmetic only, like the rest of the grid, so every engine names
 * the same segments. The count a cell "holds" is this list rolled: the same
 * public function of pack, epoch and segment every client and the server
 * already agree on.
 */
export function segmentsWithin(ring: readonly LonLat[]): SegmentId[] {
  if (ring.length < 3) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    const [x, y] = gridOf(point);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const columns = Math.floor(maxX) - Math.floor(minX) + 1;
  const rows = Math.floor(maxY) - Math.floor(minY) + 1;
  if (!(columns * rows <= MAX_SEGMENTS_WITHIN)) {
    throw new RangeError(
      `area spans more than ${MAX_SEGMENTS_WITHIN} segments`,
    );
  }
  const inside = (longitude: number, latitude: number): boolean => {
    let within = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (
        yi > latitude !== yj > latitude &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
      ) {
        within = !within;
      }
    }
    return within;
  };
  const segments: SegmentId[] = [];
  for (let row = Math.floor(minY); row <= Math.floor(maxY); row++) {
    for (let column = Math.floor(minX); column <= Math.floor(maxX); column++) {
      const longitude = (column + 0.5) * COLUMN_DEGREES - 180;
      const latitude = (row + 0.5) * ROW_DEGREES - 90;
      if (inside(longitude, latitude)) segments.push(`seg:${row}:${column}`);
    }
  }
  if (segments.length === 0) {
    const middle: LonLat = [
      ring.reduce((sum, [longitude]) => sum + longitude, 0) / ring.length,
      ring.reduce((sum, [, latitude]) => sum + latitude, 0) / ring.length,
    ];
    segments.push(segmentAt(middle));
  }
  return segments;
}

/**
 * The segments a walk passes through, in the order it first enters each. A
 * tap-sent walk and one the Avaia chose go through the same function, so the
 * owner pointing is no way round the rarity.
 */
export function segmentsAlong(path: readonly LonLat[]): SegmentId[] {
  const seen = new Set<SegmentId>();
  const first = path[0];
  if (first === undefined) return [];
  seen.add(segmentAt(first));
  for (let i = 1; i < path.length; i++) {
    for (const segment of cellsCrossed(path[i - 1]!, path[i]!)) {
      seen.add(segment);
    }
  }
  return [...seen];
}

/**
 * Every cell a straight leg passes through, in order: an exact grid walk
 * (Amanatides and Woo), stepping from cell to cell at each grid line the leg
 * crosses, so a cell clipped for a fraction of a metre is still entered. A leg
 * through a corner exactly steps diagonally: the two cells beside the corner
 * are only touched at a point, not entered. Arithmetic only, so every engine
 * walks the same cells.
 */
function cellsCrossed(a: LonLat, b: LonLat): SegmentId[] {
  const [ax, ay] = gridOf(a);
  const [bx, by] = gridOf(b);
  let column = Math.floor(ax);
  let row = Math.floor(ay);
  const lastColumn = Math.floor(bx);
  const lastRow = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // How far along the leg, 0 to 1, the next column and row edge are crossed,
  // and how far apart successive edges are.
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextX =
    dx > 0 ? (column + 1 - ax) / dx : dx < 0 ? (column - ax) / dx : Infinity;
  let nextY =
    dy > 0 ? (row + 1 - ay) / dy : dy < 0 ? (row - ay) / dy : Infinity;

  const cells: SegmentId[] = [`seg:${row}:${column}`];
  const steps = Math.abs(lastColumn - column) + Math.abs(lastRow - row);
  for (let step = 0; step < steps; step++) {
    if (column === lastColumn && row === lastRow) break;
    if (nextX < nextY) {
      column += stepX;
      nextX += deltaX;
    } else if (nextY < nextX) {
      row += stepY;
      nextY += deltaY;
    } else {
      column += stepX;
      row += stepY;
      nextX += deltaX;
      nextY += deltaY;
    }
    cells.push(`seg:${row}:${column}`);
  }
  // Rounding can never leave the leg's own end out.
  cells.push(`seg:${lastRow}:${lastColumn}`);
  return cells;
}

export interface FindRoll {
  readonly artifactId: ArtifactId;
  readonly segment: SegmentId;
  readonly epoch: EpochId;
  readonly packVersion: PackVersion;
  readonly slot: Slot;
  readonly tier: Tier;
  readonly experience: number;
  /**
   * Where along the walk through the segment the find lies, 0 to 1, and how
   * far to the side, -1 to 1 of `FIND_OFFSET_METERS`. Relative, never a
   * coordinate: the caller lays it on the walk it is drawing.
   */
  readonly placement: { readonly along: number; readonly across: number };
}

/**
 * Whether the rolled placement comes within the Avaia's fixed perception
 * radius of the walk that laid it down. `placement.across` is a fraction of
 * FIND_OFFSET_METERS, so no coordinate has to be created or persisted merely
 * to decide whether the find was actually seen.
 */
export function isFindPerceptible(roll: Pick<FindRoll, "placement">): boolean {
  return (
    Math.abs(roll.placement.across) * FIND_OFFSET_METERS <= PERCEPTION_METERS
  );
}

export interface RollInput {
  /** The pack that names finds. Part of the seed, so a new pack rolls anew. */
  readonly packId: string;
  readonly packVersion: PackVersion;
  readonly epoch: EpochId;
  readonly segment: SegmentId;
}

/**
 * What a segment holds this epoch, or `null` for nothing. One uniform draw
 * decides the tier against the table, rarest first, so each tier's chance is
 * exactly its rate times one segment's length.
 */
export function rollSegment(input: RollInput): FindRoll | null {
  const { packId, packVersion, epoch, segment } = input;
  if (packId.length === 0 || packId.includes(":")) {
    throw new RangeError(`pack id must be non-empty and free of ":"`);
  }
  if (!Number.isSafeInteger(packVersion) || packVersion < 1) {
    throw new RangeError(`pack version must be a positive integer`);
  }
  const random = mulberry32(
    xmur3(`${packId}:${packVersion}:${epoch}:${segment}`)(),
  );
  const draw = random();
  const km = SEGMENT_METERS / 1000;
  let threshold = 0;
  for (let i = ROLL_TABLE.tiers.length - 1; i >= 0; i--) {
    const rate: TierRate = ROLL_TABLE.tiers[i]!;
    threshold += rate.perKm * km;
    if (draw < threshold) {
      const slot = 0;
      return {
        artifactId: `art:${segment}:${epoch}:${packVersion}:${slot}`,
        segment,
        epoch,
        packVersion,
        slot,
        tier: rate.tier,
        experience: rate.experience,
        placement: { along: random(), across: random() * 2 - 1 },
      };
    }
  }
  return null;
}

/** Every find a walk rolls, in the order it passes the segments. */
export function rollAlong(
  path: readonly LonLat[],
  roll: Omit<RollInput, "segment">,
): FindRoll[] {
  return segmentsAlong(path).flatMap((segment) => {
    const found = rollSegment({ ...roll, segment });
    return found === null ? [] : [found];
  });
}

/** String hash to a 32-bit seed. Not cryptographic: there is nothing to guard. */
function xmur3(text: string): () => number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** A small seeded generator, uniform in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export {
  AVAIA_PICKUP_MAX_TIER,
  awardsFor,
  canPickUp,
  FIND_SEEN_EXPERIENCE,
  type FindAward,
  type FindEarner,
  type FindEvent,
  type FindEventKind,
} from "./experience";

export {
  closeLead,
  leadsIn,
  liveLeads,
  MAX_LEADS,
  noteLead,
  parseLeads,
  type FindLead,
} from "./leads";

export {
  ARTIFACT_SHA_DOMAIN,
  artifactSha,
  bucketsFor,
  CLAIMED_MIN_TIER,
  claimBucket,
  closedLeads,
  isArtifactSha,
  isClaimed,
  type ArtifactSha,
  type ClaimedSet,
  type ClaimOutcome,
  type ClosedLeads,
} from "./claim";
