// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useRef, useState } from "react";

import { ProgressBar } from "@nilx-one/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chooseLocalModel, useLocalModelChoice } from "./local-model-choice";
import type {
  LocalModelCatalogEntry,
  LocalModelDependency,
  LocalModelDeviceVerdict,
  LocalModelHost,
} from "./local-model-host";
import {
  createLocalModelChoiceView,
  createLocalModelSettingsViewState,
  type LocalModelOptionView,
  type LocalModelPhase,
  type UnsupportedReason,
} from "./local-model-settings-view-model";
import { type Translate, useLocalization } from "./localization";

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
  const verdict = await host.inspect(modelId);
  if (verdict.kind !== "usable") {
    return { kind: "unsupported", reason: verdict.kind };
  }
  if (await isCachedOrRecover(host, modelId)) {
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

/**
 * A completeness check that cannot prove the model complete answers "not cached" rather
 * than failing this whole status check.
 *
 * A cancelled download is one known way to reach this: `@mlc-ai/web-llm`'s OPFS writer
 * streams a response straight into a file, and at least one browser does not make that
 * write atomic — terminating the worker mid-write can leave a truncated artifact rather
 * than none at all. `isCached` then reads that file and throws parsing it, and it throws
 * the same way on every future check until the artifact is gone. Evicting here is what
 * turns a wedged device back into a retryable one, and eviction is documented as safe to
 * call even when nothing is actually cached.
 */
async function isCachedOrRecover(
  host: LocalModelHost,
  modelId: string,
): Promise<boolean> {
  try {
    return await host.isCached(modelId);
  } catch {
    await host.remove(modelId).catch(() => undefined);
    return false;
  }
}

async function inspectCatalog(
  host: LocalModelHost,
  catalog: readonly LocalModelCatalogEntry[],
): Promise<ReadonlyMap<string, LocalModelDeviceVerdict>> {
  const verdicts = await Promise.all(
    catalog.map(
      async (entry) =>
        [entry.modelId, await host.inspect(entry.modelId)] as const,
    ),
  );
  return new Map(verdicts);
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
 * ask for, asked for early and released again once fetched. A person who changes their mind
 * midway can say so: cancelling abandons the download and re-reads the cache, and is never
 * reported as something having gone wrong.
 *
 * `host` is not constructed here — see `local-model-host.ts` for why this package may not
 * reach into `@nilx-one/narration-webllm` or `@aiaiaiai/webllm` itself. A deployment without one to pass simply
 * does not render this section, which `AuthenticatedMapHomeView` decides, not this component.
 */
export function LocalModelSettings({
  host,
  catalog,
  defaultModelId,
}: LocalModelSettingsProps) {
  const { t } = useLocalization();
  const stored = useLocalModelChoice();
  const verdictsQuery = useQuery({
    queryKey: [
      "local-model-verdicts",
      ...catalog.map((entry) => entry.modelId),
    ],
    queryFn: () => inspectCatalog(host, catalog),
    retry: false,
    staleTime: 0,
  });
  const choice = createLocalModelChoiceView({
    catalog,
    defaultModelId,
    stored,
    verdicts: verdictsQuery.data,
  });
  const modelId = choice.effectiveModelId;
  const effective = choice.options.find((option) => option.modelId === modelId);
  const refused = choice.options.filter(
    (option) => option.refusal !== undefined,
  );
  // Until someone chooses, the picker asks rather than pretending the default was chosen;
  // a stored choice stays shown even while the default stands in for it.
  const pickerValue =
    stored !== undefined &&
    choice.options.some((option) => option.modelId === stored)
      ? stored
      : "";
  const entry = catalog.find((candidate) => candidate.modelId === modelId);
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<
    { readonly ratio: number; readonly text: string } | undefined
  >(undefined);
  const downloadAbort = useRef<AbortController | undefined>(undefined);
  // A one-time note, not a checkbox: it surfaces the moment a use-policy entry is picked
  // and is gone on the next render unless picked again. Nothing here gates the choice —
  // per the Llama 3.2 Community License §1.b.ii, a person receiving it through this
  // product is not the one who must agree to the licence; we are, as its distributor.
  const [justChosenPolicy, setJustChosenPolicy] = useState<string | null>(null);

  function onPick(pickedId: string): void {
    chooseLocalModel(pickedId);
    const picked = choice.options.find((option) => option.modelId === pickedId);
    setJustChosenPolicy(picked?.usePolicy ?? null);
  }

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
      const controller = new AbortController();
      downloadAbort.current = controller;
      setProgress({ ratio: 0, text: "" });
      try {
        const engine = await host.open(modelId, setProgress, controller.signal);
        // Warms the cache; a prefetch from here never keeps an engine resident.
        await engine.unload();
      } catch (error) {
        // A download someone asked to stop did not fail; it settles as a success so the
        // cache is re-read and the section returns to whatever is true now.
        if (!controller.signal.aborted) throw error;
      }
    },
    onSettled: () => {
      downloadAbort.current = undefined;
      setProgress(undefined);
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => host.remove(modelId),
    onSuccess: refresh,
  });

  const phase = phaseFrom(statusQuery, download, remove, progress);
  const described =
    statusQuery.data?.kind === "absent" ? statusQuery.data.notices : [];
  const entryNotices = entry?.notices ?? [];
  const view = createLocalModelSettingsViewState(phase, [
    ...entryNotices,
    ...described.filter((notice) => !entryNotices.includes(notice)),
  ]);

  return (
    <fieldset className="local-model-settings">
      <legend>{t("settings.localModel.legend")}</legend>
      <label className="local-model-settings__picker">
        <select
          value={pickerValue}
          aria-label={t("settings.localModel.legend")}
          disabled={view.busy}
          onChange={(event) => onPick(event.currentTarget.value)}
        >
          {pickerValue === "" ? (
            <option value="" disabled>
              {t("settings.localModel.choose")}
            </option>
          ) : null}
          {choice.options.map((option) => (
            <option
              key={option.modelId}
              value={option.modelId}
              disabled={!option.selectable}
            >
              {optionText(option, t)}
            </option>
          ))}
        </select>
        <svg
          className="local-model-settings__chevron"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path d="m2.5 4.5 3.5 3 3.5-3" />
        </svg>
      </label>
      {refused.length === 0 ? null : (
        <ul className="local-model-settings__refusals">
          {refused.map((option) => (
            <li key={option.modelId}>{refusalText(option, t)}</li>
          ))}
        </ul>
      )}
      {justChosenPolicy === null ? null : (
        <p className="local-model-settings__policy-note" role="status">
          {t("settings.localModel.option.usePolicyNote")}{" "}
          <a href={justChosenPolicy} target="_blank" rel="noreferrer">
            {t("settings.localModel.option.usePolicy")}
          </a>
          <button
            type="button"
            className="local-model-settings__policy-dismiss"
            aria-label={t("settings.localModel.option.usePolicyDismiss")}
            onClick={() => setJustChosenPolicy(null)}
          >
            ×
          </button>
        </p>
      )}
      {effective === undefined ? null : (
        <LocalModelDetails option={effective} />
      )}
      {choice.fallback === undefined ? null : (
        <p className="local-model-settings__fallback">
          {choice.fallback === "stored_ineligible"
            ? t("settings.localModel.fallback.ineligible")
            : t("settings.localModel.fallback.unknown")}
        </p>
      )}
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
        {view.canCancel ? (
          <button
            type="button"
            className="bond-profile__action"
            onClick={() => downloadAbort.current?.abort()}
          >
            {t("settings.localModel.action.cancel")}
          </button>
        ) : (
          <button
            type="button"
            className="bond-profile__action"
            disabled={!view.canRemove || view.busy}
            onClick={() => remove.mutate()}
          >
            {t("settings.localModel.action.remove")}
          </button>
        )}
      </div>
    </fieldset>
  );
}

