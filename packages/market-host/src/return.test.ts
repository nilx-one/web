// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, expect, it, vi } from "vitest";
import { createMarketReturn, marketReturnUrl } from "./return";

const visitId = "v".repeat(43);

afterEach(() => {
  history.replaceState(null, "", "/");
  sessionStorage.clear();
});

const plan = {
  origin: { longitude_e7: "305000000", latitude_e7: "504000000" },
  destination: {
    id: { owner_pub_dress: "0xda-market", number: 0 },
    pub_dress: "0xda-market-zoloti-vorota",
    description: "Golden Gate",
    isVerified: false,
    coordinate: { longitude_e7: "305131000", latitude_e7: "504489000" },
  },
  started_at_ms: "1000",
};

it("builds the return address on a 0x1 host page only", () => {
  expect(
    marketReturnUrl({ returnPath: "/telegram/", visitId, orderId: "o1" }),
  ).toBe(`https://nilx.one/telegram/?market_visit=${visitId}&market_order=o1`);
  expect(
    marketReturnUrl({
      returnPath: "//evil.example/",
      visitId,
      orderId: "o1",
    }),
  ).toBe(`https://nilx.one/?market_visit=${visitId}&market_order=o1`);
});

it("is not a return without the query", async () => {
  const request = vi.fn<typeof fetch>();
  await expect(createMarketReturn(undefined, request)()).resolves.toBe(
    undefined,
  );
  expect(request).not.toHaveBeenCalled();
});

it("confirms only Identity's matching completion and clears the address", async () => {
  history.replaceState(
    null,
    "",
    `/?market_visit=${visitId}&market_order=o1&keep=1`,
  );
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ confirmed: true, order_id: "o1" })),
    );
  await expect(createMarketReturn(() => "tma x", request)()).resolves.toEqual({
    confirmed: true,
  });
  expect(location.search).toBe("?keep=1");
  expect(request).toHaveBeenCalledWith(
    `/api/v1/identity/market-return?visit_id=${visitId}&order_id=o1`,
    expect.objectContaining({
      credentials: "same-origin",
      headers: expect.objectContaining({ authorization: "tma x" }),
    }),
  );
});

it("does not confirm a refused, mismatched or malformed return", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("{}", { status: 404 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ confirmed: true, order_id: "o2" })),
    );
  const confirm = createMarketReturn(undefined, request);
  for (const query of [
    `?market_visit=${visitId}&market_order=o1`,
    `?market_visit=${visitId}&market_order=o1`,
    `?market_visit=short&market_order=o1`,
  ]) {
    history.replaceState(null, "", `/${query}`);
    await expect(confirm()).resolves.toEqual({ confirmed: false });
  }
  expect(request).toHaveBeenCalledTimes(2);
});

it("hands back the stored route once so xPing can fly home", async () => {
  sessionStorage.setItem(
    "nilx-one.market.trip",
    JSON.stringify({ version: 1, plan }),
  );
  history.replaceState(null, "", `/?market_visit=${visitId}&market_order=o1`);
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("{}", { status: 404 }));
  await expect(createMarketReturn(undefined, request)()).resolves.toEqual({
    confirmed: false,
    trip: plan,
  });
  expect(sessionStorage.getItem("nilx-one.market.trip")).toBeNull();
});

it("drops a malformed route and leaves a plain visit's route alone", async () => {
  sessionStorage.setItem(
    "nilx-one.market.trip",
    JSON.stringify({ version: 1, plan: { origin: {} } }),
  );
  const request = vi.fn<typeof fetch>();
  await expect(createMarketReturn(undefined, request)()).resolves.toBe(
    undefined,
  );
  expect(sessionStorage.getItem("nilx-one.market.trip")).not.toBeNull();
  history.replaceState(null, "", `/?market_visit=short&market_order=o1`);
  await expect(createMarketReturn(undefined, request)()).resolves.toEqual({
    confirmed: false,
  });
  expect(sessionStorage.getItem("nilx-one.market.trip")).toBeNull();
});
