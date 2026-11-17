// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, expect, it, vi } from "vitest";
import type { CourierPlan } from "@nilx-one/application";
import { createMarketVisit } from "./visit";

const beginMarketVisit = createMarketVisit();

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
const visit = {
  point: "zoloti-vorota",
  avaia: { longitude: 30.5, latitude: 50.4 },
  plan,
};
const response = (
  action = "https://0xda-market.nilx.one/nilx-browser/exchange",
) =>
  new Response(JSON.stringify({ code: "a".repeat(43), action }), {
    status: 201,
  });

afterEach(() => {
  document.querySelectorAll("form").forEach((form) => form.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("continues the one-time handoff if sessionStorage is restricted", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage disabled");
  });
  const request = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", request);
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  await expect(beginMarketVisit(visit)).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledTimes(1);
  const requestBody: unknown = JSON.parse(
    String(request.mock.calls[0]?.[1]?.body),
  );
  expect(requestBody).toEqual({
    point: "zoloti-vorota",
    avaia: { longitude: 30.5, latitude: 50.4 },
    return_path: "/",
  });
  expect(requestBody).not.toHaveProperty("seeds");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(document.querySelector("form")?.action).toBe(
    "https://0xda-market.nilx.one/nilx-browser/exchange",
  );
});

it("must not submit a stale handoff after the selected arrival is cancelled", async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", request);
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  const controller = new AbortController();
  const pending = beginMarketVisit({ ...visit, signal: controller.signal });
  controller.abort();
  finish(response());
  await expect(pending).rejects.toThrow("Market visit cancelled");
  expect(submit).not.toHaveBeenCalled();
});

it("proves the Bond with the host credential when the host has no session cookie", async () => {
  const request = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", request);
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  await createMarketVisit(() => "tma signed-init-data")(visit);
  expect(request.mock.calls[0]?.[1]?.headers).toEqual({
    "Content-Type": "application/json",
    "x-0x1-csrf": "1",
    authorization: "tma signed-init-data",
  });
});

it("sends no empty credential when the host has none", async () => {
  const request = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", request);
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  await createMarketVisit(() => undefined)(visit);
  expect(request.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
    "authorization",
  );
});

it("sends only the coordinates of a remembered Avaia position", async () => {
  const request = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", request);
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  const remembered = { longitude: 30.5, latitude: 50.4, bearingDeg: 90 };
  await beginMarketVisit({ ...visit, avaia: remembered });
  const requestBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
    avaia: unknown;
  };
  expect(requestBody.avaia).toEqual({ longitude: 30.5, latitude: 50.4 });
});

it("follows the signed-in TEST Identity's exchange origin without a production fallback", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      response("https://market-test.onrender.com/nilx-browser/exchange"),
    );
  vi.stubGlobal("fetch", request);
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  await beginMarketVisit(visit);
  expect(submit).toHaveBeenCalledOnce();
  expect(document.querySelector("form")?.action).toBe(
    "https://market-test.onrender.com/nilx-browser/exchange",
  );
});

it("never sends a one-time code to a malformed or unsafe exchange", async () => {
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  for (const action of [
    "http://market-test.onrender.com/nilx-browser/exchange",
    "https://evil.example/another-endpoint",
    "https://user:pass@market-test.onrender.com/nilx-browser/exchange",
    "https://market-test.onrender.com/nilx-browser/exchange?redirect=evil",
    "https://market-test.onrender.com/nilx-browser/exchange#token",
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(action)));
    await expect(beginMarketVisit(visit)).rejects.toThrow(
      "Invalid Market exchange",
    );
  }
  expect(submit).not.toHaveBeenCalled();
});

it("fails closed when an older or malformed Identity omits exchange action", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: "a".repeat(43) }), { status: 201 }),
      ),
  );
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  await expect(beginMarketVisit(visit)).rejects.toThrow(
    "Missing Market exchange",
  );
  expect(submit).not.toHaveBeenCalled();
});
