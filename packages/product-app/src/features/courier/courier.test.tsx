// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  BusinessPoint,
  BusinessPointProjection,
  CourierPlan,
  CourierDirectoryPort,
} from "@nilx-one/application";
import {
  CourierCapabilityUnavailable,
  courierDestinationRequest,
  decodeCourierDestination,
} from "@nilx-one/application";
import { seededMarketDirectory } from "./market-points";
import type { MapRenderer } from "@nilx-one/map-contract";
import { chooseLocale } from "../../shell/localization";
import { activityCamera } from "./courier-map";
import { ActivityStack, roundedFlightDistanceMeters } from "./activity-stack";
import { useCourier } from "./use-courier";
const origin = { longitude_e7: "305000000", latitude_e7: "504000000" };
const destination: BusinessPoint = {
  id: { owner_pub_dress: "0xda-market", number: 7 },
  pub_dress: "0xda-market-one",
  description: "One",
  isVerified: false,
  coordinate: { longitude_e7: "305010000", latitude_e7: "504010000" },
};
const projection: BusinessPointProjection = {
  owner_pub_dress: "0xda-market",
  points: [destination],
};
const plan: CourierPlan = { origin, destination, started_at_ms: "1000" };
beforeEach(() => {
  chooseLocale("en");
  vi.useFakeTimers();
  vi.setSystemTime(2000);
});
afterEach(() => {
  vi.useRealTimers();
});
it("validates Core output and handles dateline flight and camera bounds", () => {
  expect(courierDestinationRequest(origin, projection)).toEqual({
    origin,
    candidates: [{ point_id: "007", coordinate: destination.coordinate }],
  });
  expect(
    decodeCourierDestination('{"ok":true,"point_id":"007"}', projection),
  ).toBe(destination);
  expect(() =>
    decodeCourierDestination(
      '{"ok":false,"error":"no_candidates"}',
      projection,
    ),
  ).toThrow();
  expect(() =>
    decodeCourierDestination('{"ok":true,"point_id":"008"}', projection),
  ).toThrow();
  expect(() =>
    courierDestinationRequest(origin, {
      ...projection,
      points: [{ ...destination, id: { ...destination.id, number: 256 } }],
    }),
  ).toThrow();
  expect(() =>
    courierDestinationRequest(origin, {
      ...projection,
      owner_pub_dress: "someone-else",
    }),
  ).toThrow();
  const camera = activityCamera(
    [
      { longitude: 179.9, latitude: 0 },
      { longitude: -179.9, latitude: 0 },
    ],
    390,
    844,
  )!;
  expect(Math.abs(camera.center[0])).toBeCloseTo(180);
  expect(camera.zoom).toBeGreaterThan(8);
});
it("keeps both activity rows oldest first and confirms only actual completion", () => {
  const cell = {
    id: "cell",
    center: { longitude: 30.5, latitude: 50.4 },
    boundary: [
      [30.5, 50.4],
      [30.6, 50.5],
    ] as const,
  };
  const job = { cell, startedAt: 500, durationMs: 60000, landmarks: 0 };
  const focus = vi.fn(),
    follow = vi.fn();
  const props = {
    onFlight: focus,
    onFollow: follow,
    onCells: focus,
    flight: {
      active: true,
      progress: {
        point: { longitude: 30.5, latitude: 50.4 },
        remainingMs: 9000,
      },
    },
  };
  const view = render(
    <ActivityStack {...props} jobs={[job]} plan={plan} completed={undefined} />,
  );
  expect(screen.getAllByRole("status")[0]).toHaveTextContent("Revealing");
  fireEvent.click(screen.getByRole("button", { name: "Follow xPing" }));
  expect(follow).toHaveBeenCalledOnce();
  view.rerender(
    <ActivityStack {...props} jobs={[]} plan={plan} completed={undefined} />,
  );
  expect(screen.queryByText(/Cells opened/)).toBeNull();
  act(() => vi.advanceTimersByTime(9000));
  expect(screen.queryByText(/xPing arrived/)).toBeNull();
  view.rerender(
    <ActivityStack
      {...props}
      jobs={[]}
      plan={plan}
      completed={undefined}
      flight={{
        active: false,
        progress: {
          ...props.flight.progress,
          remainingMs: 0,
          arrivedAt: Date.now(),
        },
      }}
    />,
  );
  expect(screen.getByText(/xPing arrived/)).toHaveTextContent("✅");
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole("status")).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
const directory: CourierDirectoryPort = {
  points: async () => projection,
};
it("does not confirm a cancelled sibling and accepts the final cell callback after job removal", () => {
  const cell = {
    id: "first",
    center: { longitude: 30.5, latitude: 50.4 },
    boundary: [],
  };
  const second = { ...cell, id: "second" };
  const firstJob = { cell, startedAt: 500, durationMs: 60000, landmarks: 0 };
  const secondJob = { ...firstJob, cell: second, startedAt: 600 };
  const props = {
    plan: undefined,
    flight: { active: false, progress: undefined },
    onFlight: vi.fn(),
    onFollow: vi.fn(),
    onCells: vi.fn(),
  };
  const view = render(
    <ActivityStack
      {...props}
      jobs={[firstJob, secondJob]}
      completed={undefined}
    />,
  );
  const earlier = { cell, at: Date.now() };
  view.rerender(
    <ActivityStack {...props} jobs={[secondJob]} completed={earlier} />,
  );
  view.rerender(<ActivityStack {...props} jobs={[]} completed={earlier} />);
  expect(screen.queryByText(/Cells opened/)).toBeNull();
  // The fog store removes a job before the callback updates the parent.
  view.rerender(
    <ActivityStack {...props} jobs={[secondJob]} completed={earlier} />,
  );
  view.rerender(<ActivityStack {...props} jobs={[]} completed={earlier} />);
  view.rerender(
    <ActivityStack
      {...props}
      jobs={[]}
      completed={{ cell: second, at: Date.now() }}
    />,
  );
  expect(screen.getByText(/Cells opened/)).toHaveTextContent("✅");
});
function renderer() {
  return {
    systemDrone: { upsert: vi.fn(() => true), remove: vi.fn() },
    getCamera: () => ({ center: [0, 0], zoom: 10, bearing: 0, pitch: 0 }),
    setCamera: vi.fn(),
    subscribeCamera: () => () => {},
  } as unknown as MapRenderer;
}
it("does not invent a destination when the adapter is missing", async () => {
  const core = { courierDestination: vi.fn(async () => destination) };
  const { result } = renderHook(() =>
    useCourier({
      renderer: renderer(),
      origin: { longitude: 30.5, latitude: 50.4 },
      core,
      directory: undefined,
      suspended: false,
    }),
  );
  act(() => result.current.open("exclusive"));
  await act(() => result.current.accept());
  expect(result.current.error).toBe(true);
  expect(core.courierDestination).not.toHaveBeenCalled();
  expect(result.current.plan).toBeUndefined();
});
it("dispatches to an author-seeded pin on an older Core and preserves real Core failures", async () => {
  const map = renderer();
  const core = {
    courierDestination: vi.fn(async (): Promise<BusinessPoint> => {
      throw new CourierCapabilityUnavailable();
    }),
  };
  const { result, unmount } = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.61625, latitude: 50.39519 },
      core,
      directory: seededMarketDirectory,
      suspended: false,
    }),
  );
  act(() => result.current.open("special"));
  await act(() => result.current.accept());
  expect(result.current.plan?.destination.pub_dress).toBe(
    "0xda-market-osokorky",
  );
  expect(result.current.plan?.destination.isVerified).toBe(false);
  expect(result.current.flyover.active).toBe(true);
  expect(result.current.offer).toBeUndefined();
  unmount();

  core.courierDestination.mockRejectedValue(new Error("Invalid Core output"));
  const failed = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.61625, latitude: 50.39519 },
      core,
      directory: seededMarketDirectory,
      suspended: false,
    }),
  );
  act(() => failed.result.current.open("exclusive"));
  await act(() => failed.result.current.accept());
  expect(failed.result.current.error).toBe(true);
  expect(failed.result.current.flyover.active).toBe(false);
  expect(failed.result.current.plan).toBeUndefined();
});
it("uses Core's destination, blocks duplicate dispatch, and cancels stale asynchronous results", async () => {
  const map = renderer();
  let resolve!: (value: BusinessPoint) => void;
  const core = {
    courierDestination: vi.fn(
      () =>
        new Promise<BusinessPoint>((r) => {
          resolve = r;
        }),
    ),
  };
  const { result, unmount } = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.5, latitude: 50.4 },
      core,
      directory,
      suspended: false,
    }),
  );
  act(() => result.current.open("special"));
  await act(async () => {
    void result.current.accept();
    await Promise.resolve();
  });
  act(() => {
    void result.current.accept();
  });
  expect(core.courierDestination).toHaveBeenCalledOnce();
  act(() => result.current.close());
  await act(async () => resolve(destination));
  expect(result.current.plan).toBeUndefined();
  act(() => result.current.open("special"));
  await act(async () => {
    void result.current.accept();
    await Promise.resolve();
  });
  await act(async () => resolve(destination));
  expect(result.current.plan?.destination).toBe(destination);
  expect(result.current.plan?.started_at_ms).toBe("2000");
  expect(core.courierDestination).toHaveBeenLastCalledWith(
    { longitude_e7: "305000000", latitude_e7: "504000000" },
    projection,
  );
  expect(map.systemDrone!.upsert).toHaveBeenCalled();
  unmount();
  expect(map.systemDrone!.remove).toHaveBeenCalledWith("system:xPing:courier");
});
it("preserves the world camera while the offer is pending, skipped or reopened", () => {
  const map = renderer();
  const { result, rerender } = renderHook(
    ({ at }) =>
      useCourier({
        renderer: map,
        origin: at,
        core: undefined,
        directory,
        suspended: false,
      }),
    { initialProps: { at: { longitude: 30.5, latitude: 50.4 } } },
  );
  act(() => result.current.open("exclusive"));
  expect(result.current.flyover.active).toBe(false);
  expect(map.setCamera).not.toHaveBeenCalled();
  rerender({ at: { longitude: 30.5001, latitude: 50.4001 } });
  rerender({ at: { longitude: 30.5002, latitude: 50.4002 } });
  expect(map.setCamera).not.toHaveBeenCalled();
  act(() => result.current.close());
  expect(map.setCamera).not.toHaveBeenCalled();
  act(() => result.current.open("special"));
  expect(map.setCamera).not.toHaveBeenCalled();
  act(() => result.current.close());
  expect(result.current.flyover.active).toBe(false);
  expect(map.setCamera).not.toHaveBeenCalled();
});
it("listens for taps on the flying xPing only, never on a parked offer drone", async () => {
  const map = renderer();
  const unsubscribe = vi.fn();
  const subscribeActivation = vi.fn(() => unsubscribe);
  Object.assign(map.systemDrone!, { subscribeActivation });
  const core = { courierDestination: vi.fn(async () => destination) };
  const { result, unmount } = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.5, latitude: 50.4 },
      core,
      directory,
      suspended: false,
    }),
  );
  act(() => result.current.open("exclusive"));
  expect(subscribeActivation).not.toHaveBeenCalled();
  await act(() => result.current.accept());
  expect(result.current.flyover.active).toBe(true);
  expect(subscribeActivation).toHaveBeenCalledOnce();
  expect(subscribeActivation).toHaveBeenCalledWith(
    "flyover:xPing",
    expect.any(Function),
  );
  unmount();
  expect(unsubscribe).toHaveBeenCalled();
});
it("rounds route distance according to its scale", () => {
  expect(
    [0, 0.1, 9.2, 47.8, 51, 199, 201].map(roundedFlightDistanceMeters),
  ).toEqual([0, 1, 10, 48, 60, 200, 250]);
});

