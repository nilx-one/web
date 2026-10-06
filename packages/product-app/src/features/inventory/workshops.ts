// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapLandmark,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useEffect, useState } from "react";

/**
 * Repair workshops: real places in the basemap where a broken player can be
 * fixed (`Place::RepairWorkshop` in core). Which places count is this
 * product's call. They are read from the archive's own `pois`, as they are
 * in Kyiv today:
 *
 * - every electronics repair shop (`electronics_repair`, some 96 in Kyiv)
 *   and radio parts shop (`radiotechnics`);
 * - a radio market, by its name: Kyiv's «Радіоринок» is a `marketplace` and
 *   «Дарницький Радіо ринок» an `electronics` shop in the archive.
 */
export const WORKSHOP_KINDS: ReadonlySet<string> = new Set([
  "electronics_repair",
  "radiotechnics",
  "marketplace",
  "electronics",
]);

/** Kinds that are a workshop whatever they are called. */
const ALWAYS_WORKSHOPS: ReadonlySet<string> = new Set([
  "electronics_repair",
  "radiotechnics",
]);

const RADIO_MARKET = /радіо\s*ринок|радио\s*рынок|radio\s*market/iu;

export function isWorkshop(place: MapLandmark): boolean {
  if (ALWAYS_WORKSHOPS.has(place.kind)) return true;
  const names = [place.name, ...Object.values(place.facts)].filter(
    (value): value is string => typeof value === "string",
  );
  return names.some((name) => RADIO_MARKET.test(name));
}

/** How close the Bond has to stand: inside the shop, or at its door. */
export const WORKSHOP_RADIUS_METERS = 40;

/** A fix this imprecise cannot tell the shop from the one next door. */
export const WORKSHOP_ACCURACY_METERS = 50;

export type WorkshopRenderer = Pick<
  MapRenderer,
  "pointsNear" | "subscribeLandmarksChanged"
>;

/** The nearest workshop to a real observation of this device, if any. */
export function workshopAt(
  renderer: WorkshopRenderer,
  device: (MapPointSelection & { readonly accuracyMeters: number }) | undefined,
): MapLandmark | undefined {
  if (
    device === undefined ||
    renderer.pointsNear === undefined ||
    device.accuracyMeters > WORKSHOP_ACCURACY_METERS
  ) {
    return undefined;
  }
  return renderer
    .pointsNear(device, WORKSHOP_RADIUS_METERS, WORKSHOP_KINDS)
    .find(isWorkshop);
}

/**
 * The workshop this device stands at, kept current as it moves and as the
 * map loads. Only a real observation counts: a declared position stands the
 * Bond somewhere, it does not walk them into a shop.
 */
export function useWorkshop(
  renderer: WorkshopRenderer,
  device: (MapPointSelection & { readonly accuracyMeters: number }) | undefined,
): MapLandmark | undefined {
  const [workshop, setWorkshop] = useState<MapLandmark | undefined>();
  const longitude = device?.longitude;
  const latitude = device?.latitude;
  const accuracy = device?.accuracyMeters;

  useEffect(() => {
    const here =
      longitude === undefined ||
      latitude === undefined ||
      accuracy === undefined
        ? undefined
        : { longitude, latitude, accuracyMeters: accuracy };
    const look = () => setWorkshop(workshopAt(renderer, here));
    const first = globalThis.setTimeout(look, 0);
    const unsubscribe = renderer.subscribeLandmarksChanged?.(look);
    return () => {
      globalThis.clearTimeout(first);
      unsubscribe?.();
    };
  }, [accuracy, latitude, longitude, renderer]);

  return workshop;
}
