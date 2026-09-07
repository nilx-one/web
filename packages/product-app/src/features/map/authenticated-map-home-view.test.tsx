// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { GeolocationCapability } from "@nilx-one/host-contract";
import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION_DOUBLE,
  createGeolocationDouble,
  createMapRendererDouble,
  observation,
} from "../../../../../tests/support/doubles";
import type { ShellRoute, ShellSection } from "../../shell/routes";
import {
  AuthenticatedMapHomeView,
  type ConnectedProvider,
} from "./authenticated-map-home-view";

function renderer(status: MapRendererStatus = { kind: "ready" }): MapRenderer {
  return createMapRendererDouble(status);
}

interface ViewOverrides {
  avaiaPubDress?: string;
  connectedProviders?: readonly ConnectedProvider[];
  geolocation?: GeolocationCapability;
  mapRenderer?: MapRenderer;
  section?: ShellSection;
  onLogout?: () => void;
  onNavigate?: (route: ShellRoute) => void;
}

function renderView(overrides: ViewOverrides = {}) {
  const optionalProps = {
    ...(overrides.connectedProviders === undefined
      ? {}
      : { connectedProviders: overrides.connectedProviders }),
    ...(overrides.onLogout === undefined
      ? {}
      : { onLogout: overrides.onLogout }),
    ...(overrides.onNavigate === undefined
      ? {}
      : { onNavigate: overrides.onNavigate }),
  };

  return render(
    <AuthenticatedMapHomeView
      hostLabel="browser host"
      pubDress="0x0sky"
      avaiaPubDress={overrides.avaiaPubDress ?? "0skai"}
      renderer={overrides.mapRenderer ?? renderer()}
      geolocation={overrides.geolocation ?? UNSUPPORTED_GEOLOCATION_DOUBLE}
      runtime={{
        tone: "ready",
        label: "Shared Core ready",
        detail: "Contract 0.1.0 is available to the Web client.",
      }}
      safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      section={overrides.section ?? "world"}
      {...optionalProps}
    />,
  );
}