/**
 * One line per entry, as a native picker shows it. What a licence obliges to be seen beside
 * the model — "Built with Llama" — travels in the line itself, so it is shown wherever the
 * entry is offered. An entry this device refuses is marked here and says why under the
 * picker, where a reason has room to be read whole.
 */
function optionText(option: LocalModelOptionView, t: Translate): string {
  const parts = [option.label];
  if (option.isDefault) {
    parts.push(t("settings.localModel.option.default"));
  }
  if (option.attribution !== null) {
    parts.push(option.attribution);
  }
  const text = parts.join(" · ");
  return option.refusal === undefined
    ? text
    : `${text} — ${t("settings.localModel.option.unavailable")}`;
}

function refusalText(option: LocalModelOptionView, t: Translate): string {
  const refusal = option.refusal;
  const reason =
    refusal?.kind === "over_budget"
      ? t("settings.localModel.option.overBudget")
          .replace("{required}", Math.round(refusal.requiredMb).toString())
          .replace("{budget}", Math.round(refusal.budgetMb).toString())
      : t("settings.localModel.option.missingFeatures");
  return `${option.label} — ${reason}`;
}

/** What is worth knowing about the model in effect, and only that one. */
function LocalModelDetails({
  option,
}: {
  readonly option: LocalModelOptionView;
}) {
  const { t } = useLocalization();

  return (
    <div className="local-model-settings__option">
      <small>
        {t("settings.localModel.option.memory").replace(
          "{size}",
          Math.round(option.vramMb).toString(),
        )}
      </small>
      {option.attribution === null ? null : (
        <small className="local-model-settings__attribution">
          {option.attribution}
        </small>
      )}
      {option.usePolicy === null ? null : (
        <a
          className="local-model-settings__policy"
          href={option.usePolicy}
          target="_blank"
          rel="noreferrer"
        >
          {t("settings.localModel.option.usePolicy")}
        </a>
      )}
    </div>
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
