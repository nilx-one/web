// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { DockSeat } from "./bond-dock-view-model";

/**
 * Handing the wheel from one identity to the other.
 *
 * The world draws one body: whichever identity is driving. Handing over is
 * therefore not a swap of one model for another at the same instant — one body
 * settles and leaves, the other arrives. `quiesce` and `wake` are the two
 * non-looping clips every published study carries for exactly this, and the
 * ambient sampler deliberately never reaches for them.
 *
 * None of this is shared-world state. Who is at the wheel is presentation: it
 * moves nobody, asserts nothing, and is never written back.
 */
export interface WheelHandover {
  readonly from: DockSeat;
  readonly to: DockSeat;
  readonly startedMs: number;
}

/** The length of `wake` and `quiesce` as the rig builds them. */
export const HANDOVER_CLIP_MS = 1_500;

/** Both halves: one body leaves, then the other arrives. */
export const HANDOVER_MS = HANDOVER_CLIP_MS * 2;

/**
 * The body the world should be drawing. `clipId` is present only while a
 * handover is running: at rest the body takes the ambient rhythm every other
 * body shares, so this says nothing about which clip that is.
 */
export interface WheelBody {
  readonly seat: DockSeat;
  readonly clipId?: "quiesce" | "wake";
  readonly clipPhase?: number;
}

function elapsed(handover: WheelHandover, nowMs: number): number {
  return Math.max(0, nowMs - handover.startedMs);
}

export function wheelBody(
  wheel: DockSeat,
  handover: WheelHandover | undefined,
  nowMs: number,
): WheelBody {
  if (handover === undefined) {
    return { seat: wheel };
  }

  const since = elapsed(handover, nowMs);

  // The first half belongs to the body that is leaving: it is still the one on
  // the world, and it settles before it goes rather than blinking out.
  if (since < HANDOVER_CLIP_MS) {
    return {
      seat: handover.from,
      clipId: "quiesce",
      clipPhase: since / HANDOVER_CLIP_MS,
    };
  }

  if (since < HANDOVER_MS) {
    return {
      seat: handover.to,
      clipId: "wake",
      clipPhase: (since - HANDOVER_CLIP_MS) / HANDOVER_CLIP_MS,
    };
  }

  return { seat: handover.to };
}

export function handoverComplete(
  handover: WheelHandover,
  nowMs: number,
): boolean {
  return elapsed(handover, nowMs) >= HANDOVER_MS;
}
