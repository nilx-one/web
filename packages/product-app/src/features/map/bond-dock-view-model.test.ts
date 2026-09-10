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

  it("hands the wheel over whatever this device can run", () => {
    // The wheel is presentation: it decides which body the world draws, and a
    // device that can run no model still draws one.
    expect(createBondDockViewState(base)).toMatchObject({
      preparesRuntime: false,
      right: {
        role: "unavailable",
        tone: "idle",
        actionable: true,
        actionLabel: "Hand the wheel to 0skai",
      },
    });
    expect(createBondDockViewState({ ...base, avaia: "ready" })).toMatchObject({
      right: { role: "ready", tone: "ready", actionable: true },
    });
    expect(
      createBondDockViewState({ ...base, avaia: "preparing" }),
    ).toMatchObject({
      right: { role: "preparing", actionable: true, tone: "working" },
    });
  });

  it("asks for a runtime this host could fetch as it hands the wheel over", () => {
    expect(
      createBondDockViewState({
        ...base,
        avaia: "downloadable",
        downloadable: true,
      }),
    ).toMatchObject({
      preparesRuntime: true,
      right: { role: "download", actionLabel: "Hand the wheel to 0skai" },
    });
    // Nothing to fetch, or no way to fetch it: the wheel still changes hands.
    expect(
      createBondDockViewState({ ...base, avaia: "downloadable" }),
    ).toMatchObject({ preparesRuntime: false, right: { actionable: true } });
    expect(
      createBondDockViewState({
        ...base,
        wheel: "avaia",
        avaia: "downloadable",
        downloadable: true,
      }).preparesRuntime,
    ).toBe(false);
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
  it("keeps the selected Avaia as the edit target before its profile is read", () => {
    const dock = createBondDockViewState({ ...base, wheel: "avaia" });

    expect(dock.left).toMatchObject({ seat: "avaia", role: "driving" });
    expect(dock.configure).toEqual({ seat: "avaia", label: "Edit 0skai" });
  });

  it("states what an owner has not configured, in either seat", () => {
    expect(
      createBondDockViewState({ ...base, avaiaConfiguration: "unconfigured" })
        .right,
    ).toMatchObject({
      role: "unconfigured",
      actionLabel: "Hand the wheel to 0skai",
    });
    expect(
      createBondDockViewState({
        ...base,
        wheel: "avaia",
        avaiaConfiguration: "unconfigured",
      }).left,
    ).toMatchObject({
      role: "unconfigured",
      actionLabel: "Focus the world on 0skai",
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

  it("stays configured on a device that can run nothing", () => {
    expect(
      createBondDockViewState({
        ...base,
        avaia: "unavailable",
        avaiaConfiguration: "configured",
      }).right,
    ).toMatchObject({ role: "unavailable", tone: "idle" });
  });
});

describe("What the Dock configures", () => {
  it("configures the Bond while the Bond is driving", () => {
    expect(
      createBondDockViewState({ ...base, avaiaConfiguration: "configured" })
        .configure,
    ).toEqual({ seat: "bond", label: "Edit 0x0sky" });
  });

  it("configures the Avaia while the Avaia is driving", () => {
    expect(
      createBondDockViewState({
        ...base,
        wheel: "avaia",
        avaiaConfiguration: "unconfigured",
      }).configure,
    ).toEqual({ seat: "avaia", label: "Set up 0skai" });
    expect(
      createBondDockViewState({
        ...base,
        wheel: "avaia",
        avaiaConfiguration: "configured",
      }).configure,
    ).toEqual({ seat: "avaia", label: "Edit 0skai" });
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
