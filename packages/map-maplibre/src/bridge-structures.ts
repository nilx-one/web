// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRoad } from "@nilx-one/map-contract";

/**
 * Bridges as structures: a deck raised over what it crosses, ramps where it
 * meets the ground, and piers beneath (docs/bridge-structures.md).
 *
 * The archive marks a bridge only as a `roads` line with `is_bridge`; it
 * carries no outline, no span height and no piers. All of that is made up
 * here from the lines alone, procedurally and as presentation only: a deck
 * as wide as what it carries, at a height set by its kind, climbing from
 * every point where it joins a road on the ground, and piers at a steady
 * spacing beneath the parts high enough to need them. No 3D model is drawn;
 * a cable-stayed or arch bridge reads as the same kind of deck.
 */

export const BRIDGE_STRUCTURE_SOURCE_ID = "nilx-one-bridge-structures";
export const BRIDGE_DECK_LAYER_ID = "nilx-one-bridge-decks";
export const BRIDGE_PIER_LAYER_ID = "nilx-one-bridge-piers";
/** Below this zoom the flat style deck says enough and nothing is built. */
export const BRIDGE_STRUCTURE_MIN_ZOOM = 14;
/** How steeply a deck climbs from where it meets the ground. */
export const BRIDGE_RAMP_GRADE = 0.07;
/** Pieces a deck is cut into, so its height can follow the ramp. */
const PIECE_METERS = 10;
/** Pieces overlap this much, so a bend never opens a gap in the deck. */
const PIECE_OVERLAP_METERS = 0.6;
/** A deck lower than this lies on the ground and is left to the style. */
const MIN_DECK_METERS = 1;
/** A pier is only put under deck at least this high. */
const MIN_PIER_METERS = 4;
const PIER_LENGTH_METERS = 2.4;
/** Two vertices this close are one node: tiles repeat shared vertices. */
const SNAP_METERS = 0.5;
/** A cap on what one view builds, so a dense area cannot run away. */
const MAX_FEATURES = 8_000;

interface Carriage {
  /** Deck width, metres. */
  readonly width: number;
  /** Deck height over what it crosses at full span, metres. */
  readonly height: number;
  readonly thickness: number;
  readonly pierSpacing: number;
}

const CARRIAGES: Readonly<Record<string, Carriage>> = {
  highway: { width: 26, height: 16, thickness: 2.2, pierSpacing: 70 },
  major_road: { width: 22, height: 14, thickness: 2, pierSpacing: 60 },
  medium_road: { width: 16, height: 11, thickness: 1.8, pierSpacing: 50 },
  minor_road: { width: 11, height: 8, thickness: 1.5, pierSpacing: 40 },
  rail: { width: 10, height: 13, thickness: 2.2, pierSpacing: 55 },
  path: { width: 5, height: 7, thickness: 1, pierSpacing: 35 },
};

const EARTH_RADIUS_METERS = 6_371_008.8;
const RAD = Math.PI / 180;

type Point = readonly [x: number, y: number];

interface Frame {
  toLocal(point: readonly [number, number]): Point;
  toLonLat(point: Point): [number, number];
}

function frameAt(origin: readonly [number, number]): Frame {
  const east = EARTH_RADIUS_METERS * RAD * Math.cos(origin[1] * RAD);
  const north = EARTH_RADIUS_METERS * RAD;
  return {
    toLocal: ([longitude, latitude]) => [
      (longitude - origin[0]) * east,
      (latitude - origin[1]) * north,
    ],
    toLonLat: ([x, y]) => [origin[0] + x / east, origin[1] + y / north],
  };
}

function keyOf([x, y]: Point): string {
  return `${Math.round(x / SNAP_METERS)},${Math.round(y / SNAP_METERS)}`;
}

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly length: number;
  readonly carriage: Carriage;
}

export interface BridgeFeature {
  readonly type: "Feature";
  readonly properties: {
    readonly part: "deck" | "pier";
    readonly bottom: number;
    readonly top: number;
  };
  readonly geometry: {
    readonly type: "Polygon";
    readonly coordinates: readonly (readonly [number, number])[][];
  };
}

