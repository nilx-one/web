// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { distanceM, projectOnSegment, type LonLat } from "./geo";
import { SURFACE_WEIGHT, surfaceOf, type Surface } from "./surface";

/**
 * One `roads` feature as the renderer reads it from a loaded tile.
 *
 * `lines` holds every line of a LineString or MultiLineString. The same street
 * usually arrives several times, once per tile it crosses and clipped at that
 * tile's buffer; the builder joins those pieces back together.
 */
export interface RoadFeature {
  readonly kind: string;
  readonly kindDetail?: string | undefined;
  readonly isBridge?: boolean | undefined;
  readonly lines: readonly (readonly LonLat[])[];
}

export interface WalkEdge {
  /** Node indices, `a < b`. Edges are walkable both ways. */
  readonly a: number;
  readonly b: number;
  readonly lengthM: number;
  readonly surface: Surface;
  /** Crosses over something, typically water. Kept for the destination checks. */
  readonly bridge: boolean;
}

/**
 * The pedestrian graph. Plain data, built by a pure function: the same features
 * in any order give the same graph, node and edge numbering included.
 *
 * Coordinates and indices stay inside routing. Nothing here is meant for the
 * model, which only ever sees closed-vocabulary labels.
 */
export interface WalkGraph {
  readonly nodes: readonly LonLat[];
  readonly edges: readonly WalkEdge[];
  /** Edge indices touching each node, ascending. */
  readonly adjacency: readonly (readonly number[])[];
}

/** Coordinates are snapped to 1e-7 degrees (about 1 cm) to name a node. */
export const COORDINATE_PRECISION = 1e7;

/**
 * How far a loose line end may be from another line and still be joined to it.
 * Covers tile-buffer clipping, which cuts a line at a point the neighbouring
 * tile does not have, off by up to one tile unit.
 */
export const STITCH_TOLERANCE_M = 1;

/** Cost of walking an edge end to end. */
export function edgeCost(edge: WalkEdge): number {
  return edge.lengthM * SURFACE_WEIGHT[edge.surface];
}

export function buildWalkGraph(features: readonly RoadFeature[]): WalkGraph {
  const nodes = new Map<string, NodeKey>();
  const raw: Segment[] = [];
  for (const feature of features) {
    const surface = surfaceOf(feature.kind, feature.kindDetail);
    if (surface === null) continue;
    const bridge = feature.isBridge === true;
    for (const line of feature.lines) {
      let previous: NodeKey | null = null;
      for (const point of line) {
        if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          previous = null;
          continue;
        }
        const node = nodeKey(point, nodes);
        if (previous !== null && previous !== node) {
          raw.push(segment(previous, node, surface, bridge));
        }
        previous = node;
      }
    }
  }
  const segments = stitch(dedupe(raw));
  return assemble(dedupe(segments));
}

interface NodeKey {
  readonly lon: number;
  readonly lat: number;
  readonly point: LonLat;
}

interface Segment {
  readonly a: NodeKey;
  readonly b: NodeKey;
  readonly surface: Surface;
  readonly bridge: boolean;
}

function nodeKey(point: LonLat, nodes: Map<string, NodeKey>): NodeKey {
  const lon = Math.round(point[0] * COORDINATE_PRECISION);
  const lat = Math.round(point[1] * COORDINATE_PRECISION);
  const id = `${lon},${lat}`;
  let node = nodes.get(id);
  if (node === undefined) {
    node = {
      lon,
      lat,
      point: [lon / COORDINATE_PRECISION, lat / COORDINATE_PRECISION],
    };
    nodes.set(id, node);
  }
  return node;
}

function compareNodes(x: NodeKey, y: NodeKey): number {
  return x.lon - y.lon || x.lat - y.lat;
}

function segment(
  a: NodeKey,
  b: NodeKey,
  surface: Surface,
  bridge: boolean,
): Segment {
  return compareNodes(a, b) <= 0
    ? { a, b, surface, bridge }
    : { a: b, b: a, surface, bridge };
}

function compareSegments(x: Segment, y: Segment): number {
  return compareNodes(x.a, y.a) || compareNodes(x.b, y.b);
}

/** Overlapping copies of one stretch collapse to the cheapest surface. */
function dedupe(segments: readonly Segment[]): Segment[] {
  const byPair = new Map<string, Segment>();
  for (const s of segments) {
    const pair = `${s.a.lon},${s.a.lat}|${s.b.lon},${s.b.lat}`;
    const kept = byPair.get(pair);
    if (kept === undefined) {
      byPair.set(pair, s);
      continue;
    }
    const order =
      SURFACE_WEIGHT[s.surface] - SURFACE_WEIGHT[kept.surface] ||
      (s.surface < kept.surface ? -1 : s.surface > kept.surface ? 1 : 0);
    if (order < 0) byPair.set(pair, s);
    else if (order === 0 && s.bridge && !kept.bridge) byPair.set(pair, s);
  }
  return [...byPair.values()].sort(compareSegments);
}

