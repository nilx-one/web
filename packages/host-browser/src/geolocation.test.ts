// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createBrowserGeolocation } from "./geolocation";

type SuccessCallback = (position: GeolocationPosition) => void;
type ErrorCallback = (error: { readonly code: number }) => void;

function position(overrides: Partial<GeolocationCoordinates> = {}) {
  return {
    coords: {
      longitude: 30.5234,
      latitude: 50.4501,
      accuracy: 24,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
      ...overrides,
    },
    timestamp: 1_700_000_000_000,
    toJSON: () => ({}),
  } as GeolocationPosition;
}

function permissions(state: string): Permissions {
  return {
    query: vi.fn(async () => ({ state }) as PermissionStatus),
  } as unknown as Permissions;
}

describe("createBrowserGeolocation permission inspection", () => {
  it("reports unsupported when the browser publishes no provider", async () => {
    const capability = createBrowserGeolocation({ isSecureContext: true });

    await expect(capability.readPermission()).resolves.toBe("unsupported");
  });

  it("reports unsupported outside a secure context", async () => {
    const capability = createBrowserGeolocation({
      geolocation: {} as Geolocation,
      isSecureContext: false,
    });

    await expect(capability.readPermission()).resolves.toBe("unsupported");
  });

  it.each(["granted", "denied", "prompt"] as const)(
    "reads %s from the Permissions API without prompting",
    async (state) => {
      const getCurrentPosition = vi.fn();
      const capability = createBrowserGeolocation({
        geolocation: { getCurrentPosition } as unknown as Geolocation,
        permissions: permissions(state),
        isSecureContext: true,
      });

      await expect(capability.readPermission()).resolves.toBe(state);
      expect(getCurrentPosition).not.toHaveBeenCalled();
    },
  );

  it("treats a browser without the Permissions API as promptable", async () => {
    const capability = createBrowserGeolocation({
      geolocation: {} as Geolocation,
      isSecureContext: true,
    });

    await expect(capability.readPermission()).resolves.toBe("prompt");
  });

  it("treats a rejected geolocation descriptor as promptable, not denied", async () => {
    const capability = createBrowserGeolocation({
      geolocation: {} as Geolocation,
      permissions: {
        query: vi.fn(async () => {
          throw new TypeError("unsupported permission descriptor");
        }),
      } as unknown as Permissions,
      isSecureContext: true,
    });

    await expect(capability.readPermission()).resolves.toBe("prompt");
  });
});

describe("createBrowserGeolocation acquisition", () => {
  it("projects a browser position onto the canonical observation", async () => {
    const capability = createBrowserGeolocation({
      geolocation: {
        getCurrentPosition: (success: SuccessCallback) => success(position()),
      } as unknown as Geolocation,
      isSecureContext: true,
    });

    await expect(capability.requestPosition()).resolves.toEqual({
      kind: "observed",
      position: {
        longitude: 30.5234,
        latitude: 50.4501,
        accuracyMeters: 24,
        observedAt: 1_700_000_000_000,
      },
    });
  });

  it("forwards the request policy to the provider", async () => {
    const getCurrentPosition = vi.fn(
      (
        success: SuccessCallback,
        _error?: ErrorCallback,
        _options?: PositionOptions,
      ) => success(position()),
    );
    const capability = createBrowserGeolocation({
      geolocation: { getCurrentPosition } as unknown as Geolocation,
      isSecureContext: true,
    });

    await capability.requestPosition({
      timeoutMs: 4_000,
      maximumAgeMs: 1_000,
      highAccuracy: true,
    });

    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 4_000,
      maximumAge: 1_000,
    });
  });

  it.each([
    [1, "permission-denied"],
    [2, "position-unavailable"],
    [3, "timeout"],
    [99, "host-failed"],
  ] as const)("maps provider code %i to %s", async (code, reason) => {
    const capability = createBrowserGeolocation({
      geolocation: {
        getCurrentPosition: (_success: SuccessCallback, fail: ErrorCallback) =>
          fail({ code }),
      } as unknown as Geolocation,
      isSecureContext: true,
    });

    await expect(capability.requestPosition()).resolves.toEqual({
      kind: "failed",
      reason,
    });
  });

  it("answers unsupported instead of throwing when no provider exists", async () => {
    const capability = createBrowserGeolocation({ isSecureContext: true });

    await expect(capability.requestPosition()).resolves.toEqual({
      kind: "failed",
      reason: "unsupported",
    });
  });

  it("reports a Permissions Policy violation as a denial, not a crash", async () => {
    const capability = createBrowserGeolocation({
      geolocation: {
        getCurrentPosition: () => {
          throw new Error("geolocation is disabled by permissions policy");
        },
      } as unknown as Geolocation,
      isSecureContext: true,
    });

    await expect(capability.requestPosition()).resolves.toEqual({
      kind: "failed",
      reason: "permission-denied",
    });
  });
});

describe("createBrowserGeolocation live updates", () => {
  it("publishes updates and stops deterministically", () => {
    let publish: SuccessCallback | undefined;
    const clearWatch = vi.fn();
    const capability = createBrowserGeolocation({
      geolocation: {
        watchPosition: (success: SuccessCallback) => {
          publish = success;
          return 7;
        },
        clearWatch,
      } as unknown as Geolocation,
      isSecureContext: true,
    });
    const observed = vi.fn();

    const stop = capability.watchPosition(observed);
    publish?.(position());
    stop();
    publish?.(position({ latitude: 50.46 }));
    stop();

    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalledWith({
      kind: "observed",
      position: {
        longitude: 30.5234,
        latitude: 50.4501,
        accuracyMeters: 24,
        observedAt: 1_700_000_000_000,
      },
    });
    expect(clearWatch).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("publishes a semantic failure while a watch is live", () => {
    let fail: ErrorCallback | undefined;
    const capability = createBrowserGeolocation({
      geolocation: {
        watchPosition: (_success: SuccessCallback, error: ErrorCallback) => {
          fail = error;
          return 1;
        },
        clearWatch: vi.fn(),
      } as unknown as Geolocation,
      isSecureContext: true,
    });
    const observed = vi.fn();

    capability.watchPosition(observed);
    fail?.({ code: 3 });

    expect(observed).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      reason: "timeout",
    });
  });

  it("answers unsupported through the observer when no provider exists", () => {
    const capability = createBrowserGeolocation({ isSecureContext: true });
    const observed = vi.fn();

    const stop = capability.watchPosition(observed);
    stop();

    expect(observed).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      reason: "unsupported",
    });
  });
});
