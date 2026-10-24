// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * A picked-up orb's flight, in screen pixels. Within reach an orb lies at
 * most 15 m away, which on the map is a few dozen pixels and ends beneath
 * the picker's body; drawn on the ground, the pick-up would be lost under
 * it. So the flight leaves the ground: the orb hops up, flies a high arc
 * into the picker's chest over everything on the map, and flashes there.
 * Presentation only.
 */

/** How long a picked-up orb hops up before it flies. */
export const ORB_LIFT_MS = 160;

/** How long it then takes to reach whoever picked it up. */
export const ORB_PULL_MS = 520;

/** How long the flash lasts where it arrives. */
export const ORB_BURST_MS = 320;

/** A whole pick-up, from `pulledTo.at` until nothing of it is left. */
export const ORB_COLLECT_MS = ORB_LIFT_MS + ORB_PULL_MS + ORB_BURST_MS;

/** How high the hop lifts the orb off the ground. */
export const ORB_HOP_PX = 22;

/** How many fading beads trail a flying orb. */
export const ORB_TRAIL = 3;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface FlightBead extends ScreenPoint {
  readonly scale: number;
  readonly opacity: number;
}

/** What one orb's flight shows at one moment. */
export interface FlightFrame {
  /** The orb itself, until it arrives. */
  readonly bead?: FlightBead;
  /** The fading beads behind it, nearest first. */
  readonly trail: readonly FlightBead[];
  /** The ring that opens where it arrives. */
  readonly ring?: FlightBead;
}

/**
 * How far along its arc a flying orb is at `t` of the flight: it draws back
 * a hair first, then speeds up, the way a magnet pulls.
 */
export function orbPull(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (1.6 * t - 0.6);
}

function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) * (1 - clamped);
}

/** A point on the arc from `from` to `to` at `s`, bowed up over `control`. */
function onArc(
  from: ScreenPoint,
  control: ScreenPoint,
  to: ScreenPoint,
  s: number,
): ScreenPoint {
  const u = 1 - s;
  return {
    x: u * u * from.x + 2 * u * s * control.x + s * s * to.x,
    y: u * u * from.y + 2 * u * s * control.y + s * s * to.y,
  };
}

/**
 * The flight of an orb that lay at `from` to a picker whose chest is at
 * `to`, `elapsed` milliseconds after it left. `side` (-1 or 1) bows the arc
 * left or right, so orbs leaving together do not fly one path. `undefined`
 * once the flash is over.
 */
export function orbFlightFrame(
  elapsed: number,
  from: ScreenPoint,
  to: ScreenPoint,
  side: number,
): FlightFrame | undefined {
  if (elapsed >= ORB_COLLECT_MS) return undefined;
  if (elapsed < 0) {
    return { bead: { ...from, scale: 1, opacity: 1 }, trail: [] };
  }
  const burst = (elapsed - ORB_LIFT_MS - ORB_PULL_MS) / ORB_BURST_MS;
  if (burst >= 0) {
    return {
      trail: [],
      ring: {
        ...to,
        scale: 0.4 + 2 * easeOut(burst),
        opacity: 0.95 * (1 - burst),
      },
    };
  }
  const lift = easeOut(elapsed / ORB_LIFT_MS);
  const start = { x: from.x, y: from.y - ORB_HOP_PX };
  if (elapsed < ORB_LIFT_MS) {
    return {
      bead: {
        x: from.x,
        y: from.y - ORB_HOP_PX * lift,
        scale: 1 + 0.5 * lift,
        opacity: 1,
      },
      trail: [],
    };
  }
  // A high arc, so even an orb at the picker's feet visibly flies.
  const distance = Math.hypot(to.x - start.x, to.y - start.y);
  const control = {
    x: (start.x + to.x) / 2 + side * 0.3 * distance,
    y: Math.min(start.y, to.y) - 60 - 0.4 * distance,
  };
  const at = (moment: number) => orbPull((moment - ORB_LIFT_MS) / ORB_PULL_MS);
  const s = at(elapsed);
  const scale = 1.5 - 0.8 * Math.max(0, s);
  const trail: FlightBead[] = [];
  for (let step = 1; step <= ORB_TRAIL; step += 1) {
    const behind = at(elapsed - (step * ORB_PULL_MS) / 12);
    if (behind <= 0) break;
    trail.push({
      ...onArc(start, control, to, behind),
      scale: scale * (1 - step * 0.2),
      opacity: 0.6 - step * 0.15,
    });
  }
  return {
    bead: { ...onArc(start, control, to, s), scale, opacity: 1 },
    trail,
  };
}
