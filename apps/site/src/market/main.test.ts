// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import shell from "../../market.html?raw";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("boots the actual shared catalog, searches products, and opens read-only details", async () => {
  document.body.innerHTML = shell;
  HTMLDialogElement.prototype.showModal = vi.fn();
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        meta: {
          complete: true,
          pagination: "client",
          snapshot_id: "test-catalog",
          schema_version: 1,
        },
        data: [
          {
            type: "product",
            id: "test-product",
            attributes: {
              name: "Fixture product",
              price: { amount: "12", currency: "USDT" },
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  await import("./main");
  await waitFor(() =>
    expect(document.querySelector(".product")?.textContent).toContain(
      "Fixture product",
    ),
  );
  expect(document.querySelector(".product-price")?.textContent).toBe("12 USDT");
  fireEvent.click(document.querySelector(".product")!);
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  expect(document.querySelector("#dialog-name")?.textContent).toBe(
    "Fixture product",
  );
  expect(document.querySelector("#checkout-action")).toHaveAttribute("hidden");
  fireEvent.input(document.querySelector("#search")!, {
    target: { value: "absent" },
  });
  expect(document.querySelectorAll(".product")).toHaveLength(0);
  expect(request).toHaveBeenCalledTimes(1);
});
