// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import type {
  LocalModelCatalogEntry,
  LocalModelDeviceVerdict,
} from "./local-model-host";
import {
  createLocalModelChoiceView,
  createLocalModelSettingsViewState,
} from "./local-model-settings-view-model";

describe("what an owner may do, by phase", () => {
  it("offers neither action while checking this device", () => {
    const view = createLocalModelSettingsViewState({ kind: "checking" });

    expect(view.statusKey).toBe("checking");
    expect(view.canDownload).toBe(false);
    expect(view.canRemove).toBe(false);
    expect(view.busy).toBe(false);
  });

  it("names which floor a device falls short of, not a generic refusal", () => {
    expect(
      createLocalModelSettingsViewState({
        kind: "unsupported",
        reason: "insecure_context",
      }).statusKey,
    ).toBe("unsupportedInsecure");
    expect(
      createLocalModelSettingsViewState({
        kind: "unsupported",
        reason: "webgpu_missing",
      }).statusKey,
    ).toBe("unsupportedNoWebgpu");
    expect(
      createLocalModelSettingsViewState({
        kind: "unsupported",
        reason: "adapter_unavailable",
      }).statusKey,
    ).toBe("unsupportedNoAdapter");
    expect(
      createLocalModelSettingsViewState({
        kind: "unsupported",
        reason: "below_runtime_floor",
      }).statusKey,
    ).toBe("unsupportedBelowFloor");
    expect(
      createLocalModelSettingsViewState({
        kind: "unsupported",
        reason: "missing_features",
      }).statusKey,
    ).toBe("unsupportedFeatures");
  });

  it("offers cancelling only while a download is running", () => {
    expect(
      createLocalModelSettingsViewState({
        kind: "downloading",
        ratio: 0.1,
        text: "",
      }).canCancel,
    ).toBe(true);
    for (const phase of [
      { kind: "checking" },
      { kind: "absent", bytes: null, source: "upstream" },
      { kind: "present" },
      { kind: "removing" },
      { kind: "error", message: "device lost" },
    ] as const) {
      expect(createLocalModelSettingsViewState(phase).canCancel).toBe(false);
    }
  });

  it("offers a download and carries the size and notices, once absent", () => {
    const notices = ["Model weights converted and published by mlc-ai."];
    const view = createLocalModelSettingsViewState(
      { kind: "absent", bytes: 402_653_184, source: "mirror" },
      notices,
    );

    expect(view.statusKey).toBe("absent");
    expect(view.detailBytes).toBe(402_653_184);
    expect(view.detailSource).toBe("mirror");
    expect(view.notices).toEqual(notices);
    expect(view.canDownload).toBe(true);
    expect(view.canRemove).toBe(false);
  });

  it("omits the byte detail rather than showing zero when the size is unknown", () => {
    const view = createLocalModelSettingsViewState({
      kind: "absent",
      bytes: null,
      source: "upstream",
    });

    expect(view.detailBytes).toBeUndefined();
    expect(view.detailSource).toBe("upstream");
  });

  it("keeps both actions disabled while a download is in progress", () => {
    const view = createLocalModelSettingsViewState({
      kind: "downloading",
      ratio: 0.42,
      text: "Fetching weights",
    });

    expect(view.progressRatio).toBe(0.42);
    expect(view.progressText).toBe("Fetching weights");
    expect(view.canDownload).toBe(false);
    expect(view.canRemove).toBe(false);
    expect(view.busy).toBe(true);
  });

  it("offers only removal once the model is present", () => {
    const view = createLocalModelSettingsViewState({ kind: "present" });

    expect(view.canDownload).toBe(false);
    expect(view.canRemove).toBe(true);
    expect(view.busy).toBe(false);
  });

  it("keeps both actions disabled while removing", () => {
    const view = createLocalModelSettingsViewState({ kind: "removing" });

    expect(view.canRemove).toBe(false);
    expect(view.canDownload).toBe(false);
    expect(view.busy).toBe(true);
  });

  it("surfaces the error and offers both download and removal as the retry", () => {
    const view = createLocalModelSettingsViewState({
      kind: "error",
      message: "device lost",
    });

    expect(view.errorMessage).toBe("device lost");
    expect(view.canDownload).toBe(true);
    // An error can mean an interrupted download left something behind a later check can no
    // longer read; eviction is safe even when nothing is actually cached, so it stays on
    // offer here rather than depending on knowing the error's cause.
    expect(view.canRemove).toBe(true);
  });

  it("never carries notices outside the absent phase", () => {
    const notices = ["some notice"];

    expect(
      createLocalModelSettingsViewState({ kind: "present" }, notices).notices,
    ).toEqual([]);
    expect(
      createLocalModelSettingsViewState({ kind: "checking" }, notices).notices,
    ).toEqual([]);
  });
});

