// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import type { MapRenderer } from "@nilx-one/map-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedMapHomeView } from "./authenticated-map-home-view";

function renderer(): MapRenderer {
  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    getStatus: vi.fn(() => ({ kind: "ready" })),
    subscribe: vi.fn(() => () => undefined),
    setCamera: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthenticatedMapHomeView", () => {
  it("keeps the counterpart unavailable and renders compact Core readiness", () => {
    const mapRenderer = renderer();

    render(
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        renderer={mapRenderer}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "x0skai unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Focus map on this device for 0x0sky",
      }),
    ).toBeEnabled();
    expect(screen.getByText("Shared Core ready")).toBeVisible();
    expect(screen.getByText("contract 0.1.0")).toBeVisible();
    expect(mapRenderer.mount).toHaveBeenCalledOnce();
  });

  it("focuses the map on user-approved device coordinates without asserting protocol presence", () => {
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

    render(
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        renderer={mapRenderer}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Focus map on this device for 0x0sky",
      }),
    );

    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(mapRenderer.setCamera).toHaveBeenCalledWith({
      center: [30.5234, 50.4501],
      zoom: 13,
      bearing: 0,
      pitch: 42,
    });
    expect(
      screen.getByText("Map focused on this device for 0x0sky."),
    ).toBeInTheDocument();
  });
});
