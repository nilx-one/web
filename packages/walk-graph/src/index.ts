// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The pedestrian graph Avaia walks on, and the router over it, as Core
 * computes them (nilx-one/core `docs/walk-graph.md`).
 *
 * Core is the head: it builds the graph, snaps, routes and reaches. This
 * package only hands it the roads a host read out of its tiles and turns
 * Core's answers into plain data the map can draw and animate. Until a host
 * installs Core's walking graph (`installWalkGraphCore`), there is no graph:
 * nothing is walked along, and the Avaia does not walk.
 *
 * Fog stays the host's. Core cannot call back into the page, so a walk's
 * `canEnter` becomes a mask of the nodes it may enter, and a snap takes the
 * first of Core's candidates the fog lets in.
 */

export { distanceM, projectOnSegment, type LonLat } from "./geo";
import type { LonLat } from "./geo";

/** What a walking edge is made of, as Core classifies it. */
export type Surface = "footway" | "track" | "steps" | "street" | "carriageway";

/** One `roads` feature as the renderer reads it from a loaded tile. */
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
  /** Crosses over something, typically water. */
  readonly bridge: boolean;
}

/** The pedestrian graph, as plain data to draw; Core keeps the real one. */
export interface WalkGraph {
  readonly nodes: readonly LonLat[];
  readonly edges: readonly WalkEdge[];
  /** Edge indices touching each node, ascending. */
  readonly adjacency: readonly (readonly number[])[];
}

/** Ground the caller will not let a walk enter: fog, or anything else. */
export type CanEnter = (point: LonLat) => boolean;

/** A point placed on the graph: somewhere along one edge. */
export interface GraphPosition {
  readonly edge: number;
  /** 0 at the edge's `a` node, 1 at its `b` node. */
  readonly t: number;
  readonly point: LonLat;
  /** From the original point to `point`. */
  readonly distanceM: number;
}

export interface SnapOptions {
  readonly maxDistanceM?: number;
  readonly canEnter?: CanEnter;
}

export interface WalkRoute {
  /** From the start position to the end position, graph nodes in between. */
  readonly points: readonly LonLat[];
  /** Node indices passed through, in order. */
  readonly nodes: readonly number[];
  readonly lengthM: number;
  /** Length weighted by surface. What the route minimises. */
  readonly cost: number;
}

export interface RouteOptions {
  /** Nodes failing this are never entered. Checked per node. */
  readonly canEnter?: CanEnter;
}

/** How far every node is from one graph position. */
export interface Reach {
  /** Surface-weighted cost to each node; `Infinity` where unreached. */
  readonly cost: Float64Array;
  /** Metres walked to each node along the cheapest way; `Infinity` likewise. */
  readonly lengthM: Float64Array;
}

/** Core's walking graph object (`WalkGraph` in the Wasm runtime). */
export interface CoreWalkGraphNative {
  node_coordinates(): Float64Array;
  edge_nodes(): Uint32Array;
  edge_lengths(): Float64Array;
  edge_surfaces(): Uint8Array;
  edge_bridges(): Uint8Array;
  adjacency_offsets(): Uint32Array;
  adjacency_edges(): Uint32Array;
  snap_candidates(
    longitude: number,
    latitude: number,
    maxDistanceM: number,
  ): Float64Array;
  route(
    fromEdge: number,
    fromT: number,
    fromLongitude: number,
    fromLatitude: number,
    toEdge: number,
    toT: number,
    toLongitude: number,
    toLatitude: number,
    enterable?: Uint8Array,
  ): CoreWalkRouteNative | undefined;
  reach(
    fromEdge: number,
    fromT: number,
    maxCost: number,
    enterable?: Uint8Array,
  ): CoreWalkReachNative;
}

export interface CoreWalkRouteNative {
  length_m(): number;
  cost(): number;
  nodes(): Uint32Array;
  points(): Float64Array;
  free(): void;
}

export interface CoreWalkReachNative {
  cost(): Float64Array;
  length_m(): Float64Array;
  free(): void;
}

