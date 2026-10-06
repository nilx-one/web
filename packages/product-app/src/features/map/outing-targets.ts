// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { insideRings, type MapObstacle } from "@nilx-one/map-contract";
import { LANDMARK_GROUPS, type NormalizedLandmark } from "./landmark-normalize";
import type { PlaceFeeling } from "./place-affinity";
import {
  distanceM,
  edgeCost,
  projectOnSegment,
  reachFrom,
  snapToGraph,
  SNAP_DISTANCE_M,
  SURFACE_WEIGHT,
  type CanEnter,
  type LonLat,
  type WalkGraph,
} from "@nilx-one/walk-graph";

/**
 * Where an Avaia may go for a walk (docs/avaia-outings.md §1, #301).
 *
 * The menu is built by code, from targets the landmark mapper already
 * normalized (docs/avaia-osm-landmarks.md): only the `walk_target` group, only
 * named, and only where the walking graph reaches over open ground within the
 * walk's budget. A target is arrived at, never aimed at its centroid. The model
 * sees the menu as closed labels and picks an index; the rule picks when there
 * is no model or its pick is invalid. Finds are never targets.
 *
 * All of it is presentation: nothing here is observed, persisted or sent.
 */

/** The `walk_target` group, in mapping-table order. */
export const WALK_TARGET_KINDS = LANDMARK_GROUPS.walk_target;

export type WalkTargetKind = (typeof WALK_TARGET_KINDS)[number];

/** Areas wandered in: arrived at from inside or near the edge. */
const WANDER_AREAS: ReadonlySet<WalkTargetKind> = new Set([
  "park",
  "nature_reserve",
]);

/** Areas walked up to: arrived at on the shore, never inside. */
const SHORE_AREAS: ReadonlySet<WalkTargetKind> = new Set(["lake", "beach"]);

/** Outer ring first, holes after, `[longitude, latitude]`. */
export type AreaRings = readonly (readonly LonLat[])[];

export type TargetGeometry =
  | { readonly type: "point"; readonly point: LonLat }
  | { readonly type: "area"; readonly polygons: readonly AreaRings[] };

/** One normalized landmark offered as a possible target. */
export interface OutingCandidate {
  /** Stable for the same feature; stays in code, never shown to the model. */
  readonly id: string;
  readonly kind: string;
  readonly name?: string | undefined;
  readonly geometry: TargetGeometry;
}

export interface OutingTarget {
  readonly id: string;
  readonly kind: WalkTargetKind;
  readonly name: string;
  /** Where the walk arrives: on the walking graph, on open ground. */
  readonly anchor: LonLat;
  /** Metres along the cheapest way there. */
  readonly meters: number;
}

export type OutingOption =
  | { readonly kind: "stay" }
  | { readonly kind: "wander" }
  | { readonly kind: "target"; readonly target: OutingTarget };

export interface OutingMenu {
  readonly options: readonly OutingOption[];
}

/** How far an anchor may lie from what it stands for. */
export const ANCHOR_REACH_METERS = SNAP_DISTANCE_M;

const MAX_SURFACE_WEIGHT = Math.max(...Object.values(SURFACE_WEIGHT));

/** Most targets one menu offers: with stay and wander, at most six options. */
export const MENU_TARGETS = 4;

/** A target this close is "near" to the model; anything further is "far". */
export const NEAR_METERS = 1_000;

export interface OutingMenuInput {
  readonly candidates: readonly OutingCandidate[];
  readonly graph: WalkGraph;
  /** Where the Avaia stands. */
  readonly from: LonLat;
  /** Ground the Avaia may walk on (R1); omitted, all ground is open. */
  readonly open?: CanEnter | undefined;
  /** The longest walk to a target, in metres. */
  readonly budgetMeters: number;
  /** Targets left out this time, such as one just visited. */
  readonly exclude?: ReadonlySet<string> | undefined;
  /**
   * The buildings and water the map draws around: no anchor stands in one.
   * Omitted, nothing is checked, as on a renderer that cannot say.
   */
  readonly obstacles?: readonly MapObstacle[] | undefined;
}

/**
 * The menu for one decision: stay, then up to `MENU_TARGETS` reachable
 * targets, then wander if there is a graph to wander on. Targets are taken
 * nearest first, one per kind before a second of any kind, so the menu is a
 * choice and not four parks. Equal input gives an equal menu, whatever order
 * the candidates arrive in.
 */
