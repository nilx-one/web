// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_MODELS,
  type PublishedAvatarModel,
  type StoredAvatarModel,
} from "./identity-registration";

/**
 * The 3D-model identifier the identity service keeps for a body has two forms.
 *
 * A **study** is one of the sculpted bodies this runtime publishes, named:
 * `kai-study`, `dasha-v2-study`. That is every identifier the service holds
 * today.
 *
 * A **digest** is what a customized body will be identified by: a lowercase
 * hexadecimal string of 16, 32 or 64 characters — 64, 128 or 256 bits — that
 * the customization (the body and everything it wears) hashes to. The digest
 * is opaque to the service and to every other Bond: it names an appearance
 * without describing it, and two devices that resolve the same digest draw the
 * same body. Which width is used is a choice for the hashing side; the service
 * accepts any of the three so the width can grow without a migration.
 */
export const AVATAR_MODEL_DIGEST_HEX_LENGTHS = [16, 32, 64] as const;

export type AvatarModelDigestBits = 64 | 128 | 256;

const DIGEST = /^[0-9a-f]+$/;

/** A customization digest in one of the accepted widths. */
export function isAvatarModelDigest(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (AVATAR_MODEL_DIGEST_HEX_LENGTHS as readonly number[]).includes(
      value.length,
    ) &&
    DIGEST.test(value)
  );
}

export type AvatarModelIdentifier =
  | { readonly kind: "study"; readonly model: PublishedAvatarModel }
  | {
      readonly kind: "digest";
      readonly digest: string;
      readonly bits: AvatarModelDigestBits;
    }
  | { readonly kind: "unknown"; readonly value: StoredAvatarModel };

/**
 * Reads a stored identifier without deciding anything the service did not.
 * `unknown` is a study a newer runtime published, preserved as-is — never
 * collapsed into the absence of a choice, never drawn.
 */
export function classifyAvatarModelIdentifier(
  value: StoredAvatarModel,
): AvatarModelIdentifier {
  if ((AVATAR_MODELS as readonly string[]).includes(value)) {
    return { kind: "study", model: value as PublishedAvatarModel };
  }
  if (isAvatarModelDigest(value)) {
    return {
      kind: "digest",
      digest: value,
      bits: (value.length * 4) as AvatarModelDigestBits,
    };
  }
  return { kind: "unknown", value };
}
