// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo } from "react";

import type {
  LocalModelDependency,
  LocalModelEngine,
} from "../../shell/local-model-host";
import {
  CHOICE_SYSTEM_PROMPT,
  choiceGrammar,
  choicePrompt,
  isWordable,
  readChoice,
  type DriveChoose,
} from "./drive-choice";
import type { LocalModelReadiness } from "./world-readiness";

/** A loaded model nobody asked for this long is let go. */
export const CHOOSER_IDLE_MS = 2 * 60 * 1000;

/** After a model failed to load, it is not tried again for this long. */
export const CHOOSER_RETRY_MS = 10 * 60 * 1000;

/** An answer is one number: a few tokens are all it may take. */
const MAX_NEW_TOKENS = 4;

export interface DriveChooser {
  /** The option the model picks, or `null` for no answer. Never throws. */
  choose(choose: DriveChoose): Promise<number | null>;
  /** Lets the model go. */
  dispose(): Promise<void>;
}

/**
 * The Avaia's local model, choosing from the menus the drive in Core offers.
 *
 * It loads the model the first time it is asked, not before, keeps it while
 * choices keep coming, and lets it go once none have for `CHOOSER_IDLE_MS`.
 * The decode is constrained to the offered numbers, and what comes back is
 * read against the menu all the same: a menu outside the closed vocabulary is
 * never put to the model, and anything it could not read is no answer, so
 * the drive's own pick stands.
 */
export function createDriveChooser({
  open,
  idleMs = CHOOSER_IDLE_MS,
  retryMs = CHOOSER_RETRY_MS,
  now = () => Date.now(),
}: {
  readonly open: (signal: AbortSignal) => Promise<LocalModelEngine | null>;
  readonly idleMs?: number;
  readonly retryMs?: number;
  readonly now?: () => number;
}): DriveChooser {
  let engine: Promise<LocalModelEngine | null> | undefined;
  let opening: AbortController | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let failedAt: number | undefined;
  let disposed = false;

  const release = async () => {
    const loaded = engine;
    engine = undefined;
    const controller = opening;
    opening = undefined;
    controller?.abort();
    if (idle !== undefined) globalThis.clearTimeout(idle);
    idle = undefined;
    await loaded?.then((it) => it?.unload()).catch(() => undefined);
  };

  const loaded = (): Promise<LocalModelEngine | null> | undefined => {
    if (disposed) return undefined;
    if (failedAt !== undefined && now() - failedAt < retryMs) return undefined;
    if (engine === undefined) {
      const controller = new AbortController();
      opening = controller;
      engine = open(controller.signal)
        .then((model) => {
          // Cache disappearance is not a load failure and must not start the
          // ten-minute retry backoff. Re-check on the next choice instead.
          if (model === null && opening === controller) {
            opening = undefined;
            engine = undefined;
          }
          return model;
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) failedAt = now();
          if (opening === controller) {
            opening = undefined;
            engine = undefined;
          }
          throw error;
        })
        .finally(() => {
          if (opening === controller) opening = undefined;
        });
    }
    if (idle !== undefined) globalThis.clearTimeout(idle);
    idle = globalThis.setTimeout(() => void release(), idleMs);
    return engine;
  };

  return {
    async choose(choose) {
      if (!isWordable(choose)) return null;
      const pending = loaded();
      if (pending === undefined) return null;
      try {
        const model = await pending;
        if (model === null || model.complete === undefined) return null;
        const said = await model.complete({
          system: CHOICE_SYSTEM_PROMPT,
          user: choicePrompt(choose),
          grammar: choiceGrammar(choose),
          maxNewTokens: MAX_NEW_TOKENS,
          temperature: 0,
          topP: 1,
        });
        return readChoice(choose, said);
      } catch {
        return null;
      }
    },
    async dispose() {
      disposed = true;
      await release();
    },
  };
}

/**
 * The chooser for the model in effect, but only once that model is on this
 * device: the person downloaded it in Settings, and nothing here ever starts
 * a download of its own.
 */
export function useDriveChooser(
  localModel: LocalModelDependency | undefined,
  readiness: LocalModelReadiness,
): DriveChooser["choose"] | undefined {
  const modelId =
    readiness.kind === "present"
      ? (readiness.modelId ?? localModel?.defaultModelId)
      : undefined;
  const openCached = localModel?.host.openCached;
  const chooser = useMemo(
    () =>
      openCached === undefined || modelId === undefined
        ? undefined
        : createDriveChooser({
            // This is a distinct host capability, not `open` guarded by a stale cache
            // check: eviction and cached-only acquisition are serialized by the host.
            open: (signal) => openCached(modelId, () => undefined, signal),
          }),
    [openCached, modelId],
  );
  useEffect(
    () => () => {
      void chooser?.dispose();
    },
    [chooser],
  );
  return chooser?.choose;
}
