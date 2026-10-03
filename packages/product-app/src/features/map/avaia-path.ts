// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapObstacle,
  type MapPointSelection,
  type MapRoad,
} from "@nilx-one/map-contract";
import {
  buildWalkGraph,
  GRASS_WEIGHT,
  routeOnGraph,
  snapToGraph,
} from "@nilx-one/walk-graph";

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
 * Like the walk it plans, a path is presentation: not observed, not persisted
 * and never presence evidence.
 */
export type WalkChooser = "tap" | "own";

/** How much shorter a cut across the grass must be for an Avaia to take it. */
export const SHORTCUT_GAIN = 0.35;

/** The longest cut across the grass an Avaia takes on its own. */
export const SHORTCUT_MAX_METERS = 60;

export function planWalk({
  from,
  to,
  roads,
  obstacles,
  chooser,
}: {
  readonly from: MapPointSelection;
  readonly to: MapPointSelection;
  readonly roads: readonly MapRoad[];
  readonly obstacles: readonly MapObstacle[];
  readonly chooser: WalkChooser;
}): AvaiaRoute {
  const across = planRoute(from, to, obstacles);
  const along = alongPaths(from, to, roads, obstacles);
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
  readonly route: AvaiaRoute & { readonly kind: "route" };
  readonly meters: number;
  readonly cost: number;
}

function alongPaths(
  from: MapPointSelection,
  to: MapPointSelection,
  roads: readonly MapRoad[],
  obstacles: readonly MapObstacle[],
): AlongPaths | undefined {
  if (roads.length === 0) return undefined;
  const graph = buildWalkGraph(roads);
  const start = snapToGraph(graph, [from.longitude, from.latitude]);
  const end = snapToGraph(graph, [to.longitude, to.latitude]);
  if (start === null || end === null) return undefined;
  const route = routeOnGraph(graph, start, end);
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
  return {
    route: { kind: "route", path },
    meters: route.lengthM + grassMeters,
    cost: route.cost + grassMeters * GRASS_WEIGHT,
  };
}

function point([longitude, latitude]: readonly [
  number,
  number,
]): MapPointSelection {
  return { longitude, latitude };
}

function pathMeters(path: readonly MapPointSelection[]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    meters += mapDistanceMeters(path[i - 1]!, path[i]!);
  }
  return meters;
}
