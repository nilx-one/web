// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { HostPort, SoundCue } from "@nilx-one/host-contract";
import type { StatusToastItem } from "@nilx-one/ui";
import { useEffect, useRef, useState } from "react";

/**
 * How long an error that reports something that happened stays on screen.
 * An error about a state that lasts (no location, no map) stays until it is
 * closed or the state passes.
 */
export const ERROR_TOAST_MS = 3_000;

/**
 * Marks every error toast that appears, once: felt where the host can say so
 * and heard as a failure. Feedback is presentation; a refused pulse changes
 * nothing about the toast itself.
 */
export function useErrorToastFeedback(
  toasts: readonly StatusToastItem[],
  feedback: Pick<HostPort, "impact"> | undefined,
  cue: (moment: SoundCue) => void,
): void {
  const seen = useRef(new Set<string>());
  const latest = useRef({ feedback, cue });
  useEffect(() => {
    latest.current = { feedback, cue };
  });
  const errors = toasts
    .filter((toast) => toast.kind === "error")
    .map((toast) => toast.id);
  const key = errors.join("\n");
  useEffect(() => {
    const current = new Set(key === "" ? [] : key.split("\n"));
    const fresh = [...current].some((id) => !seen.current.has(id));
    // A toast that left and comes back is news again.
    seen.current = current;
    if (!fresh) return;
    try {
      latest.current.feedback?.impact("heavy");
    } catch {
      // Best-effort presentation.
    }
    latest.current.cue("failure");
  }, [key]);
}

/**
 * Whether a raised flag is still shown: it shows when it rises and hides
 * `ms` later, until it falls and rises again.
 */
export function useTransientFlag(raised: boolean, ms: number): boolean {
  const [shown, setShown] = useState(raised);
  const [wasRaised, setWasRaised] = useState(raised);
  if (wasRaised !== raised) {
    setWasRaised(raised);
    setShown(raised);
  }
  useEffect(() => {
    if (!shown) return;
    const hides = globalThis.setTimeout(() => setShown(false), ms);
    return () => globalThis.clearTimeout(hides);
  }, [shown, ms]);
  return raised && shown;
}
