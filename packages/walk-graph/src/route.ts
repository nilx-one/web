// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { projectOnSegment, type LonLat } from "./geo";
import { edgeCost, type WalkGraph } from "./graph";

/**
 * Farthest a point may be from the graph and still be on it. Beyond this the
 * outings plan treats the point as having no line nearby (§0.2).
 */
export const SNAP_DISTANCE_M = 30;

/** Ground the caller will not let a walk enter: fog, or anything else it rules out. */
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

/**
 * The nearest place on the graph to `point`, or `null` when nothing enterable
 * lies within `maxDistanceM`. Ties go to the lower edge index, so the answer
 * depends only on the graph and the point.
 */
export function snapToGraph(
  graph: WalkGraph,
  point: LonLat,
  options: SnapOptions = {},
): GraphPosition | null {
  const maxDistanceM = options.maxDistanceM ?? SNAP_DISTANCE_M;
  let best: GraphPosition | null = null;
  graph.edges.forEach((edge, index) => {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (a === undefined || b === undefined) return;
    const projection = projectOnSegment(point, a, b);
    if (projection.distanceM > maxDistanceM) return;
    if (best !== null && projection.distanceM >= best.distanceM) return;
    if (options.canEnter && !options.canEnter(projection.point)) return;
    best = { edge: index, ...projection };
  });
  return best;
}

export interface WalkRoute {
  /** From the start position to the end position, graph nodes in between. */
  readonly points: readonly LonLat[];
  /** Node indices passed through, in order. Empty when both ends share an edge and no node is passed. */
  readonly nodes: readonly number[];
  readonly lengthM: number;
  /** Length weighted by surface. What the route minimises. */
  readonly cost: number;
}

export interface RouteOptions {
  /** Nodes failing this are never entered. Checked per node, not along edges. */
  readonly canEnter?: CanEnter;
}

/**
 * The cheapest walk between two graph positions, or `null` when none exists.
 *
 * Dijkstra over surface-weighted metres. A pure function: no state, no I/O,
 * and equal inputs give the same route, ties broken by node index.
 */
export function routeOnGraph(
  graph: WalkGraph,
  from: GraphPosition,
  to: GraphPosition,
  options: RouteOptions = {},
): WalkRoute | null {
  const startEdge = graph.edges[from.edge];
  const endEdge = graph.edges[to.edge];
  if (startEdge === undefined || endEdge === undefined) return null;
  const enterable = (node: number) => {
    const point = graph.nodes[node];
    return (
      point !== undefined &&
      (options.canEnter === undefined || options.canEnter(point))
    );
  };

  const n = graph.nodes.length;
  const cost = new Float64Array(n).fill(Infinity);
  const length = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();

  const startCost = edgeCost(startEdge);
  const seeds: readonly [number, number][] = [
    [startEdge.a, from.t],
    [startEdge.b, 1 - from.t],
  ];
  for (const [node, fraction] of seeds) {
    if (!enterable(node)) continue;
    const c = startCost * fraction;
    if (c < cost[node]!) {
      cost[node] = c;
      length[node] = startEdge.lengthM * fraction;
      heap.push(c, node);
    }
  }

  let best: { cost: number; lengthM: number; via: number } | null = null;
  if (from.edge === to.edge) {
    const fraction = Math.abs(from.t - to.t);
    best = {
      cost: startCost * fraction,
      lengthM: startEdge.lengthM * fraction,
      via: -1,
    };
  }

  const endCost = edgeCost(endEdge);
  const tail = (node: number) =>
    node === endEdge.a ? to.t : node === endEdge.b ? 1 - to.t : null;

  for (let top = heap.pop(); top !== null; top = heap.pop()) {
    const [c, node] = top;
    if (done[node] || c > cost[node]!) continue;
    if (best !== null && c >= best.cost) break;
    done[node] = 1;

    const fraction = tail(node);
    if (fraction !== null) {
      const total = c + endCost * fraction;
      if (best === null || total < best.cost) {
        best = {
          cost: total,
          lengthM: length[node]! + endEdge.lengthM * fraction,
          via: node,
        };
      }
    }

    for (const index of graph.adjacency[node] ?? []) {
      const edge = graph.edges[index]!;
      const next = edge.a === node ? edge.b : edge.a;
      if (done[next] || !enterable(next)) continue;
      const nextCost = c + edgeCost(edge);
      if (
        nextCost < cost[next]! ||
        (nextCost === cost[next]! && node < previous[next]!)
      ) {
        cost[next] = nextCost;
        length[next] = length[node]! + edge.lengthM;
        previous[next] = node;
        heap.push(nextCost, next);
      }
    }
  }

  if (best === null) return null;
  const nodes: number[] = [];
  for (let node = best.via; node !== -1; node = previous[node]!) {
    nodes.push(node);
  }
  nodes.reverse();
  return {
    points: [from.point, ...nodes.map((node) => graph.nodes[node]!), to.point],
    nodes,
    lengthM: best.lengthM,
    cost: best.cost,
  };
}

