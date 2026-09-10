// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaProfileAccessPort,
  AvaiaProfileProjection,
  CoreRuntimePort,
  IdentityAccessPort,
} from "@nilx-one/application";
import {
  UNSUPPORTED_GEOLOCATION,
  type HostPort,
} from "@nilx-one/host-contract";
import { ProductApp } from "@nilx-one/product-app";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../support/doubles";

const readyCore: CoreRuntimePort = {
  probe: async () => ({ kind: "ready", contractVersion: "0.1.0" }),
};

function createHost(): HostPort {
  return {
    getSnapshot: () => ({
      kind: "browser",
      available: true,
      theme: "dark",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: { kind: "browser-session" },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
    geolocation: UNSUPPORTED_GEOLOCATION,
  };
}

function createIdentity(
  overrides: Partial<IdentityAccessPort> = {},
): IdentityAccessPort {
  return {
    acknowledgeRecoveryKey: async () => ({ kind: "service-unavailable" }),
    authenticateNative: async () => ({ kind: "service-unavailable" }),
    forgetRememberedBond: async () => ({ kind: "completed" }),
    logoutNative: async () => ({ kind: "completed" }),
    readNativeContext: async () => ({
      kind: "authenticated",
      identity: {
        pubDress: "0x0sky",
        avaiaPubDress: "0skai",
        avatarModel: "sky-study",
      },
    }),
    readProviderIdentity: async () => ({ kind: "not-registered" }),
    recoverNative: async () => ({ kind: "service-unavailable" }),
    registerNative: async () => ({ kind: "service-unavailable" }),
    chooseAvatarModel: async () => ({ kind: "service-unavailable" }),
    renameAvaiaSlug: async () => ({ kind: "service-unavailable" }),
    renamePubDressSlug: async () => ({ kind: "service-unavailable" }),
    setProviderPassword: async () => ({ kind: "service-unavailable" }),
    registerProvider: async () => ({ kind: "service-unavailable" }),
    resolvePubDressLabel: async (label) => ({ kind: "available", label }),
    resolvePubDress: async () => ({ kind: "service-unavailable" }),
    ...overrides,
  };
}

/** An identity client that has reached contract 8 and answers for the Avaia. */
function withAvaiaProfile(
  identity: IdentityAccessPort,
  avaia: Partial<AvaiaProfileAccessPort>,
): IdentityAccessPort & AvaiaProfileAccessPort {
  return {
    ...identity,
    readAvaiaProfile: async () => ({ kind: "service-unavailable" }),
    updateAvaiaProfile: async () => ({ kind: "service-unavailable" }),
    ...avaia,
  };
}

function projection(
  overrides: Partial<AvaiaProfileProjection> = {},
): AvaiaProfileProjection {
  return {
    pubDress: "0skai",
    ownerPubDress: "0x0sky",
    configurationState: "unconfigured",
    ...overrides,
  };
}

describe("Avaia setup from the Bond dock", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("configures an Avaia from its Dock card without unmounting the world", async () => {
    const user = userEvent.setup();
    const renderer = createMapRendererDouble({ kind: "ready" });
    let stored = projection();
    const updateAvaiaProfile = vi
      .fn<AvaiaProfileAccessPort["updateAvaiaProfile"]>()
      .mockImplementation(async (pubDress) => {
        stored = projection({ pubDress, configurationState: "configured" });
        return { kind: "updated", profile: stored };
      });
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        mapRenderer={renderer}
        identity={withAvaiaProfile(createIdentity(), {
          readAvaiaProfile: async () => ({
            kind: "available",
            profile: stored,
          }),
          updateAvaiaProfile,
        })}
      />,
    );

    // An Avaia nobody has configured says so on its card, and the Dock's own
    // action offers the one thing that can be done about it.
    const configure = await screen.findByRole("button", {
      name: "Set up 0skai",
    });
    expect(
      screen.getByRole("button", { name: "Focus the world on 0skai" }),
    ).toHaveTextContent("unconfigured");
    expect(renderer.mount).toHaveBeenCalledOnce();

    await user.click(configure);

    const address = await screen.findByLabelText("pub_dress");
    expect(address).toHaveValue("sk");
    // The world is the environment, not a screen the Dock replaced.
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();

    // A body is part of what an Avaia is, and this contract publishes no model
    // to choose from, so the field is present and inert rather than invented.
    const model = screen.getByLabelText("3D model");
    expect(model).toBeDisabled();
    expect(model).toHaveValue("Not available yet");
    // The mutable middle and that one inert field are the whole textbox surface:
    // protocol-owned address affixes stay outside the editable control.
    expect(screen.getAllByRole("textbox")).toEqual([address, model]);

    await user.clear(address);
    await user.type(address, "vesn");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateAvaiaProfile).toHaveBeenCalledExactlyOnceWith("0vesnai");

    // The save ends on the world: the screen closes, the Dock reads the
    // address the service answered with, and the notice is said once in the
    // stack every transient notice is said in.
    const notice = await screen.findByText("Avaia saved");
    expect(notice.closest(".toast")).toHaveTextContent("0vesnai");
    expect(screen.queryByLabelText("pub_dress")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Edit 0vesnai" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeVisible();
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();
  });

  it("opens the same surface again for an Avaia already configured", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        mapRenderer={createMapRendererDouble({ kind: "ready" })}
        identity={withAvaiaProfile(createIdentity(), {
          readAvaiaProfile: async () => ({
            kind: "available",
            profile: projection({ configurationState: "configured" }),
          }),
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Edit 0skai" }));
    expect(await screen.findByLabelText("pub_dress")).toHaveValue("sk");
    expect(screen.getByRole("heading", { name: "0skai" })).toBeVisible();
  });

  it("keeps the service's refusal, and the address a person typed", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        mapRenderer={createMapRendererDouble({ kind: "ready" })}
        identity={withAvaiaProfile(createIdentity(), {
          readAvaiaProfile: async () => ({
            kind: "available",
            profile: projection(),
          }),
          updateAvaiaProfile: async () => ({
            kind: "rejected",
            reason: "unavailable",
          }),
        })}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Set up 0skai" }),
    );
    const address = await screen.findByLabelText("pub_dress");
    await user.clear(address);
    await user.type(address, "taken");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // A refusal keeps the person where they were, with what they typed.
    expect(
      await screen.findByText("That address belongs to another identity."),
    ).toBeVisible();
    expect(screen.getByLabelText("pub_dress")).toHaveValue("taken");
    expect(screen.queryByText("Avaia saved")).toBeNull();
  });

  it("stays configured when this device can run nothing at all", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        mapRenderer={createMapRendererDouble({ kind: "ready" })}
        identity={withAvaiaProfile(createIdentity(), {
          readAvaiaProfile: async () => ({
            kind: "available",
            profile: projection({ configurationState: "configured" }),
          }),
        })}
      />,
    );

    // No runtime is published on any device, and that never unconfigures what
    // an owner already stored.
    const configure = await screen.findByRole("button", { name: "Edit 0skai" });
    expect(
      screen.getByRole("button", { name: "Focus the world on 0skai" }),
    ).not.toHaveTextContent("unconfigured");

    configure.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("pub_dress")).toHaveValue("sk");
    expect(screen.getByText("configured")).toBeVisible();
  });

  it("leaves a host without the capability the Dock it already had", async () => {
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        mapRenderer={createMapRendererDouble({ kind: "ready" })}
        identity={createIdentity()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeVisible();
    // Nothing is synthesised in place of a profile this host cannot read.
    expect(screen.queryByRole("button", { name: /Set up/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit 0skai/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Focus the world on 0skai" }),
    ).toHaveTextContent("driving");
  });

  it("has no automatically detectable accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        mapRenderer={createMapRendererDouble({ kind: "ready" })}
        identity={withAvaiaProfile(createIdentity(), {
          readAvaiaProfile: async () => ({
            kind: "available",
            profile: projection(),
          }),
        })}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Set up 0skai" }),
    );
    await screen.findByLabelText("pub_dress");
    const results = await act(() => axe.run(container));
    expect(results.violations).toEqual([]);
  });
});
