// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CourierPlan } from "@nilx-one/application";
import { chooseLocale } from "../../shell/localization";
import { MarketDock } from "./market-dock";

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

afterEach(() => chooseLocale("en"));

it("embeds a 0x1-only product list in Dock, with no iframe, tabs or category picker", async () => {
  chooseLocale("en");
  const load = vi.fn().mockResolvedValue([
    { id: "special", name: "Special", price: "100 seeds" },
    { id: "exclusive", name: "Exclusive", price: null },
  ]);
  const onClose = vi.fn();
  const { container } = render(<MarketDock plan={plan} catalog={{ load }} onClose={onClose} />);
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.querySelector("select")).toBeNull();
  expect(screen.getByRole("heading", { name: "0x1" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: /Special/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Special/ }));
  expect(screen.getByText("Purchases with seeds are not connected yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /buy|purchase|checkout/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to map" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith("en");
});

it("offers a retry after a catalog outage", async () => {
  chooseLocale("en");
  const load = vi.fn()
    .mockRejectedValueOnce(new Error("503"))
    .mockResolvedValueOnce([]);
  render(<MarketDock plan={plan} catalog={{ load }} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByText("No 0x1 products are available yet.")).toBeInTheDocument());
  expect(load).toHaveBeenCalledTimes(2);
});