function dock(container: HTMLElement): HTMLElement {
  const surface = container.querySelector<HTMLElement>(".bond-dock");
  expect(surface).not.toBeNull();
  return surface as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthenticatedMapHomeView", () => {
  it("presents the compact Bond pair without inventing reciprocity", () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer });

    expect(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    ).toHaveTextContent("spectate");
    expect(
      screen.getByLabelText("No reciprocal relationship asserted"),
    ).toHaveTextContent("—");
    expect(
      screen.getByRole("button", {
        name: "0skai AI runtime unavailable on this host",
      }),
    ).toBeDisabled();
    expect(screen.getByText("0skai")).toBeVisible();
    expect(screen.getByText("Shared Core ready")).toBeVisible();
    expect(screen.getByText("contract 0.1.0")).toBeVisible();
    expect(mapRenderer.mount).toHaveBeenCalledOnce();
  });

  it("drops the authenticated success hero from the world surface", () => {
    renderView();

    expect(screen.queryByText("You’re in.")).toBeNull();
    expect(screen.queryByText(/Authenticated as/)).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("keeps application settings out of the Bond surface", () => {
    const { container } = renderView();
    const surface = dock(container);

    expect(
      within(surface).queryByRole("button", { name: /settings/i }),
    ).toBeNull();
    expect(
      within(surface).queryByRole("link", { name: /settings/i }),
    ).toBeNull();
    expect(surface.querySelector("[href='/settings']")).toBeNull();
  });

  it("keeps the world behind the Dock, the header and the toast stack", () => {
    const { container } = renderView();
    const shell = container.querySelector(".app-shell");
    const bottom = container.querySelector(".app-shell__bottom");

    expect(shell?.querySelector(".app-shell__world")).not.toBeNull();
    expect(bottom?.querySelector(".bond-dock")).not.toBeNull();
    expect(bottom?.querySelector(".app-shell__toasts")).toBeNull();
    expect(
      container.querySelector(".app-shell__toasts .toast-region"),
    ).not.toBeNull();
    expect(
      container.querySelector(".app-shell__status .core-chip"),
    ).not.toBeNull();
  });

  it("opens the identity route from the Bond rather than a Dock-local screen", () => {
    const onNavigate = vi.fn();

    renderView({ onNavigate });
    fireEvent.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/identity");
  });

  it("returns to the world from an identity surface", () => {
    const onNavigate = vi.fn();

    renderView({ section: "identity", onNavigate });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("presents the Bond profile on the identity route", () => {
    renderView({ section: "identity" });

    expect(screen.getByRole("heading", { name: "0x0sky" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(screen.getByText("pub_dress")).toBeVisible();
    expect(screen.getByText("Providers")).toBeVisible();
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add host" })).toBeVisible();
  });

  it("opens Add hosts with provider authorization redirects", () => {
    renderView({ section: "identity" });

    fireEvent.click(screen.getByRole("button", { name: "Add host" }));

    expect(screen.getByRole("heading", { name: "Add hosts" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Connect with Telegram/i }),
    ).toHaveAttribute("href", "/auth?provider=telegram&intent=connect");
    expect(
      screen.getByRole("link", { name: /Connect with Discord/i }),
    ).toHaveAttribute("href", "/auth?provider=discord&intent=connect");
  });

  it("keeps provider management separate from profile edit", () => {
    renderView({
      section: "identity",
      connectedProviders: ["telegram", "discord"],
    });

    expect(screen.getByLabelText("Telegram connected")).toBeVisible();
    expect(screen.getByLabelText("Discord connected")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);

    expect(screen.getByRole("heading", { name: "Edit profile" })).toBeVisible();
    expect(screen.queryByText("Providers")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Provider connections are managed separately/i),
    ).toBeVisible();
  });

  it("opens provider management from the Providers row", () => {
    renderView({ section: "identity", connectedProviders: ["telegram"] });

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);

    expect(screen.getByRole("heading", { name: "Providers" })).toBeVisible();
    expect(screen.getByText("Telegram")).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Add host" })).toBeVisible();
  });

  it("presents appearance on the settings route and persists it locally", () => {
    const { container } = renderView({ section: "settings" });

    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Auto/i })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Light/i }));

    expect(screen.getByRole("radio", { name: /Light/i })).toBeChecked();
    expect(container.querySelector(".authenticated-map-home")).toHaveAttribute(
      "data-theme",
      "light",
    );
    expect(window.localStorage.getItem("nilx-one.interface.appearance")).toBe(
      "light",
    );
  });

  it("resolves the appearance before the renderer paints its first style", () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer });

    expect(mapRenderer.setAppearance).toHaveBeenCalledWith("dark");

    const [appearanceCall] = vi.mocked(mapRenderer.setAppearance).mock
      .invocationCallOrder;
    const [mountCall] = vi.mocked(mapRenderer.mount).mock.invocationCallOrder;
    expect(appearanceCall).toBeDefined();
    expect(mountCall).toBeDefined();
    expect(appearanceCall ?? 0).toBeLessThan(mountCall ?? 0);
  });

  it("forwards an appearance change as renderer presentation state", () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer, section: "settings" });
    fireEvent.click(screen.getByRole("radio", { name: /Light/i }));

    expect(mapRenderer.setAppearance).toHaveBeenLastCalledWith("light");
    expect(mapRenderer.mount).toHaveBeenCalledOnce();
    expect(mapRenderer.unmount).not.toHaveBeenCalled();
  });

  it("keeps a rendering map free of status chrome", () => {
    renderView({ mapRenderer: renderer({ kind: "ready" }) });

    expect(screen.queryByText("Map unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading map")).not.toBeInTheDocument();
  });

  it.each([
    [
      "style-load-failed",
      "The versioned self-hosted map style is not published yet.",
    ],
    [
      "basemap-load-failed",
      "The versioned self-hosted basemap archive could not be read.",
    ],
    [
      "renderer-init-failed",
      "The map renderer could not be created on this client.",
    ],
    [
      "first-paint-timeout",
      "The map style loaded, but the renderer never drew a first frame.",
    ],
    [
      "webgl-unavailable",
      "This browser could not create the WebGL2 context the map needs.",
    ],
  ])("names a %s failure instead of showing an empty map", (reason, detail) => {
    renderView({ mapRenderer: renderer({ kind: "unavailable", reason }) });

    expect(screen.getByText("Map unavailable")).toBeVisible();
    expect(screen.getByText(detail)).toBeVisible();
  });

  it("reports renderer status through the toast stack, never the Dock", () => {
    const { container } = renderView({
      mapRenderer: renderer({ kind: "loading" }),
    });

    const toasts = container.querySelector<HTMLElement>(".app-shell__toasts");
    expect(toasts).not.toBeNull();
    expect(
      within(toasts as HTMLElement).getByText("Loading map"),
    ).toBeVisible();
    expect(within(dock(container)).queryByText("Loading map")).toBeNull();
  });

  it("subscribes to renderer status so a late failure still surfaces", () => {
    const mapRenderer = renderer({ kind: "loading" });

    renderView({ mapRenderer });

    expect(mapRenderer.subscribe).toHaveBeenCalledOnce();
    expect(screen.getByText("Loading map")).toBeVisible();
  });

  it("exposes host actions through the header overflow menu", () => {
    const onLogout = vi.fn();

    renderView({ onLogout });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("recenters through the host capability instead of a browser API", async () => {
    const mapRenderer = renderer();
    const geolocation = createGeolocationDouble({ position: observation() });

    renderView({ mapRenderer, geolocation });
    await screen.findByRole("button", { name: "Map centred on this device" });

    // The observation reaches the renderer as presentation geometry; the
    // renderer was never asked to acquire it.
    expect(mapRenderer.setObservedPosition).toHaveBeenCalledWith({
      center: [30.5234, 50.4501],
      accuracyMeters: 24,
    });
    expect(mapRenderer.setCamera).toHaveBeenCalledOnce();
    expect(geolocation.requestPosition).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "Map centred on this device" }),
    );

    // Recentering reuses the observation it already holds.
    expect(geolocation.requestPosition).toHaveBeenCalledOnce();
    expect(mapRenderer.setCamera).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Map camera focused near this device."),
    ).toBeInTheDocument();
  });

  it("keeps the world usable when the host has no location capability", async () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer });

    const control = await screen.findByRole("button", {
      name: "Location unavailable on this host",
    });
    expect(control).toBeDisabled();
    expect(mapRenderer.setCamera).not.toHaveBeenCalled();
    expect(mapRenderer.setObservedPosition).toHaveBeenCalledWith(null);
    // A host without the capability is not a renderer failure.
    expect(screen.queryByText("Map unavailable")).toBeNull();
  });
});