function catalogEntry(
  modelId: string,
  faithfulness: LocalModelCatalogEntry["faithfulness"] = null,
): LocalModelCatalogEntry {
  return {
    modelId,
    family: "qwen3",
    label: modelId,
    vramMb: 100,
    licence: "apache-2.0",
    licenceName: "Apache License 2.0",
    attribution: null,
    usePolicy: null,
    notices: ["read"],
    faithfulness,
  };
}

const DEFAULT = "default";
const OTHER = "other";
const CATALOG = [catalogEntry(DEFAULT), catalogEntry(OTHER)];
const USABLE = { kind: "usable" } as const;

describe("chosen, eligible and default", () => {
  it("runs the default when nothing was chosen", () => {
    const view = createLocalModelChoiceView({
      catalog: CATALOG,
      defaultModelId: DEFAULT,
      stored: undefined,
      verdicts: new Map<string, LocalModelDeviceVerdict>([
        [DEFAULT, USABLE],
        [OTHER, USABLE],
      ]),
    });
    expect(view.effectiveModelId).toBe(DEFAULT);
    expect(view.fallback).toBeUndefined();
    expect(view.options.map((option) => option.selectable)).toEqual([
      true,
      true,
    ]);
  });

  it("runs a stored choice the device admits", () => {
    expect(
      createLocalModelChoiceView({
        catalog: CATALOG,
        defaultModelId: DEFAULT,
        stored: OTHER,
        verdicts: new Map<string, LocalModelDeviceVerdict>([
          [DEFAULT, USABLE],
          [OTHER, USABLE],
        ]),
      }).effectiveModelId,
    ).toBe(OTHER);
  });

  it("keeps a stored choice in effect while the device is still being checked", () => {
    const view = createLocalModelChoiceView({
      catalog: CATALOG,
      defaultModelId: DEFAULT,
      stored: OTHER,
      verdicts: undefined,
    });
    expect(view.effectiveModelId).toBe(OTHER);
    expect(view.fallback).toBeUndefined();
    expect(view.options.every((option) => !option.selectable)).toBe(true);
  });

  it("falls back to the default for a stored choice the device refuses, with the refusal shown", () => {
    const view = createLocalModelChoiceView({
      catalog: CATALOG,
      defaultModelId: DEFAULT,
      stored: OTHER,
      verdicts: new Map<string, LocalModelDeviceVerdict>([
        [DEFAULT, USABLE],
        [OTHER, { kind: "over_budget", requiredMb: 900, budgetMb: 512 }],
      ]),
    });
    expect(view.effectiveModelId).toBe(DEFAULT);
    expect(view.fallback).toBe("stored_ineligible");
    expect(view.options[1]?.refusal).toEqual({
      kind: "over_budget",
      requiredMb: 900,
      budgetMb: 512,
    });
    expect(view.options[1]?.selectable).toBe(false);
  });

  it("falls back to the default for a stored choice the catalog no longer serves", () => {
    const view = createLocalModelChoiceView({
      catalog: CATALOG,
      defaultModelId: DEFAULT,
      stored: "retired",
      verdicts: new Map<string, LocalModelDeviceVerdict>([
        [DEFAULT, USABLE],
        [OTHER, USABLE],
      ]),
    });
    expect(view.effectiveModelId).toBe(DEFAULT);
    expect(view.fallback).toBe("stored_unknown");
  });

  it("states a device-wide refusal once instead of blaming the stored choice", () => {
    const refused = { kind: "webgpu_missing" } as const;
    const view = createLocalModelChoiceView({
      catalog: CATALOG,
      defaultModelId: DEFAULT,
      stored: OTHER,
      verdicts: new Map<string, LocalModelDeviceVerdict>([
        [DEFAULT, refused],
        [OTHER, refused],
      ]),
    });
    expect(view.deviceRefusal).toBe("webgpu_missing");
    expect(view.fallback).toBeUndefined();
    expect(view.options.every((option) => option.refusal === undefined)).toBe(
      true,
    );
  });

  it("labels an entry by what an on-device pass measured, or that none ran", () => {
    const view = createLocalModelChoiceView({
      catalog: [
        catalogEntry("unmeasured"),
        catalogEntry("low", { admitted: 1, total: 6 }),
        catalogEntry("measured", { admitted: 5, total: 6 }),
      ],
      defaultModelId: "unmeasured",
      stored: undefined,
      verdicts: undefined,
    });
    expect(view.options.map((option) => option.faithfulness)).toEqual([
      "unmeasured",
      "low",
      "measured",
    ]);
  });
});

describe("an entry over the declared budget, when it is the one in effect", () => {
  it("names the budget, not the device", () => {
    expect(
      createLocalModelSettingsViewState(
        { kind: "unsupported", reason: "over_budget" },
        [],
      ).statusKey,
    ).toBe("unsupportedOverBudget");
  });
});
