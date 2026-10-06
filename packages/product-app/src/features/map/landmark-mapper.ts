// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapArea, MapLandmark } from "@nilx-one/map-contract";
import { distanceM, type LonLat } from "@nilx-one/walk-graph";

import {
  LANDMARK_GROUPS,
  LANDMARK_MAPPING,
  normalizeLandmarks,
  normalizeName,
  type LandmarkKind,
  type NormalizedLandmark,
  type SourceCandidate,
} from "./landmark-normalize";
import MAPPER_KINDS from "./landmark-mapper-kinds.json";

/**
 * From archive features to mapped candidates (docs/avaia-osm-landmarks.md,
 * #306).
 *
 * The mapper reads what the archive carries and says which rows of the mapping
 * table each object matched. It reads no raw OSM tag: only the archive's own
 * `pois` `kind` and `name`, the fields the renderer already reads for noticing
 * and studying. Deciding what an object is stays with `normalizeLandmarks`.
 *
 * Which `pois` kinds it reads is `landmark-mapper-kinds.json`, and nowhere
 * else: `deploy/web/landmark-kinds.mjs` reads the same file and fails the
 * archive inspection when any of those kinds is absent. Parks, lakes,
 * reserves, beaches and peaks come from `landuse`/`water` polygons or `pois`
 * kinds nobody has inspected yet; until the inspection says which field
 * carries them, they are not read, rather than read from a guess.
 */

/**
 * The `pois` kinds this mapping reads, and the rows each matches. A monument
 * matches the major row; the significance rule makes it small when it is not.
 */
export const POI_KIND_ROWS: Readonly<Record<string, readonly LandmarkKind[]>> =
  checkedRows(MAPPER_KINDS.rows);

/**
 * `pois` kinds that are no landmark on their own, but say the named thing at
 * the same place is significant (the compatibility table: `attraction`,
 * `landmark`). `historic` alone resolves nothing and is not read.
 */
export const POI_SIGNIFICANCE_KINDS: ReadonlySet<string> = new Set(
  MAPPER_KINDS.significance,
);

/**
 * The areas this mapping reads, by the polygon's layer and kind, and by layer,
 * kind and kind detail: `landuse:park`, `water:water:lake`. Parks, reserves
 * and beaches are `landuse` polygons named by the `pois` point that shares
 * their id; a lake is a `water` polygon of kind `lake`, or of kind `water`
 * with the detail `lake`, named by the `water` point inside it.
 */
export const AREA_ROWS: Readonly<Record<string, readonly LandmarkKind[]>> =
  checkedRows(MAPPER_KINDS.areas);

/**
 * The mapper's version: which kinds it reads and how. Changing a row or a
 * supporting kind changes which landmarks come out, so it raises this in the
 * same commit, beside `LANDMARK_MAPPING.version`.
 */
export const LANDMARK_MAPPER_VERSION: string = MAPPER_KINDS.version;

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

/**
 * The archive's named areas as mapped candidates: every row its layer and
 * kind, or layer, kind and detail, match. Source ids stay in here, as for
 * points. An area with no row is dropped.
 */
export function mapArchiveAreas(areas: readonly MapArea[]): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  for (const area of areas) {
    const keys = [
      `${area.layer}:${area.kind}`,
      ...(area.kindDetail === undefined
        ? []
        : [`${area.layer}:${area.kind}:${area.kindDetail}`]),
    ];
    const matches = [
      ...new Set(
        keys.flatMap((key) =>
          Object.hasOwn(AREA_ROWS, key) ? (AREA_ROWS[key] ?? []) : [],
        ),
      ),
    ];
    const name = area.name.trim();
    if (matches.length === 0 || name.length === 0) continue;
    candidates.push({
      sourceId: area.id,
      matches,
      name,
      geometry: {
        type: "area",
        polygons: area.polygons.map((rings) =>
          rings.map((ring) => ring.map(([x, y]): LonLat => [x, y])),
        ),
      },
    });
  }
  return candidates.sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  );
}

/** Archive features straight to normalized landmarks. */
export function landmarksFromArchive(
  features: readonly MapLandmark[],
  areas: readonly MapArea[] = [],
): NormalizedLandmark[] {
  return normalizeLandmarks([
    ...mapArchiveLandmarks(features),
    ...mapArchiveAreas(areas),
  ]);
}

function pointOf(feature: MapLandmark): LonLat {
  return [feature.longitude, feature.latitude];
}

/** The JSON's rows, refused at load when one names no landmark kind. */
function checkedRows(
  rows: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly LandmarkKind[]>> {
  const known = new Set<string>(Object.values(LANDMARK_GROUPS).flat());
  for (const [kind, matches] of Object.entries(rows)) {
    for (const match of matches) {
      if (!known.has(match)) {
        throw new RangeError(`${kind} maps to no landmark kind: ${match}`);
      }
    }
  }
  return rows as Readonly<Record<string, readonly LandmarkKind[]>>;
}
