// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapBounds, MapRenderer } from "@nilx-one/map-contract";
import { buildWalkGraph, type WalkGraph } from "@nilx-one/walk-graph";
import { useEffect } from "react";
import { prefersReducedMotion } from "../../shell/motion";
import {
  arrivalOf,
  planAmbientLeg,
  sampleAmbientLeg,
  type AmbientLeg,
} from "./ambient-drone-flight";
import {
  AMBIENT_DRONE_SCALE,
  AMBIENT_MIN_ZOOM,
  ambientReachMeters,
  dronesAround,
  legAt,
  offsetMeters,
  waypoint,
  type AmbientDroneSpec,
} from "./ambient-drone-schedule";

/** How often the set of drones around the camera is looked at again. */
const RESELECT_MS = 500;
/** Legs planned in one frame at most, so waking up never stutters. */
const LEGS_PER_FRAME = 2;
/** The road graph is rebuilt at most this often when tiles arrive. */
const GRAPH_REFRESH_MS = 3_000;
/**
 * How long a leg waits for its roads to be read ahead before it settles for
 * what is loaded, and the straight line over the roofs where nothing is.
 */
const SETTLE_MS = 2_500;
/** Room around the drones' hubs the road graph is read over. */
const GRAPH_MARGIN_METERS = 650;
const STREET_KINDS: ReadonlySet<string> = new Set([
  "minor_road",
  "medium_road",
  "major_road",
]);

export interface AmbientDronesOptions {
  readonly renderer: MapRenderer;
  readonly ready: boolean;
  /** A scene, an informer or another surface owns the view for now. */
  readonly suspended?: boolean;
  /** Wall clock; the schedule is the world's, not this page's. */
  readonly clock?: () => number;
}

interface Graphs {
  readonly street: WalkGraph;
  readonly yard: WalkGraph;
  readonly bounds: MapBounds;
  readonly builtAt: number;
}

function boundsAround(drones: readonly AmbientDroneSpec[]): MapBounds {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const { hub } of drones) {
    const [w] = offsetMeters(hub, GRAPH_MARGIN_METERS, Math.PI);
    const [e] = offsetMeters(hub, GRAPH_MARGIN_METERS, 0);
    const [, s] = offsetMeters(hub, GRAPH_MARGIN_METERS, -Math.PI / 2);
    const [, n] = offsetMeters(hub, GRAPH_MARGIN_METERS, Math.PI / 2);
    west = Math.min(west, w);
    east = Math.max(east, e);
    south = Math.min(south, s);
    north = Math.max(north, n);
  }
  return { west, east, south, north };
}

function covers(bounds: MapBounds, [longitude, latitude]: readonly number[]) {
  return (
    longitude! >= bounds.west &&
    longitude! <= bounds.east &&
    latitude! >= bounds.south &&
    latitude! <= bounds.north
  );
}

function pageVisible(): boolean {
  return globalThis.document?.visibilityState !== "hidden";
}

/**
 * Lets the city's ambient drones fly around wherever the camera looks
 * (docs/ambient-drones.md).
 *
 * Only what is on screen costs anything. While the page is hidden, the map
 * zoomed out past street scale, the person asked for reduced motion or
 * something else owns the view, no frame is requested, no route is planned
 * and every drone is taken off the world; the camera or the page coming back
 * wakes it. Because each drone's place is a function of the wall clock, a
 * drone found again is where its flight has brought it in the meantime,
 * without anything having flown it. Nothing is sent anywhere: the drones are
 * scenery, not presence, and no server knows of them.
 */
