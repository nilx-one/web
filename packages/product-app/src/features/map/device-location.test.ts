// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  GeolocationCapability,
  GeolocationObservation,
  GeolocationObserver,
  GeolocationPermission,
} from "@nilx-one/host-contract";
import { describe, expect, it, vi } from "vitest";

import { observation } from "../../../../../tests/support/doubles";
import {
  createDeviceLocationController,
  type DeviceLocationState,
} from "./device-location";

interface Harness {
  readonly capability: GeolocationCapability;
  readonly requests: () => number;
  readonly watchers: () => number;
  readonly stops: () => number;
  publish(next: GeolocationObservation): void;
}

function harness(
  permission: GeolocationPermission,
  answers: readonly GeolocationObservation[],
): Harness {
  const observers = new Set<GeolocationObserver>();
  let requests = 0;
  let stops = 0;

  return {
    capability: {
      readPermission: async () => permission,
      requestPosition: async () => {
        const answer = answers[Math.min(requests, answers.length - 1)];
        requests += 1;
        return answer ?? { kind: "failed", reason: "position-unavailable" };
      },
      watchPosition: (observer) => {
        observers.add(observer);
        return () => {
          stops += 1;
          observers.delete(observer);
        };
      },
    },
    requests: () => requests,
    watchers: () => observers.size,
    stops: () => stops,
    publish(next) {
      for (const observer of [...observers]) {
        observer(next);
      }
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function states(controller: {
  subscribe(listener: (state: DeviceLocationState) => void): () => void;
}): DeviceLocationState[] {
  const seen: DeviceLocationState[] = [];
  controller.subscribe((state) => seen.push(state));
  return seen;
}

describe("device location lifecycle", () => {
  it("asks nothing before the world activates it", async () => {
    const context = harness("granted", [
      { kind: "observed", position: observation() },
    ]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    await settle();

    expect(controller.getState()).toEqual({ kind: "idle" });
    expect(context.requests()).toBe(0);
    expect(context.watchers()).toBe(0);
  });

  it("acquires and watches immediately when permission is already granted", async () => {
    const position = observation();
    const context = harness("granted", [{ kind: "observed", position }]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });
    const seen = states(controller);

    controller.activate();
    await settle();

    expect(seen.map((state) => state.kind)).toEqual([
      "checking-permission",
      "locating",
      "active",
    ]);
    expect(controller.getState()).toEqual({ kind: "active", position });
    expect(context.watchers()).toBe(1);
  });

  it("asks once for a promptable host and never again on its own", async () => {
    const context = harness("prompt", [
      { kind: "failed", reason: "permission-denied" },
    ]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    controller.activate();
    controller.activate();
    await settle();

    // A blocked automatic prompt keeps the explicit control as the way back
    // rather than burning the permission this session.
    expect(controller.getState()).toEqual({ kind: "permission-required" });
    expect(context.requests()).toBe(1);
  });

  it("never reprompts a denied permission", async () => {
    const context = harness("denied", []);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    controller.activate();
    await settle();

    expect(controller.getState()).toEqual({ kind: "denied" });
    expect(context.requests()).toBe(0);
  });

  it("reports an unsupported host without asking", async () => {
    const context = harness("unsupported", []);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();

    expect(controller.getState()).toEqual({ kind: "unsupported" });
    expect(context.requests()).toBe(0);
  });

  it("treats an explicit gesture denial as a denial", async () => {
    const context = harness("prompt", [
      { kind: "failed", reason: "permission-denied" },
    ]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.requestFromGesture();
    await settle();

    expect(controller.getState()).toEqual({ kind: "denied" });
  });

  it("retries from a user gesture after an automatic attempt was blocked", async () => {
    const position = observation();
    const context = harness("prompt", [
      { kind: "failed", reason: "permission-denied" },
      { kind: "observed", position },
    ]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    controller.requestFromGesture();
    await settle();

    expect(controller.getState()).toEqual({ kind: "active", position });
    expect(context.requests()).toBe(2);
    expect(context.watchers()).toBe(1);
  });

  it("publishes live updates without restarting the watcher", async () => {
    const position = observation();
    const context = harness("granted", [{ kind: "observed", position }]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    const moved = observation({ latitude: 50.4512, accuracyMeters: 11 });
    context.publish({ kind: "observed", position: moved });

    expect(controller.getState()).toEqual({ kind: "active", position: moved });
    expect(context.watchers()).toBe(1);
    expect(context.stops()).toBe(0);
  });

  it("keeps the last observation through a transient failure", async () => {
    const position = observation();
    const context = harness("granted", [{ kind: "observed", position }]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    context.publish({ kind: "failed", reason: "timeout" });

    expect(controller.getState()).toEqual({
      kind: "unavailable",
      reason: "timeout",
      position,
    });
    // A timeout is not a decision about permission, and it does not end the
    // live subscription.
    expect(context.watchers()).toBe(1);
  });

  it("ends live observation when permission is revoked mid-watch", async () => {
    const context = harness("granted", [
      { kind: "observed", position: observation() },
    ]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    context.publish({ kind: "failed", reason: "permission-denied" });

    expect(controller.getState()).toEqual({ kind: "permission-required" });
    expect(context.watchers()).toBe(0);
    expect(context.stops()).toBe(1);
  });

  it("stops the watcher and clears the observation on world unmount", async () => {
    const context = harness("granted", [
      { kind: "observed", position: observation() },
    ]);
    const controller = createDeviceLocationController({
      geolocation: context.capability,
    });

    controller.activate();
    await settle();
    controller.stop();

    expect(controller.getState()).toEqual({ kind: "idle" });
    expect(context.watchers()).toBe(0);
    expect(context.stops()).toBe(1);
  });

  it("discards an answer that arrives after the world stopped", async () => {
    let resolve: ((value: GeolocationObservation) => void) | undefined;
    const capability: GeolocationCapability = {
      readPermission: async () => "granted",
      requestPosition: () =>
        new Promise<GeolocationObservation>((settleRequest) => {
          resolve = settleRequest;
        }),
      watchPosition: vi.fn(() => () => undefined),
    };
    const controller = createDeviceLocationController({
      geolocation: capability,
    });

    controller.activate();
    await settle();
    controller.stop();
    resolve?.({ kind: "observed", position: observation() });
    await settle();

    expect(controller.getState()).toEqual({ kind: "idle" });
    expect(capability.watchPosition).not.toHaveBeenCalled();
  });
});
