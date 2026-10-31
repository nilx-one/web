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

const TRIP = "nilx-one.market.trip";
const storeTrip = (record: unknown) =>
  sessionStorage.setItem(TRIP, JSON.stringify(record));
const stored = () => JSON.parse(sessionStorage.getItem(TRIP) ?? "null");
const returnTo = (query: string) => history.replaceState(null, "", `/${query}`);
const confirmed = () =>
  new Response(JSON.stringify({ confirmed: true, order_id: "o1" }));

it("hands back the route home only with a confirmed purchase, once", async () => {
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi.fn<typeof fetch>().mockResolvedValue(confirmed());
  await expect(createMarketReturn(undefined, request)()).resolves.toEqual({
    confirmed: true,
    trip: plan,
  });
  expect(sessionStorage.getItem(TRIP)).toBeNull();
});

it.each([
  ["Identity is unavailable", () => new Response("{}", { status: 503 })],
  [
    "the order does not match",
    () => new Response(JSON.stringify({ confirmed: true, order_id: "o2" })),
  ],
])(
  "keeps the route and the order to ask again when %s",
  async (_case, answer) => {
    storeTrip({ version: 1, plan });
    returnTo(`?market_visit=${visitId}&market_order=o1`);
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => answer());
    const confirm = createMarketReturn(undefined, request);
    await expect(confirm()).resolves.toEqual({ confirmed: false });
    expect(stored()).toEqual({
      version: 1,
      plan,
      pending: { visitId, orderId: "o1", attempts: 1 },
    });
    // The next page load of this tab asks again, without the query.
    request.mockResolvedValueOnce(confirmed());
    await expect(confirm()).resolves.toEqual({ confirmed: true, trip: plan });
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/identity/market-return?visit_id=${visitId}&order_id=o1`,
      expect.anything(),
    );
    expect(sessionStorage.getItem(TRIP)).toBeNull();
  },
);

it("stops asking after a few unconfirmed tries but keeps the route", async () => {
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("{}", { status: 503 }));
  const confirm = createMarketReturn(undefined, request);
  for (let i = 0; i < 3; i++)
    await expect(confirm()).resolves.toEqual({ confirmed: false });
  expect(stored()).toEqual({ version: 1, plan });
  await expect(confirm()).resolves.toBe(undefined);
  expect(request).toHaveBeenCalledTimes(3);
});

it("never asks about a forged return and leaves the route alone", async () => {
  storeTrip({ version: 1, plan });
  returnTo("?market_visit=short&market_order=o1");
  const request = vi.fn<typeof fetch>();
  await expect(createMarketReturn(undefined, request)()).resolves.toEqual({
    confirmed: false,
  });
  expect(request).not.toHaveBeenCalled();
  expect(stored()).toEqual({ version: 1, plan });
});

it.each([
  [
    "an out-of-range longitude",
    {
      ...plan,
      origin: { longitude_e7: "9999999999", latitude_e7: "504000000" },
    },
  ],
  [
    "an out-of-range latitude",
    {
      ...plan,
      destination: {
        ...plan.destination,
        coordinate: { longitude_e7: "305131000", latitude_e7: "-900000001" },
      },
    },
  ],
  [
    "a station of another owner",
    {
      ...plan,
      destination: {
        ...plan.destination,
        id: { owner_pub_dress: "0x0sky", number: 0 },
      },
    },
  ],
  [
    "a station address outside Market",
    {
      ...plan,
      destination: { ...plan.destination, pub_dress: "javascript:alert(1)" },
    },
  ],
])("drops a stored route with %s", async (_case, broken) => {
  storeTrip({ version: 1, plan: broken });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi.fn<typeof fetch>().mockResolvedValue(confirmed());
  await expect(createMarketReturn(undefined, request)()).resolves.toEqual({
    confirmed: true,
  });
  expect(sessionStorage.getItem(TRIP)).toBeNull();
});
