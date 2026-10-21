// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import { useEffect, useRef } from "react";

import type { AmbientAnimalSighting } from "../ambient-animals/use-ambient-animals";
import type { AvaiaAnimalLineKind } from "./avaia-animal-lines";

/**
 * When an Avaia remarks on an animal it passes (docs/ambient-animals.md).
 *
 * It notices one close by: a squirrel, a cat or a dog within a few steps, a
 * fish in the water beside it, an eagle passing over. A dog or an eagle
 * sometimes startles it, and it says so. It does not chatter: one remark at
 * most every so often, the same animal at most once in a while, and never
 * over a line it is still saying.
 */

/** How close an animal on the ground must be to be noticed. */
export const ANIMAL_NOTICE_METERS = 12;
/** An eagle is high up: noticed when it passes this close overhead. */
export const EAGLE_NOTICE_METERS = 70;
/** The least time between two remarks about animals. */
export const ANIMAL_REMARK_GAP_MS = 45_000;
/** The least time before the same animal is remarked on again. */
export const SAME_ANIMAL_GAP_MS = 10 * 60_000;
/** How often a dog or an eagle startles it rather than just being seen. */
export const STARTLE_SHARE = 0.35;
/** How often the body's surroundings are looked at. */
const LOOK_MS = 1_500;

export interface AnimalRemarkMemory {
  /** When it last remarked on an animal; -Infinity before it ever has. */
  readonly lastAtMs: number;
  /** When it last remarked on each animal, by id. */
  readonly heard: ReadonlyMap<string, number>;
}

export const EMPTY_REMARK_MEMORY: AnimalRemarkMemory = {
  lastAtMs: -Infinity,
  heard: new Map(),
};

export interface AnimalRemark {
  readonly kind: AvaiaAnimalLineKind;
  readonly memory: AnimalRemarkMemory;
}

/**
 * What the Avaia standing at `body` says about the animals around it now, or
 * `undefined` when it says nothing. Pure: the memory it returns is the one to
 * pass next time.
 */
export function animalRemark({
  body,
  sightings,
  nowMs,
  memory,
  random = Math.random,
}: {
  readonly body: MapPointSelection;
  readonly sightings: readonly AmbientAnimalSighting[];
  readonly nowMs: number;
  readonly memory: AnimalRemarkMemory;
  readonly random?: () => number;
}): AnimalRemark | undefined {
  if (nowMs - memory.lastAtMs < ANIMAL_REMARK_GAP_MS) return undefined;
  let nearest: AmbientAnimalSighting | undefined;
  let nearestMeters = Infinity;
  for (const sighting of sightings) {
    const heard = memory.heard.get(sighting.id);
    if (heard !== undefined && nowMs - heard < SAME_ANIMAL_GAP_MS) continue;
    const away = mapDistanceMeters(body, sighting);
    const reach =
      sighting.kind === "eagle" ? EAGLE_NOTICE_METERS : ANIMAL_NOTICE_METERS;
    if (away <= reach && away < nearestMeters) {
      nearest = sighting;
      nearestMeters = away;
    }
  }
  if (nearest === undefined) return undefined;
  const { kind: animal } = nearest;
  const kind: AvaiaAnimalLineKind =
    (animal === "dog" || animal === "eagle") && random() < STARTLE_SHARE
      ? `animal.startled.${animal}`
      : `animal.${animal}`;
  const heard = new Map(
    [...memory.heard].filter(([, at]) => nowMs - at < SAME_ANIMAL_GAP_MS),
  );
  heard.set(nearest.id, nowMs);
  return { kind, memory: { lastAtMs: nowMs, heard } };
}

export interface AvaiaAnimalRemarksInput {
  /** The Avaia has the wheel and the world is in view. */
  readonly active: boolean;
  /** Where its body is now, when it has one. */
  readonly body: () => MapPointSelection | undefined;
  /** Whether it is still saying something; a remark waits for it. */
  readonly speaking: () => boolean;
  readonly sightings: () => readonly AmbientAnimalSighting[];
  readonly announce: (kind: AvaiaAnimalLineKind) => void;
}

/** Looks around the Avaia's body now and then, and says what it notices. */
export function useAvaiaAnimalRemarks(input: AvaiaAnimalRemarksInput): void {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const memory = useRef(EMPTY_REMARK_MEMORY);
  const { active } = input;
  useEffect(() => {
    if (!active) return;
    const timer = globalThis.setInterval(() => {
      const now = latest.current;
      if (now.speaking()) return;
      const body = now.body();
      if (body === undefined) return;
      const remark = animalRemark({
        body,
        sightings: now.sightings(),
        nowMs: Date.now(),
        memory: memory.current,
      });
      if (remark === undefined) return;
      memory.current = remark.memory;
      now.announce(remark.kind);
    }, LOOK_MS);
    return () => globalThis.clearInterval(timer);
  }, [active]);
}
