// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  NearbySpeechAccessPort,
  SpokenLineView,
} from "@nilx-one/application";
import type { StatusToastItem } from "@nilx-one/ui";
import { useCallback, useEffect, useRef, useState } from "react";

/** How often the world asks what can be heard, while it is visible. */
export const SPEECH_POLL_MS = 5_000;
/**
 * A line older than this when it is first seen is history, not speech: opening
 * the world must not replay what was said a few minutes ago.
 */
export const SPEECH_FRESH_SECONDS = 30;
/** How long a heard line stays up before it fades on its own. */
export const SPEECH_SHOWN_MS = 20_000;
/** Ids remembered so a dismissed or faded line is never shown twice. */
const REMEMBERED_LINES = 200;

/**
 * The lines in `heard` that have not been seen yet and are still fresh, oldest
 * first. Every line it is given is marked seen, fresh or not, so a stale line
 * is dropped once instead of being reconsidered on every poll.
 */
export function admitSpeech(
  heard: readonly SpokenLineView[],
  seen: Set<string>,
  nowSeconds: number,
): readonly SpokenLineView[] {
  const admitted: SpokenLineView[] = [];
  for (const line of heard) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    if (nowSeconds - line.spokenAt <= SPEECH_FRESH_SECONDS) {
      admitted.push(line);
    }
  }
  while (seen.size > REMEMBERED_LINES) {
    const oldest = seen.values().next();
    if (oldest.done === true) break;
    seen.delete(oldest.value);
  }
  return admitted;
}

/** A line as the transient-notice stack says it: the speaker, then the words. */
export function speechToast(line: SpokenLineView): StatusToastItem {
  return {
    id: line.id,
    kind: "active",
    title: line.speaker,
    description: line.text,
  };
}

export interface NearbySpeechOptions {
  /** Absent means this host offers no speech, which is a normal state. */
  readonly port?: NearbySpeechAccessPort | undefined;
  readonly now?: () => number;
  readonly pollMs?: number;
  readonly shownMs?: number;
  /** Told once per poll that admitted anything, after it is shown. */
  readonly onHeard?: () => void;
}

export interface NearbySpeech {
  readonly toasts: readonly StatusToastItem[];
  dismiss(id: string): void;
}

/**
 * Lets the signed-in Bond hear the Bonds within earshot, as transient notices.
 *
 * It only reads. Who is near is the service's decision over locations it
 * already holds; nothing here learns or sends a position, and a line is never
 * stored on this device. Every failure is silent: speech is an extra, and its
 * absence must never look like a fault in the world.
 */
export function useNearbySpeech(options: NearbySpeechOptions): NearbySpeech {
  const { port } = options;
  const pollMs = options.pollMs ?? SPEECH_POLL_MS;
  const shownMs = options.shownMs ?? SPEECH_SHOWN_MS;
  const nowRef = useRef(options.now ?? (() => Date.now()));
  const onHeardRef = useRef(options.onHeard);
  useEffect(() => {
    onHeardRef.current = options.onHeard;
  });
  const seen = useRef(new Set<string>());
  const [shown, setShown] = useState<readonly SpokenLineView[]>([]);

  const dismiss = useCallback((id: string) => {
    setShown((lines) => lines.filter((line) => line.id !== id));
  }, []);

  useEffect(() => {
    if (port === undefined) return;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof globalThis.setTimeout>>();
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      if (globalThis.document?.visibilityState !== "hidden") {
        const heard = await port.readNearbySpeech().catch(() => undefined);
        if (cancelled) return;
        if (heard !== undefined) {
          const admitted = admitSpeech(
            heard,
            seen.current,
            Math.floor(nowRef.current() / 1000),
          );
          if (admitted.length > 0) {
            setShown((lines) => [...lines, ...admitted]);
            onHeardRef.current?.();
            for (const line of admitted) {
              const fade = globalThis.setTimeout(() => {
                timers.delete(fade);
                dismiss(line.id);
              }, shownMs);
              timers.add(fade);
            }
          }
        }
      }
      if (!cancelled)
        pollTimer = globalThis.setTimeout(() => void poll(), pollMs);
    };
    void poll();

    return () => {
      cancelled = true;
      if (pollTimer !== undefined) globalThis.clearTimeout(pollTimer);
      for (const timer of timers) globalThis.clearTimeout(timer);
    };
  }, [dismiss, pollMs, port, shownMs]);

  return { toasts: shown.map(speechToast), dismiss };
}
