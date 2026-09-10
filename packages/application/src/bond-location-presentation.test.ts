// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import type { WorldPosition } from "./avaia-movement-controller";
import {
  removeBondLocationOverride,
  resolveBondLocationPresentation,
  setBondLocationOverride,
  type BondLocationOverrides,
} from "./bond-location-presentation";

const observed = { longitude: 30.5234, latitude: 50.4501 } as const;
const presentedElsewhere = { longitude: 2.3522, latitude: 48.8566 } as const;
const target = "0x1friend";
const other = "0x2other";

describe("per-Bond location presentation", () => {
  it("uses the observed position when the counterpart has no override", () => {
    const resolved = resolveBondLocationPresentation(
      other,
      observed,
      new Map(),
    );

    expect(resolved).toEqual({
      counterpartPubDress: other,
      position: observed,
      source: "observed",
    });
  });

  it("replaces the presented position only for the exact counterpart", () => {
    const overrides = setBondLocationOverride(
      new Map(),
      target,
      presentedElsewhere,
    );
    const targetPresentation = resolveBondLocationPresentation(
      target,
      observed,
      overrides,
    );
    const otherPresentation = resolveBondLocationPresentation(
      other,
      observed,
      overrides,
    );

    expect(targetPresentation).toEqual({
      counterpartPubDress: target,
      position: presentedElsewhere,
      source: "override",
    });
    expect(otherPresentation).toEqual({
      counterpartPubDress: other,
      position: observed,
      source: "observed",
    });
  });

  it("can present an override without a device observation", () => {
    const overrides = setBondLocationOverride(
      new Map(),
      target,
      presentedElsewhere,
    );
    const resolved = resolveBondLocationPresentation(
      target,
      undefined,
      overrides,
    );

    expect(resolved).toEqual({
      counterpartPubDress: target,
      position: presentedElsewhere,
      source: "override",
    });
  });

  it(
    "fails closed instead of leaking the observed position from a corrupt override",
    () => {
      const corrupt = new Map<string, WorldPosition>([
        [target, { longitude: Number.NaN, latitude: 48.8566 }],
      ]);
      const resolved = resolveBondLocationPresentation(
        target,
        observed,
        corrupt,
      );

      expect(resolved).toBeUndefined();
    },
  );

  it("fails closed for an invalid counterpart address", () => {
    const resolved = resolveBondLocationPresentation(
      "friend",
      observed,
      new Map(),
    );

    expect(resolved).toBeUndefined();
  });

  it(
    "rejects invalid override configuration before it enters policy state",
    () => {
      const configureInvalidPosition = () => {
        setBondLocationOverride(new Map(), target, {
          longitude: 181,
          latitude: 48.8566,
        });
      };
      const configureInvalidCounterpart = () => {
        setBondLocationOverride(new Map(), "friend", presentedElsewhere);
      };

      expect(configureInvalidPosition).toThrowError(
        "invalid-location-override",
      );
      expect(configureInvalidCounterpart).toThrowError(
        "invalid-counterpart-pub-dress",
      );
    },
  );

  it("updates policy immutably and snapshots caller-owned positions", () => {
    const original: BondLocationOverrides = new Map();
    const mutablePosition = { longitude: 2.3522, latitude: 48.8566 };
    const configured = setBondLocationOverride(
      original,
      target,
      mutablePosition,
    );

    mutablePosition.longitude = -73.9857;

    expect(original.has(target)).toBe(false);
    expect(configured.get(target)).toEqual(presentedElsewhere);

    const removed = removeBondLocationOverride(configured, target);
    expect(configured.has(target)).toBe(true);
    expect(removed.has(target)).toBe(false);
  });
});
