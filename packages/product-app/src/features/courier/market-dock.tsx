// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CourierPlan } from "@nilx-one/application";
import { useLocalization } from "../../shell/localization";
import { DockWindow } from "../../shell/dock-window";
import { marketPointTitle } from "./market-points";
import "./market-dock.css";

const messages = {
  "uk-UA": {
    back: "До мапи",
    preview: "Попередня точка на мапі · розташування ще не підтверджене",
  },
  "ru-RU": {
    back: "К карте",
    preview:
      "Предварительная точка на карте · расположение ещё не подтверждено",
  },
  en: {
    back: "Back to map",
    preview: "Preview map point · location not yet verified",
  },
};

/** The browser host supplies its own shared Market WebApp entry point. */
export function MarketDock({
  plan,
  url,
  onClose,
}: {
  plan: CourierPlan;
  url: string;
  onClose(): void;
}) {
  const { resolved: locale } = useLocalization();
  const copy = messages[locale];
  return (
    <section className="market-dock" aria-label="0xda-market">
      <DockWindow screen="market" depth={1}>
        <header className="market-dock__header">
          <button type="button" onClick={onClose}>
            {copy.back}
          </button>
          <strong>{marketPointTitle(plan.destination, locale)}</strong>
        </header>
        {!plan.destination.isVerified && (
          <p className="market-dock__notice">{copy.preview}</p>
        )}
        <iframe
          className="market-dock__frame"
          title="0xda-market Web"
          src={`${url}?locale=${encodeURIComponent(locale)}`}
          referrerPolicy="no-referrer"
        />
      </DockWindow>
    </section>
  );
}
