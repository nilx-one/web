// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreRuntimePort,
  IdentityAccessPort,
} from "@nilx-one/application";
import type { HostPort } from "@nilx-one/host-contract";
import type { MapRenderer } from "@nilx-one/map-contract";
import { ProductApp } from "@nilx-one/product-app";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readyCore: CoreRuntimePort = {
  probe: async () => ({ kind: "ready", contractVersion: "0.1.0" }),
};

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

function createAuthenticatedIdentity(): IdentityAccessPort {
  return {
    acknowledgeRecoveryKey: async () => ({ kind: "service-unavailable" }),
    authenticateNative: async () => ({ kind: "service-unavailable" }),
    forgetRememberedBond: async () => ({ kind: "completed" }),
    logoutNative: async () => ({ kind: "completed" }),
    readNativeContext: async () => ({
      kind: "authenticated",
      identity: { pubDress: "0x0sky" },
    }),
    readProviderIdentity: async () => ({ kind: "not-registered" }),
    recoverNative: async () => ({ kind: "service-unavailable" }),
    registerNative: async () => ({ kind: "service-unavailable" }),
    registerProvider: async () => ({ kind: "service-unavailable" }),
    resolvePubDress: async () => ({ kind: "service-unavailable" }),
  };
}

function createMapRenderer(): MapRenderer {
  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    getStatus: vi.fn(() => ({ kind: "ready" })),
    subscribe: vi.fn(() => () => undefined),
    setCamera: vi.fn(),
    setAppearance: vi.fn(),
  };
}

function mapContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>(
    ".authenticated-map-home__map",
  );
  expect(container).not.toBeNull();
  return container as HTMLElement;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("persistent authenticated world routing", () => {
  it("keeps one renderer mount across world, identity, settings and history traversal", async () => {
    const user = userEvent.setup();
    const renderer = createMapRenderer();

    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createAuthenticatedIdentity()}
        mapRenderer={renderer}
      />,
    );

    await screen.findByRole("button", {
      name: "Open Bond profile for 0x0sky",
    });
    const initialMap = mapContainer();
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );
    expect(
      await screen.findByRole("heading", { name: "0x0sky" }),
    ).toBeVisible();
    expect(window.location.pathname).toBe("/identity");
    expect(mapContainer()).toBe(initialMap);
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();

    const settingsLink = document.querySelector<HTMLAnchorElement>(
      'a[href="/settings"]',
    );
    expect(settingsLink).not.toBeNull();
    fireEvent.click(settingsLink as HTMLAnchorElement);

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    expect(window.location.pathname).toBe("/settings");
    expect(mapContainer()).toBe(initialMap);
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();

    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/identity"));
    expect(
      await screen.findByRole("heading", { name: "0x0sky" }),
    ).toBeVisible();
    expect(mapContainer()).toBe(initialMap);
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();
  });

  it.each([
    ["/identity", "0x0sky"],
    ["/settings", "Settings"],
  ])(
    "initializes the shared world for a direct %s navigation",
    async (path, heading) => {
      window.history.replaceState({}, "", path);
      const renderer = createMapRenderer();

      render(
        <ProductApp
          core={readyCore}
          host={createHost()}
          identity={createAuthenticatedIdentity()}
          mapRenderer={renderer}
        />,
      );

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeVisible();
      expect(mapContainer()).toBeInTheDocument();
      expect(renderer.mount).toHaveBeenCalledOnce();
      expect(renderer.unmount).not.toHaveBeenCalled();
    },
  );

  it("keeps section matching inside a host basepath", async () => {
    window.history.replaceState({}, "", "/embedded/settings");
    const renderer = createMapRenderer();

    render(
      <ProductApp
        core={readyCore}
        host={createHost()}
        identity={createAuthenticatedIdentity()}
        mapRenderer={renderer}
        routerBasepath="/embedded"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();
  });
});
