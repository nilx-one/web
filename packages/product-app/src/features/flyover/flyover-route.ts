// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapBounds } from "@nilx-one/map-contract";
import {
  buildWalkGraph,
  routeOnGraph,
  snapToGraph,
  type LonLat,
  type RoadFeature,
} from "@nilx-one/walk-graph";

/**
 * How far an end of the flyover may stand from the road graph and still be
 * joined to it. xPing flies, so the first and last stretch may cross a yard
 * or a square; any further and the graph is not where it is going.
 */
export const FLYOVER_SNAP_METERS = 250;

/** Room around both ends when reading roads, for a route that bends away. */
export const FLYOVER_ROAD_MARGIN_METERS = 400;

/** The box of roads a flyover from `from` to `to` reads before it starts. */
export function flyoverRoadBounds(from: LonLat, to: LonLat): MapBounds {
  const latitude = (from[1] + to[1]) / 2;
  const marginLatitude = FLYOVER_ROAD_MARGIN_METERS / 111_195;
  const marginLongitude =
    marginLatitude / Math.max(0.1, Math.cos((latitude * Math.PI) / 180));
  return {
    west: Math.min(from[0], to[0]) - marginLongitude,
    east: Math.max(from[0], to[0]) + marginLongitude,
    south: Math.min(from[1], to[1]) - marginLatitude,
    north: Math.max(from[1], to[1]) + marginLatitude,
  };
}

/**
 * The flyover's route from A to B, found once on the light road graph: the
 * pedestrian graph an Avaia walks (core docs/xping-flyover.md). Both ends
 * are joined to it; without a path on it, the route is the straight line.
 */
export function planFlyoverRoute(
  from: LonLat,
  to: LonLat,
  roads: readonly RoadFeature[],
): readonly LonLat[] {
  const graph = buildWalkGraph(roads);
  const options = { maxDistanceM: FLYOVER_SNAP_METERS };
  const start = snapToGraph(graph, from, options);
  const end = snapToGraph(graph, to, options);
  const route =
    start === null || end === null ? null : routeOnGraph(graph, start, end);
  if (route === null) return [from, to];
  const points: LonLat[] = [];
  for (const point of [from, ...route.points, to]) {
    const last = points[points.length - 1];
    if (last === undefined || last[0] !== point[0] || last[1] !== point[1])
      points.push(point);
  }
  return points;
}
