// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  avaiaAvailability,
  createBondDockViewState,
  type BondDockInput,
} from "./bond-dock-view-model";

const base: BondDockInput = {
  pubDress: "0x0sky",
  avaiaPubDress: "0skai",
  wheel: "bond",
  avaia: "unavailable",
  focusable: true,
  downloadable: false,
};

describe("Dock seats", () => {
  it("puts the identity at the wheel on the left and the spectator on the right", () => {
    const dock = createBondDockViewState(base);

    expect(dock.left).toMatchObject({
      seat: "bond",
      role: "You",
      actionLabel: "Focus the world on 0x0sky",
    });
    expect(dock.right).toMatchObject({ seat: "avaia", role: "unavailable" });
  });

  it("calls the Bond a spectator only when the Avaia is driving", () => {
    expect(createBondDockViewState({ ...base, wheel: "avaia" })).toMatchObject({
      left: { seat: "avaia", role: "driving" },
      right: {
        seat: "bond",
        role: "spectate",
        actionLabel: "Take the wheel as 0x0sky",
        actionable: true,
      },
    });
  });

  it("hands the wheel over only when the runtime is ready", () => {
    expect(createBondDockViewState({ ...base, avaia: "ready" })).toMatchObject({
      handover: "switch",
      right: { role: "ready", actionable: true },
    });
    expect(
      createBondDockViewState({ ...base, avaia: "preparing" }),
    ).toMatchObject({
      handover: undefined,
      right: { role: "preparing", actionable: false, tone: "working" },
    });
  });

  it("offers a download only when this host can fetch one", () => {
    expect(
      createBondDockViewState({
        ...base,
        avaia: "downloadable",
        downloadable: true,
      }),
    ).toMatchObject({
      handover: "download",
      right: { role: "download", actionLabel: "Download the 0skai runtime" },
    });
    expect(
      createBondDockViewState({ ...base, avaia: "downloadable" }),
    ).toMatchObject({ handover: undefined, right: { actionable: false } });
  });

  it("cannot focus a world with no observation to focus on", () => {
    expect(
      createBondDockViewState({ ...base, focusable: false }).left.actionable,
    ).toBe(false);
  });

  it("names an Avaia a Bond does not have yet", () => {
    expect(
      createBondDockViewState({ ...base, avaiaPubDress: undefined }).right
        .address,
    ).toBe("Avaia");
  });
});

describe("Avaia configuration on the Dock", () => {
  it("says nothing about configuration until a profile has been read", () => {
    const dock = createBondDockViewState(base);

    expect(dock.avaiaAction).toBeUndefined();
    expect(dock.right).toMatchObject({
      role: "unavailable",
      actionable: false,
      actionLabel: "0skai is unavailable on this device",
    });
  });

  it("opens setup for an Avaia its owner has not configured", () => {
    const dock = createBondDockViewState({
      ...base,
      avaiaConfiguration: "unconfigured",
    });

    expect(dock.avaiaAction).toBe("setup");
    expect(dock.right).toMatchObject({
      role: "unconfigured",
      tone: "idle",
      actionable: true,
      actionLabel: "Set up 0skai",
    });
  });

  it("opens the same surface again once it is configured", () => {
    const dock = createBondDockViewState({
      ...base,
      avaiaConfiguration: "configured",
    });

    expect(dock.avaiaAction).toBe("edit");
    expect(dock.right).toMatchObject({
      actionable: true,
      actionLabel: "Edit 0skai",
    });
  });

  it("edits a configured Avaia from the wheel it is already at", () => {
    const dock = createBondDockViewState({
      ...base,
      wheel: "avaia",
      avaiaConfiguration: "configured",
    });

    expect(dock.left).toMatchObject({
      seat: "avaia",
      role: "driving",
      actionable: true,
      actionLabel: "Edit 0skai",
    });
    expect(dock.right).toMatchObject({ seat: "bond", role: "spectate" });
  });

  it("offers setup with no runtime, and no observation to focus", () => {
    const dock = createBondDockViewState({
      ...base,
      wheel: "avaia",
      focusable: false,
      avaiaConfiguration: "unconfigured",
    });

    expect(dock.left).toMatchObject({
      role: "unconfigured",
      actionable: true,
      actionLabel: "Set up 0skai",
    });
  });

  it("lets a runtime that can take the wheel say so first", () => {
    const dock = createBondDockViewState({
      ...base,
      avaia: "ready",
      avaiaConfiguration: "configured",
    });

    expect(dock.handover).toBe("switch");
    expect(dock.avaiaAction).toBeUndefined();
    expect(dock.right).toMatchObject({
      tone: "ready",
      actionLabel: "Hand the wheel to 0skai",
    });
  });

  it("keeps an unconfigured Avaia unconfigured whatever the device can run", () => {
    const dock = createBondDockViewState({
      ...base,
      avaia: "ready",
      avaiaConfiguration: "unconfigured",
    });

    // The role is what the owner stored; the dot is what this device can run.
    expect(dock.right).toMatchObject({ role: "unconfigured", tone: "ready" });
  });
});

describe("Avaia runtime availability", () => {
  it("is unavailable while there is nothing published to download", () => {
    expect(avaiaAvailability({ acceleratedGraphics: true })).toBe(
      "unavailable",
    );
  });

  it("is unavailable on a device that cannot run it", () => {
    expect(
      avaiaAvailability({
        acceleratedGraphics: false,
        artifact: "avaia-0.1.0",
      }),
    ).toBe("unavailable");
  });

  it("moves from downloadable through preparing to ready", () => {
    const artifact = "avaia-0.1.0";
    expect(avaiaAvailability({ acceleratedGraphics: true, artifact })).toBe(
      "downloadable",
    );
    expect(
      avaiaAvailability({
        acceleratedGraphics: true,
        artifact,
        preparing: true,
      }),
    ).toBe("preparing");
    expect(
      avaiaAvailability({ acceleratedGraphics: true, artifact, loaded: true }),
    ).toBe("ready");
  });
});
