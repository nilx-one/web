// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { insideRings, type MapObstacle } from "@nilx-one/map-contract";
import type { LonLat } from "@nilx-one/walk-graph";

/**
 * How xPing flies a flyover route (core docs/xping-flyover.md).
 *
 * The flight is a runner game laid over a real city. xPing keeps to the
 * route at a steady speed; around it lie five lanes, the route's own in the
 * middle. A building ahead it can clear lifts it, one it cannot sends it to
 * the nearest free lane, and once that building is behind it the route
 * pulls it back. A person at the wheel may step it a lane aside; let go, and
 * the route pulls it back too.
 *
 * Pure and deterministic over its inputs: positions are metres on a local
 * plane, and time is whatever the caller says passed.
 */

/** Ground speed along the route. */
export const FLYOVER_SPEED_MPS = 30;
/** Distance between two lanes, about a street's width. */
export const FLYOVER_LANE_METERS = 14;
/** Lanes either side of the route; steering never goes further. */
export const FLYOVER_MAX_LANE = 2;
/** How far ahead xPing reads the buildings it is about to meet. */
export const FLYOVER_LOOKAHEAD_METERS = 110;
/** Over open ground, and over the densest blocks. */
export const FLYOVER_LOW_HEIGHT_METERS = 14;
export const FLYOVER_DENSE_HEIGHT_METERS = 34;
/** Room kept over a roof it clears. */
export const FLYOVER_CLEARANCE_METERS = 7;
/** The tallest climb xPing makes; anything taller it goes around. */
export const FLYOVER_MAX_CLIMB_METERS = 60;
/** How long a step aside holds before the route pulls xPing back. */
export const FLYOVER_STEER_HOLD_MS = 1_400;

/** Spring rates: a lane change snaps, a climb is brisk, a descent glides. */
const LATERAL_RATE = 5.5;
const CLIMB_RATE = 3;
const DESCENT_RATE = 1.1;
const ROLL_RATE = 6;
const MAX_ROLL_DEG = 38;
const CRUISE_PITCH_DEG = 7;
const PROBE_STEP_METERS = 5;
/** Half of xPing's width with some margin, either side of a lane. */
const PROBE_HALF_WIDTH_METERS = 3;
const GRAVITY = 9.81;
const EARTH_RADIUS_METERS = 6_371_008.8;
const RAD = Math.PI / 180;

export type Point = readonly [x: number, y: number];

/** Metres east and north of an origin, on a plane exact enough for a city. */
export interface LocalFrame {
  toLocal(point: LonLat): Point;
  toLonLat(point: Point): LonLat;
}

export function localFrame(origin: LonLat): LocalFrame {
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

/** A route as xPing flies it: corners rounded, measured along its length. */
export interface FlightPath {
  readonly points: readonly Point[];
  /** Distance from the start to each point. */
  readonly along: readonly number[];
  readonly length: number;
}

/**
 * Rounds a route's corners (Chaikin, keeping both ends) so a turn at a
 * crossing is a curve xPing banks through, not a corner it snaps around.
 */
export function flightPath(route: readonly Point[], rounds = 3): FlightPath {
  let points: Point[] = route.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point[0] - route[index - 1]![0],
        point[1] - route[index - 1]![1],
      ) > 0.01,
  );
  for (let round = 0; round < rounds && points.length > 2; round++) {
    const next: Point[] = [points[0]!];
    for (let index = 0; index < points.length - 1; index++) {
      const [ax, ay] = points[index]!;
      const [bx, by] = points[index + 1]!;
      if (index > 0) next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (index < points.length - 2)
        next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(points[points.length - 1]!);
    points = next;
  }
  const along = [0];
  for (let index = 1; index < points.length; index++) {
    const [ax, ay] = points[index - 1]!;
    const [bx, by] = points[index]!;
    along.push(along[index - 1]! + Math.hypot(bx - ax, by - ay));
  }
  return { points, along, length: along[along.length - 1] ?? 0 };
}

