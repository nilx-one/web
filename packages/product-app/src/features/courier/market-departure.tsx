// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import type { MapPointSelection } from "@nilx-one/map-contract";
import type { EmbeddedMarketCatalogPort } from "./market-dock";
import { useLocalization } from "../../shell/localization";

/** Why Identity would not open the Market, when it said so. */
type VisitFailure =
  "inactive" | "signed-out" | "limited" | "item-gone" | "market" | "unknown";

function visitFailure(error: unknown): VisitFailure {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "session_inactive":
      return "inactive";
    case "provider_authentication_required":
      return "signed-out";
    case "market_visit_limit":
      return "limited";
    case "item_not_available":
      return "item-gone";
    case "market_handoff_refused":
    case "market_unreachable":
    case "market_handoff_invalid":
      return "market";
    default:
      return "unknown";
  }
}

const FAILURE_TEXT: Record<VisitFailure, { uk: string; en: string }> = {
  inactive: {
    uk: "Цей пристрій зараз не активний для твого Bond. Зроби його активним і спробуй ще раз.",
    en: "This device is not your Bond's active client. Make it active and retry.",
  },
  "signed-out": {
    uk: "Сесія завершилась. Відкрий 0x1 заново й спробуй ще раз.",
    en: "Your session has ended. Reopen 0x1 and retry.",
  },
  limited: {
    uk: "Забагато спроб. Зачекай хвилину й спробуй ще раз.",
    en: "Too many attempts. Wait a minute and retry.",
  },
  "item-gone": {
    uk: "Цей Special уже не чекає на отримання.",
    en: "This Special is no longer waiting for pickup.",
  },
  market: {
    uk: "Маркет зараз не відповідає. Спробуй ще раз.",
    en: "The Market is not answering right now. Please retry.",
  },
  unknown: {
    uk: "Не вдалося відкрити маркет. Спробуйте ще раз.",
    en: "Unable to open Market. Please retry.",
  },
};

interface PendingVisit {
  key: string;
  controller: AbortController;
  promise: Promise<void>;
}

export function MarketDeparture({
  catalog,
  plan,
  avaia,
  pickupOrderId,
}: {
  catalog: EmbeddedMarketCatalogPort;
  plan: CourierPlan;
  avaia: MapPointSelection | undefined;
  pickupOrderId?: string | undefined;
}) {
  const { resolved } = useLocalization();
  const uk = resolved === "uk-UA";
  const [failed, setFailed] = useState<VisitFailure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<PendingVisit | undefined>(undefined);

  // A new arrival must never reuse an earlier point's one-time handoff.
  const visitKey = [
    plan.destination.id.owner_pub_dress,
    plan.destination.id.number,
    plan.started_at_ms,
    pickupOrderId,
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
            ...(pickupOrderId ? { pickupOrderId } : {}),
            avaia,
            plan,
            signal: controller.signal,
          }),
        );
        pending.current = { key: visitKey, controller, promise };
        setFailed(undefined);
      }

      const current = pending.current;
      void current.promise.catch((error: unknown) => {
        if (live && !current.controller.signal.aborted)
          setFailed(visitFailure(error));
      });
    }
    return () => {
      live = false;
    };
  }, [catalog, plan, avaia, visitKey, pickupOrderId]);

  return (
    <section className="market-dock">
      <p role="status">
        {failed
          ? FAILURE_TEXT[failed][uk ? "uk" : "en"]
          : !avaia
            ? uk
              ? "Очікуємо координати Avaia…"
              : "Waiting for Avaia position…"
            : uk
              ? "Відкриваємо маркет…"
              : "Opening Market…"}
      </p>
      {failed !== undefined && failed !== "item-gone" && (
        <button
          type="button"
          onClick={() => {
            pending.current?.controller.abort();
            pending.current = undefined;
            setFailed(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          {uk ? "Повторити" : "Retry"}
        </button>
      )}
    </section>
  );
}
