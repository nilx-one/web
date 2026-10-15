// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { StatusToastItem } from "@nilx-one/ui";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ERROR_TOAST_MS,
  useErrorToastFeedback,
  useTransientFlag,
} from "./error-toast-feedback";

const error = (id: string): StatusToastItem => ({
  id,
  kind: "error",
  title: id,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useErrorToastFeedback", () => {
  it("is felt and heard once for each error that appears, not for others", () => {
    const impact = vi.fn();
    const cue = vi.fn();
    const { rerender } = renderHook(
      ({ toasts }: { toasts: readonly StatusToastItem[] }) =>
        useErrorToastFeedback(toasts, { impact }, cue),
      { initialProps: { toasts: [] as readonly StatusToastItem[] } },
    );
    expect(impact).not.toHaveBeenCalled();

    rerender({ toasts: [{ id: "saved", kind: "active", title: "Saved" }] });
    expect(impact).not.toHaveBeenCalled();

    rerender({ toasts: [error("too-big")] });
    expect(impact).toHaveBeenCalledOnce();
    expect(impact).toHaveBeenCalledWith("heavy");
    expect(cue).toHaveBeenCalledWith("failure");

    rerender({ toasts: [error("too-big")] });
    expect(impact).toHaveBeenCalledOnce();

    rerender({ toasts: [] });
    rerender({ toasts: [error("too-big")] });
    expect(impact).toHaveBeenCalledTimes(2);
  });

  it("still sounds when the host's feedback throws", () => {
    const cue = vi.fn();
    renderHook(() =>
      useErrorToastFeedback(
        [error("x")],
        {
          impact: () => {
            throw new Error("no haptics");
          },
        },
        cue,
      ),
    );
    expect(cue).toHaveBeenCalledWith("failure");
  });
});

describe("useTransientFlag", () => {
  it("shows a raised flag for three seconds, and again when raised anew", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ raised }: { raised: boolean }) =>
        useTransientFlag(raised, ERROR_TOAST_MS),
      { initialProps: { raised: false } },
    );
    expect(result.current).toBe(false);

    rerender({ raised: true });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(ERROR_TOAST_MS);
    });
    expect(result.current).toBe(false);

    rerender({ raised: false });
    rerender({ raised: true });
    expect(result.current).toBe(true);
  });
});
