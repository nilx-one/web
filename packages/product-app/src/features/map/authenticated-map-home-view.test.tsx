// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvatarModel,
  BondProviderConnections,
} from "@nilx-one/application";
import type { GeolocationCapability } from "@nilx-one/host-contract";
import {
  MAP_SCALE_ZOOM,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION_DOUBLE,
  createGeolocationDouble,
  createMapRendererDouble,
  observation,
} from "../../../../../tests/support/doubles";
import { createAvatarChoiceViewState } from "../identity/avatar-choice-view-model";
import {
  createAvaiaSlugViewState,
  createProfileSlugViewState,
} from "../identity/profile-slug-view-model";
import type { AddressSlugViewState } from "../identity/profile-slug-view-model";
import type { ShellRoute, ShellSection } from "../../shell/routes";
import type { AvaiaAvailability } from "./bond-dock-view-model";
import {
  AuthenticatedMapHomeView,
  type ConnectedProvider,
} from "./authenticated-map-home-view";

function renderer(status: MapRendererStatus = { kind: "ready" }): MapRenderer {
  return createMapRendererDouble(status);
}

interface ViewOverrides {
  avaiaPubDress?: string;
  connectedProviders?: BondProviderConnections;
  providerDeepLinks?: readonly ConnectedProvider[];
  onDisconnectProvider?: (provider: ConnectedProvider) => void;
  geolocation?: GeolocationCapability;
  mapRenderer?: MapRenderer;
  section?: ShellSection;
  avaiaAvailability?: AvaiaAvailability;
  onPrepareAvaia?: () => void;
  slugEdit?: AddressSlugViewState;
  avaiaEdit?: AddressSlugViewState;
  avatarChoice?: ReturnType<typeof createAvatarChoiceViewState>;
  onAvatarChoice?: (model: "sky-study" | "dasha-study" | "kai-study") => void;
  onLogout?: () => void;
  onNavigate?: (route: ShellRoute) => void;
  onSlugChange?: (slug: string) => void;
  onSlugSubmit?: () => void;
  onAvaiaChange?: (slug: string) => void;
  onAvaiaSubmit?: () => void;
}

