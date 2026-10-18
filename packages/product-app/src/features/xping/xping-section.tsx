// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import { useLocalization } from "../../shell/localization";
import type { XpingEngineState } from "./xping-engine";
import "./xping-section.css";

/** Hours and minutes left, rounded up so "0:00" only shows when it is done. */
export function hoursMinutes(ms: number): string {
  const minutes = Math.ceil(Math.max(0, ms) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * xPing's place in the Avaia's Dock window: how much energy its engine has,
 * how much it smokes, when it is whole and full again, and the paid repair.
 */
export function XpingSection({
  engine,
}: {
  readonly engine: XpingEngineState;
}) {
  const { t } = useLocalization();
  const read = engine.read;
  // The service's clock moves on with the device's between reads.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 15_000);
    return () => globalThis.clearInterval(timer);
  }, []);
  if (read === undefined) return null;
  const { view } = read;
  const serviceNow = read.nowMs + Math.max(0, now - engine.receivedAt);
  const left =
    view.fullAtMs === undefined ? undefined : view.fullAtMs - serviceNow;
  const energy = Math.round(view.energyPermille / 10);
  const smoke = Math.round(view.smokePermille / 10);
  const status = view.broken
    ? t("xping.broken").replace("{time}", hoursMinutes(left ?? 0))
    : left === undefined || left <= 0
      ? t("xping.full")
      : t("xping.recharging").replace("{time}", hoursMinutes(left));
  const error = engine.error;
  return (
    <section
      className="avaia-notebook xping-section"
      aria-labelledby="xping-title"
    >
      <span className="interface-settings__eyebrow" id="xping-title">
        xPing
      </span>
      <div
        className="xping-section__energy"
        role="meter"
        aria-label={t("xping.energy")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={energy}
        data-broken={view.broken || undefined}
      >
        <span style={{ width: `${energy}%` }} />
      </div>
      <p className="profile-edit__note">
        {t("xping.energyLine")
          .replace("{energy}", String(energy))
          .replace("{smoke}", String(smoke))}
      </p>
      <p className="profile-edit__note" role="status">
        {status}
      </p>
      {view.repairSeeds > 0 ? (
        <button
          type="button"
          className="xping-section__repair"
          disabled={engine.busy}
          onClick={engine.repair}
        >
          {t("xping.repair").replace("{price}", String(view.repairSeeds))}
        </button>
      ) : null}
      {error === undefined ? null : (
        <p className="profile-edit__error" role="alert">
          {error.kind === "refused" && error.reason === "not_enough_seeds"
            ? t("xping.notEnoughSeeds")
            : t("xping.repairFailed")}
        </p>
      )}
    </section>
  );
}
