// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticatedMapHomeView,
  type ConnectedProvider,
} from "./authenticated-map-home-view";

function renderer(): MapRenderer {
  const readyStatus: MapRendererStatus = { kind: "ready" };

  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    getStatus: vi.fn(() => readyStatus),
    subscribe: vi.fn(() => () => undefined),
    setCamera: vi.fn(),
  };
}

interface ViewOverrides {
  connectedProviders?: readonly ConnectedProvider[];
  mapRenderer?: MapRenderer;
  onLogout?: () => void;
}

function renderView(overrides: ViewOverrides = {}) {
  return render(
    <AuthenticatedMapHomeView
      hostLabel="browser host"
      pubDress="0x0sky"
      renderer={overrides.mapRenderer ?? renderer()}
      runtime={{
        tone: "ready",
        label: "Shared Core ready",
        detail: "Contract 0.1.0 is available to the Web client.",
      }}
      safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      connectedProviders={overrides.connectedProviders}
      onLogout={overrides.onLogout}
    />,
  );
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

    expect(screen.getByRole("heading", { name: "You’re in." })).toBeVisible();
    expect(screen.getAllByText("0x0sky").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    ).toHaveTextContent("spectate");
    expect(
      screen.getByLabelText("No reciprocal relationship asserted"),
    ).toHaveTextContent("—");
    expect(
      screen.getByRole("button", {
        name: "x0skai AI runtime unavailable on this host",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Shared Core ready")).toBeVisible();
    expect(screen.getByText("contract 0.1.0")).toBeVisible();
    expect(mapRenderer.mount).toHaveBeenCalledOnce();
  });

  it("opens map settings and persists appearance locally", () => {
    const { container } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Open map settings" }));

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(screen.getByText("Map settings")).toBeVisible();
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

  it("opens the Bond profile without rendering a phone field", () => {
    renderView();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );

    expect(screen.getByRole("heading", { name: "0x0sky" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(screen.getByText("pub_dress")).toBeVisible();
    expect(screen.getByText("Providers")).toBeVisible();
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add host" })).toBeVisible();
  });

  it("opens Add hosts with provider authorization redirects", () => {
    renderView();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );
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
    renderView({ connectedProviders: ["telegram", "discord"] });

    fireEvent.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );

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
    renderView({ connectedProviders: ["telegram"] });

    fireEvent.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);

    expect(screen.getByRole("heading", { name: "Providers" })).toBeVisible();
    expect(screen.getByText("Telegram")).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Add host" })).toBeVisible();
  });

  it("exposes host actions through the compact menu", () => {
    const onLogout = vi.fn();

    renderView({ onLogout });

    fireEvent.click(screen.getByRole("button", { name: "Open host menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("focuses the camera from the Bond profile", () => {
    const mapRenderer = renderer();
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 50.4501,
          longitude: 30.5234,
          accuracy: 20,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });

    renderView({ mapRenderer });
    fireEvent.click(
      screen.getByRole("button", { name: "Open Bond profile for 0x0sky" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Focus map near this device" }),
    );

    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(mapRenderer.setCamera).toHaveBeenCalledWith({
      center: [30.5234, 50.4501],
      zoom: 13,
      bearing: 0,
      pitch: 42,
    });
    expect(
      screen.getByText("Map camera focused near this device."),
    ).toBeInTheDocument();
  });
});
