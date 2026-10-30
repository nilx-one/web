// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CourierPlan } from "@nilx-one/application";
import type { HostAuthenticationEnvelope } from "@nilx-one/host-contract";
import { afterEach, expect, it, vi } from "vitest";

import { createTelegramMarketCatalog, telegramAuthorization } from "./market";

const host = (authentication: HostAuthenticationEnvelope) => ({
  getSnapshot: () => ({
    kind: "telegram" as const,
    available: true,
    theme: "light" as const,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    authentication,
  }),
});
const plan: CourierPlan = {
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

afterEach(() => {
  document.querySelectorAll("form").forEach((form) => form.remove());
  vi.unstubAllGlobals();
});

it("authorizes with signed initData and never with an empty credential", () => {
  expect(
    telegramAuthorization(
      host({
        kind: "telegram-init-data",
        initData: "query_id=1&hash=2",
        verification: "required",
      }),
    ),
  ).toBe("tma query_id=1&hash=2");
  expect(
    telegramAuthorization(
      host({
        kind: "telegram-init-data",
        initData: "",
        verification: "required",
      }),
    ),
  ).toBeUndefined();
  expect(
    telegramAuthorization(host({ kind: "browser-session" })),
  ).toBeUndefined();
});

it("opens the Market handoff for an arrival with the Telegram credential", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ code: "a".repeat(43) }), { status: 201 }),
    );
  vi.stubGlobal("fetch", request);
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  const catalog = createTelegramMarketCatalog(
    host({
      kind: "telegram-init-data",
      initData: "query_id=1&hash=2",
      verification: "required",
    }),
  );
  if (!catalog.beginVisit) throw new Error("Telegram hands over to Market");
  await catalog.beginVisit({
    point: "zoloti-vorota",
    seeds: "0",
    avaia: { longitude: 30.5, latitude: 50.4 },
    plan,
  });
  expect(request).toHaveBeenCalledWith(
    "/api/v1/identity/market-visit",
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "tma query_id=1&hash=2",
      }),
    }),
  );
  expect(submit).toHaveBeenCalledTimes(1);
});
