// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import { useLocalization } from "../../shell/localization";
import "./fog-reveal-prompt.css";
import {
  FOG_REVEAL_CONCURRENCY,
  revealRemainingMs,
  type FogRevealJob,
} from "./fog-reveal";
import type { FogRevealPrompt as Prompt } from "./use-fog-reveal";

function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface FogRevealPromptProps {
  readonly prompt: Prompt | undefined;
  readonly jobs: readonly FogRevealJob[];
  /** Whose work this is, as the prompt names it. */
  readonly avaia: string;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}

/**
 * The question a tap into reachable fog asks, and how the reveals already
 * under way are going. It floats over the world above the Dock, the same way
 * the location control does, and says only what the Bond is deciding: which
 * Avaia goes, and roughly how long the cell takes.
 */
export function FogRevealPrompt({
  prompt,
  jobs,
  avaia,
  onConfirm,
  onDismiss,
}: FogRevealPromptProps) {
  const { t } = useLocalization();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (jobs.length === 0) return;
    const beat = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(beat);
  }, [jobs.length]);

  if (prompt === undefined && jobs.length === 0) return null;

  const limit = String(FOG_REVEAL_CONCURRENCY);
  const next =
    jobs.length === 0
      ? undefined
      : Math.min(...jobs.map((job) => revealRemainingMs(job, now)));

  return (
    <div className="fog-reveal">
      {prompt === undefined ? null : (
        <section
          className="fog-reveal__prompt"
          role="dialog"
          aria-labelledby="fog-reveal-title"
          aria-describedby="fog-reveal-detail"
        >
          <h2 className="fog-reveal__title" id="fog-reveal-title">
            {t("fog.prompt.title")}
          </h2>
          <p className="fog-reveal__detail" id="fog-reveal-detail">
            {prompt.busy
              ? t("fog.prompt.busy")
                  .replace("{avaia}", avaia)
                  .replace("{limit}", limit)
              : t("fog.prompt.detail")
                  .replace("{avaia}", avaia)
                  .replace(
                    "{minutes}",
                    String(Math.round(prompt.durationMs / 60_000)),
                  )}
          </p>
          {prompt.busy || prompt.landmarks === 0 ? null : (
            <p className="fog-reveal__note">
              {t("fog.prompt.landmarks").replace(
                "{count}",
                String(prompt.landmarks),
              )}
            </p>
          )}
          <div className="fog-reveal__actions">
            <button
              className="fog-reveal__cancel"
              type="button"
              onClick={onDismiss}
            >
              {t("fog.prompt.cancel")}
            </button>
            {prompt.busy ? null : (
              <button
                className="fog-reveal__confirm"
                type="button"
                onClick={onConfirm}
              >
                {t("fog.prompt.confirm")}
              </button>
            )}
          </div>
        </section>
      )}
      {jobs.length === 0 ? null : (
        <p className="fog-reveal__status" role="status">
          <span className="fog-reveal__pulse" aria-hidden="true" />
          {t("fog.status.revealing")
            .replace("{count}", String(jobs.length))
            .replace("{limit}", limit)}
          {next === undefined ? null : (
            <span className="fog-reveal__next">
              {` · ${t("fog.status.next").replace("{time}", formatClock(next))}`}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
