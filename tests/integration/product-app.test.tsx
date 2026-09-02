// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  formatPubDress,
  type CoreRuntimePort,
  type IdentityAccessPort,
} from "@nilx-one/application";
import type { HostPort } from "@nilx-one/host-contract";
import type { MapRenderer } from "@nilx-one/map-contract";
import {
  ProductApp as ProductAppRuntime,
  type ProductAppProps,
} from "@nilx-one/product-app";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const readyCore: CoreRuntimePort = {
  probe: async () => ({ kind: "ready", contractVersion: "0.1.0" }),
};

function createMapRenderer(): MapRenderer {
  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    getStatus: () => ({ kind: "unmounted" }),
    subscribe: () => () => undefined,
    setCamera: vi.fn(),
  };
}

function ProductApp(props: Omit<ProductAppProps, "mapRenderer">) {
  return <ProductAppRuntime {...props} mapRenderer={createMapRenderer()} />;
}

function createHost(): HostPort {
  return {
    getSnapshot: () => ({
      kind: "browser",
      available: true,
      theme: "light",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: { kind: "browser-session" },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
  };
}

function createTelegramHost(): HostPort {
  return {
    getSnapshot: () => ({
      kind: "telegram",
      available: true,
      theme: "light",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: {
        kind: "telegram-init-data",
        initData: "signed-init-data",
        verification: "required",
      },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
  };
}

function createNativeHost(authenticated = true): HostPort {
  return {
    getSnapshot: () => ({
      kind: "native",
      available: true,
      theme: "dark",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: {
        kind: "native-app-session",
        authenticated,
        verification: "required",
      },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
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
    readNativeContext: async () => ({ kind: "anonymous" }),
    readProviderIdentity: async () => ({ kind: "not-registered" }),
    recoverNative: async () => ({ kind: "service-unavailable" }),
    registerNative: async () => ({ kind: "service-unavailable" }),
    registerProvider: async () => ({ kind: "service-unavailable" }),
    resolvePubDress: async (selection) => ({
      kind: "available",
      pubDress: formatPubDress(selection),
    }),
    ...overrides,
  };
}

describe("ProductApp identity", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders native identity and visible inactive provider choices on Web", async () => {
    const core: CoreRuntimePort = {
      probe: async () => ({ kind: "unavailable", reason: "artifact-missing" }),
    };
    render(
      <ProductApp
        core={core}
        host={createHost()}
        identity={createIdentity()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Enter your pub_dress." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Telegram — coming next/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Discord — coming later/i }),
    ).toBeDisabled();
    expect(await screen.findByText("Shared Core required")).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity()}
      />,
    );
    await screen.findByLabelText("pub_dress");
    const results = await act(() => axe.run(container));
    expect(results.violations).toEqual([]);
  });

  it("adapts one browser form from availability to registration and recovery acknowledgement", async () => {
    const user = userEvent.setup();
    const registerNative = vi
      .fn<IdentityAccessPort["registerNative"]>()
      .mockResolvedValue({
        kind: "recovery-key-required",
        identity: { pubDress: "0xaSky" },
        recoveryKey: "0x1-rk-once-only",
        challenge: "0x1c-registration",
      });
    const acknowledgeRecoveryKey = vi
      .fn<IdentityAccessPort["acknowledgeRecoveryKey"]>()
      .mockResolvedValue({
        kind: "authenticated",
        identity: { pubDress: "0xaSky" },
      });
    const identity = createIdentity({
      registerNative,
      acknowledgeRecoveryKey,
    });

    render(
      <ProductApp core={readyCore} host={createHost()} identity={identity} />,
    );
    const discriminator = await screen.findByRole("combobox", {
      name: "pub_dress hexadecimal discriminator",
    });
    await user.selectOptions(discriminator, "a");
    await user.type(screen.getByLabelText("pub_dress"), "Sky");
    await screen.findByText(
      "Available — create this identity",
      {},
      { timeout: 2_000 },
    );
    await user.keyboard("{Enter}");
    await user.type(
      await screen.findByLabelText("Password"),
      "a deliberately long password",
    );
    const create = screen.getByRole("button", { name: "Create 0xaSky" });
    expect(create).toBeEnabled();
    await user.click(create);

    expect(registerNative).toHaveBeenCalledWith(
      "0xaSky",
      "a deliberately long password",
      expect.any(String),
    );
    expect(await screen.findByText("0x1-rk-once-only")).toBeInTheDocument();
    expect(screen.getByText(/only native recovery proof/i)).toBeInTheDocument();
    const continueButton = screen.getByRole("button", {
      name: "Continue to 0x1",
    });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByLabelText("I saved this recovery key"));
    await user.click(continueButton);

    expect(acknowledgeRecoveryKey).toHaveBeenCalledWith("0x1c-registration");
    expect(
      await screen.findByText("Authenticated as 0xaSky."),
    ).toBeInTheDocument();
  });

  it("switches an existing exact address to native sign-in", async () => {
    const user = userEvent.setup();
    const authenticateNative = vi
      .fn<IdentityAccessPort["authenticateNative"]>()
      .mockResolvedValue({
        kind: "authenticated",
        identity: { pubDress: "0x0sky" },
      });
    const identity = createIdentity({
      resolvePubDress: async () => ({
        kind: "registered",
        pubDress: "0x0sky",
      }),
      authenticateNative,
    });
    render(
      <ProductApp core={readyCore} host={createHost()} identity={identity} />,
    );

    await user.type(await screen.findByLabelText("pub_dress"), "sky");
    await screen.findByText("Bond found — sign in", {}, { timeout: 2_000 });
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Password"),
      "correct password value",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(authenticateNative).toHaveBeenCalledWith(
      "0x0sky",
      "correct password value",
    );
  });

  it("waits for a typing pause unless the mobile go action resolves now", async () => {
    const user = userEvent.setup();
    const resolvePubDress = vi
      .fn<IdentityAccessPort["resolvePubDress"]>()
      .mockResolvedValue({ kind: "available", pubDress: "0x0sky" });
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity({ resolvePubDress })}
      />,
    );

    const slug = await screen.findByLabelText("pub_dress");
    await user.type(slug, "sky");
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(resolvePubDress).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await screen.findByText("Available — create this identity");
    expect(resolvePubDress).toHaveBeenCalledOnce();
    expect(
      await screen.findByLabelText("Password", {}, { timeout: 2_000 }),
    ).toHaveFocus();
  });

  it("keeps the resolved identity valid while reporting rejected credentials in red", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity({
          resolvePubDress: async () => ({
            kind: "registered",
            pubDress: "0x0sky",
          }),
          authenticateNative: async () => ({
            kind: "rejected",
            reason: "invalid-credentials",
          }),
        })}
      />,
    );

    const slug = await screen.findByLabelText("pub_dress");
    await user.type(slug, "sky");
    await screen.findByText("Bond found — sign in", {}, { timeout: 2_000 });
    await user.keyboard("{Enter}");
    const password = await screen.findByLabelText("Password");
    await user.type(password, "incorrect password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("The pub_dress or password is invalid."),
    ).toBeInTheDocument();
    expect(slug.closest("form")).toHaveAttribute(
      "data-submission-error",
      "true",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
  });

  it("accepts a full pub_dress paste and splits the selector from the slug", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity()}
      />,
    );
    const slug = await screen.findByLabelText("pub_dress");
    await user.click(slug);
    await user.paste("0xaSky");

    expect(screen.getByRole("combobox")).toHaveValue("a");
    expect(slug).toHaveValue("Sky");
  });

  it("reveals password only after exact resolution and reflects the result on the form", async () => {
    const user = userEvent.setup();
    let resolveRegistered: (() => void) | undefined;
    const resolution = new Promise<{
      kind: "registered";
      pubDress: string;
    }>((resolve) => {
      resolveRegistered = () =>
        resolve({ kind: "registered", pubDress: "0x0sky" });
    });
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity({ resolvePubDress: () => resolution })}
      />,
    );

    const slug = await screen.findByLabelText("pub_dress");
    await user.type(slug, "sky");
    await screen.findByText("Checking availability…");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    resolveRegistered?.();
    await screen.findByText("Bond found — sign in", {}, { timeout: 2_000 });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(slug.closest("form")).toHaveAttribute("data-status", "registered");
    expect(slug).toHaveAttribute("aria-invalid", "false");
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Password")).toHaveFocus();
    expect(screen.getByLabelText("Password").parentElement).toHaveAttribute(
      "data-reflection",
      "positive",
    );
  });

  it("offers an on-screen continuation after saved-credential autofill", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity({
          resolvePubDress: async (selection) => ({
            kind: "registered",
            pubDress: formatPubDress(selection),
          }),
        })}
      />,
    );

    fireEvent.change(
      await screen.findByRole("combobox", {
        name: "pub_dress hexadecimal discriminator",
      }),
      { target: { value: "f" } },
    );
    fireEvent.change(screen.getByLabelText("pub_dress"), {
      target: { value: "rSb" },
    });

    await screen.findByText("Bond found — sign in", {}, { timeout: 2_000 });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue with 0xfrSb" }),
    );

    expect(await screen.findByLabelText("Password")).toHaveFocus();
  });

  it("keeps an invalid exact identity red and does not reveal password", async () => {
    const user = userEvent.setup();
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity({
          resolvePubDress: async () => ({
            kind: "rejected",
            reason: "invalid-character",
          }),
        })}
      />,
    );

    const slug = await screen.findByLabelText("pub_dress");
    await user.type(slug, "sk y");
    await screen.findByText(
      "Incorrect — this character isn’t supported",
      {},
      { timeout: 2_000 },
    );
    expect(slug.closest("form")).toHaveAttribute("data-status", "invalid");
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("keeps a remembered Bond editable so another Bond can sign in", async () => {
    const user = userEvent.setup();
    const forgetRememberedBond = vi
      .fn<IdentityAccessPort["forgetRememberedBond"]>()
      .mockResolvedValue({ kind: "completed" });
    const authenticateNative = vi
      .fn<IdentityAccessPort["authenticateNative"]>()
      .mockResolvedValue({
        kind: "authenticated",
        identity: { pubDress: "0x0rain" },
      });
    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createIdentity({
          readNativeContext: async () => ({
            kind: "remembered",
            pubDress: "0x0sky",
          }),
          forgetRememberedBond,
          resolvePubDress: async (selection) => ({
            kind: "registered",
            pubDress: formatPubDress(selection),
          }),
          authenticateNative,
        })}
      />,
    );

    expect(await screen.findByLabelText("Password")).not.toHaveFocus();
    const slug = screen.getByLabelText("pub_dress");
    expect(slug).not.toHaveAttribute("readonly");
    expect(screen.getByRole("combobox")).toBeEnabled();

    await user.clear(slug);
    await user.type(slug, "rain");
    await screen.findByText("Bond found — sign in", {}, { timeout: 2_000 });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    await user.type(
      await screen.findByLabelText("Password"),
      "correct password value",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(authenticateNative).toHaveBeenCalledWith(
      "0x0rain",
      "correct password value",
    );
    expect(forgetRememberedBond).not.toHaveBeenCalled();
  });

  it("reuses the address primitive in Telegram without native password or provider row", async () => {
    window.history.replaceState({}, "", "/telegram/");
    const user = userEvent.setup();
    const registerProvider = vi
      .fn<IdentityAccessPort["registerProvider"]>()
      .mockResolvedValue({
        kind: "registered",
        outcome: "created",
        identity: { pubDress: "0xaSky" },
      });
    render(
      <ProductApp
        core={readyCore}
        host={createTelegramHost()}
        identity={createIdentity({ registerProvider })}
        routerBasepath="/telegram"
      />,
    );

    const discriminator = await screen.findByRole("combobox", {
      name: "pub_dress hexadecimal discriminator",
    });
    await user.selectOptions(discriminator, "a");
    await user.type(screen.getByLabelText("pub_dress"), "Sky");
    await screen.findByText(
      "Available — create this identity",
      {},
      { timeout: 2_000 },
    );
    const create = await screen.findByRole("button", { name: "Create 0xaSky" });
    await waitFor(() => expect(create).toBeEnabled());
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in with")).not.toBeInTheDocument();
    await user.click(create);
    expect(registerProvider).toHaveBeenCalledWith({
      discriminator: "a",
      slug: "Sky",
    });
  });

  it("accepts a backend-verified native host session without asking for a password", async () => {
    const readProviderIdentity = vi
      .fn<IdentityAccessPort["readProviderIdentity"]>()
      .mockResolvedValue({
        kind: "registered",
        identity: { pubDress: "0x0sky" },
      });
    render(
      <ProductApp
        core={readyCore}
        host={createNativeHost()}
        identity={createIdentity({ readProviderIdentity })}
      />,
    );

    expect(
      await screen.findByText("Authenticated as 0x0sky."),
    ).toBeInTheDocument();
    expect(readProviderIdentity).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("does not treat same-device native host presence as authentication", async () => {
    const readProviderIdentity =
      vi.fn<IdentityAccessPort["readProviderIdentity"]>();
    render(
      <ProductApp
        core={readyCore}
        host={createNativeHost(false)}
        identity={createIdentity({ readProviderIdentity })}
      />,
    );

    expect(
      await screen.findAllByText("Open 0x1 from 0x1 for iOS to continue."),
    ).toHaveLength(2);
    expect(readProviderIdentity).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
