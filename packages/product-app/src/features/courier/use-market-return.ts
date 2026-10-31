// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import type { EmbeddedMarketCatalogPort } from "./market-dock";

export type MarketReturnResult = NonNullable<
  Awaited<ReturnType<NonNullable<EmbeddedMarketCatalogPort["confirmReturn"]>>>
>;

/**
 * What Identity says about the order this page was returned to Market with.
 * Undefined while asking, or when the page is no return.
 */
export function useMarketReturn(
  catalog: EmbeddedMarketCatalogPort | undefined,
) {
  const [result, setResult] = useState<MarketReturnResult>();
  useEffect(() => {
    const confirmReturn = catalog?.confirmReturn;
    if (!confirmReturn) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Core's schedule from the first answer bounds the rechecks of this page;
    // later page loads of the tab ask again too.
    let schedule: readonly number[] | undefined;
    const ask = (round: number) => {
      void confirmReturn().then(
        (answer) => {
          if (!live || answer === undefined) return;
          setResult(answer);
          schedule ??= answer.recheckMs;
          const delay =
            answer.recheckMs === undefined ? undefined : schedule?.[round];
          if (!answer.confirmed && delay !== undefined)
            timer = setTimeout(() => ask(round + 1), delay);
        },
        () => {
          // A failed check confirms nothing; the route waits for the next one.
        },
      );
    };
    ask(0);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [catalog]);
  // Closing a notice must not call off a flight still waiting to fly, and a
  // later answer is a new notice.
  const [dismissed, setDismissed] = useState<MarketReturnResult>();
  const dismiss = useCallback(() => setDismissed(result), [result]);
  return {
    result,
    notice: dismissed === result ? undefined : result,
    dismiss,
  };
}

/**
 * Back from Market with a confirmed purchase, xPing flies home along the route
 * it left on: once, when the flyover can fly and no other flight holds it. An
 * unconfirmed return never flies.
 */
export function useReturnFlight(
  result: MarketReturnResult | undefined,
  ready: boolean,
  flying: boolean,
  returnHome: (trip: CourierPlan) => void,
) {
  const flown = useRef<CourierPlan | undefined>(undefined);
  const trip = result?.confirmed === true ? result.trip : undefined;
  useEffect(() => {
    // A flyover that is not ready, or already flying, ignores a start.
    if (trip === undefined || !ready || flying || flown.current === trip)
      return;
    flown.current = trip;
    returnHome(trip);
  }, [trip, ready, flying, returnHome]);
}
