// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  BusinessNavigationPort,
  BusinessNavigationState,
  BusinessSurface,
  BusinessSurfacePort,
} from "@nilx-one/application";
import {
  UNSUPPORTED_GEOLOCATION,
  type GeolocationObservation,
} from "@nilx-one/host-contract";
import { BusinessDock } from "./business-dock";
import { BusinessWorld } from "./business-world";
import {
  cityForObservation,
  safeBusinessContact,
  searchBusinessCities,
} from "./business-view-model";
import type { MapRenderer } from "@nilx-one/map-contract";

const cities = [
  {
    id: "ua:kyiv",
    name: "Київ",
    country: "Україна",
    aliases: ["Kyiv", "Києві"],
    boundary: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ] as const,
  },
  { id: "fr:paris", name: "Paris", country: "France", aliases: ["Париж"] },
];
const business: BusinessSurface = {
  pubDress: "0xda-market",
  publicUrl: "https://0xda-market.nilx.one",
  displayName: "0xda-market",
  contacts: [],
  directory: {
    kind: "ready",
    cities,
    points: [
      {
        id: { owner_pub_dress: "0xda-market", number: 0 },
        route: "zoloti_vorota",
        displayName: "0xda-market Золоті Ворота",
        cityId: "ua:kyiv",
        contacts: [
          { label: "Website", href: "https://example.com" },
          { label: "unsafe", href: "javascript:alert(1)" },
        ],
        catalog: {
          kind: "ready",
          offers: [
            {
              id: "seeds",
              name: "Seeds",
              category: "0x1",
              quantity: "100 ₴€£",
            },
            { id: "special", name: "Special", category: "Subscriptions" },
          ],
        },
      },
    ],
  },
};
function nav(initial: BusinessNavigationState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const port: BusinessNavigationPort = {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    open: vi.fn((label, point, cityId) => {
      state = {
        label,
        ...(point === undefined ? {} : { point }),
        ...(cityId === undefined ? {} : { cityId }),
      };
      listeners.forEach((fn) => fn());
    }),
    close: vi.fn(),
    sync: vi.fn(),
    href: (_label, point) => `/${point ?? ""}`,
  };
  return port;
}
const directory: BusinessSurfacePort = {
  read: async () => ({ kind: "ready", business }),
};

describe("Business Dock", () => {
  it("uses incoming city without requesting geolocation, opens point and returns to owner", async () => {
    const navigation = nav({ label: "0xda-market", cityId: "ua:kyiv" });
    const requestPosition = vi.fn(UNSUPPORTED_GEOLOCATION.requestPosition);
    render(
      <BusinessDock
        directory={directory}
        navigation={navigation}
        geolocation={{ ...UNSUPPORTED_GEOLOCATION, requestPosition }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("link", { name: "0xda-market Золоті Ворота →" }),
    );
    expect(
      await screen.findByRole("heading", { name: "0xda-market Золоті Ворота" }),
    ).toBeVisible();
    expect(screen.getByText("Quantity: 100 ₴€£")).toBeVisible();
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    fireEvent.click(
      screen.getByRole("link", { name: "← Back to 0xda-market" }),
    );
    expect(navigation.open).toHaveBeenLastCalledWith(
      "0xda-market",
      undefined,
      "ua:kyiv",
    );
    expect(requestPosition).not.toHaveBeenCalled();
  });
  it("offers searchable manual cities and ignores a late location result after a choice", async () => {
    let complete!: (result: GeolocationObservation) => void;
    const requestPosition = vi.fn(
      () =>
        new Promise<GeolocationObservation>((resolve) => {
          complete = resolve;
        }),
    );
    const navigation = nav({ label: "0xda-market" });
    render(
      <BusinessDock
        directory={directory}
        navigation={navigation}
        geolocation={{ ...UNSUPPORTED_GEOLOCATION, requestPosition }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use my location" }),
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Париж" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Paris/ }));
    await act(async () =>
      complete({
        kind: "observed",
        position: {
          longitude: 1,
          latitude: 1,
          accuracyMeters: 1,
          observedAt: Date.now(),
        },
      }),
    );
    expect(navigation.getSnapshot()?.cityId).toBe("fr:paris");
    expect(
      await screen.findByText("No published points in this city"),
    ).toBeVisible();
  });
  it("opens a deep point without requesting location and rejects unknown paths", async () => {
    const navigation = nav({ label: "0xda-market", point: "missing" });
    const requestPosition = vi.fn(UNSUPPORTED_GEOLOCATION.requestPosition);
    render(
      <BusinessDock
        directory={directory}
        navigation={navigation}
        geolocation={{ ...UNSUPPORTED_GEOLOCATION, requestPosition }}
      />,
    );
    expect(await screen.findByText("This point is unavailable")).toBeVisible();
    expect(requestPosition).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("link", { name: "← Back to 0xda-market" }),
    );
    expect(await screen.findByRole("searchbox")).toBeVisible();
  });
  it("preserves the world renderer across organization and point navigation", async () => {
    const navigation = nav({ label: "0xda-market", cityId: "ua:kyiv" });
    const renderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      getStatus: () => ({ kind: "unmounted" }),
      subscribe: () => () => undefined,
    } as unknown as MapRenderer;
    render(
      <BusinessWorld
        directory={directory}
        navigation={navigation}
        geolocation={UNSUPPORTED_GEOLOCATION}
        renderer={renderer}
      />,
    );
    fireEvent.click(
      await screen.findByRole("link", { name: "0xda-market Золоті Ворота →" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "0xda-market Золоті Ворота" }),
      ).toBeVisible(),
    );
    expect(renderer.mount).toHaveBeenCalledTimes(1);
    expect(renderer.unmount).not.toHaveBeenCalled();
  });
  it("distinguishes unavailable directory from empty published points", async () => {
    render(
      <BusinessDock
        directory={{
          read: async () => ({
            kind: "ready",
            business: { ...business, directory: { kind: "unavailable" } },
          }),
        }}
        navigation={nav({ label: "0xda-market" })}
        geolocation={UNSUPPORTED_GEOLOCATION}
      />,
    );
    expect(
      await screen.findByText("The points directory is not connected yet"),
    ).toBeVisible();
    expect(screen.queryByText("No published points in this city")).toBeNull();
  });
});

describe("business presentation boundaries", () => {
  it("searches localized names and aliases without changing city IDs", () => {
    expect(searchBusinessCities(cities, "києві").map((c) => c.id)).toEqual([
      "ua:kyiv",
    ]);
    expect(
      searchBusinessCities(cities, "paris france").map((c) => c.id),
    ).toEqual(["fr:paris"]);
  });
  it("resolves only one actual published boundary, never nearest city or declared position", () => {
    const p = { longitude: 1, latitude: 1, accuracyMeters: 1, observedAt: 1 };
    expect(cityForObservation(cities, p)).toBe("ua:kyiv");
    expect(cityForObservation(cities, { ...p, longitude: 20 })).toBeUndefined();
    expect(
      cityForObservation(cities, { ...p, declared: true }),
    ).toBeUndefined();
    expect(
      cityForObservation([cities[0]!, { ...cities[0]!, id: "other" }], p),
    ).toBeUndefined();
  });
  it("does not expose executable or credential-bearing contact links", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user:pass@example.com",
      "mailto:a@b.test?body=private",
      "//example.com",
    ])
      expect(safeBusinessContact(value)).toBeUndefined();
    expect(safeBusinessContact("mailto:shop@example.com")).toBe(
      "mailto:shop@example.com",
    );
    expect(safeBusinessContact("tel:+380441234567")).toBe("tel:+380441234567");
  });
});
