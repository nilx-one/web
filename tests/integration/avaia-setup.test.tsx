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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../support/doubles";

const readyCore: CoreRuntimePort = {
  probe: async () => ({ kind: "ready", contractVersion: "0.1.0" }),
};

/**
 * The authenticated world opens on the Avaia, so its own Dock card is already
 * the one at the wheel. Waiting for it is what these tests are standing on,
 * not what they are about.
 */
async function avaiaAtWheel(
  _user: ReturnType<typeof userEvent.setup>,
  address = "x0skai",
): Promise<void> {
  await screen.findByRole("button", { name: `Focus the world on ${address}` });
}

/**
 * An Avaia nobody has configured is nobody to spectate, so a fresh Bond's
 * world opens with the Bond itself at the wheel.
 */
async function bondAtWheel(): Promise<void> {
  await screen.findByRole("button", { name: "Focus the world on 0x0sky" });
  await screen.findByRole("button", { name: "Set up x0skai" });
}

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
        avaiaPubDress: "x0skai",
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
    linkTelegramProvider: async () => ({ kind: "linked" }),
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
    publishAvaiaLocation: async () => ({ kind: "service-unavailable" }),
    ...avaia,
  };
}

function projection(
  overrides: Partial<AvaiaProfileProjection> = {},
): AvaiaProfileProjection {
  return {
    pubDress: "x0skai",
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

  it("opens a fresh Bond at the wheel, with nobody to spectate yet", async () => {
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
        })}
      />,
    );

    await bondAtWheel();
    expect(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    ).toHaveTextContent("You");
    expect(screen.queryByText("spectate")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set up x0skai" }),
    ).toHaveTextContent("unconfigured");
  });

  it("configures an Avaia in one tap from its Dock card, and says what it paid", async () => {
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

    await bondAtWheel();

    // An Avaia nobody has configured is not handed the wheel: its card opens
    // the one thing that can be done about it.
    await user.click(screen.getByRole("button", { name: "Set up x0skai" }));

    // The address it already holds types itself out, and Kai stands in as its
    // body, so there is nothing left to decide but Create.
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    expect(
      screen.getByRole("button", {
        name: /Change this Avaia's 3D model — currently Kai/,
      }),
    ).toBeVisible();
    // The world is the environment, not a screen the Dock replaced.
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();
    // The address is the only textbox this surface itself owns; the body an
    // Avaia is represented by is a separate, real control below it.
    expect(screen.getAllByRole("textbox")).toEqual([address]);

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(updateAvaiaProfile).toHaveBeenCalledExactlyOnceWith("x0skai");

    // What configuring paid is said once, by xSasha, who walks up to say it.
    expect(screen.queryByLabelText("pub_dress")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Avaia configured",
    });
    expect(dialog).toHaveTextContent("xSasha");
    expect(dialog).toHaveTextContent("+20 Bond experience");
    expect(dialog).toHaveTextContent("x0skai reached level 1");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "(skip)" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // The body offered is now a choice, not a default.
    expect(
      JSON.parse(
        window.localStorage.getItem("nilx-one.avatar.wardrobe") ?? "{}",
      ) as unknown,
    ).toMatchObject({ x0skai: { modelId: "kai-study" } });

    // The Bond keeps the wheel; the Avaia can now be handed it.
    expect(
      await screen.findByRole("button", { name: "Hand the wheel to x0skai" }),
    ).toHaveTextContent("AI");

    // "Saved" passes on its own.
    expect(screen.getByText("Avaia saved")).toBeVisible();
    await waitFor(() => expect(screen.queryByText("Avaia saved")).toBeNull(), {
      timeout: 6_000,
    });
    expect(renderer.unmount).not.toHaveBeenCalled();
  }, 10_000);

  it("configures under a new address when a person types one", async () => {
    const user = userEvent.setup();
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
        mapRenderer={createMapRendererDouble({ kind: "ready" })}
        identity={withAvaiaProfile(createIdentity(), {
          readAvaiaProfile: async () => ({
            kind: "available",
            profile: stored,
          }),
          updateAvaiaProfile,
        })}
      />,
    );

    await bondAtWheel();
    await user.click(screen.getByRole("button", { name: "Set up x0skai" }));
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    await user.clear(address);
    await user.type(address, "vesn");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(updateAvaiaProfile).toHaveBeenCalledExactlyOnceWith("x0vesnai");
    const notice = await screen.findByText("Avaia saved");
    expect(notice.closest(".toast")).toHaveTextContent("x0vesnai");
    expect(
      await screen.findByRole("button", { name: "Hand the wheel to x0vesnai" }),
    ).toBeVisible();
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

    await avaiaAtWheel(user);

    await user.click(
      await screen.findByRole("button", { name: "Edit x0skai" }),
    );
    expect(await screen.findByLabelText("pub_dress")).toHaveValue("sk");
    expect(screen.getByRole("heading", { name: "x0skai" })).toBeVisible();
  });

  it("keeps the service's refusal, and the slug stem a person typed", async () => {
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

    await bondAtWheel();

    await user.click(screen.getByRole("button", { name: "Set up x0skai" }));
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    await user.clear(address);
    await user.type(address, "taken");
    await user.click(screen.getByRole("button", { name: "Create" }));

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
    await avaiaAtWheel(user);

    const configure = await screen.findByRole("button", {
      name: "Edit x0skai",
    });
    expect(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
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

    // The world opens on the Avaia, so the Dock offers the wheel back to the
    // Bond rather than onward.
    expect(
      await screen.findByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeVisible();
    // Nothing is synthesised in place of a profile this host cannot read: the
    // Avaia keeps its seat and its address, and gains no configure action.
    expect(screen.queryByRole("button", { name: /Set up/ })).toBeNull();
    // The Dock's own edit action still names whoever is driving, but on this
    // host it opens no configuration: there is no address field to invent.
    await userEvent.click(screen.getByRole("button", { name: "Edit x0skai" }));
    expect(screen.queryByLabelText("pub_dress")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
    ).toHaveTextContent("AI");
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
          updateAvaiaProfile: async (pubDress) => ({
            kind: "updated",
            profile: projection({ pubDress, configurationState: "configured" }),
          }),
        })}
      />,
    );

    await bondAtWheel();

    await user.click(screen.getByRole("button", { name: "Set up x0skai" }));
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    const results = await act(() => axe.run(container));
    expect(results.violations).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByRole("dialog", { name: "Avaia configured" });
    const withDialog = await act(() => axe.run(container));
    expect(withDialog.violations).toEqual([]);
  });
});
