// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { parsePubDress, type PubDressSelection } from "@nilx-one/application";

function scalarLength(value: string): number {
  return [...value].length;
}

function isReplacement(previous: string, next: string): boolean {
  if (previous.length === 0) {
    return scalarLength(next) >= 3;
  }
  return Math.abs(scalarLength(next) - scalarLength(previous)) > 1;
}

/**
 * Accepts credential-manager username shapes without changing the canonical
 * split-field model used by the product UI.
 *
 * - `0x0sky` -> discriminator `0`, slug `sky`
 * - `sky` -> keep the selected discriminator, slug `sky`
 * - `0sky` -> discriminator `0`, slug `sky` when inserted as a replacement
 *
 * Compact numeric input is deliberately treated as a discriminator only for a
 * replacement/autofill-sized edit. This keeps manually typed slugs such as
 * `012` representable instead of reinterpreting them while the user types.
 */
export function normalizePubDressCredentialInput(
  next: PubDressSelection,
  previous: PubDressSelection,
): PubDressSelection {
  if (next.discriminator !== previous.discriminator) {
    return next;
  }

  const canonical = parsePubDress(next.slug);
  if (canonical !== undefined) {
    return canonical;
  }

  const characters = [...next.slug];
  const discriminator = characters[0];
  if (
    discriminator !== undefined &&
    /^[0-9]$/.test(discriminator) &&
    characters.length >= 3 &&
    isReplacement(previous.slug, next.slug)
  ) {
    return {
      discriminator,
      slug: characters.slice(1).join(""),
    };
  }

  return next;
}
