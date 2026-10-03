// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The pedestrian graph Avaia walks on, and the router over it.
 *
 * Zero dependency and pure: the graph is built from `roads` features already
 * read out of loaded tiles, and every function here is deterministic over its
 * input. Fetching tiles, reading them from the renderer and drawing grass
 * connectors belong to callers. See docs/avaia-outings.md §0.
 */

export { distanceM, projectOnSegment, type LonLat } from "./geo";
export {
  buildWalkGraph,
  COORDINATE_PRECISION,
  edgeCost,
  STITCH_TOLERANCE_M,
  type RoadFeature,
  type WalkEdge,
  type WalkGraph,
} from "./graph";
export {
  reachFrom,
  routeOnGraph,
  SNAP_DISTANCE_M,
  snapToGraph,
  type CanEnter,
  type GraphPosition,
  type Reach,
  type RouteOptions,
  type SnapOptions,
  type WalkRoute,
} from "./route";
export {
  GRASS_WEIGHT,
  SURFACE_WEIGHT,
  surfaceOf,
  type Surface,
} from "./surface";
