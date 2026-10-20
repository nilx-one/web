// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useEffect, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import { mapDistanceMeters } from "@nilx-one/map-contract";
import type { MapFogCell } from "@nilx-one/map-contract";
import { courierPoint } from "./courier-map";
import type { FogRevealJob } from "../map/fog-reveal";
import { FOG_REVEAL_CONCURRENCY, revealRemainingMs } from "../map/fog-reveal";
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
/** Keep short flights readable without flickering at long-range precision. */
export function roundedFlightDistanceMeters(meters: number): number {
  const distance = Math.max(0, meters);
  const step = distance <= 50 ? 1 : distance <= 200 ? 10 : 50;
  return Math.ceil(distance / step) * step;
}
export function ActivityStack({
  jobs,
  plan,
  flight,
  completed,
  target,
  brokenAt,
  onFlight,
  onFollow,
  onCells,
}: {
  jobs: readonly FogRevealJob[];
  plan: CourierPlan | undefined;
  flight: Pick<Flyover, "active" | "progress">;
  completed: RevealCompletion | undefined;
  /** The destination's display name; progress is told as distance to it. */
  target?: string | undefined;
  /** When forcing on empty broke xPing's engine and called the flight off. */
  brokenAt?: number | undefined;
  onFlight(): void;
  onFollow(): void;
  onCells(): void;
}) {
  const { t } = useLocalization();
  const [now, setNow] = useState(Date.now);
  const [groupStart, setGroupStart] = useState<number>();
  const ids = jobs
    .map((job) => job.cell.id)
    .sort()
    .join("\n");
  const latestStart = Math.max(...jobs.map((job) => job.startedAt));
  const [previous, setPrevious] = useState({ ids, startedAt: latestStart });
  if (
    jobs.length &&
    (ids !== previous.ids || latestStart !== previous.startedAt)
  )
    setPrevious({ ids, startedAt: latestStart });
  // Retain the last active cell across the reveal store's synchronous update:
  // its completion callback may arrive one render after the job disappears.
  // A completed sibling cannot confirm cancellation of the remaining cell.
  const confirmed =
    !jobs.length &&
    completed?.cell.id === previous.ids &&
    completed.at >= previous.startedAt
      ? completed
      : undefined;
  const arrivedAt = flight.progress?.arrivedAt;
  const returning = flight.progress?.returning === true;
  const brokeRecently = brokenAt !== undefined && now - brokenAt < 5000;
  const showFlight =
    plan !== undefined &&
    (flight.active ||
      (arrivedAt !== undefined && now - arrivedAt < 5000) ||
      brokeRecently);
  const hasCells =
    jobs.length > 0 || (confirmed !== undefined && now - confirmed.at < 5000);
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
  if (jobs.length || (confirmed && now - confirmed.at < 5000))
    rows.push({
      id: "cells",
      at: groupStart ?? confirmed?.at ?? now,
      done: jobs.length === 0,
      exiting: jobs.length === 0 && now - (confirmed?.at ?? now) > 4500,
      label: jobs.length
        ? t("fog.status.revealing")
            .replace("{count}", String(jobs.length))
            .replace("{limit}", String(FOG_REVEAL_CONCURRENCY)) +
          " · " +
          clock(Math.min(...jobs.map((j) => revealRemainingMs(j, now))))
        : t("courier.cellsDone"),
      focus: onCells,
    });
  const flightProgress = () => {
    if (!flight.progress || !plan) return t("courier.flight") + " · …";
    if (target === undefined)
      return t("courier.flight") + " · " + clock(flight.progress.remainingMs);
    const meters = roundedFlightDistanceMeters(
      mapDistanceMeters(
        flight.progress.point,
        courierPoint(plan.destination.coordinate),
      ),
    );
    return t("courier.distance")
      .replace("{meters}", String(meters))
      .replace("{target}", target);
  };
  const backProgress = () => {
    if (!flight.progress || !plan) return t("courier.returning") + " · …";
    const meters = roundedFlightDistanceMeters(
      mapDistanceMeters(flight.progress.point, courierPoint(plan.origin)),
    );
    return `${t("courier.returning")} · ${meters} ${t("courier.meters")}`;
  };
  if (plan && showFlight) {
    const ended = brokeRecently ? brokenAt : arrivedAt;
    rows.push({
      id: "flight",
      at: Number(plan.started_at_ms),
      done: arrivedAt !== undefined && !brokeRecently,
      exiting: !flight.active && ended !== undefined && now >= ended + 4500,
      label: brokeRecently
        ? t("courier.broken")
        : returning
          ? backProgress()
          : arrivedAt !== undefined
            ? t("courier.arrived")
            : flightProgress(),
      focus: onFlight,
      ...(flight.active && (arrivedAt === undefined || returning)
        ? { follow: onFollow }
        : {}),
    });
  }
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
