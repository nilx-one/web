// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AwardKind } from "@nilx-one/application";
import {
  AVAIA_PICKUP_MAX_TIER,
  FIND_SEEN_EXPERIENCE,
  ORB_EXPERIENCE,
  ROLL_TABLE,
  type Tier,
} from "@nilx-one/artifact-contract";

import {
  XP_LANDMARK_NOTICED_MANUALLY,
  XP_LANDMARK_STUDIED_BY_AVAIA,
  XP_ZONE_REVEALED_BY_AVAIA,
  XP_ZONE_REVEALED_MANUALLY,
  type Earner,
} from "./progression";

/**
 * Committed experience (docs/avaia-outings.md, R3): the server holds the
 * number and a sha, the device holds the record.
 *
 * Every award is a record on this device: what was earned, by whom, and for
 * what (a cell, a landmark, a find). Its commitment is an HMAC of that record
 * and the commitment before it, under a Bond key the server never sees. The
 * commitment is all the server gets, as the award's id: without the key it
 * cannot be turned back into the record, even though every cell and every
 * find of a week could be enumerated.
 *
 * The records of one device form a chain, like commits. Replaying a history
 * must reproduce the head the server accepted, so a history that was edited
 * or cut shows.
 */

export type { AwardKind };

/** One award, as this device's history records it. Never sent. */
export interface AwardRecord {
  readonly kind: AwardKind;
  readonly earner: Earner;
  /** For `find_picked_up` only: the find's tier, which prices it. */
  readonly tier?: Tier;
  /**
   * What earned it, in this device's own terms: a cell id, a landmark id, an
   * `artifactId`. It is what makes two awards of the same kind different
   * records, and the reason the record stays here.
   */
  readonly subject: string;
  /** Wall-clock milliseconds. */
  readonly at: number;
}

/** `xp:` and 43 base64url characters: the 32 bytes of an HMAC-SHA-256. */
export type Commitment = `xp:${string}`;

const COMMITMENT = /^xp:[A-Za-z0-9_-]{43}$/;

export function isCommitment(value: unknown): value is Commitment {
  return typeof value === "string" && COMMITMENT.test(value);
}

/** Bumped whenever the canonical form below changes. */
export const AWARD_RECORD_VERSION = "nilx-one.award.v1";

/**
 * What an award pays, or `null` when the kind cannot be earned that way: a
 * zone the Avaia revealed pays the Avaia, a zone walked open pays the Bond, and
 * so on; an Avaia never picks up a find above its tier.
 */
export function awardAmount(
  record: Pick<AwardRecord, "kind" | "earner" | "tier">,
): number | null {
  const { kind, earner, tier } = record;
  if (kind !== "find_picked_up" && tier !== undefined) return null;
  switch (kind) {
    case "zone_revealed":
      return earner === "avaia" ? XP_ZONE_REVEALED_BY_AVAIA : null;
    case "zone_walked":
      return earner === "bond" ? XP_ZONE_REVEALED_MANUALLY : null;
    case "landmark_studied":
      return earner === "avaia" ? XP_LANDMARK_STUDIED_BY_AVAIA : null;
    case "landmark_noticed":
      return earner === "bond" ? XP_LANDMARK_NOTICED_MANUALLY : null;
    case "find_seen":
      return FIND_SEEN_EXPERIENCE;
    case "find_picked_up": {
      if (tier === undefined) return null;
      if (earner === "avaia" && tier > AVAIA_PICKUP_MAX_TIER) return null;
      return ROLL_TABLE.tiers[tier - 1]?.experience ?? null;
    }
    // Whoever reached it first, an Avaia or a Bond. Committed only: an orb
    // has to be claimed, so it is never published the legacy way.
    case "orb_picked_up":
      return ORB_EXPERIENCE;
    // Priced by its recipe in Core, by the service: never estimated here,
    // and never published the legacy way.
    case "craft_finished":
      return null;
  }
}

/**
 * A finished craft's subject: its recipe and when it started, so two crafts
 * of one recipe are two records. Only the recipe is ever sent.
 */
export function craftSubject(recipe: string, startedMs: number): string {
  return `craft:${recipe}:${startedMs}`;
}

/** The recipe a finished craft's subject names. */
export function craftRecipeOf(subject: string): string {
  return subject.split(":")[1] ?? "";
}

/**
 * The bytes a commitment signs: the version, the parent, then the record,
 * one field per line. A field never holds a line break, so the form cannot
 * be read two ways.
 */
export function canonicalAward(
  parent: Commitment | null,
  record: AwardRecord,
): string {
  const fields = [
    AWARD_RECORD_VERSION,
    parent ?? "-",
    record.kind,
    record.earner,
    record.tier === undefined ? "-" : String(record.tier),
    record.subject,
    String(record.at),
  ];
  if (fields.some((field) => /[\r\n]/.test(field))) {
    throw new RangeError("an award field holds a line break");
  }
  return fields.join("\n");
}

/** A new history key. It travels only directly, to this Bond's other devices. */
export async function newHistoryKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign", "verify"],
  );
}

/** A history key from its raw 32 bytes, as another device of this Bond sent it. */
export async function importHistoryKey(
  raw: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  if (raw.byteLength !== 32) {
    throw new RangeError("a history key is 32 bytes");
  }
  return globalThis.crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

/** The commitment to `record` on top of `parent`. */
export async function commitAward(
  key: CryptoKey,
  parent: Commitment | null,
  record: AwardRecord,
): Promise<Commitment> {
  const bytes = new TextEncoder().encode(canonicalAward(parent, record));
  const mac = await globalThis.crypto.subtle.sign("HMAC", key, bytes);
  return `xp:${base64url(new Uint8Array(mac))}`;
}

/**
 * The head a history replays to: each record committed on top of the one
 * before, from `null`. Equal to the server's head when nothing was edited,
 * dropped or added; `null` for an empty history.
 */
export async function replayChain(
  key: CryptoKey,
  records: readonly AwardRecord[],
): Promise<Commitment | null> {
  let head: Commitment | null = null;
  for (const record of records) head = await commitAward(key, head, record);
  return head;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
