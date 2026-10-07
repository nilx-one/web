// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  canPickUp,
  epochOf,
  FIND_OFFSET_METERS,
  FIND_PACK_ID,
  isFindPerceptible,
  rollAlong,
  ROLL_TABLE,
  segmentAt,
  type FindRoll,
} from "@nilx-one/artifact-contract";
import type {
  AvaiaDrivePassing,
  AvaiaDriveTarget,
} from "@nilx-one/application";
import {
  mapDistanceMeters,
  type MapArea,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import {
  distanceM,
  projectOnSegment,
  reachFrom,
  snapToGraph,
  type LonLat,
  type WalkGraph,
} from "@nilx-one/walk-graph";

import type { OutingTarget } from "./outing-targets";
import {
  feelingFor,
  lingerMs,
  outingAppeal,
  returnAfterMs,
  type PlaceAffinity,
} from "./place-affinity";

/**
 * The world layer the Avaia's drive in Core stands on (`docs/avaia-drive.md`
 * in core): what this device resolves the ground into before the drive sees
 * it, and back again when the drive answers.
 *
 * The drive never sees a place. Everything it is offered is an opaque ref this
 * module minted, with whole metres; everything it answers names one of those
 * refs, which `DriveRefs` turns back into ground. Nothing here decides what
 * the Avaia does: it only says what is there.
 */

/** What a ref stands for on this device. */
export type DriveRefEntry =
  | { readonly kind: "point"; readonly point: MapPointSelection }
  | {
      readonly kind: "landmark";
      readonly point: MapPointSelection;
      readonly landmark: MapLandmark;
    }
  | {
      readonly kind: "target";
      readonly point: MapPointSelection;
      readonly target: OutingTarget;
    }
  | {
      readonly kind: "area";
      readonly point: MapPointSelection;
      readonly landmark: MapLandmark;
    }
  | {
      readonly kind: "find";
      readonly point: MapPointSelection;
      readonly roll: FindRoll;
    };

/** The most refs one page keeps; the oldest are forgotten first. */
export const DRIVE_REFS_LIMIT = 512;

/** How far ahead of the body something on the way is noticed. */
export const NOTICE_AHEAD_METERS = 40;

/** How far off the way a sight is reported at all; the drive decides nearer. */
export const SIGHT_OFF_ROUTE_METERS = 30;

/** The most graph nodes offered for a stroll or a wander. */
const NODES_LIMIT = 128;

const point = ([longitude, latitude]: LonLat): MapPointSelection => ({
  longitude,
  latitude,
});
const lonLat = (at: MapPointSelection): LonLat => [at.longitude, at.latitude];

/**
 * Refs the drive may be handed and hands back. The same thing gets the same
 * ref for as long as the page is open, so the drive's memory of what it saw
 * on a walk and what it visited holds.
 */
export class DriveRefs {
  private readonly entries = new Map<string, DriveRefEntry>();
  private taps = 0;

  get(ref: string): DriveRefEntry | undefined {
    return this.entries.get(ref);
  }

  private keep(ref: string, entry: DriveRefEntry): string {
    this.entries.delete(ref);
    this.entries.set(ref, entry);
    while (this.entries.size > DRIVE_REFS_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return ref;
  }

  /** A point B its owner set. Every tap is a new one. */
  tap(at: MapPointSelection): string {
    this.taps += 1;
    return this.keep(`b:${this.taps}`, { kind: "point", point: at });
  }

  /** Somewhere on the ground with no name: a graph node, home. */
  point(at: MapPointSelection, name?: string): string {
    return this.keep(
      name ?? `n:${at.longitude.toFixed(6)},${at.latitude.toFixed(6)}`,
      { kind: "point", point: at },
    );
  }

  landmark(landmark: MapLandmark): string {
    return this.keep(`lm:${landmark.id}`, {
      kind: "landmark",
      point: { longitude: landmark.longitude, latitude: landmark.latitude },
      landmark,
    });
  }

  target(target: OutingTarget): string {
    return this.keep(`t:${target.id}`, {
      kind: "target",
      point: point(target.anchor),
      target,
    });
  }

  /** An area seen on the way, at the place on its edge nearest the walk. */
  area(area: MapArea, at: MapPointSelection): string {
    return this.keep(`a:${area.id}`, {
      kind: "area",
      point: at,
      landmark: {
        id: area.id,
        kind: area.kind,
        name: area.name,
        longitude: at.longitude,
        latitude: at.latitude,
        facts: {},
      },
    });
  }

  find(roll: FindRoll, at: MapPointSelection): string {
    return this.keep(`f:${roll.artifactId}`, { kind: "find", point: at, roll });
  }
}

/** Nodes in order, `lengthM` within `[min, max]`, the first `NODES_LIMIT`. */
function nodesWithin(
  graph: WalkGraph,
  lengthM: Float64Array,
  [min, max]: readonly [number, number],
  keep: (node: LonLat) => boolean = () => true,
): LonLat[] {
  const nodes: LonLat[] = [];
  for (let index = 0; index < graph.nodes.length; index++) {
    if (nodes.length === NODES_LIMIT) break;
    const meters = lengthM[index]!;
    const node = graph.nodes[index]!;
    if (meters >= min && meters <= max && keep(node)) nodes.push(node);
  }
  return nodes;
}

/**
 * Where a stroll may go: graph nodes `min`–`max` m along the paths from the
 * body and within `leash` of `anchor`, in graph order. Off the paths, the
 * nearest node within `max` is the way back to them; with none, nothing.
 */
export function strollNodes(input: {
  readonly graph: WalkGraph;
  readonly from: MapPointSelection;
  readonly anchor: MapPointSelection;
  readonly minM: number;
  readonly maxM: number;
  readonly leashM: number;
  readonly canEnter?: ((at: LonLat) => boolean) | undefined;
}): MapPointSelection[] {
  const { graph, canEnter } = input;
  const from = lonLat(input.from);
  const anchor = lonLat(input.anchor);
  const start = snapToGraph(graph, from, canEnter ? { canEnter } : {});
  if (start === null) {
    let best: LonLat | undefined;
    let bestM = input.maxM;
    for (const node of graph.nodes) {
      const meters = distanceM(node, from);
      if (meters <= bestM && (canEnter?.(node) ?? true)) {
        best = node;
        bestM = meters;
      }
    }
    return best === undefined ? [] : [point(best)];
  }
  const reach = reachFrom(graph, start, {
    maxCost: input.maxM * 3,
    ...(canEnter ? { canEnter } : {}),
  });
  return nodesWithin(
    graph,
    reach.lengthM,
    [input.minM, input.maxM],
    (node) => distanceM(node, anchor) <= input.leashM,
  ).map(point);
}

/** Where a wander may go: graph nodes `min`–`max` m along the paths. */
export function wanderNodes(input: {
  readonly graph: WalkGraph;
  readonly from: MapPointSelection;
  readonly range: readonly [number, number];
  readonly canEnter?: ((at: LonLat) => boolean) | undefined;
}): MapPointSelection[] {
  const { graph, canEnter } = input;
  const start = snapToGraph(
    graph,
    lonLat(input.from),
    canEnter ? { canEnter } : {},
  );
  if (start === null) return [];
  const reach = reachFrom(graph, start, {
    maxCost: input.range[1] * 3,
    ...(canEnter ? { canEnter } : {}),
  });
  return nodesWithin(graph, reach.lengthM, input.range).map(point);
}

/**
 * An outing target as the drive reads it: its kind and metres, and what the
 * Avaia's record of places says about it.
 */
export function outingTarget(
  ref: string,
  target: OutingTarget,
  affinity: PlaceAffinity,
  now: number,
  budgetMeters: number,
  revisitMs: number,
): AvaiaDriveTarget {
  return {
    ref,
    kind: target.kind,
    meters: Math.round(target.meters),
    appeal: Math.round(
      Math.min(
        1,
        Math.max(0, outingAppeal(affinity, target, now, budgetMeters)),
      ) * 1000,
    ),
    feeling: feelingFor(affinity, target.id, now),
    stay_ms: String(lingerMs(affinity, target, now)),
    revisit_ms: String(returnAfterMs(affinity, target.id, revisitMs)),
  };
}

/** A find on the walk, where it lies on the ground. */
export interface PlacedFind {
  readonly roll: FindRoll;
  readonly point: MapPointSelection;
}

/** How finely a walk is sampled to lay finds on it, in metres. */
const SAMPLE_METERS = 1;

/**
 * The finds a walk passes that the Avaia sees and may pick up itself, laid on
 * the ground: `placement.along` of the way the walk runs through the find's
 * segment, `placement.across` of `FIND_OFFSET_METERS` to its side. The rolls
 * are the same ones the completed walk reports, so stepping aside for one
 * never rolls anything new.
 */
export function findsAlong(
  path: readonly MapPointSelection[],
  nowMs: number,
): PlacedFind[] {
  if (path.length < 2) return [];
  const rolls = rollAlong(path.map(lonLat), {
    packId: FIND_PACK_ID,
    packVersion: ROLL_TABLE.version,
    epoch: epochOf(nowMs),
  }).filter((roll) => isFindPerceptible(roll) && canPickUp(roll, "avaia"));
  if (rolls.length === 0) return [];
  // Where the walk enters and leaves each segment, sampled along it.
  const spans = new Map<string, { from: LonLat; to: LonLat }[]>();
  for (let leg = 1; leg < path.length; leg++) {
    const a = lonLat(path[leg - 1]!);
    const b = lonLat(path[leg]!);
    const steps = Math.max(1, Math.ceil(distanceM(a, b) / SAMPLE_METERS));
    for (let i = 0; i < steps; i++) {
      const p = lerp(a, b, i / steps);
      const q = lerp(a, b, (i + 1) / steps);
      const segment = segmentAt(lerp(p, q, 0.5));
      const runs = spans.get(segment) ?? [];
      const last = runs[runs.length - 1];
      if (last !== undefined && last.to[0] === p[0] && last.to[1] === p[1]) {
        last.to = q;
      } else runs.push({ from: p, to: q });
      spans.set(segment, runs);
    }
  }
  return rolls.flatMap((roll) => {
    const run = spans.get(roll.segment)?.[0];
    if (run === undefined) return [];
    const on = lerp(run.from, run.to, roll.placement.along);
    // The side is across the run's own heading.
    const k = Math.cos((on[1] * Math.PI) / 180);
    const dx = (run.to[0] - run.from[0]) * k;
    const dy = run.to[1] - run.from[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return [{ roll, point: point(on) }];
    const metersPerDegree = 111_195;
    const side = (roll.placement.across * FIND_OFFSET_METERS) / metersPerDegree;
    const at: LonLat = [
      on[0] + ((-dy / length) * side) / k,
      on[1] + (dx / length) * side,
    ];
    return [{ roll, point: point(at) }];
  });
}

function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** How far `at` lies from the rest of the walk, and how far along it that is. */
function offRoute(
  path: readonly MapPointSelection[],
  at: MapPointSelection,
): { readonly offM: number; readonly alongM: number } {
  let best = { offM: Infinity, alongM: 0 };
  let walked = 0;
  for (let leg = 1; leg < path.length; leg++) {
    const a = lonLat(path[leg - 1]!);
    const b = lonLat(path[leg]!);
    const projection = projectOnSegment(lonLat(at), a, b);
    if (projection.distanceM < best.offM) {
      best = {
        offM: projection.distanceM,
        alongM: walked + distanceM(a, b) * projection.t,
      };
    }
    walked += distanceM(a, b);
  }
  return best;
}

/** The part of a walk still ahead of the body: from where it is to the end. */
export function wayAhead(
  path: readonly MapPointSelection[],
  along: readonly number[],
  walkedM: number,
  body: MapPointSelection,
): MapPointSelection[] {
  const ahead = [body];
  for (let i = 0; i < path.length; i++) {
    if ((along[i] ?? 0) > walkedM) ahead.push(path[i]!);
  }
  return ahead;
}

/**
 * What the Avaia passes, as the drive reads it: sights and finds within
 * `NOTICE_AHEAD_METERS` ahead along the rest of the walk, each with how far off
 * the way it lies. The drive decides what is near enough to step aside for.
 */
export function passingThings(input: {
  readonly refs: DriveRefs;
  /** The rest of the walk, from the body. */
  readonly ahead: readonly MapPointSelection[];
  readonly landmarks: readonly MapLandmark[];
  readonly areas: readonly MapArea[];
  readonly finds: readonly PlacedFind[];
  /** Landmarks the owner walked past that this Avaia has not studied. */
  readonly studyable: ReadonlySet<string>;
}): AvaiaDrivePassing[] {
  const { refs, ahead } = input;
  if (ahead.length < 2) return [];
  const seen = (at: MapPointSelection, offLimit: number) => {
    const { offM, alongM } = offRoute(ahead, at);
    return offM <= offLimit && alongM <= NOTICE_AHEAD_METERS
      ? Math.round(offM)
      : undefined;
  };
  const things: AvaiaDrivePassing[] = [];
  for (const found of input.finds) {
    const off = seen(found.point, FIND_OFFSET_METERS);
    if (off === undefined) continue;
    things.push({
      ref: refs.find(found.roll, found.point),
      kind: "find",
      group: "find",
      off_route_m: off,
    });
  }
  for (const landmark of input.landmarks) {
    const off = seen(landmark, SIGHT_OFF_ROUTE_METERS);
    if (off === undefined || !/^[a-z][a-z_]{0,31}$/.test(landmark.kind)) {
      continue;
    }
    things.push({
      ref: refs.landmark(landmark),
      kind: landmark.kind,
      group: "landmark",
      off_route_m: off,
      ...(input.studyable.has(landmark.id) ? { studyable: true } : {}),
    });
  }
  for (const area of input.areas) {
    const edge = nearestEdge(area, ahead[0]!);
    if (edge === undefined || !/^[a-z][a-z_]{0,31}$/.test(area.kind)) {
      continue;
    }
    const off = seen(edge, SIGHT_OFF_ROUTE_METERS);
    if (off === undefined) continue;
    things.push({
      ref: refs.area(area, edge),
      kind: area.kind,
      group: "area",
      off_route_m: off,
    });
  }
  return things;
}

/** The point on an area's outer rings nearest `to`. */
function nearestEdge(
  area: MapArea,
  to: MapPointSelection,
): MapPointSelection | undefined {
  let best: { at: LonLat; meters: number } | undefined;
  for (const polygon of area.polygons) {
    const ring = polygon[0];
    if (ring === undefined) continue;
    for (let i = 1; i < ring.length; i++) {
      const projection = projectOnSegment(lonLat(to), ring[i - 1]!, ring[i]!);
      if (best === undefined || projection.distanceM < best.meters) {
        best = { at: projection.point, meters: projection.distanceM };
      }
    }
  }
  return best === undefined ? undefined : point(best.at);
}

/** Whole metres between two points, as the drive reads distance. */
export function wholeMeters(
  a: MapPointSelection,
  b: MapPointSelection,
): number {
  return Math.round(mapDistanceMeters(a, b));
}
