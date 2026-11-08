// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  SeedsWalletAccessPort,
  SeedsWalletResult,
} from "@nilx-one/application";
import { expect, it, vi } from "vitest";

import { useSeedsWallet } from "./use-seeds-wallet";

it("shows nothing for a host without a wallet", () => {
  const { result } = renderHook(() => useSeedsWallet("0x0sky", undefined));
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
    ({ key }) => useSeedsWallet("0x0sky", wallet, key),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it("never shows one Bond's balance for another, even mid-request", async () => {
  const first = deferred<SeedsWalletResult>();
  const second = deferred<SeedsWalletResult>();
  const pending = new Promise<SeedsWalletResult>(() => undefined);
  const readA = vi
    .fn<SeedsWalletAccessPort["readSeedsWallet"]>()
    .mockResolvedValueOnce({ kind: "read", balance: 10_000n })
    .mockReturnValueOnce(first.promise)
    .mockReturnValue(pending);
  const walletA: SeedsWalletAccessPort = { readSeedsWallet: readA };
  const walletB: SeedsWalletAccessPort = {
    readSeedsWallet: vi.fn(() => second.promise),
  };
  const { result, rerender } = renderHook(
    ({ owner, wallet, key }) => useSeedsWallet(owner, wallet, key),
    {
      initialProps: {
        owner: "alice",
        wallet: walletA as SeedsWalletAccessPort | undefined,
        key: 0,
      },
    },
  );
  await waitFor(() =>
    expect(result.current).toEqual({ kind: "read", balance: 10_000n }),
  );

  // Alice's refresh is in flight when Bob signs in with a new port.
  rerender({ owner: "alice", wallet: walletA, key: 1 });
  rerender({ owner: "bob", wallet: walletB, key: 1 });
  expect(result.current).toEqual({ kind: "loading" });

  // Alice's late answer is dropped, not shown for Bob.
  await act(async () => first.resolve({ kind: "read", balance: 4_242n }));
  expect(result.current).toEqual({ kind: "loading" });

  await act(async () => second.resolve({ kind: "read", balance: 640n }));
  expect(result.current).toEqual({ kind: "read", balance: 640n });

  // The same port for another Bond also starts from loading, synchronously.
  rerender({ owner: "carol", wallet: walletB, key: 1 });
  expect(result.current).toEqual({ kind: "loading" });

  // A port that disappears and comes back does not resurrect a balance.
  rerender({ owner: "carol", wallet: undefined, key: 1 });
  expect(result.current).toBeUndefined();
  rerender({ owner: "carol", wallet: walletA, key: 1 });
  expect(result.current).toEqual({ kind: "loading" });
});
