// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  shellPresentationForWidth,
  useShellPresentation,
} from "./shell-presentation";

function resizeTo(width: number): void {
  window.innerWidth = width;
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("shellPresentationForWidth", () => {
  it.each([
    [1440, "wide"],
    [1024, "wide"],
    [1023, "regular"],
    [600, "regular"],
    [599, "compact"],
    [320, "compact"],
  ])("resolves %ipx as %s", (width, expected) => {
    expect(shellPresentationForWidth(width)).toBe(expected);
  });
});

describe("useShellPresentation", () => {
  it("follows the viewport across the three presentation modes", () => {
    const { result } = renderHook(() => useShellPresentation());

    resizeTo(1280);
    expect(result.current).toBe("wide");

    resizeTo(820);
    expect(result.current).toBe("regular");

    resizeTo(390);
    expect(result.current).toBe("compact");
  });
});
