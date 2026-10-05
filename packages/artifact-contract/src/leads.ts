// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { canPickUp } from "./experience";
import type { ArtifactId, EpochId, FindRoll, SegmentId, Tier } from "./index";

/**
 * Leads: rare finds the Avaia saw and left for the person
 * (docs/avaia-outings.md §3.4, #305).
 *
 * A lead is the least a device needs to send its person after a find: which
 * find, in which segment and week, how rare, and when it was seen. It has no
 * coordinates and no name, it is not on the map, not an outing target, and
 * not a record anywhere but this device. It lives until its week ends, since
 * the segment rolls anew after that, and closes when the find is picked up.
 */
export interface FindLead {
  readonly artifactId: ArtifactId;
  readonly segment: SegmentId;
  readonly epoch: EpochId;
  readonly tier: Tier;
  /** Wall-clock milliseconds of the first sighting. */
  readonly seenAt: number;
}

/** The most leads a device keeps; past it, the oldest sighting goes first. */
export const MAX_LEADS = 12;

/**
 * Leads after the Avaia sees `roll` at `seenAt`. Only a find the Avaia may not
 * pick up itself becomes a lead; seeing one already held changes nothing, so
 * walking past it again keeps the first sighting.
 */
export function noteLead(
  leads: readonly FindLead[],
  roll: FindRoll,
  seenAt: number,
): FindLead[] {
  if (canPickUp(roll, "avaia")) return [...leads];
  if (leads.some((lead) => lead.artifactId === roll.artifactId)) {
    return [...leads];
  }
  const next: FindLead[] = [
    ...leads,
    {
      artifactId: roll.artifactId,
      segment: roll.segment,
      epoch: roll.epoch,
      tier: roll.tier,
      seenAt,
    },
  ];
  return capped(next);
}

/** The leads still worth walking to: those of the current week. */
export function liveLeads(
  leads: readonly FindLead[],
  epoch: EpochId,
): FindLead[] {
  return leads.filter((lead) => lead.epoch === epoch);
}

/** Leads after a find is picked up: its lead, if any, is closed. */
export function closeLead(
  leads: readonly FindLead[],
  artifactId: ArtifactId,
): FindLead[] {
  return leads.filter((lead) => lead.artifactId !== artifactId);
}

/** The live leads in a segment, for a walk that comes back to it. */
export function leadsIn(
  leads: readonly FindLead[],
  segment: SegmentId,
  epoch: EpochId,
): FindLead[] {
  return leads.filter(
    (lead) => lead.segment === segment && lead.epoch === epoch,
  );
}

/**
 * Leads read back from storage. Anything malformed is dropped rather than
 * trusted, duplicates keep their first sighting, and the cap still holds.
 */
export function parseLeads(value: unknown): FindLead[] {
  if (!Array.isArray(value)) return [];
  const leads: FindLead[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const lead = parseLead(item);
    if (lead === undefined || seen.has(lead.artifactId)) continue;
    seen.add(lead.artifactId);
    leads.push(lead);
  }
  return capped(leads);
}

function parseLead(item: unknown): FindLead | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const { artifactId, segment, epoch, tier, seenAt } = item as Record<
    string,
    unknown
  >;
  if (
    typeof artifactId !== "string" ||
    !/^art:seg:-?\d+:-?\d+:e-?\d+:\d+:\d+$/.test(artifactId) ||
    typeof segment !== "string" ||
    !/^seg:-?\d+:-?\d+$/.test(segment) ||
    typeof epoch !== "string" ||
    !/^e-?\d+$/.test(epoch) ||
    !artifactId.startsWith(`art:${segment}:${epoch}:`) ||
    typeof tier !== "number" ||
    !Number.isInteger(tier) ||
    tier < 1 ||
    tier > 6 ||
    typeof seenAt !== "number" ||
    !Number.isFinite(seenAt)
  ) {
    return undefined;
  }
  return {
    artifactId: artifactId as ArtifactId,
    segment: segment as SegmentId,
    epoch: epoch as EpochId,
    tier: tier as Tier,
    seenAt,
  };
}

/** Newest sightings kept, oldest dropped; ties go by artifact id. */
function capped(leads: FindLead[]): FindLead[] {
  if (leads.length <= MAX_LEADS) return leads;
  const keep = new Set(
    [...leads]
      .sort(
        (a, b) =>
          b.seenAt - a.seenAt ||
          (a.artifactId < b.artifactId
            ? -1
            : a.artifactId > b.artifactId
              ? 1
              : 0),
      )
      .slice(0, MAX_LEADS),
  );
  return leads.filter((lead) => keep.has(lead));
}
