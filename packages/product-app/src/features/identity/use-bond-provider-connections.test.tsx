// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BondProviderAccount } from "@nilx-one/application";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useBondProviderConnections } from "./use-bond-provider-connections";

describe("Bond provider connections", () => {
  it("carries the providers a session attests to", () => {
    const { result } = renderHook(() =>
      useBondProviderConnections([{ provider: "telegram" }]),
    );

    expect(result.current.connections).toEqual([{ provider: "telegram" }]);
  });

  it("never carries two accounts of one provider", () => {
    const attested: readonly BondProviderAccount[] = [
      { provider: "telegram", handle: "zerosky" },
      { provider: "telegram", handle: "othersky" },
    ];

    const { result } = renderHook(() => useBondProviderConnections(attested));

    expect(result.current.connections).toEqual([
      { provider: "telegram", handle: "zerosky" },
    ]);
  });

  it("detaches a provider and keeps it detached", () => {
    const attested: readonly BondProviderAccount[] = [
      { provider: "telegram" },
      { provider: "discord" },
    ];
    const { result, rerender } = renderHook(() =>
      useBondProviderConnections(attested),
    );

    act(() => result.current.disconnect("telegram"));
    rerender();

    expect(result.current.connections).toEqual([{ provider: "discord" }]);

    // Detaching what is no longer attached changes nothing.
    act(() => result.current.disconnect("telegram"));
    rerender();

    expect(result.current.connections).toEqual([{ provider: "discord" }]);
  });
});