export interface BridgeStructures {
  readonly type: "FeatureCollection";
  readonly features: readonly BridgeFeature[];
}

/** The deck height at a node `distance` metres from the nearest ground. */
function rampHeight(carriage: Carriage, distance: number): number {
  return Math.min(carriage.height, distance * BRIDGE_RAMP_GRADE);
}

/** A quad from `from` to `to`, `halfWidth` either side of the line. */
function quad(
  frame: Frame,
  [ax, ay]: Point,
  [bx, by]: Point,
  halfWidth: number,
): [number, number][] {
  const length = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / length) * halfWidth;
  const ny = ((bx - ax) / length) * halfWidth;
  const ring: Point[] = [
    [ax + nx, ay + ny],
    [bx + nx, by + ny],
    [bx - nx, by - ny],
    [ax - nx, ay - ny],
    [ax + nx, ay + ny],
  ];
  return ring.map(frame.toLonLat);
}

/**
 * The structures for every bridge among `roads`. Roads that are not bridges
 * say where the ground is: a bridge vertex they share is where its ramp
 * begins. A bridge whose ends are not loaded keeps its full height there.
 */
export function bridgeStructures(roads: readonly MapRoad[]): BridgeStructures {
  const bridges = roads.filter(
    (road) => road.isBridge === true && CARRIAGES[road.kind] !== undefined,
  );
  const first = bridges[0]?.lines[0]?.[0];
  if (first === undefined) return { type: "FeatureCollection", features: [] };
  const frame = frameAt(first);

  const nodes: Point[] = [];
  const index = new Map<string, number>();
  const nodeOf = (point: Point): number => {
    const key = keyOf(point);
    const known = index.get(key);
    if (known !== undefined) return known;
    index.set(key, nodes.length);
    nodes.push(point);
    return nodes.length - 1;
  };
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const road of bridges) {
    const carriage = CARRIAGES[road.kind]!;
    for (const line of road.lines) {
      let previous: number | undefined;
      for (const vertex of line) {
        if (!Number.isFinite(vertex[0]) || !Number.isFinite(vertex[1])) {
          previous = undefined;
          continue;
        }
        const node = nodeOf(frame.toLocal(vertex));
        if (previous !== undefined && previous !== node) {
          const a = Math.min(previous, node);
          const b = Math.max(previous, node);
          // The same stretch arrives once per tile it crosses.
          const key = `${a}:${b}:${road.kind}`;
          if (!seen.has(key)) {
            seen.add(key);
            const [ax, ay] = nodes[a]!;
            const [bx, by] = nodes[b]!;
            edges.push({
              a,
              b,
              length: Math.hypot(bx - ax, by - ay),
              carriage,
            });
          }
        }
        previous = node;
      }
    }
  }

  // Where a bridge meets the ground: a vertex a road on the ground shares.
  // Most of a view's roads are nowhere near a bridge; a box test skips them
  // before any vertex is named.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of nodes) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const ground = new Set<number>();
  for (const road of roads) {
    if (road.isBridge === true) continue;
    for (const line of road.lines)
      for (const vertex of line) {
        const local = frame.toLocal(vertex);
        if (
          local[0] < minX - SNAP_METERS ||
          local[0] > maxX + SNAP_METERS ||
          local[1] < minY - SNAP_METERS ||
          local[1] > maxY + SNAP_METERS
        )
          continue;
        const node = index.get(keyOf(local));
        if (node !== undefined) ground.add(node);
      }
  }

  // Distance along the bridges from the nearest ground, every node at once.
  const adjacency: number[][] = nodes.map(() => []);
  for (const [position, edge] of edges.entries()) {
    adjacency[edge.a]!.push(position);
    adjacency[edge.b]!.push(position);
  }
  const distance = new Float64Array(nodes.length).fill(Infinity);
  const queue: number[] = [];
  for (const node of ground) {
    distance[node] = 0;
    queue.push(node);
  }
  // Few nodes, so a plain scan for the nearest beats keeping a heap.
  const done = new Uint8Array(nodes.length);
  while (queue.length > 0) {
    let best = 0;
    for (let i = 1; i < queue.length; i++)
      if (distance[queue[i]!]! < distance[queue[best]!]!) best = i;
    const node = queue.splice(best, 1)[0]!;
    if (done[node]) continue;
    done[node] = 1;
    for (const position of adjacency[node]!) {
      const edge = edges[position]!;
      const other = edge.a === node ? edge.b : edge.a;
      const next = distance[node]! + edge.length;
      if (next < distance[other]!) {
        distance[other] = next;
        queue.push(other);
      }
    }
  }

  const features: BridgeFeature[] = [];
  const push = (feature: BridgeFeature) => {
    if (features.length < MAX_FEATURES) features.push(feature);
  };
  for (const edge of edges) {
    const { carriage, length } = edge;
    if (length <= 0) continue;
    const a = nodes[edge.a]!;
    const b = nodes[edge.b]!;
    const da = distance[edge.a]!;
    const db = distance[edge.b]!;
    const heightAt = (s: number) =>
      rampHeight(carriage, Math.min(da + s, db + length - s));
    const along = (s: number): Point => {
      const t = s / length;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const pieces = Math.max(1, Math.ceil(length / PIECE_METERS));
    for (let piece = 0; piece < pieces; piece++) {
      const from = (piece / pieces) * length;
      const to = ((piece + 1) / pieces) * length;
      const top = heightAt((from + to) / 2);
      if (top < MIN_DECK_METERS) continue;
      push({
        type: "Feature",
        properties: {
          part: "deck",
          bottom: Math.max(0, top - carriage.thickness),
          top,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            quad(
              frame,
              along(Math.max(0, from - PIECE_OVERLAP_METERS)),
              along(Math.min(length, to + PIECE_OVERLAP_METERS)),
              carriage.width / 2,
            ),
          ],
        },
      });
    }
    const piers = Math.round(length / carriage.pierSpacing);
    for (let pier = 0; pier < piers; pier++) {
      const s = ((pier + 0.5) / piers) * length;
      const top = heightAt(s) - carriage.thickness;
      if (top + carriage.thickness < MIN_PIER_METERS) continue;
      push({
        type: "Feature",
        properties: { part: "pier", bottom: 0, top },
        geometry: {
          type: "Polygon",
          coordinates: [
            quad(
              frame,
              along(Math.max(0, s - PIER_LENGTH_METERS / 2)),
              along(Math.min(length, s + PIER_LENGTH_METERS / 2)),
              carriage.width * 0.3,
            ),
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Deck and pier colours for an appearance; the style may publish its own. */
export interface BridgePalette {
  readonly deck: string;
  readonly pier: string;
}

export const BRIDGE_PALETTES: Readonly<
  Record<"light" | "dark", BridgePalette>
> = {
  light: { deck: "#f4f7f8", pier: "#c3d1d5" },
  dark: { deck: "#33474e", pier: "#24343a" },
};

export function bridgeStructureLayers(
  palette: BridgePalette,
): readonly Record<string, unknown>[] {
  const common = {
    type: "fill-extrusion",
    source: BRIDGE_STRUCTURE_SOURCE_ID,
    minzoom: BRIDGE_STRUCTURE_MIN_ZOOM,
  };
  const paint = (color: string) => ({
    "fill-extrusion-color": color,
    "fill-extrusion-base": ["get", "bottom"],
    "fill-extrusion-height": ["get", "top"],
    "fill-extrusion-vertical-gradient": true,
    "fill-extrusion-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      BRIDGE_STRUCTURE_MIN_ZOOM,
      0,
      BRIDGE_STRUCTURE_MIN_ZOOM + 1,
      0.96,
    ],
  });
  return [
    {
      id: BRIDGE_PIER_LAYER_ID,
      ...common,
      filter: ["==", ["get", "part"], "pier"],
      paint: paint(palette.pier),
    },
    {
      id: BRIDGE_DECK_LAYER_ID,
      ...common,
      filter: ["==", ["get", "part"], "deck"],
      paint: paint(palette.deck),
    },
  ];
}
