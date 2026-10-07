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
  readonly open: (signal: AbortSignal) => Promise<LocalModelEngine>;
  readonly idleMs?: number;
  readonly retryMs?: number;
  readonly now?: () => number;
}): DriveChooser {
  let engine: Promise<LocalModelEngine> | undefined;
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
    await loaded?.then((it) => it.unload()).catch(() => undefined);
  };

  const loaded = (): Promise<LocalModelEngine> | undefined => {
    if (disposed) return undefined;
    if (failedAt !== undefined && now() - failedAt < retryMs) return undefined;
    if (engine === undefined) {
      const controller = new AbortController();
      opening = controller;
      engine = open(controller.signal)
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
        if (model.complete === undefined) return null;
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
  const chooser = useMemo(
    () =>
      localModel === undefined || modelId === undefined
        ? undefined
        : createDriveChooser({
            open: async (signal) => {
              // A `present` readiness is a snapshot. Settings may have removed the
              // model since it was read, so confirm the cache at acquisition time.
              const cached = await localModel.host
                .isCached(modelId)
                .catch(() => false);
              signal.throwIfAborted();
              if (!cached) throw new Error("local model is no longer cached");
              return localModel.host.open(modelId, () => undefined, signal);
            },
          }),
    [localModel, modelId],
  );
  useEffect(
    () => () => {
      void chooser?.dispose();
    },
    [chooser],
  );
  return chooser?.choose;
}
