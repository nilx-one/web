// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

import { ProgressBar } from "@nilx-one/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { LocalModelDependency, LocalModelHost } from "./local-model-host";
import {
  createLocalModelSettingsViewState,
  type LocalModelPhase,
  type UnsupportedReason,
} from "./local-model-settings-view-model";
import { useLocalization } from "./localization";

export type LocalModelSettingsProps = LocalModelDependency;

type LocalModelCheck =
  | { readonly kind: "unsupported"; readonly reason: UnsupportedReason }
  | { readonly kind: "cached" }
  | {
      readonly kind: "absent";
      readonly bytes: number | null;
      readonly source: "mirror" | "upstream";
      readonly notices: readonly string[];
    };

async function checkLocalModel(
  host: LocalModelHost,
  modelId: string,
): Promise<LocalModelCheck> {
  const verdict = await host.inspect();
  if (verdict.kind !== "usable") {
    return { kind: "unsupported", reason: verdict.kind };
  }
  if (await host.isCached(modelId)) {
    return { kind: "cached" };
  }
  const description = await host.describe(modelId);
  return {
    kind: "absent",
    bytes: description.bytes,
    source: description.source,
    notices: description.bytes === null ? [] : description.notices,
  };
}

function queryKeyFor(modelId: string): readonly unknown[] {
  return ["local-model-status", modelId];
}

/**
 * Status and management for the on-device model `nilx-one/ai` selects for this product —
 * see `docs/model-selection.md` there for why it is `Qwen3-0.6B`.
 *
 * This fieldset never triggers a model's first load: per `nilx-one/ai#8`, a model is only
 * ever lazy-loaded from the explicit entry point of whichever feature needs it. What it
 * offers instead is what that entry point cannot say on its own — whether the artifacts are
 * already on this device, how large a first download is and where it would come from before
 * anything is fetched, and a way to reclaim the storage rather than wait for eviction to do
 * it. "Download now" here is a convenience prefetch: the same bytes that entry point would
 * ask for, asked for early and released again once fetched.
 *
 * `host` is not constructed here — see `local-model-host.ts` for why this package may not
 * reach into `@nilx-one/narration-webllm` itself. A deployment without one to pass simply
 * does not render this section, which `AuthenticatedMapHomeView` decides, not this component.
 */
export function LocalModelSettings({ host, modelId }: LocalModelSettingsProps) {
  const { t } = useLocalization();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<
    { readonly ratio: number; readonly text: string } | undefined
  >(undefined);

  const statusQuery = useQuery({
    queryKey: queryKeyFor(modelId),
    queryFn: () => checkLocalModel(host, modelId),
    retry: false,
    staleTime: 0,
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeyFor(modelId) });
  }

  const download = useMutation({
    mutationFn: async () => {
      setProgress({ ratio: 0, text: "" });
      const engine = await host.open(modelId, setProgress);
      // Warms the cache; a prefetch from here never keeps an engine resident.
      await engine.unload();
    },
    onSettled: () => {
      setProgress(undefined);
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => host.remove(modelId),
    onSuccess: refresh,
  });

  const phase = phaseFrom(statusQuery, download, remove, progress);
  const view = createLocalModelSettingsViewState(
    phase,
    statusQuery.data?.kind === "absent" ? statusQuery.data.notices : [],
  );

  return (
    <fieldset className="local-model-settings">
      <legend>{t("settings.localModel.legend")}</legend>
      <p className="local-model-settings__status" role="status">
        {t(`settings.localModel.status.${view.statusKey}`)}
      </p>

      {view.statusKey === "absent" ? (
        <p className="local-model-settings__detail">
          {view.detailSource === "mirror"
            ? t("settings.localModel.detail.mirror")
            : t("settings.localModel.detail.upstream")}{" "}
          {view.detailBytes === undefined
            ? t("settings.localModel.detail.unknownSize")
            : `${megabytes(view.detailBytes)} MB`}
        </p>
      ) : null}

      {view.progressRatio === undefined ? null : (
        <ProgressBar
          ratio={view.progressRatio}
          label={
            view.progressText === undefined || view.progressText === ""
              ? t("settings.localModel.status.downloading")
              : view.progressText
          }
        />
      )}

      {view.errorMessage === undefined ? null : (
        <p className="local-model-settings__error" role="alert">
          {view.errorMessage}
        </p>
      )}

      {view.notices.length === 0 ? null : (
        <details className="local-model-settings__notices">
          <summary>{t("settings.localModel.notices.legend")}</summary>
          <ul>
            {view.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="local-model-settings__actions">
        <button
          type="button"
          className="bond-profile__action"
          disabled={!view.canDownload || view.busy}
          onClick={() => download.mutate()}
        >
          {t("settings.localModel.action.download")}
        </button>
        <button
          type="button"
          className="bond-profile__action"
          disabled={!view.canRemove || view.busy}
          onClick={() => remove.mutate()}
        >
          {t("settings.localModel.action.remove")}
        </button>
      </div>
    </fieldset>
  );
}

interface AsyncState {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

interface StatusAsyncState extends AsyncState {
  readonly data: LocalModelCheck | undefined;
}

function phaseFrom(
  statusQuery: StatusAsyncState,
  download: AsyncState,
  remove: AsyncState,
  progress: { readonly ratio: number; readonly text: string } | undefined,
): LocalModelPhase {
  if (download.isPending) {
    return {
      kind: "downloading",
      ratio: progress?.ratio ?? 0,
      text: progress?.text ?? "",
    };
  }
  if (remove.isPending) {
    return { kind: "removing" };
  }
  if (download.isError) {
    return { kind: "error", message: messageOf(download.error) };
  }
  if (remove.isError) {
    return { kind: "error", message: messageOf(remove.error) };
  }
  if (statusQuery.isPending) {
    return { kind: "checking" };
  }
  if (statusQuery.isError) {
    return { kind: "error", message: messageOf(statusQuery.error) };
  }

  const check = statusQuery.data;
  if (check === undefined || check.kind === "cached") {
    return { kind: "present" };
  }
  return check.kind === "unsupported"
    ? { kind: "unsupported", reason: check.reason }
    : { kind: "absent", bytes: check.bytes, source: check.source };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