export function outingMenu(input: OutingMenuInput): OutingMenu {
  const { graph, open, budgetMeters } = input;
  const start = snapToGraph(graph, input.from, open ? { canEnter: open } : {});
  if (start === null) return { options: [{ kind: "stay" }] };
  // Nothing whose cheapest way is within the budget in metres costs more than
  // the budget on the dearest surface, so the pass stops there.
  const reach = reachFrom(graph, start, {
    maxCost: budgetMeters * MAX_SURFACE_WEIGHT,
    ...(open ? { canEnter: open } : {}),
  });

  const clear = standsClear(input.obstacles ?? []);
  const targets: OutingTarget[] = [];
  for (const candidate of input.candidates) {
    if (!isWalkTargetKind(candidate.kind)) continue;
    const name = candidate.name?.trim();
    if (name === undefined || name.length === 0) continue;
    if (input.exclude?.has(candidate.id)) continue;
    const arrival = arrive(
      candidate.kind,
      candidate.geometry,
      graph,
      open,
      { cost: reach.cost, lengthM: reach.lengthM, start },
      clear,
    );
    if (arrival === undefined || arrival.meters > budgetMeters) continue;
    targets.push({ id: candidate.id, kind: candidate.kind, name, ...arrival });
  }

  targets.sort(
    (a, b) => a.meters - b.meters || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const chosen: OutingTarget[] = [];
  const kinds = new Set<WalkTargetKind>();
  for (const target of targets) {
    if (chosen.length === MENU_TARGETS) break;
    if (kinds.has(target.kind)) continue;
    kinds.add(target.kind);
    chosen.push(target);
  }
  for (const target of targets) {
    if (chosen.length === MENU_TARGETS) break;
    if (!chosen.includes(target)) chosen.push(target);
  }
  chosen.sort(
    (a, b) => a.meters - b.meters || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    options: [
      { kind: "stay" },
      ...chosen.map((target) => ({ kind: "target" as const, target })),
      { kind: "wander" },
    ],
  };
}

/**
 * The rule that decides without a model: the nearest target, or wander when
 * there is none, or stay when there is nowhere to walk. The drive (#302)
 * weighs these against restlessness, energy and the hour.
 */
export function chooseByRule(menu: OutingMenu): OutingOption {
  return (
    menu.options.find((option) => option.kind === "target") ??
    menu.options.find((option) => option.kind === "wander") ??
    menu.options[0] ?? { kind: "stay" }
  );
}

/** One menu option as the model sees it: a closed label and how far, no more. */
export type ModelOption =
  | { readonly index: number; readonly label: "stay" | "wander" }
  | {
      readonly index: number;
      readonly label: WalkTargetKind;
      readonly reach: "near" | "far";
      /** How the Avaia feels about the place, when its feelings are given. */
      readonly feeling?: PlaceFeeling;
    };

/**
 * The menu without coordinates, names or ids: what a local model may read.
 * A landmark's name stays in the interface, never in the decision. How the
 * Avaia feels about a target is a closed label too, read from code's own
 * record of its visits; the model reads it and never writes it.
 */
export function menuForModel(
  menu: OutingMenu,
  feeling?: (targetId: string) => PlaceFeeling,
): readonly ModelOption[] {
  return menu.options.map((option, index) =>
    option.kind === "target"
      ? {
          index,
          label: option.target.kind,
          reach: option.target.meters <= NEAR_METERS ? "near" : "far",
          ...(feeling === undefined
            ? {}
            : { feeling: feeling(option.target.id) }),
        }
      : { index, label: option.kind },
  );
}

/** The model's pick, or the rule's when the pick is not an index on the menu. */
export function chooseByModel(menu: OutingMenu, pick: unknown): OutingOption {
  if (
    typeof pick === "number" &&
    Number.isInteger(pick) &&
    pick >= 0 &&
    pick < menu.options.length
  ) {
    return menu.options[pick]!;
  }
  return chooseByRule(menu);
}

export function isWalkTargetKind(kind: string): kind is WalkTargetKind {
  return (WALK_TARGET_KINDS as readonly string[]).includes(kind);
}

interface Reached {
  readonly cost: Float64Array;
  readonly lengthM: Float64Array;
  readonly start: NonNullable<ReturnType<typeof snapToGraph>>;
}

/**
 * Where a walk to this target arrives, and how far it is, or `undefined`
 * when the graph does not reach it over open ground.
 *
 * - a point: the nearest place on the graph within 30 m of it;
 * - a park or reserve: the cheapest node inside it or within 30 m of its edge;
 * - a lake or beach: the cheapest node outside it within 30 m of its shore.
 *
 * No anchor stands in a building or in water (`clear`): an area takes its
 * next cheapest node instead, a point is not offered.
 */
function arrive(
  kind: WalkTargetKind,
  geometry: TargetGeometry,
  graph: WalkGraph,
  open: CanEnter | undefined,
  reached: Reached,
  clear: (point: LonLat) => boolean,
): { readonly anchor: LonLat; readonly meters: number } | undefined {
  if (geometry.type === "point") {
    const at = snapToGraph(graph, geometry.point, {
      maxDistanceM: ANCHOR_REACH_METERS,
      ...(open ? { canEnter: open } : {}),
    });
    if (at === null || !clear(at.point)) return undefined;
    const edge = graph.edges[at.edge]!;
    const whole = edgeCost(edge);
    const ways = [
      {
        cost: reached.cost[edge.a]! + whole * at.t,
        meters: reached.lengthM[edge.a]! + edge.lengthM * at.t,
      },
      {
        cost: reached.cost[edge.b]! + whole * (1 - at.t),
        meters: reached.lengthM[edge.b]! + edge.lengthM * (1 - at.t),
      },
    ];
    if (reached.start.edge === at.edge) {
      const fraction = Math.abs(reached.start.t - at.t);
      ways.push({ cost: whole * fraction, meters: edge.lengthM * fraction });
    }
    const way = ways.reduce((a, b) => (b.cost < a.cost ? b : a));
    const meters = way.meters;
    return Number.isFinite(meters) ? { anchor: at.point, meters } : undefined;
  }

  const inside = WANDER_AREAS.has(kind);
  const shore = SHORE_AREAS.has(kind);
  if (!inside && !shore) return undefined;
  let best: { node: number; cost: number } | undefined;
  for (const rings of geometry.polygons) {
    const box = paddedBox(rings[0] ?? [], ANCHOR_REACH_METERS);
    graph.nodes.forEach((node, index) => {
      const cost = reached.cost[index]!;
      if (!Number.isFinite(cost)) return;
      if (best !== undefined && cost >= best.cost) return;
      if (!inBox(node, box)) return;
      const within = insideRings(node, rings);
      const near = edgeDistance(node, rings) <= ANCHOR_REACH_METERS;
      const fits = inside ? within || near : !within && near;
      if (fits && clear(node)) best = { node: index, cost };
    });
  }
  if (best === undefined) return undefined;
  return {
    anchor: graph.nodes[best.node]!,
    meters: reached.lengthM[best.node]!,
  };
}

/**
 * Whether a point stands clear of every building and water polygon. Each
 * polygon's box is worked out once, so most polygons are passed over cheaply.
 */
function standsClear(
  obstacles: readonly MapObstacle[],
): (point: LonLat) => boolean {
  const polygons = obstacles.flatMap((obstacle) =>
    obstacle.polygons.map((rings) => ({
      rings,
      box: paddedBox(rings[0] ?? [], 0),
    })),
  );
  return (point) =>
    !polygons.some(
      ({ rings, box }) => inBox(point, box) && insideRings(point, rings),
    );
}

interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

function paddedBox(ring: readonly LonLat[], meters: number): Box {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of ring) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  const padLat = meters / 111_000;
  const padLon =
    padLat / Math.max(0.01, Math.cos((((south + north) / 2) * Math.PI) / 180));
  return {
    west: west - padLon,
    east: east + padLon,
    south: south - padLat,
    north: north + padLat,
  };
}

function inBox([longitude, latitude]: LonLat, box: Box): boolean {
  return (
    longitude >= box.west &&
    longitude <= box.east &&
    latitude >= box.south &&
    latitude <= box.north
  );
}

function edgeDistance(point: LonLat, rings: AreaRings): number {
  let nearest = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      nearest = Math.min(
        nearest,
        a[0] === b[0] && a[1] === b[1]
          ? distanceM(point, a)
          : projectOnSegment(point, a, b).distanceM,
      );
    }
  }
  return nearest;
}

/**
 * The walk targets among normalized landmarks, as the menu takes them. A line
 * is never a target, and nothing but the `walk_target` group is.
 */
export function outingCandidates(
  landmarks: readonly NormalizedLandmark[],
): OutingCandidate[] {
  return landmarks.flatMap((landmark): OutingCandidate[] =>
    landmark.group !== "walk_target" || landmark.geometry.type === "line"
      ? []
      : [
          {
            id: landmark.id,
            kind: landmark.kind,
            name: landmark.name,
            geometry: landmark.geometry,
          },
        ],
  );
}
