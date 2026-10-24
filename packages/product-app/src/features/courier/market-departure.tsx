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
  const pending = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<void>;
  } | undefined>(undefined);

  // A new arrival must never reuse an earlier point's one-time handoff.
  const visitKey = [
    plan.destination.id.owner_pub_dress,
    plan.destination.id.number,
    plan.started_at_ms,
    attempt,
  ].join(":");

  useEffect(() => {
    let live = true;
    if (pending.current && pending.current.key !== visitKey) {
      pending.current.controller.abort();
      pending.current = undefined;
    }

    // Wait for late Avaia coordinates, never caching a rejected handoff.
    const beginVisit = catalog.beginVisit;
    if (avaia && beginVisit) {
      if (!pending.current) {
        const controller = new AbortController();
        const promise = Promise.resolve().then(() =>
          beginVisit({
            point: plan.destination.pub_dress.replace(/^0xda-market-/, ""),
            seeds: String(seeds),
            avaia,
            plan,
            signal: controller.signal,
          }),
        );
        pending.current = { key: visitKey, controller, promise };
        setFailed(false);
      }

      const current = pending.current;
      void current.promise.catch(() => {
        if (live && !current.controller.signal.aborted) setFailed(true);
      });
    }
    return () => {
      live = false;
    };
  }, [catalog, plan, seeds, avaia, visitKey]);

  return (
    <section className="market-dock">
      <p role="status">
        {failed
          ? uk
            ? "Не вдалося відкрити маркет. Спробуйте ще раз."
            : "Unable to open Market. Please retry."
          : !avaia
            ? uk
              ? "Очікуємо координати Avaia…"
              : "Waiting for Avaia position…"
            : uk
              ? "Відкриваємо маркет…"
              : "Opening Market…"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={() => {
            pending.current?.controller.abort();
            pending.current = undefined;
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          {uk ? "Повторити" : "Retry"}
        </button>
      )}
    </section>
  );
}
