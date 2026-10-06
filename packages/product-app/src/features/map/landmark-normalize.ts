// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { insideRings } from "@nilx-one/map-contract";
import { distanceM, type LonLat } from "@nilx-one/walk-graph";

/**
 * From mapped archive candidates to normalized landmarks
 * (docs/avaia-osm-landmarks.md, #307).
 *
 * The mapper (#306) says which rows of the mapping table an archive object
 * matched. This step decides what it is: one kind per object by the table's
 * precedence, the significance rules for each kind, no malformed geometry, and
 * one landmark per physical feature. It is pure and deterministic: the same
 * candidates in any order give the same landmarks, in the same order.
 *
 * Source ids stay in here. What comes out carries a landmark id derived from
 * the kind and the place, a name for the interface, and geometry for routing;
 * none of it is model input, which only ever gets closed labels.
 */

/** The mapping table, group by group, rows in table order. */
export const LANDMARK_GROUPS = {
  walk_target: [
    "park",
    "lake",
    "nature_reserve",
    "viewpoint",
    "beach",
    "peak",
    "castle",
    "fort",
    "archaeological_site",
    "ruins",
    "historic_building",
    "museum",
    "major_monument",
  ],
  route_landmark: [
    "artwork",
    "fountain",
    "bridge",
    "tower",
    "church",
    "small_monument",
    "shrine",
    "cross",
    "spring",
  ],
  micro_interest: [
    "bench",
    "picnic_site",
    "information",
    "bird_hide",
    "cairn",
    "camp_site",
  ],
} as const;

export type LandmarkGroup = keyof typeof LANDMARK_GROUPS;
export type LandmarkKind = (typeof LANDMARK_GROUPS)[LandmarkGroup][number];

/**
 * The mapping's version and its thresholds, starting values to be set from
 * the Kyiv archive's real distribution. Changing any of them changes which
 * landmarks come out, so it raises the version in the same commit.
 */
export const LANDMARK_MAPPING = {
  version: "1.0",
  /** A park smaller than this is not a park target. 1 ha. */
  parkMinAreaM2: 10_000,
  /** A monument with a footprint this large is major. */
  majorMonumentMinFootprintM2: 100,
  /** Same-kind objects this close are one feature, names permitting. */
  duplicateWithinMeters: 50,
} as const;

/** Kinds that are only ever areas: a park is not a point. */
const AREA_ONLY: ReadonlySet<LandmarkKind> = new Set([
  "park",
  "lake",
  "nature_reserve",
  "beach",
]);

/** Kinds that may be a line, beside a point or an area. */
const MAY_BE_LINE: ReadonlySet<LandmarkKind> = new Set(["bridge"]);

export type AreaRings = readonly (readonly LonLat[])[];

export type LandmarkGeometry =
  | { readonly type: "point"; readonly point: LonLat }
  | { readonly type: "area"; readonly polygons: readonly AreaRings[] }
  | { readonly type: "line"; readonly lines: readonly (readonly LonLat[])[] };

/** One archive object as the mapper hands it over. */
export interface SourceCandidate {
  /** Stable within the archive; used for ties here and never passed on. */
  readonly sourceId: string;
  /** Every row of the mapping table the object matched. */
  readonly matches: readonly LandmarkKind[];
  readonly name?: string | undefined;
  readonly geometry: LandmarkGeometry;
  /**
   * Where the archive puts the object's label, when it has one apart from
   * the geometry. It stands for an area instead of its vertices, which move
   * as tiles load and clip it differently.
   */
  readonly anchor?: LonLat | undefined;
  /** A heritage-style attribute, when the archive carries one. */
  readonly heritage?: boolean | undefined;
  /** A co-occurring `attraction` or `landmark` kind. */
  readonly attraction?: boolean | undefined;
  /** An explicit historic attribute. `building=*` alone is not one. */
  readonly historic?: boolean | undefined;
}

export interface NormalizedLandmark {
  /** Derived from the kind and the place: the same feature, the same id. */
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly group: LandmarkGroup;
  readonly name?: string;
  readonly geometry: LandmarkGeometry;
}

