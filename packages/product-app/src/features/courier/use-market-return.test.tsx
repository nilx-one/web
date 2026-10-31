// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CourierPlan } from "@nilx-one/application";
import type { EmbeddedMarketCatalogPort } from "./market-dock";
import {
  MARKET_RECHECK_MS,
  useMarketReturn,
  useReturnFlight,
} from "./use-market-return";

const trip: CourierPlan = {
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

/** The home view's handoff: ask once, then fly home when xPing can fly. */
function handoff(
  confirmReturn: NonNullable<EmbeddedMarketCatalogPort["confirmReturn"]>,
  returnHome: (plan: CourierPlan) => void,
) {
  const catalog: EmbeddedMarketCatalogPort = {
    load: vi.fn().mockResolvedValue([]),
    confirmReturn,
  };
  return renderHook(
    ({ suspended, flying }: { suspended: boolean; flying?: boolean }) => {
      const market = useMarketReturn(catalog);
      useReturnFlight(market.result, !suspended, flying ?? false, returnHome);
      return market;
    },
    {
      initialProps: { suspended: true } as {
        suspended: boolean;
        flying?: boolean;
      },
    },
  );
}

it("flies home once, only after the confirmation and the suspension end", async () => {
  let answer!: (value: { confirmed: boolean; trip?: CourierPlan }) => void;
  const confirmReturn = vi.fn(
    () =>
      new Promise<{ confirmed: boolean; trip?: CourierPlan }>((resolve) => {
        answer = resolve;
      }),
  );
  const returnHome = vi.fn();
  const hook = handoff(confirmReturn, returnHome);
  // Ready before the answer: nothing to fly yet.
  hook.rerender({ suspended: false });
  hook.rerender({ suspended: true });
  await act(async () => answer({ confirmed: true, trip }));
  expect(hook.result.current.notice).toEqual({ confirmed: true, trip });
  // Startup or a dialog still holds the flyover: no request starts.
  hook.rerender({ suspended: true });
  expect(returnHome).not.toHaveBeenCalled();
  hook.rerender({ suspended: false });
  expect(returnHome).toHaveBeenCalledOnce();
  expect(returnHome).toHaveBeenCalledWith(trip);
  // Later suspensions, renders and a closed notice never fly it again.
  hook.rerender({ suspended: true });
  act(() => hook.result.current.dismiss());
  hook.rerender({ suspended: false });
  expect(hook.result.current.notice).toBeUndefined();
  expect(returnHome).toHaveBeenCalledOnce();
  expect(confirmReturn).toHaveBeenCalledOnce();
});

it("keeps the flight waiting when the notice is closed first", async () => {
  const returnHome = vi.fn();
  const hook = handoff(
    vi.fn().mockResolvedValue({ confirmed: true, trip }),
    returnHome,
  );
  await waitFor(() => expect(hook.result.current.result).toBeDefined());
  act(() => hook.result.current.dismiss());
  hook.rerender({ suspended: false });
  expect(returnHome).toHaveBeenCalledOnce();
});

it.each([
  ["Identity is unavailable", () => Promise.reject(new Error("503"))],
  [
    "the purchase is not confirmed",
    () => Promise.resolve({ confirmed: false, trip }),
  ],
  ["the page is no return", () => Promise.resolve(undefined)],
])("never flies when %s", async (_case, confirmReturn) => {
  const returnHome = vi.fn();
  const hook = handoff(confirmReturn, returnHome);
  await act(async () => {
    await Promise.resolve();
  });
  hook.rerender({ suspended: false });
  hook.rerender({ suspended: true });
  hook.rerender({ suspended: false });
  expect(returnHome).not.toHaveBeenCalled();
});

it("waits for another flight to end, then flies home once", async () => {
  const returnHome = vi.fn();
  const hook = handoff(
    vi.fn().mockResolvedValue({ confirmed: true, trip }),
    returnHome,
  );
  await waitFor(() => expect(hook.result.current.result).toBeDefined());
  hook.rerender({ suspended: false, flying: true });
  expect(returnHome).not.toHaveBeenCalled();
  hook.rerender({ suspended: false, flying: false });
  expect(returnHome).toHaveBeenCalledOnce();
  hook.rerender({ suspended: false, flying: true });
  hook.rerender({ suspended: false, flying: false });
  expect(returnHome).toHaveBeenCalledOnce();
});

it("asks again on a bounded schedule and flies once Identity confirms", async () => {
  vi.useFakeTimers();
  try {
    const confirmReturn = vi
      .fn()
      .mockResolvedValueOnce({ confirmed: false, retry: true })
      .mockResolvedValueOnce({ confirmed: false, retry: true })
      .mockResolvedValueOnce({ confirmed: true, trip });
    const returnHome = vi.fn();
    const hook = handoff(confirmReturn, returnHome);
    hook.rerender({ suspended: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.notice).toEqual({
      confirmed: false,
      retry: true,
    });
    expect(returnHome).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_RECHECK_MS[0]!);
    });
    expect(confirmReturn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_RECHECK_MS[1]!);
    });
    expect(confirmReturn).toHaveBeenCalledTimes(3);
    expect(returnHome).toHaveBeenCalledOnce();
    expect(hook.result.current.notice).toEqual({ confirmed: true, trip });
  } finally {
    vi.useRealTimers();
  }
});

it("stops asking within the page after the last scheduled recheck", async () => {
  vi.useFakeTimers();
  try {
    const confirmReturn = vi
      .fn()
      .mockResolvedValue({ confirmed: false, retry: true });
    handoff(confirmReturn, vi.fn());
    for (const delay of [...MARKET_RECHECK_MS, 3_600_000])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    expect(confirmReturn).toHaveBeenCalledTimes(MARKET_RECHECK_MS.length + 1);
  } finally {
    vi.useRealTimers();
  }
});
