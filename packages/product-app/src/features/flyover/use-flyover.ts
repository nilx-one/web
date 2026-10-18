// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapBounds,
  MapCamera,
  MapCameraPadding,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import type { LonLat } from "@nilx-one/walk-graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { prefersReducedMotion } from "../../shell/motion";
import { offsetPoint } from "../guide/guide-stage";
import {
  flightObstacles,
  FLYOVER_SPEED_MPS,
  flightPath,
  flightPoint,
  localFrame,
  scanAhead,
  startFlight,
  steerFlight,
  stepFlight,
  type FlightObstacle,
  type FlightState,
} from "./flyover-flight";
import { flyoverRoadBounds, planFlyoverRoute } from "./flyover-route";

/** xPing's handle while it flies, apart from the informer's. */
export const FLYOVER_DRONE_ID = "flyover:xPing";
/** Big enough to read from the chase camera, still a small drone. */
export const FLYOVER_DRONE_SCALE = 3;
/** Rising from beside the Bond before it sets off. */
export const FLYOVER_TAKEOFF_MS = 1_400;
/** Hovering by the station before the camera returns. */
export const FLYOVER_ARRIVAL_MS = 2_000;
/** How often the buildings around xPing are read again. */
const OBSTACLE_REFRESH_MS = 250;
/** The box of buildings read around xPing: its lookahead and the lanes. */
const OBSTACLE_REACH_METERS = 160;
/** The chase camera looks this far ahead of xPing, along its heading. */
const CHASE_AHEAD_METERS = 22;
const CHASE_PITCH = 60;
/** How quickly the chase camera swings round to xPing's heading. */
const CHASE_TURN_RATE = 2.5;

/**
 * Behind and above xPing, looking the way it flies: the runner-game shot.
 * The higher it flies, the wider the shot, so it stays in frame.
 */
export function chaseCamera(
  point: MapPointSelection,
  bearingDeg: number,
  heightMeters: number,
): MapCamera {
  const center = offsetPoint(point, bearingDeg, CHASE_AHEAD_METERS);
  return {
    center: [center.longitude, center.latitude],
    zoom: 19.4 - Math.log2(1 + Math.max(0, heightMeters) / 28),
    bearing: bearingDeg,
    pitch: CHASE_PITCH,
  };
}

/** One still view of the whole route, for reduced motion. */
export function routeOverview(route: readonly LonLat[]): MapCamera {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of route) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  const latitude = (south + north) / 2;
  const widthMeters =
    (east - west) * 111_195 * Math.cos((latitude * Math.PI) / 180);
  const heightMeters = (north - south) * 111_195;
  const span = Math.max(widthMeters, heightMeters, 200) * 1.4;
  // A 512 px world at zoom 0 is 40 075 km across the equator.
  const zoom = Math.log2(
    (40_075_016 * Math.cos((latitude * Math.PI) / 180) * 360) / (span * 512),
  );
  return {
    center: [(west + east) / 2, latitude],
    zoom: Math.min(18, Math.max(11, zoom)),
    bearing: 0,
    pitch: 0,
  };
}

function around(point: LonLat, meters: number): MapBounds {
  const latitude = meters / 111_195;
  const longitude = latitude / Math.cos((point[1] * Math.PI) / 180);
  return {
    west: point[0] - longitude,
    east: point[0] + longitude,
    south: point[1] - latitude,
    north: point[1] + latitude,
  };
}

export interface FlyoverRequest {
  /** Where the Bond and its Avaia stand. */
  readonly from: MapPointSelection;
  /** The business station the flight goes to. */
  readonly to: MapPointSelection;
}

export interface Flyover {
  /** A flight is under way, whether it is open or tucked away. */
  readonly active: boolean;
  /**
   * The flight is open: it owns the screen, its controls are up and the
   * world's own camera stands down. A collapsed flight is still `active`.
   */
  readonly expanded: boolean;
  readonly following: boolean;
  readonly progress: FlyoverProgress | undefined;
  setFollowing(value: boolean): void;
  /** Starts the flight; ignored while one is under way. */
  start(request: FlyoverRequest): void;
  /** Steps xPing a lane aside; the route pulls it back once let go. */
  steer(direction: -1 | 1): void;
  /** Tucks the flight away: it flies on and the world is handed back. */
  collapse(): void;
  /** Opens a collapsed flight again, chasing xPing. */
  expand(): void;
  /** Cancels the flight at once. */
  leave(): void;
}

