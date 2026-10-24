// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { CourierPlan } from "@nilx-one/application";
import { chooseLocale } from "../../shell/localization";
import { MarketDeparture } from "./market-departure";

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
const avaia = { longitude: 30.5, latitude: 50.4 };

afterEach(() => {
  chooseLocale("en");
  vi.restoreAllMocks();
});

it("waits for Avaia coordinates instead of caching a rejected handoff", async () => {
  const beginVisit = vi.fn().mockResolvedValue(undefined);
  const catalog = { load: vi.fn().mockResolvedValue([]), beginVisit };
  const view = render(
    <MarketDeparture
      catalog={catalog}
      plan={plan}
      seeds={10}
      avaia={undefined}
    />,
  );
  expect(screen.getByText("Waiting for Avaia position…")).toBeInTheDocument();
  expect(beginVisit).not.toHaveBeenCalled();
  view.rerender(
    <MarketDeparture catalog={catalog} plan={plan} seeds={10} avaia={avaia} />,
  );
  await waitFor(() => expect(beginVisit).toHaveBeenCalledTimes(1));
  expect(beginVisit).toHaveBeenCalledWith(
    expect.objectContaining({ point: "zoloti-vorota", seeds: "10", avaia }),
  );
});

it("changes point without duplicate StrictMode handoff", async () => {
  const beginVisit = vi.fn().mockResolvedValue(undefined);
  const catalog = { load: vi.fn().mockResolvedValue([]), beginVisit };
  const next: CourierPlan = {
    ...plan,
    destination: {
      ...plan.destination,
      id: { owner_pub_dress: "0xda-market", number: 1 },
      pub_dress: "0xda-market-batkivshchyna",
    },
    started_at_ms: "2000",
  };
  const view = render(
    <StrictMode>
      <MarketDeparture
        catalog={catalog}
        plan={plan}
        seeds={10}
        avaia={avaia}
      />
    </StrictMode>,
  );
  await waitFor(() => expect(beginVisit).toHaveBeenCalledTimes(1));
  const oldSignal = beginVisit.mock.calls[0]![0].signal as AbortSignal;
  view.rerender(
    <StrictMode>
      <MarketDeparture
        catalog={catalog}
        plan={next}
        seeds={10}
        avaia={avaia}
      />
    </StrictMode>,
  );
  await waitFor(() => expect(beginVisit).toHaveBeenCalledTimes(2));
  expect(oldSignal.aborted).toBe(true);
  expect(beginVisit.mock.calls[1]![0].point).toBe("batkivshchyna");
});

it("retries a real handoff failure explicitly", async () => {
  const beginVisit = vi
    .fn()
    .mockRejectedValueOnce(new Error("503"))
    .mockResolvedValueOnce(undefined);
  const catalog = { load: vi.fn().mockResolvedValue([]), beginVisit };
  render(
    <MarketDeparture catalog={catalog} plan={plan} seeds={10} avaia={avaia} />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(beginVisit).toHaveBeenCalledTimes(2));
});