/**
 * Join loose line ends to the line they were cut from.
 *
 * Every node used by exactly one segment is visited in coordinate order. If
 * another node lies within the tolerance it is merged into it; otherwise, if a
 * segment passes within the tolerance, that segment is split at the loose end.
 * A real dead end farther than the tolerance from anything stays a dead end.
 */
function stitch(input: readonly Segment[]): Segment[] {
  const segments: (Segment | null)[] = [...input];
  const degree = new Map<NodeKey, number>();
  const bump = (node: NodeKey, by: number) =>
    degree.set(node, (degree.get(node) ?? 0) + by);
  for (const s of input) {
    bump(s.a, 1);
    bump(s.b, 1);
  }
  const grid = new SegmentGrid();
  input.forEach((s, index) => grid.add(s, index));
  const add = (s: Segment) => {
    segments.push(s);
    grid.add(s, segments.length - 1);
  };

  const loose = [...degree]
    .filter(([, count]) => count === 1)
    .map(([node]) => node)
    .sort(compareNodes);

  for (const end of loose) {
    if (degree.get(end) !== 1) continue;
    const nearby = grid.near(end.point).flatMap((index) => {
      const s = segments[index];
      return s ? [{ index, s }] : [];
    });
    const own = nearby.find(({ s }) => s.a === end || s.b === end);
    if (own === undefined) continue;
    const neighbour = own.s.a === end ? own.s.b : own.s.a;

    let merge: { node: NodeKey; distance: number } | null = null;
    for (const { s } of nearby) {
      for (const node of [s.a, s.b]) {
        if (node === end || node === neighbour) continue;
        const distance = distanceM(end.point, node.point);
        if (distance > STITCH_TOLERANCE_M) continue;
        if (
          merge === null ||
          distance < merge.distance ||
          (distance === merge.distance && compareNodes(node, merge.node) < 0)
        ) {
          merge = { node, distance };
        }
      }
    }
    if (merge !== null) {
      segments[own.index] = null;
      add(segment(neighbour, merge.node, own.s.surface, own.s.bridge));
      degree.set(end, 0);
      bump(merge.node, 1);
      continue;
    }

    let split: { index: number; s: Segment; distance: number } | null = null;
    for (const { index, s } of nearby) {
      if (s.a === end || s.b === end) continue;
      const { distanceM: distance } = projectOnSegment(
        end.point,
        s.a.point,
        s.b.point,
      );
      if (distance > STITCH_TOLERANCE_M) continue;
      if (split === null || distance < split.distance) {
        split = { index, s, distance };
      }
    }
    if (split !== null) {
      segments[split.index] = null;
      add(segment(split.s.a, end, split.s.surface, split.s.bridge));
      add(segment(end, split.s.b, split.s.surface, split.s.bridge));
      bump(end, 2);
    }
  }
  return segments.filter((s): s is Segment => s !== null);
}

function assemble(segments: readonly Segment[]): WalkGraph {
  const used = new Set<NodeKey>();
  for (const s of segments) {
    used.add(s.a);
    used.add(s.b);
  }
  const ordered = [...used].sort(compareNodes);
  const indexOf = new Map(ordered.map((node, index) => [node, index]));
  const edges: WalkEdge[] = segments.map((s) => ({
    a: indexOf.get(s.a) ?? 0,
    b: indexOf.get(s.b) ?? 0,
    lengthM: distanceM(s.a.point, s.b.point),
    surface: s.surface,
    bridge: s.bridge,
  }));
  const adjacency: number[][] = ordered.map(() => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a]?.push(index);
    adjacency[edge.b]?.push(index);
  });
  return { nodes: ordered.map((node) => node.point), edges, adjacency };
}

/** Coarse bucket index so stitching only looks at segments near a loose end. */
class SegmentGrid {
  static readonly CELL_DEG = 0.0005;
  private readonly cells = new Map<string, number[]>();

  add(s: Segment, index: number): void {
    const padLat = STITCH_TOLERANCE_M / 111_000;
    const cos = Math.max(0.01, Math.cos((s.a.point[1] * Math.PI) / 180));
    const padLon = padLat / cos;
    const x0 = cell(Math.min(s.a.point[0], s.b.point[0]) - padLon);
    const x1 = cell(Math.max(s.a.point[0], s.b.point[0]) + padLon);
    const y0 = cell(Math.min(s.a.point[1], s.b.point[1]) - padLat);
    const y1 = cell(Math.max(s.a.point[1], s.b.point[1]) + padLat);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const id = `${x},${y}`;
        const bucket = this.cells.get(id);
        if (bucket === undefined) this.cells.set(id, [index]);
        else bucket.push(index);
      }
    }
  }

  near(point: LonLat): readonly number[] {
    return this.cells.get(`${cell(point[0])},${cell(point[1])}`) ?? [];
  }
}

function cell(degrees: number): number {
  return Math.floor(degrees / SegmentGrid.CELL_DEG);
}
