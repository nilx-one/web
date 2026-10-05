// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapBounds, MapRoad } from "@nilx-one/map-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createRoadTileCache,
  MAX_ROAD_TILES,
  ROAD_TILE_ZOOM,
  tileBounds,
  tilesCovering,
  type TileId,
} from "./road-tiles";

/** A box about `km` kilometres across, centred in Kyiv. */
function around(km: number, longitude = 30.5234): MapBounds {
  const latitude = 50.4501;
  const dLat = km / 2 / 111.2;
  const dLon = dLat / Math.cos((latitude * Math.PI) / 180);
  return {
    west: longitude - dLon,
    east: longitude + dLon,
    south: latitude - dLat,
    north: latitude + dLat,
  };
}

/** One road per tile, along the middle of it, named after the tile. */
function fakeTiles() {
  const fetchTile = vi.fn(async (tile: TileId): Promise<readonly MapRoad[]> => {
    const box = tileBounds(tile);
    const middle = (box.north + box.south) / 2;
    return [
      {
        kind: "path",
        kindDetail: `${tile.x}/${tile.y}`,
        lines: [
          [
            [box.west, middle],
            [box.east, middle],
          ],
        ],
      },
    ];
  });
  return fetchTile;
}

describe("tilesCovering", () => {
  it("covers a box with the tiles it touches, row by row", () => {
    const tiles = tilesCovering(around(3), ROAD_TILE_ZOOM);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.length).toBeLessThanOrEqual(16);
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i - 1]!;
      const b = tiles[i]!;
      expect(b.y > a.y || (b.y === a.y && b.x === a.x + 1)).toBe(true);
    }
    const box = around(3);
    for (const tile of tiles) {
      const b = tileBounds(tile);
      expect(b.west <= box.east && b.east >= box.west).toBe(true);
      expect(b.south <= box.north && b.north >= box.south).toBe(true);
    }
  });
});

