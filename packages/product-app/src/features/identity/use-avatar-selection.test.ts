// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { forgetAvatarChoices } from "./avatar-wardrobe-store";
import {
  useAvatarSelection,
  useCommitAvatarSelection,
} from "./use-avatar-selection";

beforeEach(() => {
  window.localStorage.clear();
  forgetAvatarChoices();
});

describe("useAvatarSelection", () => {
  it("falls back to the given default while nothing has been chosen", () => {
    const { result } = renderHook(() =>
      useAvatarSelection("0skai", "sky-study"),
    );

    expect(result.current?.modelId).toBe("sky-study");
  });

  it("answers nothing when there is neither a default nor a stored choice", () => {
    const { result } = renderHook(() => useAvatarSelection("0skai", undefined));

    expect(result.current).toBeUndefined();
  });

  // The regression this hook exists to prevent: a body actually chosen and
  // remembered for this address must survive being handed a non-undefined
  // fallback on every subsequent render — that fallback is a default, not an
  // authority, and it must not silently outrank a real choice.
  it("prefers a remembered choice over the default it was handed", () => {
    const commit = renderHook(() => useCommitAvatarSelection());
    act(() =>
      commit.result.current({
        subject: "avaia",
        address: "0skai",
        selection: { modelId: "kai-study", appearance: {} },
        modelIsLocal: true,
      }),
    );

    // The same deterministic default this address would ambiently get is
    // still handed in on every render — the point is that it must lose.
    const { result } = renderHook(() =>
      useAvatarSelection("0skai", "sky-study"),
    );

    expect(result.current?.modelId).toBe("kai-study");
  });

  it("ignores a stored model this client no longer publishes", () => {
    const commit = renderHook(() => useCommitAvatarSelection());
    act(() =>
      commit.result.current({
        subject: "avaia",
        address: "0skai",
        selection: {
          // @ts-expect-error — simulating a model an older client stored.
          modelId: "retired-study",
          appearance: {},
        },
        modelIsLocal: true,
      }),
    );

    const { result } = renderHook(() =>
      useAvatarSelection("0skai", "sky-study"),
    );

    expect(result.current?.modelId).toBe("sky-study");
  });

  it("keeps each address's remembered choice separate", () => {
    const commit = renderHook(() => useCommitAvatarSelection());
    act(() =>
      commit.result.current({
        subject: "avaia",
        address: "0skai",
        selection: { modelId: "kai-study", appearance: {} },
        modelIsLocal: true,
      }),
    );

    const { result } = renderHook(() =>
      useAvatarSelection("0other-ai", "dasha-study"),
    );

    expect(result.current?.modelId).toBe("dasha-study");
  });
});

describe("useCommitAvatarSelection", () => {
  it("never writes a model for a subject whose body the service owns", () => {
    const commit = renderHook(() => useCommitAvatarSelection());
    act(() =>
      commit.result.current({
        subject: "bond",
        address: "0x0sky",
        selection: { modelId: "dasha-study", appearance: {} },
        modelIsLocal: false,
      }),
    );

    // Nothing local was ever asked for this address, so nothing is remembered
    // for it — the service's own value is what would answer instead.
    const { result } = renderHook(() =>
      useAvatarSelection("0x0sky", undefined),
    );
    expect(result.current).toBeUndefined();
  });

  it("switches which body is chosen without losing the choice on a later read", () => {
    const commit = renderHook(() => useCommitAvatarSelection());
    act(() =>
      commit.result.current({
        subject: "avaia",
        address: "0skai",
        selection: { modelId: "dasha-v2-study", appearance: {} },
        modelIsLocal: true,
      }),
    );
    act(() =>
      commit.result.current({
        subject: "avaia",
        address: "0skai",
        selection: { modelId: "kai-study", appearance: {} },
        modelIsLocal: true,
      }),
    );

    // A later, independent read of the same address — the shape every screen
    // that draws this Avaia actually does — answers with the newer choice.
    const { result } = renderHook(() =>
      useAvatarSelection("0skai", "sky-study"),
    );
    expect(result.current?.modelId).toBe("kai-study");
  });
});
