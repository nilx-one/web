// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BusinessStationAccessPort,
  BusinessStationView,
} from "@nilx-one/application";
import type { AvatarHandle, AvatarLayerContract } from "@nilx-one/map-contract";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AVATAR_MIN_ZOOM } from "./avatar-presence";
import {
  createStationHandle,
  stationHandleId,
  stationRenderSet,
  useBusinessStations,
  type StationCamera,
} from "./use-business-stations";

const batkivshchyna: BusinessStationView = {
  pubDress: "0xda-market-batkivshchyna",
  ownerPubDress: "0xda-market",
  longitude: 30.5632,
  latitude: 50.4265,
};
const zolotiVorota: BusinessStationView = {
  pubDress: "0xda-market-zoloti-vorota",
  ownerPubDress: "0xda-market",
  longitude: 30.5131,
  latitude: 50.4489,
};

/** The camera standing over a shop at a body's zoom. */
function over(
  station: BusinessStationView,
  zoom = AVATAR_MIN_ZOOM,
): StationCamera {
  return { center: [station.longitude, station.latitude], zoom };
}

/** Shops spread across Ukraine and beyond, all far from Zoloti Vorota. */
function distantStations(count: number): BusinessStationView[] {
  return Array.from({ length: count }, (_, index) => ({
    pubDress: `0xda-market-far-${index}`,
    ownerPubDress: "0xda-market",
    longitude: 22 + (index % 100) * 0.2,
    latitude: 45 + Math.floor(index / 100) * 0.2,
  }));
}

function layer() {
  const upsert = vi.fn<(handle: AvatarHandle) => void>();
  const remove = vi.fn<(id: string) => void>();
  const avatars: AvatarLayerContract = {
    upsert,
    remove,
    setCamera: vi.fn(),
  };
  return { avatars, upsert, remove };
}

function port(
  ...answers: (readonly BusinessStationView[] | undefined)[]
): BusinessStationAccessPort {
  const read = vi.fn<BusinessStationAccessPort["readBusinessStations"]>();
  for (const answer of answers) read.mockResolvedValueOnce(answer);
  read.mockResolvedValue(answers.at(-1));
  return { readBusinessStations: read };
}

describe("createStationHandle", () => {
  it("stands idle at its shop and keeps the same body everywhere", () => {
    const handle = createStationHandle(batkivshchyna, true);
    expect(handle).toMatchObject({
      id: "station:0xda-market-batkivshchyna",
      lngLat: [30.5632, 50.4265],
      clipId: "idle",
      visible: true,
    });
    expect(createStationHandle(batkivshchyna, false)).toMatchObject({
      modelId: handle.modelId,
      visible: false,
    });
  });
});

describe("stationRenderSet", () => {
  it("holds nothing below a body's zoom, however near", () => {
    expect(
      stationRenderSet([batkivshchyna], over(batkivshchyna, 14), new Set()),
    ).toEqual([]);
  });

  it("enters only the shops near the camera out of a large global list", () => {
    const set = stationRenderSet(
      [...distantStations(2_000), zolotiVorota, batkivshchyna],
      over(zolotiVorota),
      new Set(),
    );
    // Batkivshchyna is about 4 km away: listed, but not instantiated.
    expect(set).toEqual([{ station: zolotiVorota, visible: true }]);
  });

  it("keeps a held body hidden on zoom out and releases it far away", () => {
    const held = new Set([stationHandleId(zolotiVorota)]);
    expect(
      stationRenderSet([zolotiVorota], over(zolotiVorota, 12), held),
    ).toEqual([{ station: zolotiVorota, visible: false }]);
    expect(stationRenderSet([zolotiVorota], over(batkivshchyna), held)).toEqual(
      [],
    );
  });
});

describe("useBusinessStations", () => {
  it("hydrates only the shop in view out of many distant ones", async () => {
    const { avatars, upsert } = layer();
    const stations = port([...distantStations(1_000), zolotiVorota]);
    const { result } = renderHook(() =>
      useBusinessStations({
        port: stations,
        avatars,
        camera: over(zolotiVorota),
      }),
    );
    await waitFor(() => expect(result.current).toHaveLength(1_001));
    expect(upsert.mock.calls.map(([handle]) => handle.id)).toEqual([
      stationHandleId(zolotiVorota),
    ]);
  });

  it("hydrates nothing until the camera comes in to a body's zoom", async () => {
    const { avatars, upsert } = layer();
    const stations = port([zolotiVorota, batkivshchyna]);
    const { result, rerender } = renderHook(
      ({ camera }: { camera: StationCamera }) =>
        useBusinessStations({ port: stations, avatars, camera }),
      { initialProps: { camera: over(zolotiVorota, 12) } },
    );
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(upsert).not.toHaveBeenCalled();

    rerender({ camera: over(zolotiVorota) });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: stationHandleId(zolotiVorota),
        visible: true,
      }),
    );
  });

  it("only flips visibility on zoom, stays quiet on a pan, and releases on leaving", async () => {
    const { avatars, upsert, remove } = layer();
    const stations = port([zolotiVorota, batkivshchyna]);
    const { rerender, unmount } = renderHook(
      ({ camera }: { camera: StationCamera }) =>
        useBusinessStations({ port: stations, avatars, camera }),
      { initialProps: { camera: over(zolotiVorota) } },
    );
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    rerender({ camera: over(zolotiVorota, 12) });
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: false }),
    );
    expect(remove).not.toHaveBeenCalled();

    rerender({ camera: over(zolotiVorota) });
    // A small pan that changes nothing for the shop sends nothing.
    rerender({
      camera: { center: [30.5132, 50.4489], zoom: AVATAR_MIN_ZOOM },
    });
    expect(upsert).toHaveBeenCalledTimes(3);

    rerender({ camera: over(batkivshchyna) });
    expect(remove).toHaveBeenCalledWith(stationHandleId(zolotiVorota));
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: stationHandleId(batkivshchyna) }),
    );

    unmount();
    expect(remove).toHaveBeenLastCalledWith(stationHandleId(batkivshchyna));
  });

  it("moves a held body when its business restates the shop's point", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { avatars, upsert } = layer();
      const moved = { ...zolotiVorota, longitude: 30.5135 };
      const stations = port([zolotiVorota], [moved]);
      renderHook(() =>
        useBusinessStations({
          port: stations,
          avatars,
          camera: over(zolotiVorota),
          refreshMs: 1_000,
        }),
      );
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);
      await waitFor(() =>
        expect(upsert).toHaveBeenLastCalledWith(
          expect.objectContaining({ lngLat: [30.5135, 50.4489] }),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a station that left the answer and keeps the rest on a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { avatars, upsert, remove } = layer();
      const stations = port([zolotiVorota], [], undefined);
      renderHook(() =>
        useBusinessStations({
          port: stations,
          avatars,
          camera: over(zolotiVorota),
          refreshMs: 1_000,
        }),
      );
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);
      await waitFor(() =>
        expect(remove).toHaveBeenCalledWith(stationHandleId(zolotiVorota)),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
