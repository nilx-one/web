// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  HANDOVER_CLIP_MS,
  HANDOVER_MS,
  handoverComplete,
  wheelBody,
  type WheelHandover,
} from "./wheel-handover";

const handover: WheelHandover = {
  from: "avaia",
  to: "bond",
  startedMs: 1_000,
};

describe("the body the wheel is showing", () => {
  it("shows the identity driving, with no clip of its own, at rest", () => {
    expect(wheelBody("avaia", undefined, 0)).toEqual({ seat: "avaia" });
    expect(wheelBody("bond", undefined, 9_999)).toEqual({ seat: "bond" });
  });

  // The body leaving is still the one on the world: it settles before it goes
  // rather than blinking out under the one replacing it.
  it("keeps the leaving body through the first half, settling", () => {
    expect(wheelBody("bond", handover, 1_000)).toEqual({
      seat: "avaia",
      clipId: "quiesce",
      clipPhase: 0,
    });
    expect(wheelBody("bond", handover, 1_000 + HANDOVER_CLIP_MS / 2)).toEqual({
      seat: "avaia",
      clipId: "quiesce",
      clipPhase: 0.5,
    });
  });

  it("brings the arriving body in for the second half, waking", () => {
    expect(wheelBody("bond", handover, 1_000 + HANDOVER_CLIP_MS)).toEqual({
      seat: "bond",
      clipId: "wake",
      clipPhase: 0,
    });
    expect(wheelBody("bond", handover, 1_000 + HANDOVER_CLIP_MS * 1.5)).toEqual(
      { seat: "bond", clipId: "wake", clipPhase: 0.5 },
    );
  });

  // Both halves run start to finish: neither body is cut off part-way.
  it("covers the whole handover without a gap or an overlap", () => {
    const seats = new Set<string>();
    for (let at = 0; at < HANDOVER_MS; at += 50) {
      const body = wheelBody("bond", handover, 1_000 + at);
      expect(body.clipId).toBeDefined();
      expect(body.clipPhase).toBeGreaterThanOrEqual(0);
      expect(body.clipPhase).toBeLessThan(1);
      seats.add(`${body.seat}:${body.clipId}`);
    }
    expect([...seats].sort()).toEqual(["avaia:quiesce", "bond:wake"]);
  });

  it("hands the arrived body back to the ambient rhythm when it is over", () => {
    expect(wheelBody("bond", handover, 1_000 + HANDOVER_MS)).toEqual({
      seat: "bond",
    });
    expect(handoverComplete(handover, 1_000 + HANDOVER_MS - 1)).toBe(false);
    expect(handoverComplete(handover, 1_000 + HANDOVER_MS)).toBe(true);
  });

  // A clock that jumps backwards must not rewind a handover into the past.
  it("treats a time before it started as its beginning", () => {
    expect(wheelBody("bond", handover, 0)).toEqual({
      seat: "avaia",
      clipId: "quiesce",
      clipPhase: 0,
    });
  });
});