export function useAmbientDrones({
  renderer,
  ready,
  suspended = false,
  clock = Date.now,
}: AmbientDronesOptions): void {
  useEffect(() => {
    const layer = renderer.systemDrone;
    if (!ready || suspended || layer === undefined || prefersReducedMotion())
      return;
    const shown = new Set<string>();
    const legs = new Map<string, AmbientLeg>();
    let drones: readonly AmbientDroneSpec[] = [];
    let selectedAt = -Infinity;
    let graphs: Graphs | undefined;
    let tilesChanged = false;
    // Roads read ahead over the drones' ground, the box last asked for and
    // when; a renderer that cannot read ahead has only what the view loaded.
    let readAhead: MapBounds | undefined;
    let readingAt: number | undefined;
    let frame: number | undefined;
    let stopped = false;

    const take = (id: string) => {
      shown.delete(id);
      try {
        layer.remove(id);
      } catch {
        /* A lost renderer has nothing left to remove. */
      }
    };
    const clear = () => {
      for (const id of [...shown]) take(id);
    };
    const camera = () => {
      try {
        return renderer.getCamera();
      } catch {
        return undefined;
      }
    };
    const watching = () => {
      const view = camera();
      return (
        !stopped &&
        pageVisible() &&
        view !== undefined &&
        view.zoom >= AMBIENT_MIN_ZOOM
      );
    };

    const graphFor = (
      from: readonly number[],
      to: readonly number[],
      now: number,
    ): Graphs | undefined => {
      const stale =
        graphs === undefined ||
        (tilesChanged && now - graphs.builtAt >= GRAPH_REFRESH_MS) ||
        ((!covers(graphs.bounds, from) || !covers(graphs.bounds, to)) &&
          now - graphs.builtAt >= GRAPH_REFRESH_MS / 3);
      if (!stale) return graphs;
      const bounds = boundsAround(drones);
      const roads = renderer.roadsWithin?.(bounds) ?? [];
      tilesChanged = false;
      graphs = {
        street: buildWalkGraph(
          roads.filter((road) => STREET_KINDS.has(road.kind)),
        ),
        yard: buildWalkGraph(roads),
        bounds,
        builtAt: now,
      };
      return graphs;
    };

    /**
     * Whether a leg between these points may be planned now. Roads past the
     * view are read ahead once over the drones' ground, from the same archive
     * the map draws and through the renderer's own capped cache, so an area
     * costs a few tiles once and nothing after.
     */
    const readAround = (
      from: readonly number[],
      to: readonly number[],
      now: number,
    ): boolean => {
      if (renderer.preloadRoads === undefined) return true;
      if (
        readAhead !== undefined &&
        covers(readAhead, from) &&
        covers(readAhead, to)
      )
        return readingAt === undefined || now - readingAt >= SETTLE_MS;
      if (readingAt !== undefined && now - readingAt < SETTLE_MS) return false;
      const bounds = boundsAround(drones);
      readAhead = bounds;
      readingAt = now;
      const done = () => {
        if (readAhead !== bounds) return;
        readingAt = undefined;
        graphs = undefined;
      };
      try {
        void renderer.preloadRoads(bounds).then(done, done);
      } catch {
        done();
      }
      return false;
    };

    const select = (now: number) => {
      const view = camera();
      if (view === undefined) return;
      const [longitude, latitude] = view.center;
      const reach = ambientReachMeters(
        latitude,
        view.zoom,
        view.pitch,
        Math.hypot(globalThis.innerWidth || 0, globalThis.innerHeight || 0),
      );
      drones = dronesAround([longitude, latitude], reach);
      selectedAt = now;
      const kept = new Set(drones.map((drone) => drone.id));
      for (const id of [...shown]) if (!kept.has(id)) take(id);
      const time = clock();
      const current = new Map(
        drones.map((drone) => [drone.id, legAt(drone, time).leg]),
      );
      for (const key of [...legs.keys()]) {
        const split = key.lastIndexOf("#");
        const leg = current.get(key.slice(0, split));
        if (leg === undefined || Number(key.slice(split + 1)) < leg - 1)
          legs.delete(key);
      }
    };

    const draw = (now: number) => {
      frame = undefined;
      if (!watching()) {
        clear();
        return;
      }
      if (now - selectedAt >= RESELECT_MS) select(now);
      const time = clock();
      let planned = 0;
      try {
        for (const drone of drones) {
          const schedule = legAt(drone, time);
          const key = `${drone.id}#${schedule.leg}`;
          let leg = legs.get(key);
          if (leg === undefined) {
            if (planned >= LEGS_PER_FRAME) continue;
            const from = waypoint(drone, schedule.leg);
            const to = waypoint(drone, schedule.leg + 1);
            // A leg is planned once and flown whole, so it waits a moment
            // for its roads rather than commit to the straight line.
            if (!readAround(from, to, now)) continue;
            const graph = graphFor(from, to, now);
            planned += 1;
            leg = planAmbientLeg(
              from,
              to,
              drone.kind === "street" ? graph?.street : graph?.yard,
            );
            legs.set(key, leg);
          }
          const previous = legs.get(`${drone.id}#${schedule.leg - 1}`);
          const sample = sampleAmbientLeg(
            leg,
            schedule,
            drone.heightMeters,
            previous && arrivalOf(previous, drone.heightMeters),
          );
          layer.upsert({
            id: drone.id,
            kind: drone.kind,
            lngLat: sample.lngLat,
            bearingDeg: sample.bearingDeg,
            heightMeters: sample.heightMeters,
            rollDeg: sample.rollDeg,
            pitchDeg: sample.pitchDeg,
            phase: (time % 1_000) / 1_000,
            reducedMotion: false,
            scale: AMBIENT_DRONE_SCALE,
          });
          shown.add(drone.id);
        }
      } catch {
        // A renderer that cannot draw them takes them off; the world goes on.
        stopped = true;
        clear();
        return;
      }
      frame = globalThis.requestAnimationFrame(draw);
    };

    const wake = () => {
      if (frame === undefined && watching())
        frame = globalThis.requestAnimationFrame(draw);
    };
    // Zooming back in to street scale is what most often wakes it.
    const unsubscribeCamera = renderer.subscribeCamera(wake);
    const unsubscribeTiles = renderer.subscribeLandmarksChanged?.(() => {
      tilesChanged = true;
    });
    globalThis.document?.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      stopped = true;
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      unsubscribeCamera();
      unsubscribeTiles?.();
      globalThis.document?.removeEventListener("visibilitychange", wake);
      clear();
    };
  }, [renderer, ready, suspended, clock]);
}
