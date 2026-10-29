// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MarketLanding } from "./landing";

vi.mock("@nilx-one/host-browser", () => ({
  createBrowserGeolocation: () => ({}),
}));
vi.mock("@nilx-one/identity-http", () => ({
  createBusinessSurfaceHttp: () => ({}),
}));
vi.mock("@nilx-one/map-maplibre", () => ({
  createMapLibreRenderer: () => ({
    getStatus: () => ({ kind: "unavailable" }),
    setPinnedLandmarks: () => {},
    setCamera: () => {},
    subscribe: () => () => {},
  }),
}));
vi.mock("@nilx-one/product-app/localization", () => ({
  useLocalization: () => ({ resolved: "en" }),
}));
vi.mock("@nilx-one/map-contract", () => ({
  mapDistanceMeters: () => 0,
}));
vi.mock("../business-navigation", () => ({
  createBusinessNavigation: () => ({}),
}));
vi.mock("./catalog", () => ({
  createNilxOneMarketCatalog: () => ({
    load: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@nilx-one/product-app/business", () => ({
  BusinessWorld: ({ content }: { content: ReactNode }) => <div>{content}</div>,
  MarketDock: ({ plan }: { plan: { destination: { pub_dress: string } } }) => (
    <div>Market point: {plan.destination.pub_dress}</div>
  ),
  seededMarketDirectory: {
    points: async () => ({
      points: [
        {
          id: { owner_pub_dress: "0xda-market", number: 0 },
          pub_dress: "0xda-market-zoloti-vorota",
          description: "Golden Gate",
          isVerified: false,
          coordinate: { longitude_e7: "305131000", latitude_e7: "504489000" },
        },
        {
          id: { owner_pub_dress: "0xda-market", number: 1 },
          pub_dress: "0xda-market-batkivshchyna",
          description: "Motherland Monument",
          isVerified: false,
          coordinate: { longitude_e7: "305632000", latitude_e7: "504265000" },
        },
      ],
    }),
  },
  marketPointTitle: (point: { description: string }) =>
    `0xda-market ${point.description}`,
  marketMapPoints: () => [],
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("browses Market root without a session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 401 })),
  );
  render(<MarketLanding />);
  expect(
    await screen.findByRole("button", { name: "0xda-market Golden Gate" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "0xda-market Motherland Monument" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/device display only/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "0xda-market Golden Gate" }),
  );
  expect(window.location.pathname).toBe(
    "/%D0%B7%D0%BE%D0%BB%D0%BE%D1%82%D1%96",
  );
  window.history.pushState(null, "", "/");
  fireEvent(window, new PopStateEvent("popstate"));
  fireEvent.change(screen.getByLabelText("Browse points in city"), {
    target: { value: "Odesa" },
  });
  expect(
    screen.getByText("No available points in this city yet."),
  ).toBeInTheDocument();
});

it("opens a guest point URL", async () => {
  window.history.replaceState(null, "", "/золоті");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<MarketLanding />);
  expect(
    await screen.findByText("Market point: 0xda-market-zoloti-vorota"),
  ).toBeInTheDocument();
});

it("keeps the readable Golden Gate URL after the Core handoff", async () => {
  window.history.replaceState(null, "", "/zoloti-vorota");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 401 })),
  );
  render(<MarketLanding />);
  expect(
    await screen.findByText("Market point: 0xda-market-zoloti-vorota"),
  ).toBeInTheDocument();
  expect(decodeURIComponent(window.location.pathname)).toBe("/золоті");
});

it("pins the selected visit without claiming arrival", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          point: "batkivshchyna",
          seeds: "400",
          seeds_authority: "client_display",
          avaia: { longitude: 30.5, latitude: 50.4 },
        }),
        { status: 200 },
      ),
    ),
  );
  render(<MarketLanding />);
  await waitFor(() =>
    expect(screen.getByText(/Selected visit point/)).toBeInTheDocument(),
  );
  expect(screen.getByText(/not server-verified/)).toBeInTheDocument();
  expect(screen.queryByText("You are here")).toBeNull();
});

it("retains Identity balance and visited point from the current server handoff", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          point: "batkivshchyna",
          seeds: "9360",
          seeds_authority: "identity_snapshot",
          avaia: { longitude: 30.5, latitude: 50.4 },
        }),
      ),
    ),
  );
  render(<MarketLanding />);
  expect(await screen.findByText(/9360 seeds/)).toHaveTextContent(
    "balance at handoff; checked again before purchase",
  );
  expect(screen.getByText(/Selected visit point/)).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
    "Motherland Monument",
  );
  expect(screen.queryByText(/device display only/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "0xda-market Motherland Monument" }),
  );
  expect(
    screen.getByText("Market point: 0xda-market-batkivshchyna"),
  ).toBeInTheDocument();
  expect(screen.getByText(/9360 seeds/)).toBeInTheDocument();
});

it.each([
  { seeds_authority: "browser_claim" },
  { seeds: "-640" },
  { seeds: "640.5" },
  { avaia: { longitude: 181, latitude: 50.4 } },
])(
  "rejects malformed visit context %j without blocking browsing",
  async (invalid) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            point: "batkivshchyna",
            seeds: "640",
            seeds_authority: "identity_snapshot",
            avaia: { longitude: 30.5, latitude: 50.4 },
            ...invalid,
          }),
        ),
      ),
    );
    render(<MarketLanding />);
    await screen.findByRole("button", { name: "0xda-market Golden Gate" });
    expect(screen.queryByText(/Selected visit point/)).toBeNull();
    expect(screen.queryByText(/balance at handoff/)).toBeNull();
  },
);
