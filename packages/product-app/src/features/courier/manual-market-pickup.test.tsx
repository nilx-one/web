// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { BusinessPoint } from "@nilx-one/application";
import {
  ManualMarketPickup,
  nearbyMarketPickupPoint,
} from "./manual-market-pickup";

const point: BusinessPoint = {
  id: { owner_pub_dress: "0xda-market", number: 0 },
  pub_dress: "0xda-market-zoloti-vorota",
  description: "Golden Gate",
  isVerified: false,
  coordinate: { longitude_e7: "305131000", latitude_e7: "504489000" },
};
const paid = {
  order_id: "paid-order-123",
  sku: "0x1_special_1m",
  state: "paid" as const,
  slot_x: null,
  slot_y: null,
};
const at = { longitude: 30.5131, latitude: 50.4489 };

it("hints at a known in-game point without asserting a physical visit", () => {
  expect(nearbyMarketPickupPoint(at, [point])).toEqual(point);
  expect(
    nearbyMarketPickupPoint({ ...at, latitude: 50.45 }, [point]),
  ).toBeUndefined();
  expect(nearbyMarketPickupPoint(undefined, [point])).toBeUndefined();
});

it("offers a one-time explicit manual pickup action only beside the point", () => {
  const onVisit = vi.fn();
  const props = {
    items: [paid],
    position: at,
    points: [point],
    locale: "uk-UA" as const,
    disabled: false,
    busy: false,
    failed: false,
    onVisit,
  };
  const view = render(<ManualMarketPickup {...props} />);
  expect(onVisit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Забрати Special" }));
  expect(onVisit).toHaveBeenCalledExactlyOnceWith(paid.order_id, point);
  view.rerender(
    <ManualMarketPickup {...props} position={{ ...at, latitude: 50.45 }} />,
  );
  expect(screen.queryByRole("button", { name: "Забрати Special" })).toBeNull();
});

it("does not offer pickup to unpaid or inactive world clients", () => {
  const onVisit = vi.fn();
  const props = {
    items: [{ ...paid, state: "in_transit" as const }],
    position: at,
    points: [point],
    locale: "en" as const,
    disabled: false,
    busy: false,
    failed: false,
    onVisit,
  };
  const view = render(<ManualMarketPickup {...props} />);
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<ManualMarketPickup {...props} items={[paid]} disabled />);
  expect(
    screen.getByRole("button", { name: "Collect Special" }),
  ).toBeDisabled();
  expect(onVisit).not.toHaveBeenCalled();
});
