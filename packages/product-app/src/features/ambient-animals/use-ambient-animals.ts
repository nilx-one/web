// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapBounds, MapRenderer } from "@nilx-one/map-contract";
import { useEffect } from "react";

import { prefersReducedMotion } from "../../shell/motion";
import { offsetMeters } from "../ambient-drones/ambient-drone-schedule";
import {
  ANIMAL_MIN_ZOOM,
  EMPTY_GROUND,
  animalsAround,
  eaglesAround,
  sampleAnimal,
  sampleEagle,
  type AnimalGround,
  type AnimalSpec,
  type EagleSpec,
} from "./ambient-animal-schedule";

/** How often the animals around the camera, and their ground, are read again. */
const RESELECT_MS = 1_000;
/** Ground animals are looked for this far around the middle of the view. */
const GROUND_REACH_METERS = 220;
/** An eagle is seen from further off: it is high up and large. */
const SKY_REACH_METERS = 450;
/** Road kinds a dog or a cat walks along. */
const PATH_KINDS: ReadonlySet<string> = new Set(["path"]);

export interface AmbientAnimalsOptions {
  readonly renderer: MapRenderer;
  readonly ready: boolean;
  /** A scene, an informer or another surface owns the view for now. */
  readonly suspended?: boolean;
  /** Wall clock; the schedule is the world's, not this page's. */
  readonly clock?: () => number;
}

function boundsAround(
  centre: readonly [number, number],
  meters: number,
): MapBounds {
  const [west] = offsetMeters(centre, meters, Math.PI);
  const [east] = offsetMeters(centre, meters, 0);
  const [, south] = offsetMeters(centre, meters, -Math.PI / 2);
  const [, north] = offsetMeters(centre, meters, Math.PI / 2);
  return { west, east, south, north };
}

/** The ground the animals live on, from what this renderer has loaded. */
export function groundWithin(
  renderer: Pick<
    MapRenderer,
    "obstaclesWithin" | "greenAreasWithin" | "roadsWithin"
  >,
  bounds: MapBounds,
): AnimalGround {
  const water: AnimalGround["water"][number][] = [];
  const buildings: AnimalGround["buildings"][number][] = [];
  for (const obstacle of renderer.obstaclesWithin?.(bounds) ?? []) {
    (obstacle.kind === "water" ? water : buildings).push(...obstacle.polygons);
  }
  const green = (renderer.greenAreasWithin?.(bounds) ?? []).map(
    (area) => area.polygon,
  );
  const paths = (renderer.roadsWithin?.(bounds) ?? [])
    .filter((road) => PATH_KINDS.has(road.kind))
    .flatMap((road) => road.lines);
  return { green, water, buildings, paths };
}

function pageVisible(): boolean {
  return globalThis.document?.visibilityState !== "hidden";
}

/**
 * Lets the city's animals live wherever the camera looks
 * (docs/ambient-animals.md): squirrels in the parks, piranhas in the water,
 * dogs and cats along the footways, an eagle now and then overhead.
 *
 * It costs nothing off screen. While the page is hidden, the map is zoomed
 * out past the scale an animal reads at, the person asked for reduced motion
 * or something else owns the view, no frame is requested and every animal is
 * taken off the world. Nothing is sent anywhere: they are scenery, not
 * presence, and no server knows of them. Ground still in fog keeps no
 * animal: what this device has not revealed stays unknown.
 */
export function useAmbientAnimals({
  renderer,
  ready,
  suspended = false,
  clock = Date.now,
}: AmbientAnimalsOptions): void {
  useEffect(() => {
    const layer = renderer.animals;
    if (!ready || suspended || layer === undefined || prefersReducedMotion())
      return;
    const shown = new Set<string>();
    let animals: readonly AnimalSpec[] = [];
    let eagles: readonly EagleSpec[] = [];
    let ground: AnimalGround = EMPTY_GROUND;
    let selectedAt = -Infinity;
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
        view.zoom >= ANIMAL_MIN_ZOOM
      );
    };
    const revealed = ([longitude, latitude]: readonly number[]) => {
      const fog = renderer.fog;
      if (fog === undefined || !fog.isActive()) return true;
      const point = { longitude: longitude!, latitude: latitude! };
      return fog.isRevealed(fog.cellAt(point).id);
    };

    const select = (now: number) => {
      const view = camera();
      if (view === undefined) return;
      const centre = view.center;
      ground = groundWithin(
        renderer,
        boundsAround(centre, GROUND_REACH_METERS + 20),
      );
      animals = animalsAround(centre, GROUND_REACH_METERS, ground).filter(
        (animal) => revealed(animal.home),
      );
      eagles = eaglesAround(centre, SKY_REACH_METERS);
      selectedAt = now;
      const kept = new Set([
        ...animals.map((animal) => animal.id),
        ...eagles.map((eagle) => eagle.id),
      ]);
      for (const id of [...shown]) if (!kept.has(id)) take(id);
    };

    const draw = (now: number) => {
      frame = undefined;
      if (!watching()) {
        clear();
        return;
      }
      if (now - selectedAt >= RESELECT_MS) select(now);
      const time = clock();
      try {
        for (const animal of animals) {
          layer.upsert(sampleAnimal(animal, time, ground));
          shown.add(animal.id);
        }
        for (const eagle of eagles) {
          layer.upsert(sampleEagle(eagle, time));
          shown.add(eagle.id);
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
    const unsubscribeCamera = renderer.subscribeCamera(wake);
    // Tiles arriving can turn a spot green or wet: read the ground again.
    const unsubscribeTiles = renderer.subscribeLandmarksChanged?.(() => {
      selectedAt = -Infinity;
    });
    const onVisibility = () => {
      if (pageVisible()) {
        wake();
        return;
      }
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      frame = undefined;
      clear();
    };
    globalThis.document?.addEventListener("visibilitychange", onVisibility);
    wake();
    return () => {
      stopped = true;
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      unsubscribeCamera();
      unsubscribeTiles?.();
      globalThis.document?.removeEventListener(
        "visibilitychange",
        onVisibility,
      );
      clear();
    };
  }, [renderer, ready, suspended, clock]);
}
