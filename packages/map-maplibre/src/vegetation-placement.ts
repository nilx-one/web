// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Where trees and bushes stand: inside the real green areas the basemap
 * paints, and nowhere else.
 *
 * The archive carries no tree points, so a tree here is not a claim that a
 * tree stands at that spot. It is how a real park, wood or lawn is drawn at
 * street scale: its mass, as trees. Every candidate comes from a fixed grid
 * anchored to the world, so the same park shows the same trees from any
 * camera, on any device, and a polygon cut across tiles is filled once.
 */

export type VegetationModel =
  "tree-round" | "tree-tall" | "tree-pine" | "bush" | "hedge";

export const VEGETATION_MODELS: readonly VegetationModel[] = [
  "tree-round",
  "tree-tall",
  "tree-pine",
  "bush",
  "hedge",
];

/** One tree or bush, ready to be drawn. */
export interface VegetationInstance {
  /** Stable across views: the grid cell it was drawn from. */
  readonly id: string;
  readonly model: VegetationModel;
  readonly lngLat: readonly [number, number];
  readonly bearingDeg: number;
  /** Around 1: the same model, a little bigger or smaller. */
  readonly scale: number;
}

type Ring = readonly (readonly [number, number])[];
/** Outer ring first, then holes, in longitude and latitude. */
export type AreaPolygon = readonly Ring[];

/** A green polygon as the basemap's `landuse` layer has it. */
export interface GreenArea {
  readonly kind: string;
  readonly polygon: AreaPolygon;
}

interface Planting {
  /** Metres between candidates on the world grid. */
  readonly spacing: number;
  /** The share of candidates that hold something. */
  readonly keep: number;
  /** Which model a kept candidate is, by weight. */
  readonly mix: readonly (readonly [VegetationModel, number])[];
}

interface Character {
  readonly trees?: Planting;
  readonly bushes?: Planting;
}

const WOODLAND: Character = {
  trees: {
    spacing: 9,
    keep: 0.85,
    mix: [
      ["tree-round", 0.45],
      ["tree-tall", 0.15],
      ["tree-pine", 0.4],
    ],
  },
  bushes: { spacing: 14, keep: 0.25, mix: [["bush", 1]] },
};

const PARK: Character = {
  trees: {
    spacing: 15,
    keep: 0.7,
    mix: [
      ["tree-round", 0.7],
      ["tree-tall", 0.2],
      ["tree-pine", 0.1],
    ],
  },
  bushes: {
    spacing: 11,
    keep: 0.35,
    mix: [
      ["bush", 0.75],
      ["hedge", 0.25],
    ],
  },
};

const LAWN: Character = {
  trees: {
    spacing: 28,
    keep: 0.35,
    mix: [
      ["tree-round", 0.7],
      ["tree-tall", 0.3],
    ],
  },
  bushes: { spacing: 14, keep: 0.3, mix: [["bush", 1]] },
};

const SCRUB: Character = {
  trees: { spacing: 26, keep: 0.25, mix: [["tree-round", 1]] },
  bushes: { spacing: 7, keep: 0.6, mix: [["bush", 1]] },
};

/**
 * How each green kind of the published style is planted. A pitch or a
 * playground stays open: a tree in the middle of a football pitch would be
 * the renderer inventing an obstacle the place does not have.
 */
export const GREEN_CHARACTER: Readonly<Record<string, Character>> = {
  forest: WOODLAND,
  wood: WOODLAND,
  nature_reserve: WOODLAND,
  protected_area: WOODLAND,
  national_park: WOODLAND,
  park: PARK,
  garden: PARK,
  cemetery: PARK,
  village_green: PARK,
  recreation_ground: PARK,
  allotments: PARK,
  grass: LAWN,
  grassland: LAWN,
  golf_course: LAWN,
  scrub: SCRUB,
  playground: {},
  pitch: {},
};

/** Closer than street scale, where a tree is a few pixels tall. */
export const VEGETATION_MIN_ZOOM = 15.5;
/** At most this many of each, nearest the view's centre first. */
export const VEGETATION_MAX_TREES = 2500;
export const VEGETATION_MAX_BUSHES = 1500;

const EARTH_RADIUS = 6378137;
/** Candidates a single area may test, so one huge wood never stalls a frame. */
const MAX_CANDIDATES_PER_AREA = 40000;

interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** Web Mercator metres: the grid every device agrees on. */
function mercator([lng, lat]: readonly [number, number]): [number, number] {
  const x = (EARTH_RADIUS * lng * Math.PI) / 180;
  const y =
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

function lngLat(x: number, y: number): [number, number] {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat =
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [lng, lat];
}

/** A fast, well-mixed hash of grid coordinates, into [0, 1). */
export function cellHash(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function inRing(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] ?? [0, 0];
    const [xj, yj] = ring[j] ?? [0, 0];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function inPolygon(
  polygon: AreaPolygon,
  lng: number,
  lat: number,
): boolean {
  const [outer, ...holes] = polygon;
  if (outer === undefined || !inRing(outer, lng, lat)) return false;
  return !holes.some((hole) => inRing(hole, lng, lat));
}

function boxOf(polygon: AreaPolygon): Box {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of polygon[0] ?? []) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

function overlap(a: Box, b: Box): Box | undefined {
  const box = {
    west: Math.max(a.west, b.west),
    south: Math.max(a.south, b.south),
    east: Math.min(a.east, b.east),
    north: Math.min(a.north, b.north),
  };
  return box.west < box.east && box.south < box.north ? box : undefined;
}

/** Polygons that rule a spot out, bucketed so each test reads only a few. */
function obstacleIndex(polygons: readonly AreaPolygon[]) {
  const cell = 0.0008; // about 60–90 m in Kyiv
  const buckets = new Map<number, { polygon: AreaPolygon; box: Box }[]>();
  const key = (x: number, y: number) => x * 1048576 + y;
  for (const polygon of polygons) {
    const box = boxOf(polygon);
    if (!Number.isFinite(box.west)) continue;
    for (
      let x = Math.floor(box.west / cell);
      x <= Math.floor(box.east / cell);
      x += 1
    )
      for (
        let y = Math.floor(box.south / cell);
        y <= Math.floor(box.north / cell);
        y += 1
      ) {
        const at = key(x, y);
        const bucket = buckets.get(at) ?? [];
        bucket.push({ polygon, box });
        buckets.set(at, bucket);
      }
  }
  return (lng: number, lat: number): boolean =>
    (
      buckets.get(key(Math.floor(lng / cell), Math.floor(lat / cell))) ?? []
    ).some(
      ({ polygon, box }) =>
        lng >= box.west &&
        lng <= box.east &&
        lat >= box.south &&
        lat <= box.north &&
        inPolygon(polygon, lng, lat),
    );
}

function pick(mix: Planting["mix"], roll: number): VegetationModel | undefined {
  const total = mix.reduce((sum, [, weight]) => sum + weight, 0);
  let at = roll * total;
  for (const [model, weight] of mix) {
    if (at < weight) return model;
    at -= weight;
  }
  return mix[mix.length - 1]?.[0];
}

export interface VegetationInput {
  readonly areas: readonly GreenArea[];
  /** Footprints and water: nothing grows inside them. */
  readonly obstacles: readonly AreaPolygon[];
  /** What the view spans, a little beyond the screen. */
  readonly bounds: Box;
  /** The view's centre: the nearest are kept when there are too many. */
  readonly center: readonly [number, number];
}

/**
 * Every tree and bush the view's green areas hold. Pure and deterministic:
 * the same areas give the same instances, whatever order the tiles came in.
 */
export function plantVegetation({
  areas,
  obstacles,
  bounds,
  center,
}: VegetationInput): {
  readonly trees: readonly VegetationInstance[];
  readonly bushes: readonly VegetationInstance[];
} {
  const blocked = obstacleIndex(obstacles);
  const [cx, cy] = mercator(center);
  // Mercator stretches the ground by 1 / cos(latitude); the grid is laid in
  // ground metres at the view's latitude, rounded so it holds still as the
  // camera pans across a city.
  const latitude = Math.round(center[1] * 2) / 2;
  const stretch = 1 / Math.cos((latitude * Math.PI) / 180);
  const found = new Map<number, VegetationInstance & { distance: number }>();
  const bushes = new Map<number, VegetationInstance & { distance: number }>();

  for (const area of areas) {
    const character = GREEN_CHARACTER[area.kind];
    if (character === undefined) continue;
    const box = overlap(boxOf(area.polygon), bounds);
    if (box === undefined) continue;
    for (const [layer, planting, salt, into, limit] of [
      ["tree", character.trees, 0x7ee1, found, VEGETATION_MAX_TREES],
      ["bush", character.bushes, 0xb05e, bushes, VEGETATION_MAX_BUSHES],
    ] as const) {
      if (planting === undefined) continue;
      const step = planting.spacing * stretch;
      const [x0, y0] = mercator([box.west, box.south]);
      const [x1, y1] = mercator([box.east, box.north]);
      // An area is read only around the view's centre, far enough to hold
      // what may be kept with room to spare: the nearest are the ones kept.
      const cells = Math.min(
        MAX_CANDIDATES_PER_AREA,
        Math.ceil((limit / planting.keep) * 3),
      );
      const reach = (Math.sqrt(cells) * step) / 2;
      const i0 = Math.floor(Math.max(x0, cx - reach) / step);
      const i1 = Math.floor(Math.min(x1, cx + reach) / step);
      const j0 = Math.floor(Math.max(y0, cy - reach) / step);
      const j1 = Math.floor(Math.min(y1, cy + reach) / step);
      for (let i = i0; i <= i1; i += 1) {
        for (let j = j0; j <= j1; j += 1) {
          if (cellHash(i, j, salt) >= planting.keep) continue;
          const at = (i * 8388608 + j) * 64 + planting.spacing;
          if (into.has(at)) continue;
          // Jittered inside its cell, away from the edges, so neighbours
          // never stack into one trunk.
          const x = (i + 0.15 + 0.7 * cellHash(i, j, salt + 1)) * step;
          const y = (j + 0.15 + 0.7 * cellHash(i, j, salt + 2)) * step;
          const [lng, lat] = lngLat(x, y);
          if (!inPolygon(area.polygon, lng, lat) || blocked(lng, lat)) continue;
          const model = pick(planting.mix, cellHash(i, j, salt + 3));
          if (model === undefined) continue;
          into.set(at, {
            id: `${layer}:${planting.spacing}:${i}:${j}`,
            model,
            lngLat: [lng, lat],
            bearingDeg: Math.floor(cellHash(i, j, salt + 4) * 360),
            scale: 0.85 + 0.3 * cellHash(i, j, salt + 5),
            distance: (x - cx) ** 2 + (y - cy) ** 2,
          });
        }
      }
    }
  }

  const nearest = (
    all: Map<number, VegetationInstance & { distance: number }>,
    limit: number,
  ) =>
    [...all.values()]
      .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map(
        ({ id, model, lngLat: at, bearingDeg, scale }): VegetationInstance => ({
          id,
          model,
          lngLat: at,
          bearingDeg,
          scale,
        }),
      );

  return {
    trees: nearest(found, VEGETATION_MAX_TREES),
    bushes: nearest(bushes, VEGETATION_MAX_BUSHES),
  };
}
