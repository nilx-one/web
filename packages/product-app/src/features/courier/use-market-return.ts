// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import type { EmbeddedMarketCatalogPort } from "./market-dock";

export type MarketReturnResult = NonNullable<
  Awaited<ReturnType<NonNullable<EmbeddedMarketCatalogPort["confirmReturn"]>>>
>;

/**
 * What Identity says about the order this page was returned to Market with,
 * read once per page. Undefined while asking, or when the page is no return.
 */
export function useMarketReturn(
  catalog: EmbeddedMarketCatalogPort | undefined,
) {
  const [result, setResult] = useState<MarketReturnResult>();
  useEffect(() => {
    const confirmReturn = catalog?.confirmReturn;
    if (!confirmReturn) return;
    let live = true;
    void confirmReturn().then(
      (answer) => {
        if (live && answer !== undefined) setResult(answer);
      },
      () => {
        // A failed check confirms nothing; the route waits for the next one.
      },
    );
    return () => {
      live = false;
    };
  }, [catalog]);
  // Closing the notice must not call off a flight still waiting to fly.
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  return { result, notice: dismissed ? undefined : result, dismiss };
}

/**
 * Back from Market with a confirmed purchase, xPing flies home along the route
 * it left on: once, and only when the flyover can fly. An unconfirmed return
 * never flies.
 */
export function useReturnFlight(
  result: MarketReturnResult | undefined,
  ready: boolean,
  returnHome: (trip: CourierPlan) => void,
) {
  const flown = useRef<CourierPlan | undefined>(undefined);
  const trip = result?.confirmed === true ? result.trip : undefined;
  useEffect(() => {
    if (trip === undefined || !ready || flown.current === trip) return;
    flown.current = trip;
    returnHome(trip);
  }, [trip, ready, returnHome]);
}
