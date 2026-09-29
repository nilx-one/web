// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createIdentityHttpAdapter } from "./index";

const ID = `line_${"a".repeat(64)}`;

function adapterAnswering(
  answer: () => Promise<Response>,
  authorization?: string,
) {
  const fetch = vi.fn<typeof globalThis.fetch>(answer);
  return {
    fetch,
    adapter: createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => authorization,
    }),
  };
}

function lines(...rest: unknown[]): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ lines: rest }), { status: 200 }),
  );
}

const good = {
  id: ID,
  speaker: "0x0sky",
  text: "привіт",
  spoken_at: "1800000000",
};

describe("readNearbySpeech", () => {
  it("reads what can be heard through the session cookie alone", async () => {
    const { adapter, fetch } = adapterAnswering(() => lines(good));

    await expect(adapter.readNearbySpeech()).resolves.toEqual([
      { id: ID, speaker: "0x0sky", text: "привіт", spokenAt: 1_800_000_000 },
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/v1/speech/nearby", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {},
    });
  });

  it("carries a host's own proof when it has one", async () => {
    const { adapter, fetch } = adapterAnswering(() => lines(), "tma init-data");

    await expect(adapter.readNearbySpeech()).resolves.toEqual([]);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "tma init-data",
    });
  });

  it("is silent when the service is absent, refuses, or is unreachable", async () => {
    for (const status of [401, 404, 503]) {
      const { adapter } = adapterAnswering(() =>
        Promise.resolve(new Response(null, { status })),
      );
      await expect(adapter.readNearbySpeech()).resolves.toBeUndefined();
    }
    const { adapter } = adapterAnswering(() =>
      Promise.reject(new Error("offline")),
    );
    await expect(adapter.readNearbySpeech()).resolves.toBeUndefined();
  });

  it("adopts nothing from an answer it only half understands", async () => {
    const bad: unknown[] = [
      { ...good, id: "line_A" },
      { ...good, id: `line_${"A".repeat(64)}` },
      { ...good, speaker: "" },
      { ...good, text: "" },
      { ...good, text: 5 },
      { ...good, spoken_at: 1_800_000_000 },
      { ...good, spoken_at: "01" },
      { ...good, spoken_at: "-1" },
      "not a line",
      null,
    ];
    for (const line of bad) {
      const { adapter } = adapterAnswering(() => lines(good, line));
      await expect(adapter.readNearbySpeech()).resolves.toBeUndefined();
    }
    for (const body of [{}, { lines: "x" }, [], null]) {
      const { adapter } = adapterAnswering(() =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
      );
      await expect(adapter.readNearbySpeech()).resolves.toBeUndefined();
    }
    const { adapter } = adapterAnswering(() =>
      lines(...Array.from({ length: 51 }, () => good)),
    );
    await expect(adapter.readNearbySpeech()).resolves.toBeUndefined();
  });
});