/** The part of Core's Wasm runtime this package uses. */
export interface WalkGraphCore {
  readonly WalkGraph: {
    build(
      features: string,
      linePoints: Uint32Array,
      coordinates: Float64Array,
    ): CoreWalkGraphNative | undefined;
    surface_names(): string;
  };
  walk_surface_of(kind: string, kindDetail?: string): string | undefined;
  walk_surface_weights(): Float64Array;
  walk_grass_weight(): number;
  walk_snap_distance_m(): number;
}

interface Installed {
  readonly core: WalkGraphCore;
  readonly surfaces: readonly Surface[];
  readonly weights: Readonly<Record<Surface, number>>;
  readonly grass: number;
  readonly snapM: number;
}

const SURFACES = new Set<string>([
  "footway",
  "track",
  "steps",
  "street",
  "carriageway",
]);

let installed: Installed | undefined;
const natives = new WeakMap<WalkGraph, CoreWalkGraphNative>();

/**
 * Hands this package Core's walking graph, once the runtime has loaded. Until
 * then there is no graph and nothing walks.
 */
export function installWalkGraphCore(core: WalkGraphCore): void {
  const surfaces = core.WalkGraph.surface_names().split(",");
  const weights = core.walk_surface_weights();
  if (
    surfaces.length !== weights.length ||
    !surfaces.every((surface) => SURFACES.has(surface))
  )
    throw new Error("0x1 Core returned an unknown walking surface table");
  installed = {
    core,
    surfaces: surfaces as Surface[],
    weights: Object.fromEntries(
      surfaces.map((surface, index) => [surface, weights[index]!]),
    ) as Record<Surface, number>,
    grass: core.walk_grass_weight(),
    snapM: core.walk_snap_distance_m(),
  };
}

/** Whether Core's walking graph is installed. */
export function walkGraphCoreInstalled(): boolean {
  return installed !== undefined;
}

/** Farthest a point may be from the graph and still be on it; 0 before Core. */
export function snapDistanceM(): number {
  return installed?.snapM ?? 0;
}

/** Cost of one metre of grass; nothing is cheap enough before Core. */
export function grassWeight(): number {
  return installed?.grass ?? Infinity;
}

/** Cost of one metre on a surface; nothing is walkable before Core. */
export function surfaceWeight(surface: Surface): number {
  return installed?.weights[surface] ?? Infinity;
}

/** The dearest surface's weight per metre; `Infinity` before Core. */
export function maxSurfaceWeight(): number {
  return installed === undefined
    ? Infinity
    : Math.max(...Object.values(installed.weights));
}

/**
 * Core's classification of one `roads` feature. `null` means it is not
 * walked along, and before Core nothing is.
 */
export function surfaceOf(
  kind: string,
  kindDetail?: string | undefined,
): Surface | null {
  const surface = installed?.core.walk_surface_of(kind, kindDetail);
  return surface !== undefined && SURFACES.has(surface)
    ? (surface as Surface)
    : null;
}

/** Cost of walking an edge end to end. */
export function edgeCost(edge: WalkEdge): number {
  return edge.lengthM * surfaceWeight(edge.surface);
}

const EMPTY: WalkGraph = Object.freeze({
  nodes: [],
  edges: [],
  adjacency: [],
});

/** Core builds the graph; the result is plain data plus Core's own copy. */
export function buildWalkGraph(features: readonly RoadFeature[]): WalkGraph {
  if (installed === undefined) return EMPTY;
  const shapes = features.map((feature) => ({
    kind: feature.kind,
    ...(feature.kindDetail === undefined
      ? {}
      : { kind_detail: feature.kindDetail }),
    ...(feature.isBridge === true ? { is_bridge: true } : {}),
    lines: feature.lines.length,
  }));
  const linePoints = new Uint32Array(
    features.flatMap((feature) => feature.lines.map((line) => line.length)),
  );
  const coordinates = new Float64Array(
    linePoints.reduce((n, m) => n + m, 0) * 2,
  );
  let at = 0;
  for (const feature of features)
    for (const line of feature.lines)
      for (const point of line) {
        coordinates[at++] = point[0];
        coordinates[at++] = point[1];
      }
  const native = installed.core.WalkGraph.build(
    JSON.stringify(shapes),
    linePoints,
    coordinates,
  );
  if (native === undefined) return EMPTY;
  const graph = describe(native, installed.surfaces);
  natives.set(graph, native);
  return graph;
}