/** Presentation telemetry from the actual route, never a purchase receipt. */
export interface FlyoverProgress {
  readonly point: MapPointSelection;
  readonly remainingMs: number;
  readonly arrivedAt?: number;
}

/**
 * The xPing flyover (core docs/xping-flyover.md). Presentation only: the
 * route, the prop and the camera are all it touches, and all of them are
 * put back when it ends. No body moves and nothing is recorded.
 */
export function useFlyover(renderer: MapRenderer, ready: boolean): Flyover {
  const [request, setRequest] = useState<FlyoverRequest | undefined>();
  const [progress, setProgress] = useState<FlyoverProgress>();
  const [following, setFollowing] = useState(true);
  const [open, setOpen] = useState(true);
  const followingRef = useRef(following);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const flight = useRef<{ state: FlightState } | undefined>(undefined);
  /** Puts the camera back where the flight found it; set while one flies. */
  const restoreCamera = useRef<(() => void) | undefined>(undefined);

  const start = useCallback(
    (next: FlyoverRequest) => {
      if (!ready || request !== undefined) return;
      setProgress(undefined);
      setFollowing(true);
      setOpen(true);
      setRequest((current) => current ?? next);
    },
    [ready, request],
  );
  const leave = useCallback(() => {
    setRequest(undefined);
    setProgress(undefined);
  }, []);
  const collapse = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    setFollowing(false);
    restoreCamera.current?.();
  }, []);
  const expand = useCallback(() => {
    setOpen(true);
    setFollowing(true);
  }, []);
  const steer = useCallback((direction: -1 | 1) => {
    const current = flight.current;
    if (current === undefined || !openRef.current) return;
    current.state = steerFlight(
      current.state,
      direction,
      globalThis.performance.now(),
    );
  }, []);

  useEffect(() => {
    if (request === undefined || !ready) return;
    const drone = renderer.systemDrone;
    let base: MapCamera;
    let basePadding: MapCameraPadding | undefined;
    try {
      base = renderer.getCamera();
      basePadding = renderer.getCameraPadding?.();
    } catch {
      return () => setRequest(undefined);
    }
    const reduced = prefersReducedMotion();
    const putBack = () => {
      try {
        renderer.setCamera(base, {
          motion: reduced ? "immediate" : "eased",
          durationMs: 900,
          ...(basePadding === undefined ? {} : { padding: basePadding }),
        });
      } catch {
        /* A lost renderer has nothing left to put back. */
      }
    };
    restoreCamera.current = putBack;
    let cancelled = false;
    let frame: number | undefined;
    let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
    const from: LonLat = [request.from.longitude, request.from.latitude];
    const to: LonLat = [request.to.longitude, request.to.latitude];

    const fly = (route: readonly LonLat[]) => {
      renderer.setRoute?.({ points: route });
      if (reduced) {
        renderer.setCamera(routeOverview(route), { motion: "immediate" });
        drone?.upsert({
          id: FLYOVER_DRONE_ID,
          lngLat: to,
          bearingDeg: 180,
          phase: 0,
          reducedMotion: true,
          scale: FLYOVER_DRONE_SCALE,
        });
        return;
      }
      const plane = localFrame(from);
      const path = flightPath(route.map(plane.toLocal));
      let state = startFlight(path);
      flight.current = { state };
      let obstacles: FlightObstacle[] = [];
      let obstaclesAt = -Infinity;
      const started = globalThis.performance.now();
      let last = started;
      let cameraBearing = state.bearingDeg;
      let publishedAt = -Infinity;
      renderer.setCamera(
        chaseCamera(request.from, state.bearingDeg, state.height),
        { motion: "eased", durationMs: FLYOVER_TAKEOFF_MS },
      );

      const draw = (now: number) => {
        frame = undefined;
        if (cancelled) return;
        const elapsed = Math.min(100, Math.max(0, now - last));
        last = now;
        const flying = now - started >= FLYOVER_TAKEOFF_MS;
        const current = flight.current ?? { state };
        state = current.state;
        if (flying) {
          if (now - obstaclesAt >= OBSTACLE_REFRESH_MS) {
            obstaclesAt = now;
            const here = plane.toLonLat(flightPoint(path, state));
            obstacles = flightObstacles(
              renderer.obstaclesWithin?.(around(here, OBSTACLE_REACH_METERS)) ??
                [],
              plane,
            );
          }
          state = stepFlight(
            path,
            state,
            scanAhead(path, state.distance, obstacles),
            elapsed,
            now,
          );
          current.state = state;
        }
        const lift = flying
          ? state.height
          : state.height * Math.min(1, (now - started) / FLYOVER_TAKEOFF_MS);
        const [longitude, latitude] = plane.toLonLat(flightPoint(path, state));
        if (state.arrived || now - publishedAt >= 250) {
          publishedAt = now;
          setProgress({
            point: { longitude, latitude },
            remainingMs:
              Math.max(0, FLYOVER_TAKEOFF_MS - (now - started)) +
              (Math.max(0, path.length - state.distance) / FLYOVER_SPEED_MPS) *
                1000,
            ...(state.arrived ? { arrivedAt: Date.now() } : {}),
          });
        }
        try {
          drone?.upsert({
            id: FLYOVER_DRONE_ID,
            lngLat: [longitude, latitude],
            bearingDeg: state.bearingDeg,
            phase: ((now - started) % 2_000) / 2_000,
            reducedMotion: false,
            heightMeters: lift,
            rollDeg: flying ? state.rollDeg : 0,
            pitchDeg: flying ? state.pitchDeg : 0,
            scale: FLYOVER_DRONE_SCALE,
          });
          if (flying && followingRef.current) {
            const turn = ((state.bearingDeg - cameraBearing + 540) % 360) - 180;
            cameraBearing +=
              turn * Math.min(1, (CHASE_TURN_RATE * elapsed) / 1000);
            renderer.setCamera(
              chaseCamera({ longitude, latitude }, cameraBearing, lift),
              { motion: "immediate" },
            );
          }
        } catch {
          setRequest(undefined);
          return;
        }
        if (state.arrived) {
          arrivalTimer = setTimeout(
            () => setRequest(undefined),
            FLYOVER_ARRIVAL_MS,
          );
          return;
        }
        frame = globalThis.requestAnimationFrame(draw);
      };
      frame = globalThis.requestAnimationFrame(draw);
    };

    const bounds = flyoverRoadBounds(from, to);
    void Promise.resolve(renderer.preloadRoads?.(bounds))
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        try {
          fly(planFlyoverRoute(from, to, renderer.roadsWithin?.(bounds) ?? []));
        } catch {
          setRequest(undefined);
        }
      });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!openRef.current) return;
      if (event.code === "Escape") {
        event.preventDefault();
        collapse();
        return;
      }
      const direction =
        event.code === "ArrowLeft" || event.code === "KeyA"
          ? -1
          : event.code === "ArrowRight" || event.code === "KeyD"
            ? 1
            : undefined;
      if (direction === undefined) return;
      event.preventDefault();
      steer(direction);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      // Whatever ends the effect ends the flight: leaving, the world closing
      // or the map going away. A later start is a new flight.
      setRequest(undefined);
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      if (arrivalTimer !== undefined) clearTimeout(arrivalTimer);
      flight.current = undefined;
      restoreCamera.current = undefined;
      try {
        drone?.remove(FLYOVER_DRONE_ID);
        renderer.setRoute?.(null);
      } catch {
        /* A lost renderer has nothing left to put back. */
      }
      putBack();
    };
  }, [ready, renderer, request, steer, collapse]);

  const active = request !== undefined;
  const expanded = active && open;
  return useMemo(
    () => ({
      active,
      expanded,
      start,
      steer,
      collapse,
      expand,
      leave,
      progress,
      following,
      setFollowing,
    }),
    [
      active,
      expanded,
      collapse,
      expand,
      leave,
      start,
      steer,
      progress,
      following,
    ],
  );
}
