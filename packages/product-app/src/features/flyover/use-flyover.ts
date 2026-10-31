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
import type { HostPort, SoundCue } from "@nilx-one/host-contract";
import type { MapFlightLoot } from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { prefersReducedMotion } from "../../shell/motion";
import { offsetPoint } from "../guide/guide-stage";
import {
  flightObstacles,
  FLYOVER_FORCE_SPEED_FACTOR,
  FLYOVER_SPEED_MPS,
  flightPath,
  flightPoint,
  nearestAlong,
  localFrame,
  scanAhead,
  startFlight,
  steerFlight,
  stepFlight,
  type FlightObstacle,
  type FlightState,
} from "./flyover-flight";
import { flyoverRoadBounds, planFlyoverRoute } from "./flyover-route";
import {
  crossedFlightLoot,
  laserLootTargets,
  LOOT_INTAKE_MS,
  lootPosition,
  rarerLoot,
  validFlightLoot,
  visibleFlightLoot,
  type FlightLootSpawn,
} from "./flight-loot";
import { flightLootHaptic } from "./flight-loot-haptics";

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
  boost = 0,
): MapCamera {
  // Widen the chase shot as the forcing engine builds to 90 m/s, then
  // return it to normal on release. MapLibre still owns the projection.
  const intensity = Number.isFinite(boost)
    ? Math.min(1, Math.max(0, boost))
    : 0;
  const lookAhead = CHASE_AHEAD_METERS + intensity * 10;
  const center = offsetPoint(point, bearingDeg, lookAhead);
  const baseZoom = 19.4 - Math.log2(1 + Math.max(0, heightMeters) / 28);
  return {
    center: [center.longitude, center.latitude],
    zoom: baseZoom - intensity * 0.6,
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

/**
 * What may force a flight, and what forcing costs. The flight asks before
 * each frame it forces, tells what it spent, and draws the engine's wear as
 * smoke. Core and the service decide the engine; this only carries it.
 */
export interface FlyoverForcing {
  allowed(): boolean;
  spent(ms: number): void;
  /** The engine's wear now, from 0 to 1. */
  wear(): number;
}

export interface FlyoverRequest {
  /** Where the Bond and its Avaia stand. */
  readonly from: MapPointSelection;
  /** The business station the flight goes to. */
  readonly to: MapPointSelection;
  /** Absent, the flight cannot be forced. */
  readonly forcing?: FlyoverForcing;
  /** Externally supplied collectible placements; the flight never rolls drops. */
  readonly loot?: readonly FlightLootSpawn[];
  /** Reports a local 3D collision, never grants a reward or entitlement. */
  readonly onLootCollected?: (item: FlightLootSpawn) => void;
  /** Park at the destination and hand presentation to the Dock until leave(). */
  readonly onDock?: () => void;
  /**
   * Begin at the station and fly only the way back to `from`: the return
   * from a Market visit that left the page while xPing was parked there.
   */
  readonly homeward?: boolean;
}

export interface Flyover {
  /** The route continues, whether open or collapsed. */
  readonly active: boolean;
  /** Whether the full-screen camera and flight controls are active. */
  readonly expanded: boolean;
  readonly following: boolean;
  readonly progress: FlyoverProgress | undefined;
  readonly lootNotice: "rare" | "special" | "exclusive" | undefined;
  setFollowing(value: boolean): void;
  /** Starts the flight; ignored while one is under way. */
  start(request: FlyoverRequest): void;
  /** Steps xPing a lane aside; the route pulls it back once let go. */
  steer(direction: -1 | 1): void;
  /** Holds or lets go of forcing; only the way out can be forced. */
  force(holding: boolean): void;
  /** Hand back the camera and world controls without ending the route. */
  collapse(): void;
  /** Resume chasing xPing and return to full-screen steering. */
  expand(): void;
  /** Leaves the flight at once. */
  leave(): void;
}

/** Presentation telemetry from the actual route, never a purchase receipt. */
export interface FlyoverProgress {
  readonly point: MapPointSelection;
  readonly remainingMs: number;
  /** When it reached the destination; it then flies back to the start. */
  readonly arrivedAt?: number;
  /** Flying back to where it set off from. */
  readonly returning?: boolean;
  /** Being forced, straight at the destination. */
  readonly forced?: boolean;
}

/**
 * The xPing flyover (core docs/xping-flyover.md). Presentation only: the
 * route, the prop and the camera are all it touches, and all of them are
 * put back when it ends. No body moves and nothing is recorded.
 */
export interface FlyoverFeedback {
  readonly playCue?: ((cue: SoundCue) => void) | undefined;
  readonly impact?: Pick<HostPort, "impact">["impact"] | undefined;
}

export function useFlyover(
  renderer: MapRenderer,
  ready: boolean,
  feedback?: FlyoverFeedback,
): Flyover {
  const [request, setRequest] = useState<FlyoverRequest | undefined>();
  const [parked, setParked] = useState(false);
  const parkedRef = useRef(false);
  const [progress, setProgress] = useState<FlyoverProgress>();
  const [lootNotice, setLootNotice] = useState<Flyover["lootNotice"]>();
  const feedbackRef = useRef(feedback);
  useEffect(() => {
    feedbackRef.current = feedback;
  }, [feedback]);
  const [following, setFollowing] = useState(true);
  const [open, setOpen] = useState(true);
  const openRef = useRef(open);
  const followingRef = useRef(following);
  const restoreCamera = useRef<
    { putBack(): void; capture(): void } | undefined
  >(undefined);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  const flight = useRef<{ state: FlightState } | undefined>(undefined);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const forcing = useRef(false);
  const force = useCallback((holding: boolean) => {
    forcing.current = holding && !parkedRef.current;
  }, []);

  const start = useCallback(
    (next: FlyoverRequest) => {
      if (!ready || request !== undefined) return;
      parkedRef.current = false;
      setParked(false);
      setProgress(undefined);
      setLootNotice(undefined);
      followingRef.current = true;
      openRef.current = true;
      setFollowing(true);
      setOpen(true);
      setRequest((current) => current ?? next);
    },
    [ready, request],
  );
  const leave = useCallback(() => {
    setRequest(undefined);
    setProgress(undefined);
    setLootNotice(undefined);
  }, []);
  const collapse = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    followingRef.current = false;
    forcing.current = false;
    setOpen(false);
    setFollowing(false);
    restoreCamera.current?.putBack();
  }, []);
  const expand = useCallback(() => {
    if (parkedRef.current) return;
    if (!openRef.current) {
      restoreCamera.current?.capture();
      openRef.current = true;
      setOpen(true);
    }
    followingRef.current = true;
    setFollowing(true);
  }, []);
  const steer = useCallback((direction: -1 | 1) => {
    const current = flight.current;
    if (current === undefined || !openRef.current || parkedRef.current) return;
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
    let worldCamera = { camera: base, padding: basePadding };
    const putBack = () => {
      try {
        renderer.setCamera(worldCamera.camera, {
          motion: reduced ? "immediate" : "eased",
          durationMs: 900,
          ...(worldCamera.padding === undefined
            ? {}
            : { padding: worldCamera.padding }),
        });
      } catch {
        /* A detached renderer has nothing left to restore. */
      }
    };
    restoreCamera.current = {
      putBack,
      capture: () => {
        try {
          worldCamera = {
            camera: renderer.getCamera(),
            padding: renderer.getCameraPadding?.(),
          };
        } catch {
          /* Preserve the last valid world camera if the renderer was lost. */
        }
      },
    };
    let cancelled = false;
    let frame: number | undefined;
    let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
    const from: LonLat = [request.from.longitude, request.from.latitude];
    const to: LonLat = [request.to.longitude, request.to.latitude];

    const dock = () => {
      if (!request.onDock || parkedRef.current || cancelled) return;
      parkedRef.current = true;
      forcing.current = false;
      setParked(true);
      // A collapsed flight must reclaim the destination view before opening Dock.
      if (!openRef.current) {
        restoreCamera.current?.capture();
        openRef.current = true;
        followingRef.current = true;
        setOpen(true);
        setFollowing(true);
        renderer.setCamera(routeOverview([to]), { motion: "immediate" });
      }
      request.onDock();
    };

    const fly = (route: readonly LonLat[]) => {
      renderer.setRoute?.({ points: route });
      if (reduced && request.homeward) {
        // Nothing to watch: xPing is simply home again.
        setRequest(undefined);
        return;
      }
      if (reduced) {
        if (openRef.current)
          renderer.setCamera(routeOverview(route), { motion: "immediate" });
        drone?.upsert({
          id: FLYOVER_DRONE_ID,
          lngLat: to,
          bearingDeg: 180,
          phase: 0,
          reducedMotion: true,
          scale: FLYOVER_DRONE_SCALE,
        });
        setProgress({
          point: request.to,
          remainingMs: 0,
          arrivedAt: Date.now(),
        });
        dock();
        return;
      }
      const plane = localFrame(from);
      let leg: "out" | "back" = "out";
      let road = route;
      let path = flightPath(road.map(plane.toLocal));
      let state = startFlight(path);
      // Only callers with an explicit collection handler can stage these props:
      // this flight neither invents drops nor treats a client hit as a reward.
      const loot = request.onLootCollected
        ? validFlightLoot(request.loot ?? [], path.length)
        : [];
      const pickedLoot = new Set<string>();
      const intakes = new Map<string, { item: FlightLootSpawn; at: number }>();
      const noticed = new Set<string>();
      let previousTargets = new Set<string>();
      let lastNoticeAt = -Infinity;
      let noticeShown = false;
      let lastLockCueAt = -Infinity;
      let brightest: FlightLootSpawn["rarity"] | undefined;
      flight.current = { state };
      let obstacles: FlightObstacle[] = [];
      let obstaclesAt = -Infinity;
      const started = globalThis.performance.now();
      let last = started;
      let cameraBearing = state.bearingDeg;
      let publishedAt = -Infinity;
      let arrivedAt: number | undefined;
      let straight = false;
      let hovering = false;
      if (openRef.current)
        renderer.setCamera(
          chaseCamera(
            request.homeward ? request.to : request.from,
            state.bearingDeg,
            state.height,
          ),
          { motion: "eased", durationMs: FLYOVER_TAKEOFF_MS },
        );

      // Back the way it came, after hovering at the station: never forced.
      const flyBack = () => {
        arrivalTimer = undefined;
        if (cancelled) return;
        leg = "back";
        road = [...route].reverse();
        renderer.setRoute?.({ points: road });
        renderer.setFlightLoot?.([]);
        previousTargets.clear();
        intakes.clear();
        path = flightPath(road.map(plane.toLocal));
        state = { ...startFlight(path), height: state.height };
        flight.current = { state };
        hovering = false;
        last = globalThis.performance.now();
        frame = globalThis.requestAnimationFrame(draw);
      };

      const draw = (now: number) => {
        frame = undefined;
        if (cancelled) return;
        const elapsed = Math.min(100, Math.max(0, now - last));
        last = now;
        const flying = leg === "back" || now - started >= FLYOVER_TAKEOFF_MS;
        const current = flight.current ?? { state };
        state = current.state;
        const previousLootPoint = flightPoint(path, state);
        const previousLootHeight = state.height;
        const forced =
          flying &&
          leg === "out" &&
          forcing.current &&
          request.forcing?.allowed() === true;
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
            forced,
          );
          current.state = state;
          if (forced) request.forcing?.spent(elapsed);
        }
        const lift = flying
          ? state.height
          : state.height * Math.min(1, (now - started) / FLYOVER_TAKEOFF_MS);
        const actualLootPoint = flightPoint(path, state);
        const [longitude, latitude] = plane.toLonLat(actualLootPoint);
        if (flying && leg === "out" && loot.length) {
          let pickups = 0;
          const previous: [number, number, number] = [
            previousLootPoint[0],
            previousLootPoint[1],
            previousLootHeight,
          ];
          const here: [number, number, number] = [
            actualLootPoint[0],
            actualLootPoint[1],
            state.height,
          ];
          for (const item of loot) {
            if (
              pickedLoot.has(item.id) ||
              !crossedFlightLoot(path, item, previous, here)
            )
              continue;
            pickedLoot.add(item.id);
            intakes.set(item.id, { item, at: now });
            brightest = rarerLoot(brightest, item.rarity);
            pickups++;
            try {
              request.onLootCollected?.(item);
            } catch {
              // A callback exception does not change the flight outcome.
            }
          }
          if (pickups) {
            try {
              if (feedbackRef.current?.impact)
                feedbackRef.current.impact("light");
              else flightLootHaptic();
            } catch {
              // An unavailable host haptic is always optional.
            }
            feedbackRef.current?.playCue?.("loot-pickup");
          }
          const distance =
            state.free === undefined
              ? state.distance
              : nearestAlong(path, actualLootPoint);
          const speed =
            FLYOVER_SPEED_MPS *
            (1 + (FLYOVER_FORCE_SPEED_FACTOR - 1) * state.boost);
          const shown = visibleFlightLoot(
            path,
            plane,
            loot,
            distance,
            speed,
            pickedLoot,
          );
          const selected = laserLootTargets(
            path,
            loot,
            distance,
            here,
            pickedLoot,
          );
          const newlyAcquired = selected.some((id) => !previousTargets.has(id));
          previousTargets = new Set(selected);
          if (newlyAcquired && now - lastLockCueAt >= 200) {
            feedbackRef.current?.playCue?.("loot-lock");
            lastLockCueAt = now;
          }
          const targeted = new Set(selected);
          const candidates = loot.filter(
            (item) =>
              targeted.has(item.id) &&
              !noticed.has(item.id) &&
              (item.rarity === "rare" ||
                item.rarity === "special" ||
                item.rarity === "exclusive"),
          );
          if (candidates.length > 0 && now - lastNoticeAt >= 2_000) {
            const rank = { rare: 1, special: 2, exclusive: 3 };
            candidates.sort(
              (a, b) =>
                (rank[b.rarity as keyof typeof rank] ?? 0) -
                  (rank[a.rarity as keyof typeof rank] ?? 0) ||
                a.id.localeCompare(b.id),
            );
            const selectedNotice = candidates[0]!;
            noticed.add(selectedNotice.id);
            setLootNotice(selectedNotice.rarity as Flyover["lootNotice"]);
            lastNoticeAt = now;
            noticeShown = true;
          }
          if (noticeShown && now - lastNoticeAt >= 2_000) {
            noticeShown = false;
            setLootNotice(undefined);
          }
          const intakeModels: MapFlightLoot[] = [];
          for (const [id, { item, at }] of intakes) {
            const progress = (now - at) / LOOT_INTAKE_MS;
            if (progress >= 1) {
              intakes.delete(id);
              continue;
            }
            const [lng, lat] = plane.toLonLat(lootPosition(path, item));
            intakeModels.push({
              id,
              lngLat: [lng, lat],
              heightMeters: item.heightMeters,
              kind: item.kind,
              rarity: item.rarity,
              near: true,
              intakeProgress: Math.max(0, progress),
            });
          }
          const items: MapFlightLoot[] =
            state.free === undefined
              ? shown
              : shown.map((item) => {
                  const at = plane.toLocal(item.lngLat);
                  return {
                    ...item,
                    near:
                      item.near &&
                      Math.hypot(
                        at[0] - actualLootPoint[0],
                        at[1] - actualLootPoint[1],
                      ) <= 30,
                  };
                });
          renderer.setFlightLoot?.([
            ...items.map((item) => ({
              ...item,
              laserTarget: targeted.has(item.id),
            })),
            ...intakeModels,
          ]);
        }
        // Forced, the route drawn is the straight line it flies; let go, the
        // roads again.
        const offRoute = state.free !== undefined;
        if (offRoute !== straight) {
          straight = offRoute;
          renderer.setRoute?.({
            points: offRoute ? [[longitude, latitude], to] : road,
          });
        }
        if (state.arrived && leg === "out" && arrivedAt === undefined)
          arrivedAt = Date.now();
        if (state.arrived || now - publishedAt >= 250) {
          publishedAt = now;
          const speed =
            FLYOVER_SPEED_MPS *
            (1 + (FLYOVER_FORCE_SPEED_FACTOR - 1) * state.boost);
          setProgress({
            point: { longitude, latitude },
            remainingMs:
              (leg === "out"
                ? Math.max(0, FLYOVER_TAKEOFF_MS - (now - started))
                : 0) +
              (Math.max(0, path.length - state.distance) / speed) * 1000,
            ...(arrivedAt === undefined ? {} : { arrivedAt }),
            ...(leg === "back" ? { returning: true } : {}),
            ...(offRoute ? { forced: true } : {}),
          });
        }
        try {
          const wear = request.forcing?.wear();
          const speedMps =
            FLYOVER_SPEED_MPS *
            (1 + (FLYOVER_FORCE_SPEED_FACTOR - 1) * state.boost);
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
            ...(wear === undefined ? {} : { wear }),
            ...(flying ? { speedMps } : {}),
            ...(brightest === undefined ? {} : { lootAura: brightest }),
          });
          if (flying && openRef.current && followingRef.current) {
            const turn = ((state.bearingDeg - cameraBearing + 540) % 360) - 180;
            cameraBearing +=
              turn * Math.min(1, (CHASE_TURN_RATE * elapsed) / 1000);
            renderer.setCamera(
              chaseCamera(
                { longitude, latitude },
                cameraBearing,
                lift,
                state.boost,
              ),
              { motion: "immediate" },
            );
          }
        } catch {
          setRequest(undefined);
          return;
        }
        if (state.arrived && !hovering) {
          hovering = true;
          if (leg === "out" && request.onDock) {
            dock();
            return;
          }
          arrivalTimer =
            leg === "out"
              ? setTimeout(flyBack, FLYOVER_ARRIVAL_MS)
              : setTimeout(() => setRequest(undefined), FLYOVER_ARRIVAL_MS);
          return;
        }
        frame = globalThis.requestAnimationFrame(draw);
      };
      if (request.homeward) {
        flyBack();
        return;
      }
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
      if (!openRef.current || parkedRef.current) return;
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
      forcing.current = false;
      cancelled = true;
      document.removeEventListener("keydown", onKeyDown);
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      if (arrivalTimer !== undefined) clearTimeout(arrivalTimer);
      flight.current = undefined;
      restoreCamera.current = undefined;
      try {
        drone?.remove(FLYOVER_DRONE_ID);
        setLootNotice(undefined);
        renderer.setFlightLoot?.([]);
        renderer.setRoute?.(null);
      } catch {
        /* A detached renderer cannot clean up its props. */
      }
      // A collapsed flight already gave the camera to the world.
      if (openRef.current) putBack();
    };
  }, [ready, renderer, request, steer, collapse]);

  const active = request !== undefined;
  const expanded = active && open && !parked;
  return useMemo(
    () => ({
      active,
      expanded,
      start,
      steer,
      force,
      collapse,
      expand,
      leave,
      progress,
      lootNotice,
      following,
      setFollowing,
    }),
    [
      active,
      expanded,
      leave,
      start,
      steer,
      force,
      collapse,
      expand,
      progress,
      lootNotice,
      following,
    ],
  );
}