/** Half the chord a heading is read over, so it turns smoothly on a curve. */
const HEADING_CHORD_METERS = 10;

/** Where the path is at a distance along it, and which way it runs there. */
export function pathAt(
  path: FlightPath,
  distance: number,
): { readonly point: Point; readonly direction: Point } {
  // Read over a chord, not one segment: on a rounded corner the heading
  // then turns continuously instead of in a step at every vertex.
  const [fx, fy] = pointAt(path, distance + HEADING_CHORD_METERS);
  const [rx, ry] = pointAt(path, distance - HEADING_CHORD_METERS);
  const length = Math.hypot(fx - rx, fy - ry);
  return {
    point: pointAt(path, distance),
    direction:
      length > 0.001 ? [(fx - rx) / length, (fy - ry) / length] : [0, 1],
  };
}

function pointAt(path: FlightPath, distance: number): Point {
  const { points, along } = path;
  if (points.length === 1) return points[0]!;
  const s = Math.min(Math.max(distance, 0), path.length);
  let low = 0;
  let high = along.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (along[middle]! <= s) low = middle;
    else high = middle;
  }
  const [ax, ay] = points[low]!;
  const [bx, by] = points[high]!;
  const t = (s - along[low]!) / (along[high]! - along[low]! || 1);
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

/** A building on the local plane, boxed for a cheap first test. */
export interface FlightObstacle {
  readonly rings: readonly (readonly Point[])[];
  readonly heightMeters: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The buildings among a renderer's obstacles; water is flown over. */
export function flightObstacles(
  obstacles: readonly MapObstacle[],
  frame: LocalFrame,
): FlightObstacle[] {
  const buildings: FlightObstacle[] = [];
  for (const obstacle of obstacles) {
    if (obstacle.kind !== "building") continue;
    obstacle.polygons.forEach((polygon, index) => {
      const heightMeters = obstacle.heights?.[index] ?? 0;
      if (!(heightMeters > 0) || polygon.length === 0) return;
      const rings = polygon.map((ring) => ring.map(frame.toLocal));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of rings[0]!) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      buildings.push({ rings, heightMeters, minX, minY, maxX, maxY });
    });
  }
  return buildings;
}

/** The tallest building standing at a point, 0 over open ground. */
function heightAt(obstacles: readonly FlightObstacle[], [x, y]: Point): number {
  let tallest = 0;
  for (const obstacle of obstacles) {
    if (obstacle.heightMeters <= tallest) continue;
    if (
      x < obstacle.minX ||
      x > obstacle.maxX ||
      y < obstacle.minY ||
      y > obstacle.maxY
    )
      continue;
    if (insideRings([x, y], obstacle.rings)) tallest = obstacle.heightMeters;
  }
  return tallest;
}

/** What lies ahead: the tallest roof in each lane, and how built up it is. */
export interface FlightScan {
  /** Index 0 is the leftmost lane, `FLYOVER_MAX_LANE` the route's own. */
  readonly laneHeights: readonly number[];
  /** Share of the ground ahead under a roof, 0 to 1. */
  readonly density: number;
}

export function scanAhead(
  path: FlightPath,
  distance: number,
  obstacles: readonly FlightObstacle[],
): FlightScan {
  const lanes = 2 * FLYOVER_MAX_LANE + 1;
  const laneHeights = new Array<number>(lanes).fill(0);
  let probes = 0;
  let covered = 0;
  for (
    let ahead = 0;
    ahead <= FLYOVER_LOOKAHEAD_METERS && distance + ahead <= path.length;
    ahead += PROBE_STEP_METERS
  ) {
    const { point, direction } = pathAt(path, distance + ahead);
    const right: Point = [direction[1], -direction[0]];
    for (let lane = 0; lane < lanes; lane++) {
      const offset = (lane - FLYOVER_MAX_LANE) * FLYOVER_LANE_METERS;
      for (const side of [
        -PROBE_HALF_WIDTH_METERS,
        0,
        PROBE_HALF_WIDTH_METERS,
      ]) {
        const height = heightAt(obstacles, [
          point[0] + right[0] * (offset + side),
          point[1] + right[1] * (offset + side),
        ]);
        laneHeights[lane] = Math.max(laneHeights[lane]!, height);
        probes++;
        if (height > 0) covered++;
      }
    }
  }
  return { laneHeights, density: probes === 0 ? 0 : covered / probes };
}

