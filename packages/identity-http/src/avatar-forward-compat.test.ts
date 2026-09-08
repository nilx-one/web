// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createIdentityHttpAdapter } from "./index";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("avatar model forward compatibility", () => {
  it("preserves a newer explicit model instead of collapsing it into no choice", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "authenticated",
        identity: {
          pub_dress: "0x0sky",
          avatar_model: "future-study",
        },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readNativeContext()).resolves.toEqual({
      kind: "authenticated",
      identity: {
        pubDress: "0x0sky",
        avatarModel: "future-study",
      },
    });
  });
});
