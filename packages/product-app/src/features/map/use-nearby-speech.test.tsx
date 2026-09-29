// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  NearbySpeechAccessPort,
  SpokenLineView,
} from "@nilx-one/application";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SPEECH_FRESH_SECONDS,
  SPEECH_POLL_MS,
  SPEECH_SHOWN_MS,
  admitSpeech,
  speechToast,
  useNearbySpeech,
} from "./use-nearby-speech";

const NOW_SECONDS = 1_800_000_000;

function line(
  digit: string,
  spokenAt = NOW_SECONDS,
  speaker = "0x0sky",
  text = "привіт",
): SpokenLineView {
  return { id: `line_${digit.repeat(64)}`, speaker, text, spokenAt };
}

describe("admitSpeech", () => {
  it("admits a fresh line once and only once", () => {
    const seen = new Set<string>();
    const first = admitSpeech([line("a")], seen, NOW_SECONDS);
    const second = admitSpeech([line("a")], seen, NOW_SECONDS + 5);
    expect(first).toEqual([line("a")]);
    expect(second).toEqual([]);
  });

  it("treats a line older than the fresh window as history and never reconsiders it", () => {
    const seen = new Set<string>();
    const old = line("b", NOW_SECONDS - SPEECH_FRESH_SECONDS - 1);
    expect(admitSpeech([old], seen, NOW_SECONDS)).toEqual([]);
    expect(seen.has(old.id)).toBe(true);
    // Even if the clock were to move back, a dropped line stays dropped.
    expect(admitSpeech([old], seen, NOW_SECONDS - 100)).toEqual([]);
  });

  it("keeps the order it was given and bounds what it remembers", () => {
    const seen = new Set<string>();
    const admitted = admitSpeech(
      [line("a"), line("b"), line("c")],
      seen,
      NOW_SECONDS,
    );
    expect(admitted.map((item) => item.id[5])).toEqual(["a", "b", "c"]);

    const many = Array.from({ length: 300 }, (_, index) => ({
      ...line("d"),
      id: `line_${index.toString(16).padStart(64, "0")}`,
    }));
    admitSpeech(many, seen, NOW_SECONDS);
    expect(seen.size).toBeLessThanOrEqual(200);
  });
});

describe("speechToast", () => {
  it("says the speaker first, then the words, keyed by the line", () => {
    expect(speechToast(line("a", NOW_SECONDS, "0xfrSb", "я тут"))).toEqual({
      id: line("a").id,
      kind: "active",
      title: "0xfrSb",
      description: "я тут",
    });
  });
});

describe("useNearbySpeech", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function portReturning(
    ...answers: (readonly SpokenLineView[] | undefined | Error)[]
  ): NearbySpeechAccessPort & { readonly reads: () => number } {
    let reads = 0;
    return {
      reads: () => reads,
      readNearbySpeech: () => {
        const answer = answers[Math.min(reads, answers.length - 1)];
        reads += 1;
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      },
    };
  }

  const clock = () => NOW_SECONDS * 1000;

  it("does nothing when the host offers no speech", async () => {
    const { result } = renderHook(() => useNearbySpeech({ now: clock }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_POLL_MS * 3);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("shows a heard line, fades it on its own, and never shows it twice", async () => {
    const port = portReturning([line("a")]);
    const { result } = renderHook(() => useNearbySpeech({ port, now: clock }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.toasts.map((toast) => toast.title)).toEqual([
      "0x0sky",
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_SHOWN_MS);
    });
    expect(result.current.toasts).toEqual([]);
    expect(port.reads()).toBeGreaterThan(1);
    // The service keeps answering with the same line; it must not come back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_POLL_MS * 3);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("lets a person dismiss a line before it fades", async () => {
    const port = portReturning([
      line("a"),
      line("b", NOW_SECONDS, "0xfrSb", "і я"),
    ]);
    const { result } = renderHook(() => useNearbySpeech({ port, now: clock }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.toasts).toHaveLength(2);
    act(() => result.current.dismiss(line("a").id));
    expect(result.current.toasts.map((toast) => toast.title)).toEqual([
      "0xfrSb",
    ]);
  });

  it("stays silent through failures and keeps listening", async () => {
    const port = portReturning(undefined, new Error("offline"), [line("c")]);
    const { result } = renderHook(() => useNearbySpeech({ port, now: clock }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.toasts).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_POLL_MS * 2);
    });
    expect(result.current.toasts.map((toast) => toast.description)).toEqual([
      "привіт",
    ]);
  });

  it("does not replay history when the world opens", async () => {
    const port = portReturning([line("a", NOW_SECONDS - 300)]);
    const { result } = renderHook(() => useNearbySpeech({ port, now: clock }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("stops asking when the world goes away", async () => {
    const port = portReturning([]);
    const { unmount } = renderHook(() => useNearbySpeech({ port, now: clock }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const before = port.reads();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_POLL_MS * 5);
    });
    expect(port.reads()).toBe(before);
  });

  it("does not ask while the page is hidden", async () => {
    const port = portReturning([]);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    renderHook(() => useNearbySpeech({ port, now: clock }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_POLL_MS * 3);
    });
    expect(port.reads()).toBe(0);
    visibility.mockReturnValue("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEECH_POLL_MS);
    });
    expect(port.reads()).toBeGreaterThan(0);
    visibility.mockRestore();
  });
});
