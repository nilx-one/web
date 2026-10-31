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
  const { container } = render(
    <MarketDock plan={plan} catalog={{ load }} onClose={onClose} />,
  );
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.querySelector("select")).toBeNull();
  expect(screen.getByRole("heading", { name: "0x1" })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Special/ })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /Special/ }));
  expect(
    screen.getByText("Purchases with seeds are not connected yet."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /buy|purchase|checkout/i }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to market" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith("en");
});

it("offers a retry after a catalog outage", async () => {
  chooseLocale("en");
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("503"))
    .mockResolvedValueOnce([]);
  render(<MarketDock plan={plan} catalog={{ load }} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(
      screen.getByText("No 0x1 products are available yet."),
    ).toBeInTheDocument(),
  );
  expect(load).toHaveBeenCalledTimes(2);
});

const product = {
  id: "0x1_special_1m",
  name: "Special · 1 month",
  price: "400 seeds",
};
const offer = { sku: "0x1_special_1m", priceId: "price-1", amountMinor: 400 };

it("buys a Special for seeds and reports the fulfilled order once", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    chooseLocale("en");
    const checkout = {
      offers: vi.fn().mockResolvedValue([offer]),
      order: vi.fn().mockResolvedValue({ id: "order-1", status: "pending" }),
      read: vi.fn().mockResolvedValue({
        id: "order-1",
        status: "fulfilled",
        visitId: "v".repeat(43),
      }),
    };
    const onPurchased = vi.fn();
    render(
      <MarketDock
        plan={plan}
        catalog={{ load: vi.fn().mockResolvedValue([product]) }}
        checkout={checkout}
        onPurchased={onPurchased}
        onClose={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Special/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Buy for 400 seeds" }),
    );
    expect(checkout.order).toHaveBeenCalledWith({
      sku: "0x1_special_1m",
      priceId: "price-1",
      amountMinor: 400,
      idempotencyKey: expect.any(String),
    });
    await screen.findByText("Waiting for 0x1 to confirm…");
    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => expect(onPurchased).toHaveBeenCalledOnce());
    expect(checkout.read).toHaveBeenCalledWith("order-1");
    expect(onPurchased).toHaveBeenCalledWith(
      expect.objectContaining({ id: "order-1", status: "fulfilled" }),
    );
    expect(
      screen.getByText("Purchased. Returning to 0x1…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy/ })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("replays a failed attempt with its key but starts a declined one afresh", async () => {
  chooseLocale("en");
  const checkout = {
    offers: vi.fn().mockResolvedValue([offer]),
    order: vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        id: "order-1",
        status: "rejected",
        rejectionCode: "insufficient_seeds",
      })
      .mockResolvedValueOnce({ id: "order-2", status: "fulfilled" }),
    read: vi.fn(),
  };
  const onPurchased = vi.fn();
  render(
    <MarketDock
      plan={plan}
      catalog={{ load: vi.fn().mockResolvedValue([product]) }}
      checkout={checkout}
      onPurchased={onPurchased}
      onClose={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Special/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Buy for 400 seeds" }),
  );
  await screen.findByText("Unable to complete the purchase.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Not enough seeds.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onPurchased).toHaveBeenCalledOnce());
  const keys = checkout.order.mock.calls.map(
    (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
  );
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
});

it("keeps browsing without a Buy button when Market offers no price", async () => {
  chooseLocale("en");
  render(
    <MarketDock
      plan={plan}
      catalog={{ load: vi.fn().mockResolvedValue([product]) }}
      checkout={{
        offers: vi.fn().mockRejectedValue(new Error("401")),
        order: vi.fn(),
        read: vi.fn(),
      }}
      onClose={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Special/ }));
  expect(
    screen.getByText("Purchases with seeds are not connected yet."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Buy/ })).toBeNull();
});