/** How far every node is from one graph position. */
export interface Reach {
  /** Surface-weighted cost to each node; `Infinity` where it cannot be reached. */
  readonly cost: Float64Array;
  /** Metres walked to each node along the cheapest way; `Infinity` likewise. */
  readonly lengthM: Float64Array;
}

/**
 * The cheapest way from one position to every node at once: one Dijkstra
 * instead of one per destination, for choosing among many. Nodes costing more
 * than `maxCost` are left unreached, which also bounds the work.
 */
export function reachFrom(
  graph: WalkGraph,
  from: GraphPosition,
  options: RouteOptions & { readonly maxCost?: number } = {},
): Reach {
  const n = graph.nodes.length;
  const cost = new Float64Array(n).fill(Infinity);
  const lengthM = new Float64Array(n).fill(Infinity);
  const startEdge = graph.edges[from.edge];
  if (startEdge === undefined) return { cost, lengthM };
  const maxCost = options.maxCost ?? Infinity;
  const enterable = (node: number) => {
    const point = graph.nodes[node];
    return (
      point !== undefined &&
      (options.canEnter === undefined || options.canEnter(point))
    );
  };
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  const startCost = edgeCost(startEdge);
  for (const [node, fraction] of [
    [startEdge.a, from.t],
    [startEdge.b, 1 - from.t],
  ] as const) {
    const c = startCost * fraction;
    if (!enterable(node) || c > maxCost || c >= cost[node]!) continue;
    cost[node] = c;
    lengthM[node] = startEdge.lengthM * fraction;
    heap.push(c, node);
  }
  for (let top = heap.pop(); top !== null; top = heap.pop()) {
    const [c, node] = top;
    if (done[node] || c > cost[node]!) continue;
    done[node] = 1;
    for (const index of graph.adjacency[node] ?? []) {
      const edge = graph.edges[index]!;
      const next = edge.a === node ? edge.b : edge.a;
      if (done[next] || !enterable(next)) continue;
      const nextCost = c + edgeCost(edge);
      if (nextCost > maxCost || nextCost >= cost[next]!) continue;
      cost[next] = nextCost;
      lengthM[next] = lengthM[node]! + edge.lengthM;
      heap.push(nextCost, next);
    }
  }
  return { cost, lengthM };
}

/** Binary heap on (cost, node), the node index breaking ties. */
class MinHeap {
  private readonly items: [number, number][] = [];

  push(cost: number, node: number): void {
    const items = this.items;
    items.push([cost, node]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): [number, number] | null {
    const items = this.items;
    const top = items[0];
    if (top === undefined) return null;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && less(items[left]!, items[smallest]!)) {
          smallest = left;
        }
        if (right < items.length && less(items[right]!, items[smallest]!)) {
          smallest = right;
        }
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

function less(x: readonly [number, number], y: readonly [number, number]) {
  return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
}
