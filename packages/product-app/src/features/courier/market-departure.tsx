// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import type { MapPointSelection } from "@nilx-one/map-contract";
import type { EmbeddedMarketCatalogPort } from "./market-dock";
import { useLocalization } from "../../shell/localization";

export function MarketDeparture({
  catalog,
  plan,
  seeds,
  avaia,
}: {
  catalog: EmbeddedMarketCatalogPort;
  plan: CourierPlan;
  seeds: number;
  avaia: MapPointSelection | undefined;
}) {
  const { resolved } = useLocalization();
  const uk = resolved === "uk-UA";
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!pending.current) {
      pending.current =
        !avaia || !catalog.beginVisit
          ? Promise.reject(new Error("Visit context unavailable"))
          : catalog.beginVisit({
              point: plan.destination.pub_dress.replace(/^0xda-market-/, ""),
              seeds: String(seeds),
              avaia,
              plan,
            });
    }
    void pending.current.catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [catalog, plan, seeds, avaia, attempt]);
  return (
    <section className="market-dock">
      <p role="status">
        {failed
          ? uk
            ? "Не вдалося відкрити маркет. Спробуйте ще раз."
            : "Unable to open Market. Please retry."
          : uk
            ? "Відкриваємо маркет…"
            : "Opening Market…"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={() => {
            pending.current = undefined;
            setFailed(false);
            setAttempt((v) => v + 1);
          }}
        >
          {uk ? "Повторити" : "Retry"}
        </button>
      )}
    </section>
  );
}
