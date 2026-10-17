// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useEffect, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import type { MapFogCell } from "@nilx-one/map-contract";
import type { FogRevealJob } from "../map/fog-reveal";
import { revealRemainingMs } from "../map/fog-reveal";
import { useLocalization } from "../../shell/localization";
import "./courier.css";
import type { Flyover } from "../flyover/use-flyover";
export interface RevealCompletion {
  readonly cell: MapFogCell;
  readonly at: number;
}
const clock = (ms: number) => {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export function ActivityStack({
  jobs,
  plan,
  flight,
  completed,
  onFlight,
  onFollow,
  onCells,
}: {
  jobs: readonly FogRevealJob[];
  plan: CourierPlan | undefined;
  flight: Pick<Flyover, "active" | "progress">;
  completed: RevealCompletion | undefined;
  onFlight(): void;
  onFollow(): void;
  onCells(): void;
}) {
  const { t } = useLocalization();
  const [now, setNow] = useState(Date.now);
  const [groupStart, setGroupStart] = useState<number>();
  const arrivedAt = flight.progress?.arrivedAt;
  const showFlight =
    plan !== undefined &&
    (flight.active || (arrivedAt !== undefined && now - arrivedAt < 5000));
  const hasCells =
    jobs.length > 0 || (completed !== undefined && now - completed.at < 5000);
  if (jobs.length && groupStart === undefined)
    setGroupStart(Math.min(...jobs.map((j) => j.startedAt)));
  else if (!hasCells && groupStart !== undefined) setGroupStart(undefined);
  const ticking = hasCells || showFlight;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [ticking]);
  const rows: {
    id: string;
    at: number;
    done: boolean;
    exiting: boolean;
    label: string;
    focus(): void;
    follow?: () => void;
  }[] = [];
  if (jobs.length || (completed && now - completed.at < 5000))
    rows.push({
      id: "cells",
      at: groupStart ?? completed?.at ?? now,
      done: jobs.length === 0,
      exiting: jobs.length === 0 && now - (completed?.at ?? now) > 4500,
      label: jobs.length
        ? t("fog.status.revealing")
            .replace("{count}", String(jobs.length))
            .replace("{limit}", "3") +
          " · " +
          clock(Math.min(...jobs.map((j) => revealRemainingMs(j, now))))
        : t("courier.cellsDone"),
      focus: onCells,
    });
  if (plan && showFlight)
    rows.push({
      id: "flight",
      at: Number(plan.started_at_ms),
      done: arrivedAt !== undefined,
      exiting: arrivedAt !== undefined && now >= arrivedAt + 4500,
      label:
        arrivedAt !== undefined
          ? t("courier.arrived")
          : t("courier.flight") +
            " · " +
            (flight.progress ? clock(flight.progress.remainingMs) : "…"),
      focus: onFlight,
      ...(flight.active && arrivedAt === undefined ? { follow: onFollow } : {}),
    });
  rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return (
    <div
      className="activity-stack"
      role="group"
      aria-label={t("courier.activities")}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          className="activity-stack__row"
          role="status"
          data-exiting={row.exiting || undefined}
        >
          <button type="button" onClick={row.focus}>
            {row.done ? "✅ " : "◷ "}
            {row.label}
          </button>
          {row.follow ? (
            <button
              type="button"
              onClick={row.follow}
              aria-label={t("courier.follow")}
            >
              ↗ xPing
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
