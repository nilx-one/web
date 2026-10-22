// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreLandmarkMapRequest, CoreRuntimePort } from "@nilx-one/application";
import type {
  MapPinnedLandmark,
  MapPinnedLandmarkKind,
} from "@nilx-one/map-contract";

/** Verified archive labels for the very same published feature IDs Core rates.
 * These are not device-normalized ids, UNESCO component ids or seeded pin ids.
 */
export interface ArchiveLandmarkLabel {
  readonly id: string;
  readonly longitudeE7: string;
  readonly latitudeE7: string;
  readonly title: string;
  readonly kind: Exclude<MapPinnedLandmarkKind, "business">;
}

const E7 = /^(0|-?[1-9][0-9]*)$/;
const ARCHIVE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const RARITIES = ["rare", "special", "exclusive"] as const;
type CuratedRarity = (typeof RARITIES)[number];
const WEIGHT: Readonly<Record<CuratedRarity, number>> = {
  rare: 0.72,
  special: 0.88,
  exclusive: 1,
};

function validE7(value: unknown, limit: number): number {
  if (typeof value !== "string" || !E7.test(value)) {
    throw new Error("invalid curated landmark coordinate");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || Math.abs(number) > limit) {
    throw new Error("invalid curated landmark coordinate");
  }
  return number;
}

function parseItem(value: unknown): {
  id: string;
  longitudeE7: string;
  latitudeE7: string;
  rarity: CuratedRarity;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid curated landmark map item");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    !ARCHIVE_ID.test(item.id) ||
    !RARITIES.includes(item.rarity as CuratedRarity) ||
    typeof item.at !== "object" ||
    item.at === null ||
    Array.isArray(item.at)
  ) {
    throw new Error("invalid curated landmark map item");
  }
  const at = item.at as Record<string, unknown>;
  validE7(at.longitude_e7, 1_800_000_000);
  validE7(at.latitude_e7, 900_000_000);
  return {
    id: item.id,
    longitudeE7: at.longitude_e7 as string,
    latitudeE7: at.latitude_e7 as string,
    rarity: item.rarity as CuratedRarity,
  };
}

/**
 * Converts one exact Core `landmark_map_view` response to the existing map-pin
 * representation. The caller must supply labels and ID/position evidence from
 * the SAME authenticated archive publication as the Core input.
 *
 * Unknown, ambiguous or displaced subjects invalidate the whole projection:
 * a Rare/Special landmark must never silently disappear or move due to an
 * untrusted display-name join. All qualifying items are returned; no top-N
 * ranking or cap is applied. Non-qualifying/Common landmarks are not projected.
 */
export function curatedLandmarkPins(
  coreReply: string,
  verifiedArchiveLabels: readonly ArchiveLandmarkLabel[],
): MapPinnedLandmark[] {
  const parsed: unknown = JSON.parse(coreReply);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid Core landmark map response");
  }
  const answer = parsed as Record<string, unknown>;
  if (
    answer.ok !== true ||
    !Number.isSafeInteger(answer.registry) ||
    (answer.registry as number) < 1 ||
    !Array.isArray(answer.landmarks)
  ) {
    throw new Error("Core landmark map projection unavailable");
  }
  const labels = new Map<string, ArchiveLandmarkLabel>();
  for (const label of verifiedArchiveLabels) {
    if (!ARCHIVE_ID.test(label.id) || labels.has(label.id)) {
      throw new Error("duplicate or invalid archive landmark identity");
    }
    validE7(label.longitudeE7, 1_800_000_000);
    validE7(label.latitudeE7, 900_000_000);
    if (
      label.title.trim() === "" ||
      !["monument", "sacred", "civic", "nature"].includes(label.kind)
    ) {
      throw new Error("invalid archive landmark label");
    }
    labels.set(label.id, label);
  }
  const seen = new Set<string>();
  const pins: MapPinnedLandmark[] = [];
  for (const raw of answer.landmarks) {
    const item = parseItem(raw);
    if (seen.has(item.id)) {
      throw new Error("duplicate Core landmark");
    }
    seen.add(item.id);
    const label = labels.get(item.id);
    if (
      label === undefined ||
      item.longitudeE7 !== label.longitudeE7 ||
      item.latitudeE7 !== label.latitudeE7
    ) {
      throw new Error("unverified Core landmark / archive mapping");
    }
    pins.push({
      id: item.id,
      longitude: Number(item.longitudeE7) / 10_000_000,
      latitude: Number(item.latitudeE7) / 10_000_000,
      kind: label.kind,
      weight: WEIGHT[item.rarity],
      title: label.title,
      detail: item.rarity,
      rarity: item.rarity,
    });
  }
  return pins;
}

/** Core projection request limit, from MAX_RARITY_MAP_LANDMARKS.
 * Never apply this as a total archive cap or a map pin display quota.
 */
export const MAX_LANDMARK_MAP_BATCH = 4096;

export interface VerifiedLandmarkArchivePublication {
  /** Used for the publisher's same-revision verification, not accepted as
   * evidence by Core on its own. The caller must authenticate this release.
   */
  readonly archiveRevision: string;
  readonly registry: number;
  readonly labels: readonly ArchiveLandmarkLabel[];
}

/**
 * Project an authenticated, completely enumerated archive publication through
 * the actual Core Wasm export, splitting only the per-call Core bound. The
 * caller owns archive authentication/completeness and must NOT pass just the
 * locally loaded tiles or hand-seeded map pins as a global publication.
 *
 * If any Core batch is missing, mismatched or invalid, fail the publication
 * atomically: never show a misleading partial roster as "all landmarks".
 */
export async function curatedLandmarkPinsFromPublication(
  core: Pick<Required<CoreRuntimePort>, "landmarkMapView">,
  publication: VerifiedLandmarkArchivePublication,
): Promise<MapPinnedLandmark[]> {
  if (
    publication.archiveRevision.trim() === "" ||
    !Number.isSafeInteger(publication.registry) ||
    publication.registry < 1
  ) {
    throw new Error("invalid verified landmark publication");
  }
  const ids = new Set<string>();
  for (const label of publication.labels) {
    if (!ARCHIVE_ID.test(label.id) || ids.has(label.id)) {
      throw new Error("duplicate or invalid published archive feature");
    }
    ids.add(label.id);
    validE7(label.longitudeE7, 1_800_000_000);
    validE7(label.latitudeE7, 900_000_000);
    if (
      label.title.trim() === "" ||
      !["monument", "sacred", "civic", "nature"].includes(label.kind)
    ) {
      throw new Error("invalid published archive label");
    }
  }
  const projected: MapPinnedLandmark[] = [];
  // Even an empty publication must verify a real Core registry: absence of
  // landmarks cannot masquerade as readiness when the runtime is missing.
  for (
    let offset = 0;
    offset < Math.max(1, publication.labels.length);
    offset += MAX_LANDMARK_MAP_BATCH
  ) {
    const labels = publication.labels.slice(offset, offset + MAX_LANDMARK_MAP_BATCH);
    const request: CoreLandmarkMapRequest = {
      registry: publication.registry,
      landmarks: labels.map((label) => ({
        id: label.id,
        at: {
          longitude_e7: label.longitudeE7,
          latitude_e7: label.latitudeE7,
        },
      })),
    };
    const coreReply = await core.landmarkMapView(request);
    const raw: unknown = JSON.parse(coreReply);
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      (raw as Record<string, unknown>).registry !== publication.registry
    ) {
      throw new Error("Core landmark registry mismatch");
    }
    projected.push(...curatedLandmarkPins(coreReply, labels));
  }
  return projected.sort((left, right) => left.id.localeCompare(right.id));
}
