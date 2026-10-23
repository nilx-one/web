// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CoreRuntimePort,
  SubscriptionStatusPort,
  SubscriptionStatus,
} from "@nilx-one/application";
import {
  SubscriptionStatusProvider,
  SubscriptionIdentity,
} from "./subscription-status";

afterEach(() => vi.useRealTimers());
const activeBadges = (name: string) =>
  screen
    .queryAllByText(name)
    .filter((element) => element.getAttribute("aria-hidden") === "false");
const active = (
  tier: "exclusive" | "special" = "exclusive",
): SubscriptionStatus => ({
  kind: "active",
  bond_pub_dress: "0x0sky",
  tier,
  valid_until_ms: String(Date.now() + 60_000),
});
function setup() {
  let invalidate = () => {};
  const source: SubscriptionStatusPort = {
    read: vi.fn(async () => null),
    subscribe: vi.fn((_owner, listener) => {
      invalidate = listener;
      return vi.fn();
    }),
  };
  const resolve = vi.fn(async (): Promise<SubscriptionStatus> => active());
  const core = { subscriptionStatus: resolve } as unknown as CoreRuntimePort;
  const view = (
    owner = "0x0sky",
    avaia = "avaia-one",
    service: SubscriptionStatusPort | undefined = source,
  ) => (
    <SubscriptionStatusProvider
      owner={owner}
      avaia={avaia}
      core={core}
      source={service}
    >
      <SubscriptionIdentity address="0x0sky" badge />
      <SubscriptionIdentity address="avaia-one" badge />
      <SubscriptionIdentity address="0x1other" badge />
    </SubscriptionStatusProvider>
  );
  return { source, resolve, view, invalidate: () => invalidate() };
}
describe("one subscription status across surfaces", () => {
  it("styles only the owner and its associated Avaia, updates downgrade and revocation together", async () => {
    const s = setup();
    render(s.view());
    await waitFor(() => expect(activeBadges("Exclusive")).toHaveLength(2));
    expect(screen.getByText("0x1other")).not.toHaveAttribute("data-tier");
    s.resolve.mockResolvedValue(active("special"));
    act(s.invalidate);
    await waitFor(() => expect(activeBadges("Special")).toHaveLength(2));
    expect(activeBadges("Exclusive")).toHaveLength(0);
    s.resolve.mockResolvedValue({
      kind: "none",
      valid_until_ms: String(Date.now() + 60_000),
    });
    act(s.invalidate);
    await waitFor(() => expect(activeBadges("Special")).toHaveLength(0));
  });
  it("clears failed reads and ignores late responses after owner changes", async () => {
    const s = setup();
    const r = render(s.view());
    await waitFor(() => expect(activeBadges("Exclusive")).toHaveLength(2));
    let finish!: (status: SubscriptionStatus) => void;
    s.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(s.invalidate);
    await waitFor(() => expect(s.resolve).toHaveBeenCalledTimes(2));
    r.rerender(s.view("0x1other"));
    await act(async () => {
      finish(active());
    });
    expect(activeBadges("Exclusive")).toHaveLength(0);
    vi.mocked(s.source.read).mockRejectedValue(new Error("offline"));
    act(s.invalidate);
    expect(activeBadges("Exclusive")).toHaveLength(0);
  });
  it("clears a removed Avaia association immediately", async () => {
    const s = setup();
    const r = render(s.view());
    await waitFor(() => expect(activeBadges("Exclusive")).toHaveLength(2));
    r.rerender(s.view("0x0sky", "avaia-two"));
    expect(activeBadges("Exclusive")).toHaveLength(1);
    expect(screen.getByText("avaia-one")).not.toHaveAttribute("data-tier");
  });
  it("removes styling at the deadline while the next authority read is pending", async () => {
    vi.useFakeTimers();
    const s = setup();
    render(s.view());
    await act(async () => {
      await Promise.resolve();
    });
    expect(activeBadges("Exclusive")).toHaveLength(2);
    vi.mocked(s.source.read).mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(activeBadges("Exclusive")).toHaveLength(0);
  });
  it("keeps the address and its badge in separate layout nodes", async () => {
    const s = setup();
    const { container } = render(s.view());
    await waitFor(() => expect(activeBadges("Exclusive")).toHaveLength(2));
    const own = container.querySelector<HTMLElement>(
      '.subscription-identity[data-tier="exclusive"]',
    );
    if (own === null) throw new Error("Missing subscribed identity");
    expect(own.querySelector(".subscription-identity__address")).toHaveTextContent(
      "0x0sky",
    );
    expect(own.querySelector(".subscription-badges")).toContainElement(
      own.querySelector('[data-level="exclusive"]'),
    );
    expect(
      own.querySelector(".subscription-identity__address"),
    ).not.toContainElement(own.querySelector(".subscription-badges"));
  });

  it("does not fabricate a subscription without an authority adapter", () => {
    render(
      <SubscriptionStatusProvider owner="0x0sky" core={{} as CoreRuntimePort}>
        <SubscriptionIdentity address="0x0sky" badge />
      </SubscriptionStatusProvider>,
    );
    expect(screen.getByText("0x0sky")).not.toHaveAttribute("data-tier");
  });
});
