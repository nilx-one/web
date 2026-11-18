// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  confirmAisMigration,
  readAisMigrationReturn,
  startAisMigration,
} from "./ais-migration";

function answer(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("moving a Bond to aiaiaiai", () => {
  it("starts with the CSRF header and hands back the issuer's address", async () => {
    const fetcher = answer(200, {
      authorization_url: "https://auth.aiaiaiai.org/authorize?x=1",
    });
    expect(await startAisMigration(fetcher)).toEqual({
      kind: "redirect",
      url: "https://auth.aiaiaiai.org/authorize?x=1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/aiaiaiai/migrate/start",
      expect.objectContaining({
        method: "POST",
        headers: { "x-0x1-csrf": "1" },
      }),
    );
  });

  it("never sends the browser to a non-https foreign address", async () => {
    const fetcher = answer(200, {
      authorization_url: "http://attacker.example/authorize",
    });
    expect(await startAisMigration(fetcher)).toEqual({
      kind: "failed",
      reason: "unavailable",
    });
  });

  it("names why a start was refused", async () => {
    for (const [code, reason] of [
      ["fresh_bond_sign_in_required", "fresh-sign-in-required"],
      ["bond_already_attached", "already-attached"],
      ["already_aiaiaiai", "already-aiaiaiai"],
      ["migration_pending", "in-progress"],
    ] as const) {
      expect(await startAisMigration(answer(409, { error: { code } }))).toEqual(
        { kind: "failed", reason },
      );
    }
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await startAisMigration(down)).toEqual({
      kind: "failed",
      reason: "unavailable",
    });
  });

  it("confirms, follows only a same-origin next, and names refusals", async () => {
    expect(
      await confirmAisMigration(
        answer(200, {
          attached: true,
          next: "/api/v1/auth/aiaiaiai/start?return=%2F",
        }),
      ),
    ).toEqual({
      kind: "attached",
      next: "/api/v1/auth/aiaiaiai/start?return=%2F",
    });
    expect(
      await confirmAisMigration(
        answer(200, { attached: true, next: "//attacker.example" }),
      ),
    ).toEqual({ kind: "attached", next: "/" });
    for (const [code, reason] of [
      ["migration_expired", "expired"],
      ["aiaiaiai_proof_invalid", "proof-invalid"],
      ["identity_conflict", "identity-conflict"],
    ] as const) {
      expect(
        await confirmAisMigration(answer(409, { error: { code } })),
      ).toEqual({ kind: "failed", reason });
    }
  });

  it("reads what the callback left in the address", () => {
    expect(readAisMigrationReturn("")).toBeUndefined();
    expect(readAisMigrationReturn("?migration=confirm")).toEqual({
      stage: "confirm",
    });
    expect(
      readAisMigrationReturn("?migration_error=migration_expired"),
    ).toEqual({
      stage: "error",
      reason: "expired",
    });
    expect(
      readAisMigrationReturn("?migration_error=migration_unavailable"),
    ).toEqual({
      stage: "error",
      reason: "unavailable",
    });
  });
});
