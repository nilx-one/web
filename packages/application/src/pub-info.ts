// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The public, synced slice of a Bond's `.bnd`.
 *
 * Experience totals are what `pub_info` holds today. The service stores them
 * and answers them to anyone reading the Bond; it does not price an action
 * or decide a level. Event ids are client nonces. A place never travels with
 * an award.
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
