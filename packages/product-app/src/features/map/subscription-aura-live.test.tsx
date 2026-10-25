// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreRuntimePort,
  SubscriptionStatusPort,
} from "@nilx-one/application";
import type { AvatarHandle } from "@nilx-one/map-contract";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  createGeolocationDouble,
  createMapRendererDouble,
  observation,
} from "../../../../../tests/support/doubles";
import { createAvatarChoiceViewState } from "../identity/avatar-choice-view-model";
import { SubscriptionStatusProvider } from "../subscription/subscription-status";
import { AuthenticatedMapHomeView } from "./authenticated-map-home-view";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("updates visible and cached bodies on every tier change without zooming or reloading the world", async () => {
  const renderer = createMapRendererDouble({ kind: "ready" });
  const geolocation = createGeolocationDouble({ position: observation() });
  let tier: "exclusive" | "special" | undefined = "exclusive";
  let invalidate: (() => void) | undefined;
  const source: SubscriptionStatusPort = {
    read: async () => {
      const now = Date.now();
      return {
        bond_pub_dress: "0x0sky",
        checked_at_ms: String(now),
        refresh_after_ms: String(now + 3_600_000),
        entitlement:
          tier === undefined
            ? null
            : {
                tier,
                starts_at_ms: String(now - 1_000),
                expires_at_ms: String(now + 3_600_000),
              },
      };
    },
    subscribe: (_owner, listener) => {
      invalidate = listener;
      return () => {
        invalidate = undefined;
      };
    },
  };
  const core = {
    subscriptionStatus: async () => {
      const valid_until_ms = String(Date.now() + 3_600_000);
      return tier === undefined
        ? { kind: "none" as const, valid_until_ms }
        : {
            kind: "active" as const,
            bond_pub_dress: "0x0sky",
            tier,
            valid_until_ms,
          };
    },
  } as unknown as CoreRuntimePort;

  render(
    <SubscriptionStatusProvider
      owner="0x0sky"
      avaia="x0skai"
      core={core}
      source={source}
    >
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        avaiaPubDress="x0skai"
        renderer={renderer}
        geolocation={geolocation}
        avatarChoice={createAvatarChoiceViewState("sky-study", undefined)}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />
    </SubscriptionStatusProvider>,
  );

  const lastBody = (id: string): AvatarHandle | undefined =>
    vi
      .mocked(renderer.avatars!.upsert)
      .mock.calls.map(([handle]) => handle)
      .findLast((handle) => handle.id === id);

  await vi.waitFor(() =>
    expect(lastBody("avaia")?.subscriptionAura).toBe("exclusive"),
  );

  // Both studies may stay cached while the wheel changes. Neither should
  // retain the previous paid tier when it is not currently visible.
  fireEvent.click(
    screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
  );
  await vi.waitFor(() => expect(lastBody("bond")).toBeDefined());

  async function switchTier(next: typeof tier): Promise<void> {
    await act(async () => {
      tier = next;
      expect(invalidate).toBeDefined();
      invalidate!();
    });
    await vi.waitFor(() => {
      expect(lastBody("bond")?.subscriptionAura).toBe(next);
      expect(lastBody("avaia")?.subscriptionAura).toBe(next);
    });
  }

  await switchTier("special");
  await switchTier(undefined);
  await switchTier("exclusive");
  await switchTier("special");

  // No camera zoom-out or model remount is needed for a valid tier update.
  expect(renderer.mount).toHaveBeenCalledTimes(1);
  expect(renderer.unmount).not.toHaveBeenCalled();
});