it("tells flight progress as useful distance to the named target", () => {
  // The plan's destination stands at 30.501, 50.401; about 111.2 m per
  // 0.001° of latitude.
  const at = (latitude: number) => ({
    active: true,
    progress: { point: { longitude: 30.501, latitude }, remainingMs: 9000 },
  });
  const props = {
    jobs: [],
    plan,
    completed: undefined,
    target: "0xda-market Golden Gate",
    onFlight: vi.fn(),
    onFollow: vi.fn(),
    onCells: vi.fn(),
  };
  const view = render(<ActivityStack {...props} flight={at(50.4)} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "120 m to 0xda-market Golden Gate",
  );
  view.rerender(<ActivityStack {...props} flight={at(50.4005)} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "60 m to 0xda-market Golden Gate",
  );
  view.rerender(<ActivityStack {...props} flight={at(50.4009)} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "12 m to 0xda-market Golden Gate",
  );
  view.rerender(<ActivityStack {...props} flight={at(50.401)} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "0 m to 0xda-market Golden Gate",
  );
  view.rerender(
    <ActivityStack {...props} target={undefined} flight={at(50.4)} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "xPing · flying to 0xda-market · 0:09",
  );
});

it("keeps xPing in its dock while its engine is broken", async () => {
  const map = renderer();
  const engine = {
    readXpingEngine: vi.fn(async () => ({
      kind: "read" as const,
      state: { energy_permille: 0, at_ms: "0", broken_at_ms: "0" },
      view: {
        energyPermille: 0,
        smokePermille: 1000,
        broken: true,
        emptyMarginMs: 0,
        fullAtMs: 43_200_000,
        repairSeeds: 50,
      },
      nowMs: 0,
    })),
    forceXpingEngine: vi.fn(),
    repairXpingEngine: vi.fn(),
  };
  const core = { courierDestination: vi.fn(async () => destination) };
  const { result } = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.5, latitude: 50.4 },
      core,
      directory,
      suspended: false,
      engine,
    }),
  );
  act(() => result.current.open("exclusive"));
  await act(() => result.current.accept());
  expect(result.current.blocked).toBe("broken");
  expect(result.current.error).toBe(true);
  expect(core.courierDestination).not.toHaveBeenCalled();
  expect(result.current.flyover.active).toBe(false);
});

