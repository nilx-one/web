// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { createLocalModelSettingsViewState } from "./local-model-settings-view-model";

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

  it("surfaces the error and still offers a download as the retry", () => {
    const view = createLocalModelSettingsViewState({
      kind: "error",
      message: "device lost",
    });

    expect(view.errorMessage).toBe("device lost");
    expect(view.canDownload).toBe(true);
    expect(view.canRemove).toBe(false);
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
