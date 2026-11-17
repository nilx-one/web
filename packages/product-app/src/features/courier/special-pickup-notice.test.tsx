// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SpecialPickupNotice } from "./special-pickup-notice";

const paid = {
  order_id: "order-one",
  state: "paid" as const,
  sku: "0x1_special_1m",
  slot_x: null,
  slot_y: null,
};

it("shows the Identity-paid item without any dismiss or automatic courier dispatch", () => {
  const send = vi.fn();
  const view = render(
    <SpecialPickupNotice
      items={[paid]}
      locale="uk-UA"
      dispatching={false}
      onSendXping={send}
    />,
  );
  expect(screen.getByText("Special оплачено")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /закрити|dismiss|close/i }),
  ).toBeNull();
  expect(send).not.toHaveBeenCalled();
  view.rerender(
    <SpecialPickupNotice
      items={[paid]}
      locale="uk-UA"
      dispatching={false}
      onSendXping={send}
    />,
  );
  expect(screen.getByText("Special оплачено")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Відправити xPing" }));
  expect(send).toHaveBeenCalledExactlyOnceWith("order-one");
});

it("never offers unpaid, in-transit or other SKUs as pending collection", () => {
  const send = vi.fn();
  render(
    <SpecialPickupNotice
      items={[
        { ...paid, state: "in_transit" },
        { ...paid, order_id: "other", sku: "0x1_special_3m" },
      ]}
      locale="en"
      dispatching={false}
      onSendXping={send}
    />,
  );
  expect(screen.queryByText("Special paid")).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it("disables a second dispatch while a courier is already busy", () => {
  const send = vi.fn();
  render(
    <SpecialPickupNotice
      items={[paid]}
      locale="en"
      dispatching
      onSendXping={send}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Send xPing" }));
  expect(send).not.toHaveBeenCalled();
});
