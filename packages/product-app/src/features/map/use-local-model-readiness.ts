// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import { useLocalModelChoice } from "../../shell/local-model-choice";
import type {
  LocalModelDependency,
  LocalModelDeviceVerdict,
} from "../../shell/local-model-host";
import { createLocalModelChoiceView } from "../../shell/local-model-settings-view-model";
import type { LocalModelReadiness } from "./world-readiness";

/**
 * Asks this device about the model in effect — the same one Settings would show — without
 * downloading or loading it: a WebGPU verdict for every entry, then the cache for the
 * chosen one.
 */
export async function readLocalModelReadiness(
  localModel: LocalModelDependency,
  stored: string | undefined,
): Promise<LocalModelReadiness> {
  const { host, catalog, defaultModelId } = localModel;
  const verdicts = new Map<string, LocalModelDeviceVerdict>(
    await Promise.all(
      catalog.map(
        async (entry) =>
          [entry.modelId, await host.inspect(entry.modelId)] as const,
      ),
    ),
  );
  const { effectiveModelId } = createLocalModelChoiceView({
    catalog,
    defaultModelId,
    stored,
    verdicts,
  });
  const verdict =
    verdicts.get(effectiveModelId) ?? (await host.inspect(effectiveModelId));
  if (verdict.kind !== "usable") {
    return { kind: "unsupported", reason: verdict.kind };
  }
  // An artifact the cache cannot read back is a model that is not here yet;
  // Settings is where it is repaired.
  const cached = await host.isCached(effectiveModelId).catch(() => false);
  return cached
    ? { kind: "present", modelId: effectiveModelId }
    : { kind: "available" };
}

/**
 * The on-device model's readiness, re-read whenever `revision` changes — the caller bumps it
 * when the model may have been downloaded or removed.
 */
export function useLocalModelReadiness(
  localModel: LocalModelDependency | undefined,
  revision: unknown,
): LocalModelReadiness {
  const stored = useLocalModelChoice();
  // The last answer stands while the next one is asked, so a re-check does not
  // flash the frame back to pending.
  const [readiness, setReadiness] = useState<LocalModelReadiness>({
    kind: "checking",
  });

  useEffect(() => {
    if (localModel === undefined) return;
    let current = true;
    readLocalModelReadiness(localModel, stored).then(
      (next) => {
        if (current) setReadiness(next);
      },
      () => {
        if (current) setReadiness({ kind: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [localModel, stored, revision]);

  return localModel === undefined ? { kind: "not-wired" } : readiness;
}
