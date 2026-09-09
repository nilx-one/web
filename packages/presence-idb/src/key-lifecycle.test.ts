// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  PresenceJournalKeyMissingError,
  resolveJournalKey,
} from "./key-lifecycle";

describe("presence journal key lifecycle", () => {
  it("uses the existing key even when visits already exist", () => {
    const key = { id: "local-key" };

    expect(resolveJournalKey(key, 12)).toBe(key);
  });

  it("allows first-key creation only for an empty journal", () => {
    expect(resolveJournalKey(undefined, 0)).toBeNull();
  });

  it("fails closed when ciphertext exists without its key", () => {
    expect(() => resolveJournalKey(undefined, 1)).toThrow(
      PresenceJournalKeyMissingError,
    );
  });
});
