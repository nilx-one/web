// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";
import { distanceM, type LonLat } from "@nilx-one/walk-graph";

import {
  LANDMARK_MAPPING,
  normalizeLandmarks,
  normalizeName,
  type LandmarkKind,
  type NormalizedLandmark,
  type SourceCandidate,
} from "./landmark-normalize";

/**
 * From archive features to mapped candidates (docs/avaia-osm-landmarks.md,
 * #306).
 *
 * The mapper reads what the archive carries and says which rows of the mapping
 * table each object matched. It reads no raw OSM tag: only the archive's own
 * `pois` `kind` and `name`, the fields the renderer already reads for noticing
 * and studying, and that `deploy/web/landmark-kinds.mjs` checks against the
 * deployed archive. Deciding what an object is stays with `normalizeLandmarks`.
 *
 * Only rows whose archive source is confirmed are enabled. Parks, lakes,
 * reserves, beaches and peaks come from `landuse`/`water` polygons or `pois`
 * kinds nobody has inspected yet; until the archive inspection says which
 * field carries them, they are not read, rather than read from a guess.
 */

/**
 * The `pois` kinds this mapping reads, and the rows each matches. Every key is
 * in the renderer's `LANDMARK_KINDS`, so the deploy check already fails when
 * the archive stops carrying all of them. A monument matches the major row;
 * the significance rule makes it small when it is not.
 */
export const POI_KIND_ROWS: Readonly<Record<string, readonly LandmarkKind[]>> =
  {
    monument: ["major_monument"],
    memorial: ["major_monument"],
    artwork: ["artwork"],
    sculpture: ["artwork"],
    statue: ["artwork"],
    museum: ["museum"],
    castle: ["castle"],
    fort: ["fort"],
    ruins: ["ruins"],
    archaeological_site: ["archaeological_site"],
    viewpoint: ["viewpoint"],
  };

/**
 * `pois` kinds that are no landmark on their own, but say the named thing at
 * the same place is significant (the compatibility table: `attraction`,
 * `landmark`). `historic` alone resolves nothing and is not read.
 */
export const POI_SIGNIFICANCE_KINDS: ReadonlySet<string> = new Set([
  "attraction",
  "landmark",
]);

/**
 * The mapper's version: which kinds it reads and how. Changing a row or a
 * supporting kind changes which landmarks come out, so it raises this in the
 * same commit, beside `LANDMARK_MAPPING.version`.
 */
export const LANDMARK_MAPPER_VERSION = "1.0";

/**
 * The archive's landmark points as mapped candidates. Pure and deterministic:
 * the same features in any order give the same candidates, in source id order.
 * A feature with no row, or no usable place, is dropped, not defaulted.
 */
export function mapArchiveLandmarks(
  features: readonly MapLandmark[],
): SourceCandidate[] {
  const supporting = features.flatMap((feature) => {
    const name = feature.name?.trim();
    return POI_SIGNIFICANCE_KINDS.has(feature.kind) &&
      name !== undefined &&
      name.length > 0
      ? [{ name: normalizeName(name), at: pointOf(feature) }]
      : [];
  });

  const candidates: SourceCandidate[] = [];
  for (const feature of features) {
    const matches = Object.hasOwn(POI_KIND_ROWS, feature.kind)
      ? POI_KIND_ROWS[feature.kind]
      : undefined;
    if (matches === undefined) continue;
    const at = pointOf(feature);
    const name = feature.name?.trim();
    const named = name !== undefined && name.length > 0;
    const attraction =
      named &&
      supporting.some(
        (support) =>
          support.name === normalizeName(name) &&
          distanceM(support.at, at) <= LANDMARK_MAPPING.duplicateWithinMeters,
      );
    candidates.push({
      sourceId: feature.id,
      matches,
      ...(named ? { name } : {}),
      geometry: { type: "point", point: at },
      ...(attraction ? { attraction } : {}),
    });
  }
  return candidates.sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  );
}

/** Archive features straight to normalized landmarks. */
export function landmarksFromArchive(
  features: readonly MapLandmark[],
): NormalizedLandmark[] {
  return normalizeLandmarks(mapArchiveLandmarks(features));
}

function pointOf(feature: MapLandmark): LonLat {
  return [feature.longitude, feature.latitude];
}
