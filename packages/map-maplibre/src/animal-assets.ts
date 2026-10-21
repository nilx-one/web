// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AmbientAnimalKind } from "@nilx-one/map-contract";

import catUrl from "./assets/animals/cat.glb?url";
import dogUrl from "./assets/animals/dog.glb?url";
import eagleUrl from "./assets/animals/eagle.glb?url";
import piranhaUrl from "./assets/animals/piranha.glb?url";

/**
 * The animals' assets, bundled as hashed same-origin files the way the
 * backpack is: they are not generated in CI, so they live in the repository.
 * Their provenance and how they were converted is `assets/animals/README.md`.
 */
export const ANIMAL_ASSET_URLS: Readonly<Record<AmbientAnimalKind, string>> = {
  dog: dogUrl,
  cat: catUrl,
  eagle: eagleUrl,
  piranha: piranhaUrl,
};
