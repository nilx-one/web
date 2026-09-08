// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MovementState, WorldPosition } from "@nilx-one/application";
import { MAP_SCALE_ZOOM, sampleAmbientAvatar } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { avatarSeed } from "./avatar-presence";
import {
  AVAIA_HANDLE_ID,
  avaiaStandpoint,
  avaiaStudy,
  createAvaiaAvatarHandle,
  headingDegrees,
} from "./avaia-presence";

const BOND: WorldPosition = { longitude: 30.5234, latitude: 50.4501 };

const EARTH_RADIUS_METERS = 6_371_008.8;

function metersApart(from: WorldPosition, to: WorldPosition): number {
  const toRadians = Math.PI / 180;
  const lat1 = from.latitude * toRadians;
  const lat2 = to.latitude * toRadians;
  const dLat = (to.latitude - from.latitude) * toRadians;
  const dLon = (to.longitude - from.longitude) * toRadians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function moving(target: WorldPosition): MovementState {
  return { kind: "moving", position: BOND, target };
}

describe("where an Avaia stands", () => {
  it("keeps to its Bond's side rather than standing inside it", () => {
    const standpoint = avaiaStandpoint(BOND, "0x0sky.avaia");

    expect(metersApart(BOND, standpoint)).toBeCloseTo(3, 1);
  });

  it("keeps the same side between observations", () => {
    expect(avaiaStandpoint(BOND, "0x0sky.avaia")).toEqual(
      avaiaStandpoint(BOND, "0x0sky.avaia"),
    );
    expect(avaiaStandpoint(BOND, "0x0sky.avaia")).not.toEqual(
      avaiaStandpoint(BOND, "0x0rain.avaia"),
    );
  });

  it("stands beside a Bond at any latitude, not only near the equator", () => {
    for (const latitude of [0, 50.4501, -33.87, 78.2]) {
      const bond = { longitude: 15, latitude };
      expect(
        metersApart(bond, avaiaStandpoint(bond, "0x0sky.avaia")),
      ).toBeCloseTo(3, 1);
    }
  });
});

describe("which body an Avaia wears", () => {
  // Two identities standing together have to be told apart, and the study is
  // the only thing distinguishing them at a glance.
  it("never wears its Bond's own study", () => {
    for (const bond of ["sky-study", "dasha-study", "kai-study"] as const) {
      expect(avaiaStudy("0x0sky.avaia", bond)).not.toBe(bond);
    }
  });

  it("wears the same study every time it is drawn", () => {
    expect(avaiaStudy("0x0sky.avaia", "sky-study")).toBe(
      avaiaStudy("0x0sky.avaia", "sky-study"),
    );
  });
});

describe("an Avaia's body", () => {
  const north = { longitude: BOND.longitude, latitude: BOND.latitude + 0.001 };
  const east = { longitude: BOND.longitude + 0.001, latitude: BOND.latitude };

  it("walks while it is going somewhere", () => {
    expect(
      createAvaiaAvatarHandle({
        avaiaAddress: "0x0sky.avaia",
        study: "kai-study",
        movement: moving(north),
        zoom: MAP_SCALE_ZOOM.building,
        timeMs: 0,
        reducedMotion: false,
      }),
    ).toMatchObject({
      id: AVAIA_HANDLE_ID,
      modelId: "kai-study",
      clipId: "walk",
    });
  });

  it("faces the way it is walking, and holds that heading once it stops", () => {
    const walking = createAvaiaAvatarHandle({
      avaiaAddress: "0x0sky.avaia",
      study: "kai-study",
      movement: moving(east),
      zoom: MAP_SCALE_ZOOM.building,
      timeMs: 0,
      reducedMotion: false,
    });
    expect(walking.bearingDeg).toBeCloseTo(90, 0);

    const stopped = createAvaiaAvatarHandle({
      avaiaAddress: "0x0sky.avaia",
      study: "kai-study",
      movement: { kind: "arrived", position: east },
      zoom: MAP_SCALE_ZOOM.building,
      timeMs: 0,
      reducedMotion: false,
      facingDegrees: 90,
    });
    expect(stopped.bearingDeg).toBe(90);
  });

  // Arriving hands the body back to the rhythm every other body shares — the
  // sampler may well stroll it around, which is ambient life, not travel.
  it("settles into the ambient rhythm once it arrives", () => {
    const timeMs = 20_000;
    const arrived = createAvaiaAvatarHandle({
      avaiaAddress: "0x0sky.avaia",
      study: "kai-study",
      movement: { kind: "arrived", position: north },
      zoom: MAP_SCALE_ZOOM.building,
      timeMs,
      reducedMotion: false,
    });
    const ambient = sampleAmbientAvatar(
      avatarSeed("0x0sky.avaia"),
      timeMs,
      false,
    );

    expect(arrived.clipId).toBe(ambient.clipId);
    expect(arrived.clipPhase).toBe(ambient.clipPhase);
    expect(arrived.lngLat).toEqual([north.longitude, north.latitude]);
  });

  it("holds still when the person asked for reduced motion", () => {
    expect(
      createAvaiaAvatarHandle({
        avaiaAddress: "0x0sky.avaia",
        study: "kai-study",
        movement: moving(north),
        zoom: MAP_SCALE_ZOOM.building,
        timeMs: 12_345,
        reducedMotion: true,
      }),
    ).toMatchObject({ clipId: "idle", clipPhase: 0 });
  });

  // The same policy as every other body: readable close in, withdrawn where an
  // observation is a place rather than a person.
  it("takes the same apparent size and withdrawal as any other body", () => {
    const close = createAvaiaAvatarHandle({
      avaiaAddress: "0x0sky.avaia",
      study: "kai-study",
      movement: { kind: "idle", position: BOND },
      zoom: MAP_SCALE_ZOOM.building,
      timeMs: 0,
      reducedMotion: false,
    });
    expect(close.scale).toBeGreaterThan(1);
    expect(close.visible).toBe(true);

    const far = createAvaiaAvatarHandle({
      avaiaAddress: "0x0sky.avaia",
      study: "kai-study",
      movement: { kind: "idle", position: BOND },
      zoom: MAP_SCALE_ZOOM.city,
      timeMs: 0,
      reducedMotion: false,
    });
    expect(far.visible).toBe(false);
  });
});

describe("heading", () => {
  it("reads north, east, south and west off two positions", () => {
    expect(headingDegrees(BOND, north())).toBeCloseTo(0, 0);
    expect(headingDegrees(BOND, east())).toBeCloseTo(90, 0);
    expect(headingDegrees(BOND, south())).toBeCloseTo(180, 0);
    expect(headingDegrees(BOND, west())).toBeCloseTo(270, 0);
  });

  function north(): WorldPosition {
    return { longitude: BOND.longitude, latitude: BOND.latitude + 0.001 };
  }
  function south(): WorldPosition {
    return { longitude: BOND.longitude, latitude: BOND.latitude - 0.001 };
  }
  function east(): WorldPosition {
    return { longitude: BOND.longitude + 0.001, latitude: BOND.latitude };
  }
  function west(): WorldPosition {
    return { longitude: BOND.longitude - 0.001, latitude: BOND.latitude };
  }
});