/** The roof a lane asks xPing to clear, or `undefined` past its reach. */
function climbFor(scan: FlightScan, lane: number): number | undefined {
  const roof = scan.laneHeights[lane + FLYOVER_MAX_LANE] ?? 0;
  const needed = roof === 0 ? 0 : roof + FLYOVER_CLEARANCE_METERS;
  return needed <= FLYOVER_MAX_CLIMB_METERS ? needed : undefined;
}

/**
 * The lane xPing takes: the one it wants when it can clear it, otherwise
 * the free lane nearest to that, nearer the route on a tie. With nothing
 * free it keeps the lane it wants and climbs whatever is there.
 */
export function chooseLane(scan: FlightScan, wanted: number): number {
  if (climbFor(scan, wanted) !== undefined) return wanted;
  for (let step = 1; step <= 2 * FLYOVER_MAX_LANE; step++) {
    const candidates = [wanted - step, wanted + step]
      .filter((lane) => Math.abs(lane) <= FLYOVER_MAX_LANE)
      .sort((a, b) => Math.abs(a) - Math.abs(b));
    for (const lane of candidates)
      if (climbFor(scan, lane) !== undefined) return lane;
  }
  return wanted;
}

/** The height to fly in a lane: over the block's density and its roofs. */
export function cruiseHeight(scan: FlightScan, lane: number): number {
  const base =
    FLYOVER_LOW_HEIGHT_METERS +
    (FLYOVER_DENSE_HEIGHT_METERS - FLYOVER_LOW_HEIGHT_METERS) *
      Math.min(1, scan.density * 1.6);
  const roof = scan.laneHeights[lane + FLYOVER_MAX_LANE] ?? 0;
  return Math.max(base, roof === 0 ? 0 : roof + FLYOVER_CLEARANCE_METERS);
}

export interface FlightState {
  /** Distance flown along the path. */
  readonly distance: number;
  /** Metres right of the route, and how fast that changes. */
  readonly lateral: number;
  readonly lateralSpeed: number;
  /** Metres above the ground, and how fast that changes. */
  readonly height: number;
  readonly climbSpeed: number;
  /** The lane a person stepped to, and when. */
  readonly steerLane: number;
  readonly steeredAt: number;
  /** The lane being flown. */
  readonly lane: number;
  readonly bearingDeg: number;
  readonly rollDeg: number;
  readonly pitchDeg: number;
  readonly arrived: boolean;
}

export function startFlight(path: FlightPath): FlightState {
  const { direction } = pathAt(path, 0);
  return {
    distance: 0,
    lateral: 0,
    lateralSpeed: 0,
    height: FLYOVER_LOW_HEIGHT_METERS,
    climbSpeed: 0,
    steerLane: 0,
    steeredAt: -Infinity,
    lane: 0,
    bearingDeg: bearingOf(direction),
    rollDeg: 0,
    pitchDeg: CRUISE_PITCH_DEG,
    arrived: path.length === 0,
  };
}

/** A person's step aside, at a time on the same clock as `stepFlight`. */
export function steerFlight(
  state: FlightState,
  direction: -1 | 1,
  nowMs: number,
): FlightState {
  const held = nowMs - state.steeredAt < FLYOVER_STEER_HOLD_MS;
  const from = held ? state.steerLane : state.lane;
  return {
    ...state,
    steerLane: Math.max(
      -FLYOVER_MAX_LANE,
      Math.min(FLYOVER_MAX_LANE, from + direction),
    ),
    steeredAt: nowMs,
  };
}

