// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export class PresenceJournalKeyMissingError extends Error {
  constructor() {
    super("Presence journal key is missing for stored visit records");
    this.name = "PresenceJournalKeyMissingError";
  }
}

/**
 * Resolve the only two valid Phase 1 key states.
 *
 * `null` means an empty journal may create its first local key. Existing visit
 * records without their key are deliberately unrecoverable: generating a new
 * key would create a mixed database where old ciphertext can never be read.
 */
export function resolveJournalKey<T>(
  existing: T | undefined,
  storedVisitCount: number,
): T | null {
  if (existing !== undefined) return existing;
  if (storedVisitCount > 0) throw new PresenceJournalKeyMissingError();
  return null;
}
