// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION,
  createBondLocationGeolocation,
  createDeclaredGeolocation,
  type BondLocationMode,
  type GeolocationCapability,
} from "./geolocation";

describe("UNSUPPORTED_GEOLOCATION", () => {
  it("answers the canonical contract instead of forcing a host branch", async () => {
    await expect(UNSUPPORTED_GEOLOCATION.readPermission()).resolves.toBe(
      "unsupported",
    );
    await expect(UNSUPPORTED_GEOLOCATION.requestPosition()).resolves.toEqual({
      kind: "failed",
      reason: "unsupported",
    });
  });

  it("tells a subscriber the capability is absent and stops cleanly", () => {
    const observed = vi.fn();

    const stop = UNSUPPORTED_GEOLOCATION.watchPosition(observed);
    stop();
    stop();

    expect(observed).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      reason: "unsupported",
    });
  });
});

describe("createDeclaredGeolocation", () => {
  it("answers the declared point, marked as declared, without prompting", async () => {
    const declared = createDeclaredGeolocation({
      longitude: 30.563,
      latitude: 50.4265,
    });

    await expect(declared.readPermission()).resolves.toBe("granted");
    const observation = await declared.requestPosition();
    expect(observation).toMatchObject({
      kind: "observed",
      position: {
        longitude: 30.563,
        latitude: 50.4265,
        accuracyMeters: 0,
        declared: true,
      },
    });

    // The point never moves, so a watch has nothing more to say.
    const observed = vi.fn();
    declared.watchPosition(observed)();
    expect(observed).not.toHaveBeenCalled();
  });
});

describe("createBondLocationGeolocation", () => {
  const manual = {
    kind: "manual",
    position: { longitude: 2.3522, latitude: 48.8566 },
  } as const;

  function deviceDouble() {
    const stopDevice = vi.fn();
    const device: GeolocationCapability = {
      readPermission: vi.fn(async () => "granted" as const),
      requestPosition: vi.fn(async () => ({
        kind: "observed" as const,
        position: {
          longitude: 30.5234,
          latitude: 50.4501,
          accuracyMeters: 12,
          observedAt: 1,
        },
      })),
      watchPosition: vi.fn(() => stopDevice),
    };
    return { device, stopDevice };
  }

  it("stands a manual Bond at its declared point and never asks the device", async () => {
    const { device } = deviceDouble();
    const bond = createBondLocationGeolocation({
      device,
      readLocation: async () => manual,
    });

    await expect(bond.readPermission()).resolves.toBe("granted");
    await expect(bond.requestPosition()).resolves.toMatchObject({
      kind: "observed",
      position: { longitude: 2.3522, latitude: 48.8566, declared: true },
    });
    const observed = vi.fn();
    const stop = bond.watchPosition(observed);
    await Promise.resolve();
    await Promise.resolve();
    stop();

    // The watch follows the request that already answered this point.
    expect(observed).not.toHaveBeenCalled();
    expect(device.readPermission).not.toHaveBeenCalled();
    expect(device.requestPosition).not.toHaveBeenCalled();
    expect(device.watchPosition).not.toHaveBeenCalled();
  });

  it("observes the device only while the Bond is live", async () => {
    const { device } = deviceDouble();
    const bond = createBondLocationGeolocation({
      device,
      readLocation: async () => ({ kind: "live" }),
    });

    await expect(bond.requestPosition()).resolves.toMatchObject({
      kind: "observed",
      position: { longitude: 30.5234 },
    });
    expect(device.requestPosition).toHaveBeenCalledOnce();
  });

  it("fails closed while the Bond's location is unknown", async () => {
    const { device } = deviceDouble();
    const bond = createBondLocationGeolocation({
      device,
      readLocation: async () => ({ kind: "unavailable" }),
    });

    await expect(bond.requestPosition()).resolves.toEqual({
      kind: "failed",
      reason: "position-unavailable",
    });
    expect(device.requestPosition).not.toHaveBeenCalled();
  });

  it("stops observing the device once a live Bond's location becomes unknown", async () => {
    vi.useFakeTimers();
    try {
      const { device, stopDevice } = deviceDouble();
      let mode: BondLocationMode = { kind: "live" };
      const bond = createBondLocationGeolocation({
        device,
        readLocation: async () => mode,
        recheckMs: 1_000,
      });
      const stop = bond.watchPosition(vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      expect(device.watchPosition).toHaveBeenCalledOnce();

      mode = { kind: "unavailable" };
      await vi.advanceTimersByTimeAsync(1_000);
      expect(stopDevice).toHaveBeenCalledOnce();

      // Still unknown: nothing restarts.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(device.watchPosition).toHaveBeenCalledOnce();

      // Only a definite live answer observes the device again.
      mode = { kind: "live" };
      await vi.advanceTimersByTimeAsync(1_000);
      expect(device.watchPosition).toHaveBeenCalledTimes(2);

      stop();
      expect(stopDevice).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a running watch between device and declared point as the mode changes", async () => {
    vi.useFakeTimers();
    try {
      const { device, stopDevice } = deviceDouble();
      let mode: BondLocationMode = { kind: "live" };
      const bond = createBondLocationGeolocation({
        device,
        readLocation: async () => mode,
        recheckMs: 1_000,
      });
      const observed = vi.fn();
      const stop = bond.watchPosition(observed);
      await vi.advanceTimersByTimeAsync(0);
      expect(device.watchPosition).toHaveBeenCalledOnce();

      // Declared from another host: the device watch ends, the point arrives.
      mode = manual;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(stopDevice).toHaveBeenCalledOnce();
      expect(observed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          position: expect.objectContaining({ declared: true }),
        }),
      );

      // An unknown read leaves a declared point shown; no device is involved.
      mode = { kind: "unavailable" };
      await vi.advanceTimersByTimeAsync(1_000);
      expect(device.watchPosition).toHaveBeenCalledOnce();

      mode = { kind: "live" };
      await vi.advanceTimersByTimeAsync(1_000);
      expect(device.watchPosition).toHaveBeenCalledTimes(2);

      stop();
      expect(stopDevice).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(device.watchPosition).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
