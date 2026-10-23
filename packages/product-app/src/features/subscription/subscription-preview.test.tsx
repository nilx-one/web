// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CoreRuntimePort } from "@nilx-one/application";
import {
  SubscriptionIdentity,
  SubscriptionStatusProvider,
} from "./subscription-status";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const core = {} as CoreRuntimePort;
const identity = (address: string) =>
  screen.getByText(address).closest(".subscription-identity");
const view = (owner = "0x0sky", avaia = "xSky") => (
  <SubscriptionStatusProvider
    owner={owner}
    avaia={avaia}
    core={core}
    previewCycle
  >
    <SubscriptionIdentity address="0x0sky" />
    <SubscriptionIdentity address="xSky" />
    <SubscriptionIdentity address="0x1other" />
  </SubscriptionStatusProvider>
);

it("repeats three minute-long phases for only the owner and associated Avaia", () => {
  vi.useFakeTimers();
  render(view());
  const bond = identity("0x0sky");
  const avaia = identity("xSky");
  for (let cycle = 0; cycle < 3; cycle++) {
    expect(bond).toHaveAttribute("data-tier", "special");
    expect(avaia).toHaveAttribute("data-tier", "special");
    act(() => vi.advanceTimersByTime(59_999));
    expect(bond).toHaveAttribute("data-tier", "special");
    act(() => vi.advanceTimersByTime(1));
    expect(bond).toHaveAttribute("data-tier", "exclusive");
    expect(avaia).toHaveAttribute("data-tier", "exclusive");
    act(() => vi.advanceTimersByTime(60_000));
    expect(bond).not.toHaveAttribute("data-tier");
    expect(avaia).not.toHaveAttribute("data-tier");
    act(() => vi.advanceTimersByTime(60_000));
  }
  expect(identity("0x1other")).not.toHaveAttribute("data-tier");
});

it("catches up on foreground and stops on owner replacement or unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const result = render(view());
  vi.setSystemTime(240_000);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(identity("0x0sky")).toHaveAttribute("data-tier", "exclusive");
  result.rerender(view("0x1other"));
  expect(identity("0x0sky")).not.toHaveAttribute("data-tier");
  expect(identity("xSky")).not.toHaveAttribute("data-tier");
  expect(identity("0x1other")).not.toHaveAttribute("data-tier");
  expect(vi.getTimerCount()).toBe(0);
  result.rerender(view());
  expect(identity("0x0sky")).toHaveAttribute("data-tier", "special");
  result.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
