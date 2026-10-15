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
  useBusinessStations,
} from "./use-business-stations";

const batkivshchyna: BusinessStationView = {
  pubDress: "xda-market-batkivshchynai",
  ownerPubDress: "0xda-market",
  longitude: 30.5632,
  latitude: 50.4265,
};
const zolotiVorota: BusinessStationView = {
  pubDress: "xda-market-zoloti-vorotai",
  ownerPubDress: "0xda-market",
  longitude: 30.5131,
  latitude: 50.4489,
};

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
    const handle = createStationHandle(batkivshchyna, AVATAR_MIN_ZOOM);
    expect(handle).toMatchObject({
      id: "station:xda-market-batkivshchynai",
      lngLat: [30.5632, 50.4265],
      clipId: "idle",
      visible: true,
    });
    expect(createStationHandle(batkivshchyna, 3)).toMatchObject({
      modelId: handle.modelId,
      visible: false,
    });
  });
});

describe("useBusinessStations", () => {
  it("draws every station and only flips visibility with the zoom", async () => {
    const { avatars, upsert, remove } = layer();
    const stations = port([batkivshchyna, zolotiVorota]);
    const { rerender, unmount } = renderHook(
      ({ zoom }: { zoom: number }) =>
        useBusinessStations({
          port: stations,
          avatars,
          zoom,
        }),
      { initialProps: { zoom: AVATAR_MIN_ZOOM } },
    );
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(upsert.mock.calls.map(([handle]) => handle.id)).toEqual([
      stationHandleId(batkivshchyna),
      stationHandleId(zolotiVorota),
    ]);

    rerender({ zoom: 3 });
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: false }),
    );
    expect(remove).not.toHaveBeenCalled();

    unmount();
    expect(remove.mock.calls.map(([id]) => id).sort()).toEqual([
      stationHandleId(batkivshchyna),
      stationHandleId(zolotiVorota),
    ]);
  });

  it("removes a station that left the answer and keeps the rest on a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { avatars, upsert, remove } = layer();
      const stations = port(
        [batkivshchyna, zolotiVorota],
        [zolotiVorota],
        undefined,
      );
      renderHook(() =>
        useBusinessStations({
          port: stations,
          avatars,
          zoom: AVATAR_MIN_ZOOM,
          refreshMs: 1_000,
        }),
      );
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(1_000);
      await waitFor(() =>
        expect(remove).toHaveBeenCalledWith(stationHandleId(batkivshchyna)),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
