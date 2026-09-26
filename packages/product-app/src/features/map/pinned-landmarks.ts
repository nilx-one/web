// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapPinnedLandmark,
  MapPinnedLandmarkKind,
} from "@nilx-one/map-contract";

import type { Translate, TranslationKey } from "../../shell/localization";

export interface PinnedLandmarkSeed {
  readonly id: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly kind: MapPinnedLandmarkKind;
  readonly weight: number;
  readonly name: TranslationKey;
}

const KIND_KEYS: Readonly<Record<MapPinnedLandmarkKind, TranslationKey>> = {
  monument: "landmark.pinnedKind.monument",
  sacred: "landmark.pinnedKind.sacred",
  civic: "landmark.pinnedKind.civic",
  nature: "landmark.pinnedKind.nature",
};

/**
 * Kyiv's anchors, at their real coordinates. Weight is a hand-set first guess
 * at how far out each one should stay named, not a measurement: the vertical
 * dominants that read from across the river come first, the green ground the
 * city breathes through after them.
 */
export const KYIV_PINNED_LANDMARKS: readonly PinnedLandmarkSeed[] = [
  {
    id: "kyiv.motherland",
    // Same point the volumetric monument layer stands on.
    longitude: 30.5636,
    latitude: 50.4267,
    kind: "monument",
    weight: 1,
    name: "landmark.pinned.motherland",
  },
  {
    id: "kyiv.lavra",
    longitude: 30.5567,
    latitude: 50.4342,
    kind: "sacred",
    weight: 0.9,
    name: "landmark.pinned.lavra",
  },
  {
    id: "kyiv.sophia",
    longitude: 30.5143,
    latitude: 50.4529,
    kind: "sacred",
    weight: 0.85,
    name: "landmark.pinned.sophia",
  },
  {
    id: "kyiv.independence",
    longitude: 30.5242,
    latitude: 50.4503,
    kind: "civic",
    weight: 0.8,
    name: "landmark.pinned.independence",
  },
  {
    id: "kyiv.st-andrew",
    longitude: 30.5178,
    latitude: 50.4588,
    kind: "sacred",
    weight: 0.65,
    name: "landmark.pinned.standrew",
  },
  {
    id: "kyiv.golden-gate",
    longitude: 30.5133,
    latitude: 50.4488,
    kind: "monument",
    weight: 0.6,
    name: "landmark.pinned.goldenGate",
  },
  {
    id: "kyiv.trukhaniv",
    longitude: 30.5444,
    latitude: 50.4611,
    kind: "nature",
    weight: 0.6,
    name: "landmark.pinned.trukhaniv",
  },
  {
    id: "kyiv.volodymyr-hill",
    longitude: 30.5278,
    latitude: 50.4553,
    kind: "nature",
    weight: 0.55,
    name: "landmark.pinned.volodymyrHill",
  },
  {
    id: "kyiv.holosiiv",
    longitude: 30.511,
    latitude: 50.383,
    kind: "nature",
    weight: 0.55,
    name: "landmark.pinned.holosiiv",
  },
  {
    id: "kyiv.freedom-arch",
    longitude: 30.53,
    latitude: 50.4547,
    kind: "monument",
    weight: 0.5,
    name: "landmark.pinned.freedomArch",
  },
  {
    id: "kyiv.askold",
    longitude: 30.5519,
    latitude: 50.4467,
    kind: "nature",
    weight: 0.4,
    name: "landmark.pinned.askold",
  },
];

export function pinnedLandmarks(
  t: Translate,
  seeds: readonly PinnedLandmarkSeed[] = KYIV_PINNED_LANDMARKS,
): MapPinnedLandmark[] {
  return seeds.map((seed) => ({
    id: seed.id,
    longitude: seed.longitude,
    latitude: seed.latitude,
    kind: seed.kind,
    weight: seed.weight,
    title: t(seed.name),
    detail: t(KIND_KEYS[seed.kind]),
  }));
}
