// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createIdentityHttpAdapter } from "./index";

function adapterAnswering(answer: () => Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(answer);
  return {
    fetch,
    adapter: createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma init-data",
    }),
  };
}

function stations(...rest: unknown[]): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ stations: rest }), { status: 200 }),
  );
}

const zolotiVorota = {
  pub_dress: "xda-market-zoloti-vorotai",
  owner_pub_dress: "0xda-market",
  coordinate: { latitude_e7: "504489000", longitude_e7: "305131000" },
};

describe("readBusinessStations", () => {
  it("reads every station without any proof of who is asking", async () => {
    const { adapter, fetch } = adapterAnswering(() => stations(zolotiVorota));

    await expect(adapter.readBusinessStations()).resolves.toEqual([
      {
        pubDress: "xda-market-zoloti-vorotai",
        ownerPubDress: "0xda-market",
        longitude: 30.5131,
        latitude: 50.4489,
      },
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/stations", {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });
  });

  it("drops the whole answer when one station is malformed", async () => {
    const { adapter } = adapterAnswering(() =>
      stations(zolotiVorota, { ...zolotiVorota, coordinate: null }),
    );
    await expect(adapter.readBusinessStations()).resolves.toBeUndefined();
  });

  it("treats a refusal or an unreachable service as no answer", async () => {
    const refused = adapterAnswering(() =>
      Promise.resolve(new Response("{}", { status: 503 })),
    );
    await expect(
      refused.adapter.readBusinessStations(),
    ).resolves.toBeUndefined();

    const offline = adapterAnswering(() => Promise.reject(new Error("down")));
    await expect(
      offline.adapter.readBusinessStations(),
    ).resolves.toBeUndefined();
  });
});