function renderView(overrides: ViewOverrides = {}) {
  const optionalProps = {
    ...(overrides.connectedProviders === undefined
      ? {}
      : { connectedProviders: overrides.connectedProviders }),
    ...(overrides.providerDeepLinks === undefined
      ? {}
      : { providerDeepLinks: overrides.providerDeepLinks }),
    ...(overrides.onDisconnectProvider === undefined
      ? {}
      : { onDisconnectProvider: overrides.onDisconnectProvider }),
    ...(overrides.onLogout === undefined
      ? {}
      : { onLogout: overrides.onLogout }),
    ...(overrides.onNavigate === undefined
      ? {}
      : { onNavigate: overrides.onNavigate }),
    ...(overrides.avaiaAvailability === undefined
      ? {}
      : { avaiaAvailability: overrides.avaiaAvailability }),
    ...(overrides.onPrepareAvaia === undefined
      ? {}
      : { onPrepareAvaia: overrides.onPrepareAvaia }),
    ...(overrides.slugEdit === undefined
      ? {}
      : { slugEdit: overrides.slugEdit }),
    ...(overrides.avaiaEdit === undefined
      ? {}
      : { avaiaEdit: overrides.avaiaEdit }),
    ...(overrides.avatarChoice === undefined
      ? {}
      : { avatarChoice: overrides.avatarChoice }),
    ...(overrides.onAvatarChoice === undefined
      ? {}
      : { onAvatarChoice: overrides.onAvatarChoice }),
    ...(overrides.onSlugChange === undefined
      ? {}
      : { onSlugChange: overrides.onSlugChange }),
    ...(overrides.onSlugSubmit === undefined
      ? {}
      : { onSlugSubmit: overrides.onSlugSubmit }),
    ...(overrides.onAvaiaChange === undefined
      ? {}
      : { onAvaiaChange: overrides.onAvaiaChange }),
    ...(overrides.onAvaiaSubmit === undefined
      ? {}
      : { onAvaiaSubmit: overrides.onAvaiaSubmit }),
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

    // The Bond is at the wheel, so it is the Avaia that spectates — and with no
    // runtime to fetch, spectating is all it can do.
    expect(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    ).toHaveTextContent("You");
    expect(
      screen.getByLabelText("No reciprocal relationship asserted"),
    ).toHaveTextContent("—");
    expect(
      screen.getByRole("button", {
        name: "0skai is unavailable on this device",
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

  it("takes the wheel to the Avaia and leaves the Bond spectating", () => {
    renderView({ avaiaAvailability: "ready" });

    const handover = screen.getByRole("button", {
      name: "Hand the wheel to 0skai",
    });
    expect(handover).toBeEnabled();
    expect(handover).toHaveTextContent("ready");

    fireEvent.click(handover);

    expect(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toHaveTextContent("spectate");
    expect(
      screen.getByRole("button", { name: "Focus the world on 0skai" }),
    ).toHaveTextContent("driving");

    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );

    expect(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    ).toHaveTextContent("You");
  });

  it("offers the runtime download only when this host can fetch one", () => {
    const onPrepareAvaia = vi.fn();
    renderView({ avaiaAvailability: "downloadable", onPrepareAvaia });

    const download = screen.getByRole("button", {
      name: "Download the 0skai runtime",
    });
    expect(download).toHaveTextContent("download");
    fireEvent.click(download);
    expect(onPrepareAvaia).toHaveBeenCalledOnce();

    cleanup();
    renderView({ avaiaAvailability: "downloadable" });
    expect(
      screen.getByRole("button", {
        name: "0skai is unavailable on this device",
      }),
    ).toBeDisabled();
  });

  it("focuses the world on the identity at the wheel", async () => {
    const mapRenderer = renderer();
    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
    });
    // The first fix moves the camera once on its own; focusing is the move a
    // person asks for, and it goes closer than that first fix does.
    await screen.findByRole("button", { name: "Map centred on this device" });
    const setCamera = vi.mocked(mapRenderer.setCamera);
    const firstFix = setCamera.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    );

    expect(setCamera.mock.calls.length).toBe(firstFix + 1);
    const [camera] = setCamera.mock.calls.at(-1) ?? [];
    expect(camera?.zoom).toBeGreaterThan(15);
  });

  it("opens the Bond edit surface from the Dock header", () => {
    const onNavigate = vi.fn();

    renderView({ onNavigate });
    const edit = screen.getByRole("button", { name: "Edit this Bond" });

    expect(edit).toHaveTextContent("edit");
    fireEvent.click(edit);

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/identity");
  });

  it("keeps the edit action to the world, where the Dock names the Bond", () => {
    renderView({ section: "identity" });

    expect(
      screen.queryByRole("button", { name: "Edit this Bond" }),
    ).not.toBeInTheDocument();
  });

  it("returns to the world from an identity surface", () => {
    const onNavigate = vi.fn();

    renderView({ section: "identity", onNavigate });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("presents the whole Bond profile on one identity surface", () => {
    renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", undefined, false),
      avaiaEdit: createAvaiaSlugViewState("0skai", "0x0sky", undefined, false),
    });

    expect(screen.getByRole("heading", { name: "0x0sky" })).toBeVisible();
    // Reading and changing the profile are the same screen.
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("pub_dress")).toHaveValue("sky");
    expect(screen.getByLabelText("avaia")).toHaveValue("skai");
    expect(screen.getByText("Providers")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add a provider" }),
    ).toBeVisible();
    // Nothing a person cannot change is presented as something to edit.
    for (const absent of [
      "Age",
      "Home",
      "Family",
      "Closest Bond",
      "BondChains",
    ]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });

  it("opens the Providers screen from add, with a connect route each", () => {
    renderView({ section: "identity" });

    fireEvent.click(screen.getByRole("button", { name: "Add a provider" }));

    expect(screen.getByRole("heading", { name: "Providers" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Connect Telegram" }),
    ).toHaveAttribute("href", "/auth?provider=telegram&intent=connect");
    expect(
      screen.getByRole("link", { name: "Connect Discord" }),
    ).toHaveAttribute("href", "/auth?provider=discord&intent=connect");
    expect(screen.getAllByText("Not connected")).toHaveLength(2);
  });

  it("offers the three studies, assigns none, and draws no fallback body", async () => {
    const onAvatarChoice = vi.fn();
    const mapRenderer = renderer();
    renderView({
      section: "identity",
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState(undefined, undefined),
      onAvatarChoice,
    });

    for (const name of ["Sky", "Dasha", "Kai"]) {
      expect(
        screen.getByRole("radio", { name: new RegExp(name) }),
      ).not.toBeChecked();
    }
    expect(
      screen.getByText(/no avatar is drawn until you choose/i),
    ).toBeVisible();
    await screen.findByRole("button", { name: "Map centred on this device" });
    expect(mapRenderer.avatars).toBeDefined();
    expect(vi.mocked(mapRenderer.avatars!.upsert)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: /Dasha/ }));

    expect(onAvatarChoice).toHaveBeenCalledExactlyOnceWith("dasha-study");
  });

  it("reports a newer stored study without substituting another body", () => {
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState(
        "future-study" as AvatarModel,
        undefined,
      ),
    });

    expect(
      screen.getByText(/future-study, which this client cannot display/i),
    ).toBeVisible();
    for (const name of ["Sky", "Dasha", "Kai"]) {
      expect(
        screen.getByRole("radio", { name: new RegExp(name) }),
      ).not.toBeChecked();
    }
  });

  it("marks the chosen study and locks the picker while it saves", () => {
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState("sky-study", "kai-study"),
    });

    expect(screen.getByRole("radio", { name: /Kai/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Sky/ })).toBeDisabled();
  });

  it("shows connected providers as marks that open the external account", () => {
    renderView({
      section: "identity",
      connectedProviders: [
        { provider: "telegram", handle: "zerosky" },
        { provider: "discord", externalId: "84759302847591038" },
      ],
    });

    const telegram = screen.getByRole("link", { name: "Open Telegram" });
    expect(telegram).toHaveTextContent("TG");
    expect(telegram).toHaveAttribute("href", "https://t.me/zerosky");
    expect(telegram).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Open Discord" })).toHaveAttribute(
      "href",
      "https://discord.com/users/84759302847591038",
    );
    // The compact surface carries no account text at all.
    expect(screen.queryByText("zerosky")).not.toBeInTheDocument();
  });

  it("hands a provider scheme to a host that can follow one", () => {
    renderView({
      section: "identity",
      providerDeepLinks: ["telegram"],
      connectedProviders: [{ provider: "telegram", handle: "zerosky" }],
    });

    const telegram = screen.getByRole("link", { name: "Open Telegram" });
    expect(telegram).toHaveAttribute("href", "tg://resolve?domain=zerosky");
    expect(telegram).not.toHaveAttribute("target");
  });

  it("falls back to the provider itself for an address it does not know", () => {
    renderView({
      section: "identity",
      connectedProviders: [{ provider: "telegram" }],
    });

    expect(screen.getByRole("link", { name: "Open Telegram" })).toHaveAttribute(
      "href",
      "https://t.me",
    );
  });

  it("names the Bond and its Avaia from the same surface", () => {
    const onSlugChange = vi.fn();
    const onAvaiaChange = vi.fn();
    renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", undefined, false),
      avaiaEdit: createAvaiaSlugViewState("0skai", "0x0sky", undefined, false),
      onSlugChange,
      onAvaiaChange,
    });

    const save = screen.getAllByRole("button", { name: "Save" });
    expect(save).toHaveLength(2);
    expect(save[0]).toBeDisabled();
    expect(save[1]).toBeDisabled();

    fireEvent.change(screen.getByLabelText("pub_dress"), {
      target: { value: "rain" },
    });
    fireEvent.change(screen.getByLabelText("avaia"), {
      target: { value: "rainai" },
    });

    expect(onSlugChange).toHaveBeenCalledExactlyOnceWith("rain");
    expect(onAvaiaChange).toHaveBeenCalledExactlyOnceWith("rainai");
  });

  it("saves a changed slug and reports what the service answered", () => {
    const onSlugSubmit = vi.fn();
    const { rerender } = renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", "rain", false),
      onSlugSubmit,
    });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSlugSubmit).toHaveBeenCalledOnce();

    rerender(
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        avaiaPubDress="0skai"
        renderer={renderer()}
        geolocation={UNSUPPORTED_GEOLOCATION_DOUBLE}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
        section="identity"
        slugEdit={createProfileSlugViewState("0x0sky", "rain", false, {
          kind: "rejected",
          reason: "unavailable",
        })}
        onSlugSubmit={onSlugSubmit}
      />,
    );

    expect(
      screen.getByText("That address belongs to another Bond."),
    ).toBeVisible();
  });

  it("manages connected and unconnected providers on one screen", () => {
    const onDisconnectProvider = vi.fn();
    renderView({
      section: "identity",
      connectedProviders: [{ provider: "telegram", handle: "zerosky" }],
      onDisconnectProvider,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add a provider" }));

    expect(screen.getByRole("heading", { name: "Providers" })).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByText("Not connected")).toBeVisible();
    // Connected: reachable and detachable. Unconnected: connectable.
    expect(screen.getByRole("link", { name: "Open Telegram" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Connect Telegram" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Discord" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disconnect Telegram from this Bond",
      }),
    );

    expect(onDisconnectProvider).toHaveBeenCalledExactlyOnceWith("telegram");
  });

  it("says a disconnect never reaches the external account", () => {
    renderView({
      section: "identity",
      connectedProviders: [{ provider: "telegram" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add a provider" }));

    expect(
      screen.getByText(/never deletes the account on the provider/),
    ).toBeVisible();
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
    window.localStorage.setItem("nilx-one.interface.appearance", "dark");
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

  // A device that never asked for dark must not be given it. The world opens
  // in the same light the sign-in surface was painted in.
  it("opens light when neither a choice nor the device asks for dark", () => {
    const mapRenderer = renderer();

    const { container } = renderView({ mapRenderer });

    expect(mapRenderer.setAppearance).toHaveBeenCalledWith("light");
    expect(container.querySelector(".authenticated-map-home")).toHaveAttribute(
      "data-theme",
      "light",
    );
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

  // Focusing a Bond is the moment a person expects to see somebody. Unscaled,
  // a body is about three pixels tall there, so this covers the whole path:
  // the camera arrives, the body is drawn large enough to read, and it
  // withdraws again when the world pulls back to where a person is a place.
  it("draws a readable body at close range and withdraws it when the world pulls back", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });

    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
    });
    await screen.findByRole("button", { name: "Map centred on this device" });

    const upsert = vi.mocked(mapRenderer.avatars!.upsert);
    expect(upsert).toHaveBeenCalled();

    act(() => {
      mapRenderer.moveCamera(
        { ...mapRenderer.getCamera(), zoom: MAP_SCALE_ZOOM.building },
        true,
      );
    });

    const close = upsert.mock.lastCall?.[0];
    expect(close).toMatchObject({ modelId: "dasha-study", visible: true });
    expect(close?.scale).toBeGreaterThan(1);

    act(() => {
      mapRenderer.moveCamera(
        { ...mapRenderer.getCamera(), zoom: MAP_SCALE_ZOOM.city },
        true,
      );
    });

    expect(upsert.mock.lastCall?.[0].visible).toBe(false);
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
