// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapFogField,
  type MapObstacle,
  type MapPointSelection,
  type MapRoad,
} from "@nilx-one/map-contract";
import {
  buildWalkGraph,
  GRASS_WEIGHT,
  routeOnGraph,
  snapToGraph,
  type GraphPosition,
  type Surface,
  type WalkGraph,
  type WalkRoute,
} from "@nilx-one/walk-graph";

import type { AvaiaLocomotionMode } from "./avaia-walk";
import { planRoute, type AvaiaRoute } from "./avaia-route";

/**
 * Paths first, grass when it pays (docs/avaia-outings.md §0).
 *
 * An Avaia walks along the footways, tracks and streets the basemap carries
 * whenever there are any, and steps onto open ground for the rest: from where
 * it stands to the nearest line, and from the line to where it is going. Open
 * ground is planned around buildings and water exactly as before
 * (`planRoute`); it is allowed, only dearer, at `GRASS_WEIGHT` a metre.
 *
 * Who chose the destination decides how dear:
 *
 * - `tap`: the owner pointed. Grass is allowed the whole way, and the walk
 *   takes whichever is cheaper, the paths or straight across.
 * - `own`: the Avaia chose. It keeps to the paths, and cuts across only where
 *   that is a real shortcut: at least `SHORTCUT_GAIN` shorter and no longer
 *   than `SHORTCUT_MAX_METERS`. With no line nearby it crosses open ground.
 *
 * An Avaia walks only on open ground (R1): a walk never passes through the
 * fog, on paths or across the grass. When every way there would, the walk is
 * refused as `fog`. Opening the fog is the reveal's job, cell by cell at the
 * edge of what is open, never the walk's.
 *
 * Like the walk it plans, a path is presentation: not observed, not persisted
 * and never presence evidence.
 */
export type WalkChooser = "tap" | "own";

/** How much shorter a cut across the grass must be for an Avaia to take it. */
export const SHORTCUT_GAIN = 0.35;

/** The longest cut across the grass an Avaia takes on its own. */
export const SHORTCUT_MAX_METERS = 60;

/**
 * How closely a planned walk is checked for fog. A fog cell is about 175 m
 * across, so nothing can hide between two checks.
 */
export const FOG_CHECK_METERS = 10;

/** Where a body may set foot. */
export type OpenGround = (point: MapPointSelection) => boolean;

export interface PlannedWalkRoute {
  readonly kind: "route";
  readonly path: readonly MapPointSelection[];
  /**
   * Fastest gait this route's observed surface supports. Distance still
   * decides whether that gait is actually selected.
   */
  readonly maxLocomotion: AvaiaLocomotionMode;
}

/** A planned walk, or what stood in the way: a building, water, or fog. */
export type WalkPlan =
  | PlannedWalkRoute
  | { readonly kind: "blocked"; readonly by: MapObstacle["kind"] | "fog" };

const FOG: WalkPlan = { kind: "blocked", by: "fog" };

function planned(
  route: AvaiaRoute,
  maxLocomotion: AvaiaLocomotionMode,
): WalkPlan {
  return route.kind === "route" ? { ...route, maxLocomotion } : route;
}

/**
 * The ground a body may walk on while `fog` is drawn: revealed cells, the
 * Bond's own cell and the ground within `nearDeviceMeters` of it — the Bond
 * is never in the fog — and the cell the body already stands in, so it can
 * always walk out of where it is. `undefined` when no fog is drawn: then all
 * ground is open, as it is on a renderer with no fog.
 */
export function openGround({
  fog,
  device,
  body,
  nearDeviceMeters,
}: {
  readonly fog: MapFogField | undefined;
  readonly device: MapPointSelection | undefined;
  readonly body: MapPointSelection;
  readonly nearDeviceMeters: number;
}): OpenGround | undefined {
  if (fog === undefined || !fog.isActive()) return undefined;
  const own = device === undefined ? undefined : fog.cellAt(device).id;
  const standing = fog.cellAt(body).id;
  return (point) => {
    const cell = fog.cellAt(point).id;
    return (
      cell === standing ||
      cell === own ||
      fog.isRevealed(cell) ||
      (device !== undefined &&
        mapDistanceMeters(device, point) <= nearDeviceMeters)
    );
  };
}

export function planWalk({
  from,
  to,
  roads,
  obstacles,
  chooser,
  open,
}: {
  readonly from: MapPointSelection;
  readonly to: MapPointSelection;
  readonly roads: readonly MapRoad[];
  readonly obstacles: readonly MapObstacle[];
  readonly chooser: WalkChooser;
  /** Where a body may set foot. Omitted, all ground is open. */
  readonly open?: OpenGround | undefined;
}): WalkPlan {
  const straight = planRoute(from, to, obstacles);
  const across =
    straight.kind === "route" && !stays(straight.path, open)
      ? FOG
      : planned(straight, "jog");
  const along = alongPaths(from, to, roads, obstacles, open);
  if (along === undefined) return across;
  if (across.kind === "blocked") return along.route;
  const acrossMeters = pathMeters(across.path);
  const cut =
    chooser === "tap"
      ? acrossMeters * GRASS_WEIGHT < along.cost
      : acrossMeters <= SHORTCUT_MAX_METERS &&
        acrossMeters <= (1 - SHORTCUT_GAIN) * along.meters;
  return cut ? across : along.route;
}