export function normalizeLandmarks(
  candidates: readonly SourceCandidate[],
): NormalizedLandmark[] {
  const resolved: Resolved[] = [];
  for (const candidate of candidates) {
    if (!wellFormed(candidate.geometry)) continue;
    if (candidate.anchor !== undefined && !finite(candidate.anchor)) continue;
    const kind = resolveKind(candidate);
    if (kind === undefined) continue;
    const name = candidate.name?.trim();
    resolved.push({
      sourceId: candidate.sourceId,
      kind,
      ...(name === undefined || name.length === 0 ? {} : { name }),
      geometry: candidate.geometry,
      at: candidate.anchor ?? representativePoint(candidate.geometry),
    });
  }

  // The survivor of each duplicate set is the first of it in this order, so
  // keeping greedily keeps exactly the survivors.
  resolved.sort(bySurvivorship);
  const kept: Resolved[] = [];
  for (const landmark of resolved) {
    if (!kept.some((other) => duplicates(other, landmark))) {
      kept.push(landmark);
    }
  }

  return kept
    .map(({ kind, name, geometry, at }) => ({
      id: landmarkId(kind, at),
      kind,
      group: groupOf(kind),
      ...(name === undefined ? {} : { name }),
      geometry,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The one kind an object is: of every row it matched that also passes that
 * row's significance rule, the first by group order and then table order. A
 * monument that is not significant enough to be major is small.
 */
export function resolveKind(
  candidate: SourceCandidate,
): LandmarkKind | undefined {
  let best: LandmarkKind | undefined;
  for (const match of candidate.matches) {
    const kind = qualify(match, candidate);
    if (kind === undefined) continue;
    if (best === undefined || precedence(kind) < precedence(best)) best = kind;
  }
  return best;
}

function qualify(
  kind: LandmarkKind,
  candidate: SourceCandidate,
): LandmarkKind | undefined {
  if (!(kind in PRECEDENCE)) return undefined;
  const { geometry } = candidate;
  if (AREA_ONLY.has(kind) && geometry.type !== "area") return undefined;
  if (geometry.type === "line" && !MAY_BE_LINE.has(kind)) return undefined;
  const named = (candidate.name?.trim() ?? "").length > 0;

  if (kind === "major_monument") {
    const significant =
      named &&
      (candidate.heritage === true ||
        candidate.attraction === true ||
        footprintM2(geometry) >= LANDMARK_MAPPING.majorMonumentMinFootprintM2);
    return significant ? kind : qualify("small_monument", candidate);
  }
  if (groupOf(kind) === "walk_target" && !named) return undefined;
  if (
    kind === "park" &&
    footprintM2(geometry) < LANDMARK_MAPPING.parkMinAreaM2
  ) {
    return undefined;
  }
  if (kind === "historic_building" && candidate.historic !== true) {
    return undefined;
  }
  return kind;
}

const PRECEDENCE: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(LANDMARK_GROUPS)
    .flat()
    .map((kind, index) => [kind, index]),
);

function precedence(kind: LandmarkKind): number {
  return PRECEDENCE[kind] ?? Infinity;
}

export function groupOf(kind: LandmarkKind): LandmarkGroup {
  for (const [group, kinds] of Object.entries(LANDMARK_GROUPS)) {
    if ((kinds as readonly string[]).includes(kind)) {
      return group as LandmarkGroup;
    }
  }
  throw new RangeError(`not a landmark kind: ${kind}`);
}

/** Lower and trimmed, accents folded, punctuation and spacing collapsed. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

interface Resolved {
  readonly sourceId: string;
  readonly kind: LandmarkKind;
  readonly name?: string;
  readonly geometry: LandmarkGeometry;
  readonly at: LonLat;
}

/**
 * The kind of the higher row first (only ever differs for a monument, major
 * over small), then polygon over point, then named over unnamed, then the
 * smallest source id.
 */
function bySurvivorship(a: Resolved, b: Resolved): number {
  const area = (r: Resolved) => (r.geometry.type === "area" ? 0 : 1);
  const unnamed = (r: Resolved) => (r.name === undefined ? 1 : 0);
  return (
    precedence(a.kind) - precedence(b.kind) ||
    area(a) - area(b) ||
    unnamed(a) - unnamed(b) ||
    (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
  );
}

/**
 * One monument read twice, once with a heritage attribute and once without,
 * is still one monument: for deduplication major and small are one kind.
 */
function sameFeatureKind(a: LandmarkKind, b: LandmarkKind): boolean {
  const monument = (kind: LandmarkKind) =>
    kind === "major_monument" || kind === "small_monument";
  return a === b || (monument(a) && monument(b));
}

function duplicates(a: Resolved, b: Resolved): boolean {
  if (!sameFeatureKind(a.kind, b.kind)) return false;
  const namesAgree =
    a.name === undefined ||
    b.name === undefined ||
    normalizeName(a.name) === normalizeName(b.name);
  if (!namesAgree) return false;
  return (
    contains(a.geometry, b.at) ||
    contains(b.geometry, a.at) ||
    distanceM(a.at, b.at) <= LANDMARK_MAPPING.duplicateWithinMeters
  );
}

function contains(geometry: LandmarkGeometry, point: LonLat): boolean {
  return (
    geometry.type === "area" &&
    geometry.polygons.some((rings) => insideRings(point, rings))
  );
}

function landmarkId(kind: LandmarkKind, [lon, lat]: LonLat): string {
  // About a metre: the same feature from any tile lands on the same id.
  const q = (value: number) => Math.round(value * 1e5);
  return `lm:${kind}:${q(lon)}:${q(lat)}`;
}

function finite([lon, lat]: LonLat): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function wellFormed(geometry: LandmarkGeometry): boolean {
  switch (geometry.type) {
    case "point":
      return finite(geometry.point);
    case "line":
      return (
        geometry.lines.length > 0 &&
        geometry.lines.every((line) => line.length >= 2 && line.every(finite))
      );
    case "area":
      return (
        geometry.polygons.length > 0 &&
        geometry.polygons.every(
          (rings) =>
            rings.length > 0 &&
            rings.every((ring) => closedRing(ring) && ring.every(finite)),
        ) &&
        footprintM2(geometry) > 0
      );
  }
}

/**
 * A ring is closed: at least four points, the last the same as the first. An
 * open ring is malformed however many points it has, and goes no further.
 */
function closedRing(ring: readonly LonLat[]): boolean {
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return (
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1]
  );
}

/**
 * A point that stands for the geometry: the point itself, the middle vertex
 * of a line, the vertex average of an area's outer rings. Only for closeness
 * and ids, never for arriving: arrival anchors are routing's. A candidate's
 * own `anchor` comes first: the vertex average of an area depends on which of
 * its pieces are loaded.
 */
function representativePoint(geometry: LandmarkGeometry): LonLat {
  if (geometry.type === "point") return geometry.point;
  if (geometry.type === "line") {
    const line = geometry.lines[0]!;
    return line[Math.floor(line.length / 2)]!;
  }
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const rings of geometry.polygons) {
    const outer = rings[0]!;
    // A closed ring repeats its first vertex; count it once.
    for (const [x, y] of outer.slice(0, -1)) {
      lon += x;
      lat += y;
      count += 1;
    }
  }
  return [lon / count, lat / count];
}

/** Area in square metres: outer rings less holes. 0 for a point or a line. */
export function footprintM2(geometry: LandmarkGeometry): number {
  if (geometry.type !== "area") return 0;
  let total = 0;
  for (const [outer, ...holes] of geometry.polygons) {
    if (outer === undefined) continue;
    total += ringArea(outer);
    for (const hole of holes) total -= ringArea(hole);
  }
  return Math.max(0, total);
}

function ringArea(ring: readonly LonLat[]): number {
  const origin = ring[0];
  if (origin === undefined) return 0;
  const ky = 111_195;
  const kx = ky * Math.cos((origin[1] * Math.PI) / 180);
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    twice +=
      (xj - origin[0]) * kx * ((yi - origin[1]) * ky) -
      (xi - origin[0]) * kx * ((yj - origin[1]) * ky);
  }
  return Math.abs(twice) / 2;
}