it("gives a flight forcing from a working engine", async () => {
  const map = renderer();
  const engine = {
    readXpingEngine: vi.fn(async () => ({
      kind: "read" as const,
      state: { energy_permille: 500, at_ms: "0" },
      view: {
        energyPermille: 500,
        smokePermille: 500,
        broken: false,
        emptyMarginMs: 2000,
        fullAtMs: 21_600_000,
        repairSeeds: 25,
      },
      nowMs: 0,
    })),
    forceXpingEngine: vi.fn(),
    repairXpingEngine: vi.fn(),
  };
  const { result } = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.5, latitude: 50.4 },
      core: { courierDestination: vi.fn(async () => destination) },
      directory,
      suspended: false,
      engine,
    }),
  );
  act(() => result.current.open("exclusive"));
  await act(() => result.current.accept());
  expect(result.current.flyover.active).toBe(true);
  expect(result.current.forcing?.energy()).toBeCloseTo(0.5);
  expect(result.current.forcing?.allowed()).toBe(true);
});

it("tells the way back, and a breakdown, in the flight row", () => {
  const props = {
    jobs: [],
    plan,
    completed: undefined,
    target: "0xda-market Golden Gate",
    onFlight: vi.fn(),
    onFollow: vi.fn(),
    onCells: vi.fn(),
  };
  const view = render(
    <ActivityStack
      {...props}
      flight={{
        active: true,
        progress: {
          // The plan set off from 30.5, 50.4.
          point: { longitude: 30.5, latitude: 50.401 },
          remainingMs: 3000,
          arrivedAt: Date.now(),
          returning: true,
        },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "xPing · flying back · 120 m",
  );
  expect(screen.getByRole("button", { name: "Follow xPing" })).toBeDefined();
  view.rerender(
    <ActivityStack
      {...props}
      brokenAt={Date.now()}
      flight={{ active: false, progress: undefined }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "xPing broke down · flight called off",
  );
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole("status")).toBeNull();
});

it("hands the arrived plan to Dock and clears it on close", async () => {
  const map = renderer();
  const core = { courierDestination: vi.fn(async () => destination) };
  const { result } = renderHook(() =>
    useCourier({
      renderer: map,
      origin: { longitude: 30.5, latitude: 50.4 },
      core,
      directory,
      suspended: false,
      dockOnArrival: true,
    }),
  );
  expect(result.current.arrival).toBeUndefined();
  act(() => result.current.open("special"));
  await act(async () => {
    await result.current.accept();
  });
  act(() => vi.advanceTimersByTime(120_000));
  expect(result.current.arrival?.destination).toEqual(destination);
  expect(result.current.flyover.expanded).toBe(false);
  act(() => result.current.closeMarket());
  expect(result.current.arrival).toBeUndefined();
  expect(result.current.flyover.active).toBe(false);
});