function describe(
  native: CoreWalkGraphNative,
  surfaces: readonly Surface[],
): WalkGraph {
  const coordinates = native.node_coordinates();
  const nodes: LonLat[] = [];
  for (let i = 0; i < coordinates.length; i += 2)
    nodes.push([coordinates[i]!, coordinates[i + 1]!]);
  const ends = native.edge_nodes();
  const lengths = native.edge_lengths();
  const codes = native.edge_surfaces();
  const bridges = native.edge_bridges();
  const edges: WalkEdge[] = Array.from(lengths, (lengthM, index) => {
    const surface = surfaces[codes[index]!];
    if (surface === undefined)
      throw new Error("0x1 Core returned an unknown walking surface");
    return {
      a: ends[2 * index]!,
      b: ends[2 * index + 1]!,
      lengthM,
      surface,
      bridge: bridges[index] === 1,
    };
  });
  const offsets = native.adjacency_offsets();
  const flat = native.adjacency_edges();
  const adjacency = nodes.map((_, index) =>
    Array.from(flat.subarray(offsets[index]!, offsets[index + 1]!)),
  );
  return { nodes, edges, adjacency };
}

function enterable(
  graph: WalkGraph,
  canEnter: CanEnter | undefined,
): Uint8Array | undefined {
  if (canEnter === undefined) return undefined;
  return Uint8Array.from(graph.nodes, (node) => (canEnter(node) ? 1 : 0));
}

/**
 * The nearest place on the graph the caller may enter within `maxDistanceM`
 * (Core's snap distance by default), or `null`.
 */
export function snapToGraph(
  graph: WalkGraph,
  point: LonLat,
  options: SnapOptions = {},
): GraphPosition | null {
  const native = natives.get(graph);
  if (native === undefined) return null;
  const candidates = native.snap_candidates(
    point[0],
    point[1],
    options.maxDistanceM ?? snapDistanceM(),
  );
  for (let i = 0; i + 4 < candidates.length; i += 5) {
    const at: LonLat = [candidates[i + 2]!, candidates[i + 3]!];
    if (options.canEnter !== undefined && !options.canEnter(at)) continue;
    return {
      edge: candidates[i]!,
      t: candidates[i + 1]!,
      point: at,
      distanceM: candidates[i + 4]!,
    };
  }
  return null;
}

/** The cheapest walk between two graph positions, as Core routes it. */
export function routeOnGraph(
  graph: WalkGraph,
  from: GraphPosition,
  to: GraphPosition,
  options: RouteOptions = {},
): WalkRoute | null {
  const native = natives.get(graph);
  if (native === undefined) return null;
  const route = native.route(
    from.edge,
    from.t,
    from.point[0],
    from.point[1],
    to.edge,
    to.t,
    to.point[0],
    to.point[1],
    enterable(graph, options.canEnter),
  );
  if (route === undefined) return null;
  try {
    const flat = route.points();
    const points: LonLat[] = [];
    for (let i = 0; i < flat.length; i += 2)
      points.push([flat[i]!, flat[i + 1]!]);
    return {
      points,
      nodes: Array.from(route.nodes()),
      lengthM: route.length_m(),
      cost: route.cost(),
    };
  } finally {
    route.free();
  }
}

/**
 * The cheapest way from one position to every node at once, as Core reaches
 * it. Nodes costing more than `maxCost` are left unreached.
 */
export function reachFrom(
  graph: WalkGraph,
  from: GraphPosition,
  options: RouteOptions & { readonly maxCost?: number } = {},
): Reach {
  const native = natives.get(graph);
  if (native === undefined)
    return {
      cost: new Float64Array(graph.nodes.length).fill(Infinity),
      lengthM: new Float64Array(graph.nodes.length).fill(Infinity),
    };
  const reach = native.reach(
    from.edge,
    from.t,
    options.maxCost ?? Infinity,
    enterable(graph, options.canEnter),
  );
  try {
    return { cost: reach.cost(), lengthM: reach.length_m() };
  } finally {
    reach.free();
  }
}
