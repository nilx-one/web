// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createLandmarkTileCache,
  LANDMARK_TILE_ZOOM,
  landmarkFromPoint,
} from "./landmark-tiles";
import { tileBounds, type TileId } from "./road-tiles";

const AT = { longitude: 30.5234, latitude: 50.4501 };

/** A box about `km` kilometres across, centred on `AT`. */
function around(km: number) {
  const dLat = km / 2 / 111.2;
  const dLon = dLat / Math.cos((AT.latitude * Math.PI) / 180);
  return {
    west: AT.longitude - dLon,
    east: AT.longitude + dLon,
    south: AT.latitude - dLat,
    north: AT.latitude + dLat,
  };
}

describe("landmarkFromPoint", () => {
  it("keeps the archive id, so a point read ahead and on screen is one", () => {
    expect(
      landmarkFromPoint({
        id: 7,
        properties: { kind: "museum", name: "Museum", min_zoom: 16 },
        ...AT,
      }),
    ).toEqual({
      id: "poi:7",
      ...AT,
      kind: "museum",
      name: "Museum",
      facts: { min_zoom: 16 },
    });
  });

  it("turns down a kind that is no landmark, and a place that is no place", () => {
    expect(
      landmarkFromPoint({ id: 1, properties: { kind: "cafe" }, ...AT }),
    ).toBeUndefined();
    expect(
      landmarkFromPoint({
        id: 1,
        properties: { kind: "museum" },
        longitude: Number.NaN,
        latitude: 50,
      }),
    ).toBeUndefined();
  });
});

describe("createLandmarkTileCache", () => {
  /** One museum at the middle of every tile, its id the tile's. */
  const fetchTile = () =>
    vi.fn(async (tile: TileId): Promise<readonly MapLandmark[]> => {
      const box = tileBounds(tile);
      return [
        {
          id: `poi:${tile.x}/${tile.y}`,
          longitude: (box.west + box.east) / 2,
          latitude: (box.south + box.north) / 2,
          kind: "museum",
          facts: {},
        },
      ];
    });

  it("reads the archive's last zoom, where every point is", async () => {
    const fetch = fetchTile();
    const cache = createLandmarkTileCache({ fetchTile: fetch });

    const preload = await cache.preload(around(2));
    expect(preload.fetched).toBe(preload.covering);
    for (const [tile] of fetch.mock.calls) expect(tile.z).toBe(15);
    expect(LANDMARK_TILE_ZOOM).toBe(15);
  });

  it("answers what it holds within a radius, each landmark once", async () => {
    const cache = createLandmarkTileCache({ fetchTile: fetchTile() });
    await cache.preload(around(3));

    const near = cache.landmarksNear(AT, 1_000);
    expect(near.length).toBeGreaterThan(0);
    expect(new Set(near.map((l) => l.id)).size).toBe(near.length);
    expect(cache.landmarksNear(AT, 0.5).length).toBeLessThanOrEqual(1);
    // Nothing is known past what was read.
    expect(
      cache.landmarksNear({ longitude: 31.5, latitude: 50.4501 }, 1_000),
    ).toEqual([]);
  });

  it("does not fetch a tile the caller turned down", async () => {
    const fetch = fetchTile();
    const cache = createLandmarkTileCache({ fetchTile: fetch });

    const preload = await cache.preload(around(2), () => false);
    expect(fetch).not.toHaveBeenCalled();
    expect(preload.refused).toBe(preload.covering);
  });
});
