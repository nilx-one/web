// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useSeedsWallet } from "./use-seeds-wallet";

it("shows nothing for a host without a wallet", () => {
  const { result } = renderHook(() => useSeedsWallet(undefined));
  expect(result.current).toBeUndefined();
});

it("reads Identity's wallet and again on refresh and visibility", async () => {
  const readSeedsWallet = vi
    .fn()
    .mockResolvedValueOnce({ kind: "read", balance: 10_000n })
    .mockResolvedValueOnce({ kind: "read", balance: 9_360n })
    .mockResolvedValueOnce({ kind: "service-unavailable" });
  const wallet = { readSeedsWallet };
  const { result, rerender } = renderHook(
    ({ key }) => useSeedsWallet(wallet, key),
    { initialProps: { key: "closed" } },
  );
  expect(result.current).toEqual({ kind: "loading" });
  await waitFor(() =>
    expect(result.current).toEqual({ kind: "read", balance: 10_000n }),
  );

  rerender({ key: "inventory" });
  await waitFor(() =>
    expect(result.current).toEqual({ kind: "read", balance: 9_360n }),
  );

  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // A failed read says so instead of keeping or inventing a balance.
  await waitFor(() => expect(result.current).toEqual({ kind: "unavailable" }));
  expect(readSeedsWallet).toHaveBeenCalledTimes(3);
});