describe("createRoadTileCache", () => {
  it("fetches the tiles around an outing once, and answers roads from them", async () => {
    const fetchTile = fakeTiles();
    const cache = createRoadTileCache({ fetchTile });
    const box = around(3);

    const first = await cache.preload(box);
    expect(first.fetched).toBe(first.covering);
    expect(first.cached).toBe(0);
    expect(cache.size).toBe(first.covering);
    // Every tile's road, asked about over the tiles' whole extent.
    const all = tilesCovering(box, ROAD_TILE_ZOOM).map(tileBounds);
    const extent: MapBounds = {
      west: Math.min(...all.map((b) => b.west)),
      east: Math.max(...all.map((b) => b.east)),
      south: Math.min(...all.map((b) => b.south)),
      north: Math.max(...all.map((b) => b.north)),
    };
    expect(cache.roadsWithin(extent).length).toBe(first.covering);

    const again = await cache.preload(box);
    expect(again.fetched).toBe(0);
    expect(again.cached).toBe(first.covering);
    expect(fetchTile).toHaveBeenCalledTimes(first.covering);
  });

  it("fetches only the new tiles when the outing moves on", async () => {
    const fetchTile = fakeTiles();
    const cache = createRoadTileCache({ fetchTile });
    const first = await cache.preload(around(2));
    // A little east: most tiles are already held.
    const moved = await cache.preload(around(2, 30.545));
    expect(moved.cached).toBeGreaterThan(0);
    expect(moved.fetched).toBe(moved.covering - moved.cached);
    expect(fetchTile).toHaveBeenCalledTimes(first.fetched + moved.fetched);
  });

  it("never fetches or holds more than its cap, nearest first", async () => {
    const fetchTile = fakeTiles();
    const cache = createRoadTileCache({ fetchTile, maxTiles: 6 });
    const box = around(8);
    const result = await cache.preload(box);
    expect(result.covering).toBeGreaterThan(6);
    expect(result.fetched).toBe(6);
    expect(result.skipped).toBe(result.covering - 6);
    expect(cache.size).toBe(6);

    // The tile under the centre is among those held.
    const centre = tilesCovering(around(0.01), ROAD_TILE_ZOOM)[0]!;
    expect(fetchTile.mock.calls.map(([tile]) => tile)).toContainEqual(centre);

    // Somewhere else entirely: the old tiles make room.
    await cache.preload(around(1, 30.7));
    expect(cache.size).toBeLessThanOrEqual(6);
    expect(cache.roadsWithin(around(1, 30.7)).length).toBeGreaterThan(0);
  });

  it("does not fetch tiles the caller turns down", async () => {
    const fetchTile = fakeTiles();
    const cache = createRoadTileCache({ fetchTile });
    const box = around(3);
    const centre = (box.west + box.east) / 2;
    const result = await cache.preload(box, (tile) => tile.west < centre);
    expect(result.refused).toBeGreaterThan(0);
    expect(result.fetched).toBe(result.covering - result.refused);
    for (const [tile] of fetchTile.mock.calls) {
      expect(tileBounds(tile).west).toBeLessThan(centre);
    }
  });

  it("counts a failed tile, holds nothing for it, and tries it again next time", async () => {
    let fail = true;
    const fetchTile = vi.fn(async (): Promise<readonly MapRoad[]> => {
      if (fail) throw new Error("offline");
      return [];
    });
    const cache = createRoadTileCache({ fetchTile });
    const box = around(0.2);
    const failed = await cache.preload(box);
    expect(failed.failed).toBe(failed.covering);
    expect(cache.size).toBe(0);
    fail = false;
    const retried = await cache.preload(box);
    expect(retried.fetched).toBe(retried.covering);
  });

  it("asks once for a tile two preloads want at the same time", async () => {
    const fetchTile = fakeTiles();
    const cache = createRoadTileCache({ fetchTile });
    const box = around(0.2);
    await Promise.all([cache.preload(box), cache.preload(box)]);
    expect(fetchTile).toHaveBeenCalledTimes(
      tilesCovering(box, ROAD_TILE_ZOOM).length,
    );
  });

  it("answers only the lines inside the box asked about", async () => {
    const cache = createRoadTileCache({ fetchTile: fakeTiles() });
    await cache.preload(around(3));
    const far: MapBounds = { west: 31, east: 31.1, south: 51, north: 51.1 };
    expect(cache.roadsWithin(far)).toEqual([]);
  });

  it("clips lines that cross the box to the box, splitting where they leave", async () => {
    const box: MapBounds = {
      west: 30.52,
      east: 30.53,
      south: 50.445,
      north: 50.455,
    };
    const crossing: MapRoad = {
      kind: "path",
      kindDetail: "footway",
      lines: [
        // In from the west, a vertex inside, out to the east.
        [
          [30.51, 50.45],
          [30.525, 50.451],
          [30.54, 50.45],
        ],
        // Inside, out to the north, and back in: two pieces.
        [
          [30.521, 50.45],
          [30.525, 50.46],
          [30.529, 50.45],
        ],
      ],
    };
    const cache = createRoadTileCache({
      fetchTile: async () => [crossing],
      maxTiles: 64,
    });
    await cache.preload(box);
    const pieces = cache
      .roadsWithin(box)
      .flatMap((road) => road.lines)
      // Each held tile answers the same road; one copy is enough to check.
      .slice(0, 3);
    const epsilon = 1e-12;
    for (const line of pieces) {
      for (const [longitude, latitude] of line) {
        expect(longitude).toBeGreaterThanOrEqual(box.west - epsilon);
        expect(longitude).toBeLessThanOrEqual(box.east + epsilon);
        expect(latitude).toBeGreaterThanOrEqual(box.south - epsilon);
        expect(latitude).toBeLessThanOrEqual(box.north + epsilon);
      }
    }
    expect(pieces).toHaveLength(3);
    // The first line stays one piece, its inner vertex kept exactly.
    expect(pieces[0]).toHaveLength(3);
    expect(pieces[0]![1]).toEqual([30.525, 50.451]);
    expect(pieces[0]![0]![0]).toBeCloseTo(box.west, 12);
    expect(pieces[0]![2]![0]).toBeCloseTo(box.east, 12);
    // The second leaves through the north edge and comes back.
    expect(pieces[1]!.at(-1)![1]).toBeCloseTo(box.north, 12);
    expect(pieces[2]![0]![1]).toBeCloseTo(box.north, 12);
  });

  it("caps by default at the documented number of tiles", () => {
    expect(MAX_ROAD_TILES).toBe(32);
    expect(ROAD_TILE_ZOOM).toBe(14);
  });
});