interface AlongPaths {
  readonly route: PlannedWalkRoute;
  readonly meters: number;
  readonly cost: number;
}

function alongPaths(
  from: MapPointSelection,
  to: MapPointSelection,
  roads: readonly MapRoad[],
  obstacles: readonly MapObstacle[],
  open: OpenGround | undefined,
): AlongPaths | undefined {
  if (roads.length === 0) return undefined;
  const graph = buildWalkGraph(roads);
  const canEnter =
    open === undefined
      ? undefined
      : ([longitude, latitude]: readonly [number, number]) =>
          open({ longitude, latitude });
  const options = canEnter === undefined ? {} : { canEnter };
  const start = snapToGraph(graph, [from.longitude, from.latitude], options);
  const end = snapToGraph(graph, [to.longitude, to.latitude], options);
  if (start === null || end === null) return undefined;
  const route = routeOnGraph(graph, start, end, options);
  if (route === null) return undefined;

  const onto = planRoute(from, point(start.point), obstacles);
  const off = planRoute(point(end.point), to, obstacles);
  if (onto.kind === "blocked" || off.kind === "blocked") return undefined;

  const grassMeters = pathMeters(onto.path) + pathMeters(off.path);
  const path: MapPointSelection[] = [];
  for (const next of [
    ...onto.path,
    ...route.points.slice(1, -1).map(point),
    ...off.path,
  ]) {
    const last = path[path.length - 1];
    if (last === undefined || mapDistanceMeters(last, next) > 0.01) {
      path.push(next);
    }
  }
  if (path.length < 2) path.push(to);
  // The graph checks only the nodes it passes; a long edge, or a step on or
  // off the line, may still cut a corner of the fog.
  if (!stays(path, open)) return undefined;
  return {
    route: {
      kind: "route",
      path,
      maxLocomotion: routeLocomotion(graph, start, end, route, grassMeters),
    },
    meters: route.lengthM + grassMeters,
    cost: route.cost + grassMeters * GRASS_WEIGHT,
  };
}

function routeLocomotion(
  graph: WalkGraph,
  start: GraphPosition,
  end: GraphPosition,
  route: WalkRoute,
  grassMeters: number,
): AvaiaLocomotionMode {
  // A connector across unspecified open ground is suitable for a cross/jog,
  // but not enough evidence to call the whole route a running surface.
  if (grassMeters > 0.5) return "jog";

  const edges = new Set<number>([start.edge, end.edge]);
  for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1]!;
    const b = route.nodes[i]!;
    const edge = graph.adjacency[a]?.find((index) => {
      const candidate = graph.edges[index];
      return (
        candidate !== undefined &&
        ((candidate.a === a && candidate.b === b) ||
          (candidate.a === b && candidate.b === a))
      );
    });
    if (edge === undefined) return "walk";
    edges.add(edge);
  }

  let max: AvaiaLocomotionMode = "run";
  for (const index of edges) {
    const surface = graph.edges[index]?.surface;
    if (surface === undefined) return "walk";
    const allowed = surfaceLocomotion(surface);
    if (allowed === "walk") return "walk";
    if (allowed === "jog") max = "jog";
  }
  return max;
}

function surfaceLocomotion(surface: Surface): AvaiaLocomotionMode {
  if (surface === "footway" || surface === "track") return "run";
  if (surface === "street") return "jog";
  return "walk";
}

function point([longitude, latitude]: readonly [
  number,
  number,
]): MapPointSelection {
  return { longitude, latitude };
}

/** Whether every point of `path`, checked every `FOG_CHECK_METERS`, is open. */
function stays(
  path: readonly MapPointSelection[],
  open: OpenGround | undefined,
): boolean {
  if (open === undefined) return true;
  const first = path[0];
  if (first !== undefined && !open(first)) return false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const steps = Math.max(
      1,
      Math.ceil(mapDistanceMeters(a, b) / FOG_CHECK_METERS),
    );
    for (let s = 1; s <= steps; s++) {
      const point = {
        longitude: a.longitude + ((b.longitude - a.longitude) * s) / steps,
        latitude: a.latitude + ((b.latitude - a.latitude) * s) / steps,
      };
      if (!open(point)) return false;
    }
  }
  return true;
}

function pathMeters(path: readonly MapPointSelection[]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    meters += mapDistanceMeters(path[i - 1]!, path[i]!);
  }
  return meters;
}
