// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCapability } from "@nilx-one/host-contract";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseSoundPreference,
  readSoundPreference,
  SOUND_STORAGE_KEY,
  useSoundCue,
  useSoundPreferenceSync,
} from "./sound-preference";

function soundDouble() {
  return {
    supported: true,
    play: vi.fn(),
    setEnabled: vi.fn(),
    setAmbience: vi.fn(),
  } satisfies SoundCapability;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("how much this device sounds", () => {
  it("plays effects until someone says otherwise", () => {
    expect(readSoundPreference()).toBe("cues");
  });

  it("is kept on this device under its own key", () => {
    chooseSoundPreference("all");
    expect(readSoundPreference()).toBe("all");
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe("all");
  });

  it("ignores a stored value it does not know", () => {
    window.localStorage.setItem(SOUND_STORAGE_KEY, "loud");
    expect(readSoundPreference()).toBe("cues");
  });

  it("keeps the host in step with the choice", () => {
    const sound = soundDouble();
    renderHook(() => useSoundPreferenceSync(sound));
    expect(sound.setEnabled).toHaveBeenLastCalledWith(true);

    act(() => chooseSoundPreference("off"));
    expect(sound.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("never lets a cue throw into whatever triggered it", () => {
    const sound = {
      ...soundDouble(),
      play: vi.fn(() => {
        throw new Error("refused");
      }),
    };
    const { result } = renderHook(() => useSoundCue(sound));
    expect(() => result.current("tap")).not.toThrow();
    const { result: none } = renderHook(() => useSoundCue(undefined));
    expect(() => none.current("tap")).not.toThrow();
  });
});
