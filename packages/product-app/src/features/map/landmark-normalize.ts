// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

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
  walk_target: ["park", "lake", "nature_reserve", "viewpoint", "beach", "peak", "castle", "fort", "archaeological_site", "ruins", "historic_building", "museum", "major_monument"],
  route_landmark: ["artwork", "fountain", "bridge", "tower", "church", "small_monument", "shrine", "cross", "spring"],
  micro_interest: ["bench", "picnic_site", "information", "bird_hide", "cairn", "camp_site"],
} as const;

export type LandmarkGroup = keyof typeof LANDMARK_GROUPS;
export type LandmarkKind = (typeof LANDMARK_GROUPS)[LandmarkGroup][number];

export const LANDMARK_MAPPING = {
  version: "1.0",
  parkMinAreaM2: 10_000,
  majorMonumentMinFootprintM2: 100,
  duplicateWithinMeters: 50,
} as const;

const AREA_ONLY: ReadonlySet<LandmarkKind> = new Set(["park", "lake", "nature_reserve", "beach"]);
const MAY_BE_LINE: ReadonlySet<LandmarkKind> = new Set(["bridge"]);

export type AreaRings = readonly (readonly LonLat[])[];

export type LandmarkGeometry =
  | { readonly type: "point"; readonly point: LonLat }
  | { readonly type: "area"; readonly polygons: readonly AreaRings[] }
  | { readonly type: "line"; readonly lines: readonly (readonly LonLat[])[] };

export interface SourceCandidate {
  readonly sourceId: string;
  readonly matches: readonly LandmarkKind[];
  readonly name?: string | undefined;
  readonly geometry: LandmarkGeometry;
  readonly heritage?: boolean | undefined;
  readonly attraction?: boolean | undefined;
  readonly historic?: boolean | undefined;
}

export interface NormalizedLandmark {
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly group: LandmarkGroup;
  readonly name?: string;
  readonly geometry: LandmarkGeometry;
}

export function normalizeLandmarks(candidates: readonly SourceCandidate[]): NormalizedLandmark[] {
  const resolved: Resolved[] = [];
  for (const candidate of candidates) {
    if (!wellFormed(candidate.geometry)) continue;
    const kind = resolveKind(candidate);
    if (kind === undefined) continue;
    const name = candidate.name?.trim();
    resolved.push({
      sourceId: candidate.sourceId,
      kind,
      ...(name === undefined || name.length === 0 ? {} : { name }),
      geometry: candidate.geometry,
      at: representativePoint(candidate.geometry),
    });
  }

  resolved.sort(bySurvivorship);
  const kept: Resolved[] = [];
  for (const landmark of resolved) {
    if (!kept.some((other) => duplicates(other, landmark))) kept.push(landmark);
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

export function resolveKind(candidate: SourceCandidate): LandmarkKind | undefined {
  let best: LandmarkKind | undefined;
  for (const match of candidate.matches) {
    const kind = qualify(match, candidate);
    if (kind === undefined) continue;
    if (best === undefined || precedence(kind) < precedence(best)) best = kind;
  }
  return best;
}

function qualify(kind: LandmarkKind, candidate: SourceCandidate): LandmarkKind | undefined {
  if (!(kind in PRECEDENCE)) return undefined;
  const { geometry } = candidate;
  if (AREA_ONLY.has(kind) && geometry.type !== "area") return undefined;
  if (geometry.type === "line" && !MAY_BE_LINE.has(kind)) return undefined;
  const named = (candidate.name?.trim() ?? "").length > 0;

  if (kind === "major_monument") {
    const significant = named && (candidate.heritage === true || candidate.attraction === true || footprintM2(geometry) >= LANDMARK_MAPPING.majorMonumentMinFootprintM2);
    return significant ? kind : qualify("small_monument", candidate);
  }
  if (groupOf(kind) === "walk_target" && !named) return undefined;
  if (kind === "park" && footprintM2(geometry) < LANDMARK_MAPPING.parkMinAreaM2) return undefined;
  if (kind === "historic_building" && candidate.historic !== true) return undefined;
  return kind;
}

const PRECEDENCE: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(LANDMARK_GROUPS).flat().map((kind, index) => [kind, index]),
);

function precedence(kind: LandmarkKind): number {
  return PRECEDENCE[kind] ?? Infinity;
}

export function groupOf(kind: LandmarkKind): LandmarkGroup {
  for (const [group, kinds] of Object.entries(LANDMARK_GROUPS)) {
    if ((kinds as readonly string[]).includes(kind)) return group as LandmarkGroup;
  }
  throw new RangeError(`not a landmark kind: ${kind}`);
}

export function normalizeName(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("und").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

interface Resolved {
  readonly sourceId: string;
  readonly kind: LandmarkKind;
  readonly name?: string;
  readonly geometry: LandmarkGeometry;
  readonly at: LonLat;
}

function bySurvivorship(a: Resolved, b: Resolved): number {
  const area = (r: Resolved) => (r.geometry.type === "area" ? 0 : 1);
  const unnamed = (r: Resolved) => (r.name === undefined ? 1 : 0);
  return precedence(a.kind) - precedence(b.kind) || area(a) - area(b) || unnamed(a) - unnamed(b) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
}

function sameFeatureKind(a: LandmarkKind, b: LandmarkKind): boolean {
  const monument = (kind: LandmarkKind) => kind === "major_monument" || kind === "small_monument";
  return a === b || (monument(a) && monument(b));
}

function duplicates(a: Resolved, b: Resolved): boolean {
  if (!sameFeatureKind(a.kind, b.kind)) return false;
  const namesAgree = a.name === undefined || b.name === undefined || normalizeName(a.name) === normalizeName(b.name);
  if (!namesAgree) return false;
  return contains(a.geometry, b.at) || contains(b.geometry, a.at) || distanceM(a.at, b.at) <= LANDMARK_MAPPING.duplicateWithinMeters;
}

function contains(geometry: LandmarkGeometry, point: LonLat): boolean {
  return geometry.type === "area" && geometry.polygons.some((rings) => insideRings(point, rings));
}

function landmarkId(kind: LandmarkKind, [lon, lat]: LonLat): string {
  const q = (value: number) => Math.round(value * 1e5);
  return `lm:${kind}:${q(lon)}:${q(lat)}`;
}

function closedRing(ring: readonly LonLat[]): boolean {
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}

function wellFormed(geometry: LandmarkGeometry): boolean {
  const finite = ([lon, lat]: LonLat) => Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  switch (geometry.type) {
    case "point":
      return finite(geometry.point);
    case "line":
      return geometry.lines.length > 0 && geometry.lines.every((line) => line.length >= 2 && line.every(finite));
    case "area":
      return geometry.polygons.length > 0 && geometry.polygons.every((rings) => rings.length > 0 && rings.every((ring) => closedRing(ring) && ring.every(finite))) && footprintM2(geometry) > 0;
  }
}

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
    for (const [x, y] of outer.slice(0, -1)) {
      lon += x;
      lat += y;
      count += 1;
    }
  }
  return [lon / count, lat / count];
}

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
    twice += (xj - origin[0]) * kx * ((yi - origin[1]) * ky) - (xi - origin[0]) * kx * ((yj - origin[1]) * ky);
  }
  return Math.abs(twice) / 2;
}

function insideRings([x, y]: LonLat, rings: AreaRings): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