function bearingOf([x, y]: Point): number {
  return (((Math.atan2(x, y) / RAD) % 360) + 360) % 360;
}

/** A critically damped spring toward `target`, one small step. */
function spring(
  value: number,
  speed: number,
  target: number,
  rate: number,
  seconds: number,
): [number, number] {
  const acceleration = rate * rate * (target - value) - 2 * rate * speed;
  const nextSpeed = speed + acceleration * seconds;
  return [value + nextSpeed * seconds, nextSpeed];
}

/**
 * Advances the flight by `elapsedMs`, reading the roofs ahead in `scan`.
 * Steps of any length give the same flight to within a frame: long ones
 * are split into short ones.
 */
export function stepFlight(
  path: FlightPath,
  state: FlightState,
  scan: FlightScan,
  elapsedMs: number,
  nowMs: number,
): FlightState {
  if (state.arrived) return state;
  const steering = nowMs - state.steeredAt < FLYOVER_STEER_HOLD_MS;
  const lane = chooseLane(scan, steering ? state.steerLane : 0);
  const targetLateral = lane * FLYOVER_LANE_METERS;
  const targetHeight = cruiseHeight(scan, lane);
  let { distance, lateral, lateralSpeed, height, climbSpeed, rollDeg } = state;
  let bearingDeg = state.bearingDeg;
  let pitchDeg = state.pitchDeg;
  let remaining = Math.max(0, elapsedMs) / 1000;
  while (remaining > 0) {
    const seconds = Math.min(remaining, 1 / 120);
    remaining -= seconds;
    distance = Math.min(path.length, distance + FLYOVER_SPEED_MPS * seconds);
    [lateral, lateralSpeed] = spring(
      lateral,
      lateralSpeed,
      targetLateral,
      LATERAL_RATE,
      seconds,
    );
    [height, climbSpeed] = spring(
      height,
      climbSpeed,
      targetHeight,
      targetHeight > height ? CLIMB_RATE : DESCENT_RATE,
      seconds,
    );
    // Heading is where xPing is actually going: along the route, plus the
    // way it is drifting aside. How fast that turns is how hard it banks.
    const { direction } = pathAt(path, distance);
    const right: Point = [direction[1], -direction[0]];
    const nextBearing = bearingOf([
      direction[0] * FLYOVER_SPEED_MPS + right[0] * lateralSpeed,
      direction[1] * FLYOVER_SPEED_MPS + right[1] * lateralSpeed,
    ]);
    const turn = ((nextBearing - bearingDeg + 540) % 360) - 180;
    bearingDeg = nextBearing;
    const turnRate = (turn * RAD) / seconds;
    const bank = Math.atan2(FLYOVER_SPEED_MPS * turnRate, GRAVITY) / RAD;
    const targetRoll = Math.max(-MAX_ROLL_DEG, Math.min(MAX_ROLL_DEG, bank));
    rollDeg += (targetRoll - rollDeg) * Math.min(1, ROLL_RATE * seconds);
    // Nose down at cruise, up while climbing, further down while diving.
    pitchDeg =
      CRUISE_PITCH_DEG - Math.atan2(climbSpeed, FLYOVER_SPEED_MPS) / RAD;
  }
  return {
    ...state,
    distance,
    lateral,
    lateralSpeed,
    height,
    climbSpeed,
    lane,
    bearingDeg,
    rollDeg,
    pitchDeg,
    arrived: distance >= path.length,
  };
}

/** Where xPing is on the plane: on the route, `lateral` metres to its right. */
export function flightPoint(path: FlightPath, state: FlightState): Point {
  const { point, direction } = pathAt(path, state.distance);
  return [
    point[0] + direction[1] * state.lateral,
    point[1] - direction[0] * state.lateral,
  ];
}
