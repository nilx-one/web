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
const unavailable = () => new Response("{}", { status: 503 });
const DAY = 24 * 60 * 60_000;
const RECHECK = [30_000, 120_000, 600_000];

/** Core's answers; the route and policy rules themselves are tested in Core. */
function core(flyable = true) {
  return {
    marketReturnTrip: vi.fn(async () => flyable),
    marketReturnPolicy: vi.fn(async () => ({
      pendingMs: DAY,
      recheckMs: RECHECK,
    })),
  };
}

it("hands back the route home only with a confirmed purchase, once", async () => {
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi.fn<typeof fetch>().mockResolvedValue(confirmed());
  const rules = core();
  await expect(
    createMarketReturn(undefined, request, rules)(),
  ).resolves.toEqual({ confirmed: true, trip: plan });
  expect(rules.marketReturnTrip).toHaveBeenCalledWith(plan);
  expect(sessionStorage.getItem(TRIP)).toBeNull();
});

it.each([
  ["Identity is unavailable", unavailable],
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
    const confirm = createMarketReturn(undefined, request, core());
    await expect(confirm()).resolves.toEqual({
      confirmed: false,
      recheckMs: RECHECK,
    });
    expect(stored()).toEqual({
      version: 1,
      plan,
      pending: { visitId, orderId: "o1", since: expect.any(Number) },
    });
    // A later check of this tab asks again, without the query.
    request.mockResolvedValueOnce(confirmed());
    await expect(confirm()).resolves.toEqual({ confirmed: true, trip: plan });
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/identity/market-return?visit_id=${visitId}&order_id=o1`,
      expect.anything(),
    );
    expect(sessionStorage.getItem(TRIP)).toBeNull();
  },
);

it("recovers a paid order after any number of failed checks within Core's window", async () => {
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => unavailable());
  const confirm = createMarketReturn(undefined, request, core());
  for (let i = 0; i < 10; i++)
    await expect(confirm()).resolves.toEqual({
      confirmed: false,
      recheckMs: RECHECK,
    });
  request.mockResolvedValueOnce(confirmed());
  await expect(confirm()).resolves.toEqual({ confirmed: true, trip: plan });
});

it("lets an unconfirmed order go after Core's window but keeps the route", async () => {
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => unavailable());
  const confirm = createMarketReturn(undefined, request, core());
  await confirm();
  now.mockReturnValue(start + DAY);
  // The stale order is no longer asked about, and confirms nothing.
  await expect(confirm()).resolves.toBe(undefined);
  expect(stored()).toEqual({ version: 1, plan });
  expect(request).toHaveBeenCalledTimes(1);
  now.mockRestore();
});

it("never asks about a forged return and leaves the route alone", async () => {
  storeTrip({ version: 1, plan });
  returnTo("?market_visit=short&market_order=o1");
  const request = vi.fn<typeof fetch>();
  await expect(
    createMarketReturn(undefined, request, core())(),
  ).resolves.toEqual({ confirmed: false });
  expect(request).not.toHaveBeenCalled();
  expect(stored()).toEqual({ version: 1, plan });
});

it("drops a route Core says may not be flown", async () => {
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi.fn<typeof fetch>().mockResolvedValue(confirmed());
  await expect(
    createMarketReturn(undefined, request, core(false))(),
  ).resolves.toEqual({ confirmed: true });
  expect(sessionStorage.getItem(TRIP)).toBeNull();
});

it("without Core confirms but neither flies nor keeps an unconfirmed order", async () => {
  storeTrip({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => unavailable());
  await expect(createMarketReturn(undefined, request)()).resolves.toEqual({
    confirmed: false,
  });
  expect(stored()).toEqual({ version: 1, plan });
  returnTo(`?market_visit=${visitId}&market_order=o1`);
  request.mockResolvedValueOnce(confirmed());
  const broken = {
    marketReturnTrip: vi.fn(async () => {
      throw new Error("runtime lost");
    }),
  };
  await expect(
    createMarketReturn(undefined, request, broken)(),
  ).resolves.toEqual({ confirmed: true });
  // A confirmed order needs nothing more of the tab: the route is cleared.
  expect(sessionStorage.getItem(TRIP)).toBeNull();
});
