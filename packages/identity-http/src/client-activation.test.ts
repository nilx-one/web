// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createIdentityHttpAdapter } from "./index";

const ID = "0123456789abcdef0123456789abcdef";

function adapter(response: Response) {
  const fetch = vi.fn(async () => response);
  const readActivationState = vi.fn(async () => ({
    kind: "unavailable" as const,
  }));
  return {
    fetch,
    readActivationState,
    http: createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
      core: { readActivationState },
    }),
  };
}

describe("client activation routes", () => {
  it("hands every answer to Core, success or not", async () => {
    const { fetch, readActivationState, http } = adapter(
      new Response('{"error":{"code":"sync_incomplete"}}', { status: 409 }),
    );
    await http.completeActivation(ID, "ab12");
    const [path, init] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe(`/api/v1/session/activation/requests/${ID}/complete`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-0x1-csrf": "1",
      "content-type": "application/json",
    });
    expect(init.body).toBe('{"digest":"ab12"}');
    expect(readActivationState).toHaveBeenCalledWith(
      false,
      '{"error":{"code":"sync_incomplete"}}',
    );
  });

  it("uploads raw bytes with the offset and total in the query", async () => {
    const { fetch, http } = adapter(new Response("{}"));
    await http.uploadActivationSyncPart(ID, 262144, 600000, new Uint8Array(3));
    const [path, init] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe(
      `/api/v1/session/activation/requests/${ID}/sync?offset=262144&total_bytes=600000`,
    );
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({
      "x-0x1-csrf": "1",
      "content-type": "application/octet-stream",
    });
    expect((init.body as Blob).size).toBe(3);
  });

  it("reads the state without CSRF and downloads bytes as given", async () => {
    const state = adapter(new Response("{}"));
    await state.http.readActivationState();
    const [path, init] = state.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe("/api/v1/session/activation");
    expect(init.headers).not.toHaveProperty("x-0x1-csrf");

    const part = adapter(new Response(new Uint8Array([1, 2, 3])));
    expect(await part.http.downloadActivationSyncPart(ID, 0)).toEqual({
      kind: "bytes",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const missing = adapter(new Response("", { status: 409 }));
    expect(await missing.http.downloadActivationSyncPart(ID, 0)).toEqual({
      kind: "unavailable",
    });
  });
});
