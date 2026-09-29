// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GUIDE_TOAST_FADE_MS,
  GUIDE_TOAST_FLIGHT_MS,
  GuideRewardToasts,
  guideToastLifeMs,
  type GuideRewardToast,
} from "./guide-reward-toasts";

const TOASTS: readonly GuideRewardToast[] = [
  { key: "a", subject: "bond", kind: "xp", text: "+20", index: 0 },
  { key: "b", subject: "bond", kind: "level", text: "0x0sky 1", index: 1 },
  { key: "c", subject: "avaia", kind: "level", text: "x0skai 1", index: 2 },
];

describe("what a scene paid, once it has flown to the corner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("lives 3 s at the top, 3.5 s in the middle and 4 s at the bottom", () => {
    expect([0, 1, 2].map(guideToastLifeMs)).toEqual([3_000, 3_500, 4_000]);
  });

  it("lets each one go in turn, once it has landed and lived", () => {
    const expired: string[] = [];
    render(
      <GuideRewardToasts
        toasts={TOASTS}
        reducedMotion={false}
        onExpire={(key) => expired.push(key)}
      />,
    );
    const after = (ms: number) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };
    after(GUIDE_TOAST_FLIGHT_MS + 3_000 + GUIDE_TOAST_FADE_MS - 1);
    expect(expired).toEqual([]);
    after(1);
    expect(expired).toEqual(["a"]);
    after(500);
    expect(expired).toEqual(["a", "b"]);
    after(500);
    expect(expired).toEqual(["a", "b", "c"]);
  });
});
