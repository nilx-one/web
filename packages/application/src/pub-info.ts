// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The public, synced slice of a Bond's `.bnd`.
 *
 * Experience totals are what `pub_info` holds today. They are an owner
 * assertion: the service stores them and answers them to anyone reading the
 * Bond, labeled `authority: "client"` on the wire. That label is written by
 * the service. A client cannot choose it, and a payload that does not carry
 * it is not adopted. The service does not price an action, decide a level,
 * or attest that the play happened. Event ids are client nonces. A place
 * never travels with an award. Caps on carry and on an event amount are
 * abuse bounds on an untrusted number, not proof the award was earned.
 */
export interface PubInfoExperience {
  readonly bondXp: number;
  readonly avaiaXp: number;
}

export type ExperienceEarner = "bond" | "avaia";

export interface ExperienceEvent {
  readonly id: string;
  readonly earner: ExperienceEarner;
  readonly amount: number;
}

export interface ExperiencePublication {
  readonly carry?: PubInfoExperience;
  readonly events: readonly ExperienceEvent[];
}

export type PubInfoRejection =
  "authentication-required" | "inactive" | "invalid" | "rate-limited";

export type PubInfoExperienceResult =
  | { kind: "published"; experience: PubInfoExperience }
  | { kind: "rejected"; reason: PubInfoRejection }
  | { kind: "service-unavailable" };

/**
 * Read and publish the experience in `pub_info`. Kept apart from
 * `IdentityAccessPort` so a host whose service has not published this
 * capability stays a valid identity client.
 */
export interface PubInfoAccessPort {
  readPubInfo(): Promise<PubInfoExperienceResult>;
  publishExperience(
    publication: ExperiencePublication,
  ): Promise<PubInfoExperienceResult>;
}

export function hasPubInfoAccess(value: unknown): value is PubInfoAccessPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PubInfoAccessPort>;
  return (
    typeof candidate.readPubInfo === "function" &&
    typeof candidate.publishExperience === "function"
  );
}

/**
 * What an award is for (docs/avaia-outings.md, R3). The service prices each
 * kind itself; an award never carries an amount.
 */
export type AwardKind =
  | "zone_revealed"
  | "zone_walked"
  | "landmark_studied"
  | "landmark_noticed"
  | "find_seen"
  | "find_picked_up"
  | "craft_finished"
  | "orb_picked_up";

/**
 * One award as the service gets it: its commitment, where it sits on this
 * device's chain, and what it is priced by. The record it commits to stays
 * on the device. Only a pick-up of a claimed tier (4 to 6) names a find, by
 * its `artifactId`, and it has to.
 */
export interface CommittedAward {
  /** The commitment: `xp:` and 43 base64url characters. */
  readonly id: string;
  /** The commitment before it on the same chain; `null` for the first. */
  readonly parent: string | null;
  /** This device's chain: `ch:` and 8 to 43 base64url characters. */
  readonly chain: string;
  readonly kind: AwardKind;
  readonly earner: ExperienceEarner;
  /** For `find_picked_up` only. */
  readonly tier?: number;
  /** For a pick-up of tier 4 to 6 only. */
  readonly artifactId?: string;
  /** For `craft_finished` only: Core's recipe id, which prices it. */
  readonly recipe?: string;
  /** For `orb_picked_up` only, with its find's `artifactId`: which orb. */
  readonly orb?: number;
}

/**
 * What the service answered one award:
 *
 * - `accepted`: paid, and its chain moved on to it;
 * - `duplicate`: this commitment was paid before; nothing pays twice;
 * - `behind`: its parent is not the chain's head, which is `head`;
 * - `capped`: the week holds no more of its kind;
 * - `already-yours`: another device of this Bond claimed the find first;
 * - `taken`: another Bond claimed the find first. Oh crap;
 * - `too-many-chains`: the Bond holds as many chains as it may.
 *
 * Only `accepted` moves a chain.
 */
export type AwardOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "behind"; readonly head: string | null }
  | { readonly kind: "capped" }
  | { readonly kind: "already-yours" }
  | { readonly kind: "taken" }
  | { readonly kind: "too-many-chains" };

export interface AwardResult {
  readonly id: string;
  readonly outcome: AwardOutcome;
}

export type CommitAwardsResult =
  | {
      kind: "committed";
      experience: PubInfoExperience;
      results: readonly AwardResult[];
    }
  | { kind: "rejected"; reason: PubInfoRejection }
  | { kind: "service-unavailable" };

/** One claim of the week: the find's `artifactSha`, and whether it is this Bond's. */
export interface ClaimedFindView {
  readonly sha: string;
  readonly yours: boolean;
}

export type ClaimsReadResult =
  | { kind: "read"; epoch: number; claims: readonly ClaimedFindView[] }
  | { kind: "rejected"; reason: PubInfoRejection }
  | { kind: "service-unavailable" };

/** The most sha buckets one read of the claimed set may ask for. */
export const MAX_CLAIM_BUCKETS = 16;

/**
 * Commit awards and read the week's claims on rare finds. Kept apart from
 * `PubInfoAccessPort` so a host whose service predates committed awards
 * stays a valid client.
 */
export interface CommittedAwardAccessPort {
  commitAwards(awards: readonly CommittedAward[]): Promise<CommitAwardsResult>;
  /** `buckets`: up to sixteen, each two lowercase hex digits. */
  readClaims(buckets: readonly string[]): Promise<ClaimsReadResult>;
}

export function hasCommittedAwardAccess(
  value: unknown,
): value is CommittedAwardAccessPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CommittedAwardAccessPort>;
  return (
    typeof candidate.commitAwards === "function" &&
    typeof candidate.readClaims === "function"
  );
}

/**
 * A spill of orbs as the service answers it: the find's public sha, how many
 * orbs fell, when they are gone (wall-clock milliseconds), and which of them
 * someone already picked up. It names nobody, neither who spilled nor who
 * picked up.
 */
export interface OrbSpillView {
  readonly sha: string;
  readonly count: number;
  readonly expiresAt: number;
  readonly taken: readonly number[];
}

export type OrbSpillResult =
  | { kind: "spilled"; spill: OrbSpillView }
  | { kind: "rejected"; reason: PubInfoRejection }
  | { kind: "service-unavailable" };

export type OrbSpillsReadResult =
  | { kind: "read"; spills: readonly OrbSpillView[] }
  | { kind: "rejected"; reason: PubInfoRejection }
  | { kind: "service-unavailable" };

/**
 * Spills the orbs of a find whose cell this Bond opened, and reads the live
 * spills around by sha bucket, as claims are read. Apart from
 * `CommittedAwardAccessPort` so a service without spills stays a valid host:
 * its Bonds simply see no orbs.
 */
export interface OrbSpillAccessPort {
  spillOrbs(artifactId: string): Promise<OrbSpillResult>;
  /** `buckets`: up to sixteen, each two lowercase hex digits. */
  readOrbSpills(buckets: readonly string[]): Promise<OrbSpillsReadResult>;
}

export function hasOrbSpillAccess(value: unknown): value is OrbSpillAccessPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OrbSpillAccessPort>;
  return (
    typeof candidate.spillOrbs === "function" &&
    typeof candidate.readOrbSpills === "function"
  );
}
