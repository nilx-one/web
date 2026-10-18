// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  routeOnGraph,
  snapToGraph,
  type LonLat,
  type WalkGraph,
} from "@nilx-one/walk-graph";
import {
  flightPath,
  localFrame,
  pathAt,
  type FlightPath,
  type LocalFrame,
} from "../flyover/flyover-flight";
import {
  AMBIENT_HOVER_MS,
  AMBIENT_LEG_MS,
  type AmbientLegTime,
} from "./ambient-drone-schedule";

/**
 * One leg of an ambient drone's flight, planned once and then only sampled.
 *
 * Between two waypoints a drone follows the road graph it was given: the
 * streets for a cargo drone, footways and yards for a scout. It keeps low
 * only over the graph, where the way is open. A waypoint inside a block, the
 * stretch from it to the nearest road, and a whole leg the graph cannot carry
 * are flown over the roofs instead, climbing for them.
 */

/** How far a waypoint may be from the graph and still be joined to it. */
export const AMBIENT_SNAP_METERS = 120;
/** A detour longer than this many times the straight line goes over the roofs. */
export const AMBIENT_MAX_DETOUR = 2.4;
/** Height off the graph, clear of most of the city's roofs. */
export const AMBIENT_ROOFTOP_METERS = 46;
/** A waypoint this close to the graph counts as on it. */
const ON_GRAPH_METERS = 15;
/** The climb or descent between roof height and the graph is spread over this. */
const CLIMB_METERS = 50;
const MAX_ROLL_DEG = 28;
const MAX_PITCH_DEG = 11;
const GRAVITY = 9.81;
const HEADING_PROBE_METERS = 6;
const DEG = 180 / Math.PI;

export interface AmbientLeg {
  readonly frame: LocalFrame;
  readonly path: FlightPath;
  /** Along roads, or straight over the roofs. */
  readonly routed: boolean;
  /**
   * The stretch flown low, along the path: from `lowFrom` to `lowTo`. Either
   * end is open when its waypoint stands on the graph; a leg with nothing
   * low has `lowFrom` past `lowTo`.
   */
  readonly lowFrom: number;
  readonly lowTo: number;
  readonly startBearingDeg: number;
  readonly endBearingDeg: number;
}

/** How a drone arrived at the waypoint a leg starts from. */
export interface AmbientArrival {
  readonly bearingDeg: number;
  readonly heightMeters: number;
}

export interface AmbientSample {
  readonly lngLat: LonLat;
  readonly bearingDeg: number;
  readonly heightMeters: number;
  readonly rollDeg: number;
  readonly pitchDeg: number;
}

function compass([east, north]: readonly [number, number]): number {
  return (((Math.atan2(east, north) * DEG) % 360) + 360) % 360;
}

/** The signed turn from one bearing to another, the short way round. */
export function turnBetween(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function smoothstep(value: number): number {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

export function planAmbientLeg(
  from: LonLat,
  to: LonLat,
  graph: WalkGraph | undefined,
): AmbientLeg {
  const frame = localFrame(from);
  let points: readonly LonLat[] = [from, to];
  let routed = false;
  let lowFrom = Infinity;
  let lowTo = -Infinity;
  if (graph !== undefined && graph.edges.length > 0) {
    const options = { maxDistanceM: AMBIENT_SNAP_METERS };
    const start = snapToGraph(graph, from, options);
    const end = snapToGraph(graph, to, options);
    const route =
      start === null || end === null ? null : routeOnGraph(graph, start, end);
    const [ex, ey] = frame.toLocal(to);
    const straight = Math.max(40, Math.hypot(ex, ey));
    if (
      start !== null &&
      end !== null &&
      route !== null &&
      route.lengthM <= straight * AMBIENT_MAX_DETOUR
    ) {
      points = [from, ...route.points, to];
      routed = true;
      lowFrom =
        start.distanceM <= ON_GRAPH_METERS ? -Infinity : start.distanceM;
      lowTo = end.distanceM <= ON_GRAPH_METERS ? Infinity : -end.distanceM;
    }
  }
  const path = flightPath(points.map(frame.toLocal));
  return {
    frame,
    path,
    routed,
    lowFrom,
    // Counted from the end until here, where the path's length is known.
    lowTo:
      lowTo === Infinity || lowTo === -Infinity ? lowTo : path.length + lowTo,
    startBearingDeg: compass(pathAt(path, 0).direction),
    endBearingDeg: compass(pathAt(path, path.length).direction),
  };
}

/** The drone's height at a distance along its leg. */
export function heightAlong(
  leg: AmbientLeg,
  distance: number,
  lowMeters: number,
): number {
  const roof = Math.max(lowMeters, AMBIENT_ROOFTOP_METERS);
  if (!(leg.lowFrom < leg.lowTo)) return roof;
  const low =
    smoothstep((distance - leg.lowFrom) / CLIMB_METERS) *
    smoothstep((leg.lowTo - distance) / CLIMB_METERS);
  return roof + (lowMeters - roof) * low;
}

/** How a drone that flew this whole leg arrives at its end. */
export function arrivalOf(leg: AmbientLeg, lowMeters: number): AmbientArrival {
  return {
    bearingDeg: leg.endBearingDeg,
    heightMeters: heightAlong(leg, leg.path.length, lowMeters),
  };
}

/**
 * Where a drone is on its leg. It hovers at the start, turning from the way
 * it came to the way it is about to go and rising or settling to the height
 * it leaves at, then eases out, crosses and eases in, banking into bends and
 * leaning into speed. The end of one leg is the start of the next, so a
 * drone moves continuously from leg to leg.
 */
export function sampleAmbientLeg(
  leg: AmbientLeg,
  time: AmbientLegTime,
  lowMeters: number,
  arrived?: AmbientArrival,
): AmbientSample {
  const { path, frame } = leg;
  if (time.flight <= 0) {
    const ease = smoothstep(time.hover);
    const departure = heightAlong(leg, 0, lowMeters);
    const fromBearing = arrived?.bearingDeg ?? leg.startBearingDeg;
    const fromHeight = arrived?.heightMeters ?? departure;
    const bearingDeg =
      fromBearing + turnBetween(fromBearing, leg.startBearingDeg) * ease;
    return {
      lngLat: frame.toLonLat(path.points[0] ?? [0, 0]),
      bearingDeg: ((bearingDeg % 360) + 360) % 360,
      heightMeters: fromHeight + (departure - fromHeight) * ease,
      rollDeg: 0,
      pitchDeg: 0,
    };
  }
  const length = path.length;
  const f = Math.min(1, time.flight);
  const distance = smoothstep(f) * length;
  const { point, direction } = pathAt(path, distance);
  const travelSeconds = (AMBIENT_LEG_MS - AMBIENT_HOVER_MS) / 1000;
  const speed = (length * 6 * f * (1 - f)) / travelSeconds;
  const ahead = compass(
    pathAt(path, distance + HEADING_PROBE_METERS).direction,
  );
  const behind = compass(
    pathAt(path, distance - HEADING_PROBE_METERS).direction,
  );
  const curvature =
    turnBetween(behind, ahead) / DEG / (2 * HEADING_PROBE_METERS);
  const rollDeg = Math.max(
    -MAX_ROLL_DEG,
    Math.min(
      MAX_ROLL_DEG,
      Math.atan((speed * speed * curvature) / GRAVITY) * DEG,
    ),
  );
  return {
    lngLat: frame.toLonLat(point),
    bearingDeg: compass(direction),
    heightMeters: heightAlong(leg, distance, lowMeters),
    rollDeg,
    pitchDeg: Math.min(MAX_PITCH_DEG, speed * 0.7),
  };
}
