// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  STATE_PLACEMENT,
  placedStateAt,
  placedStateForKey,
} from "./state-placement";

describe("State placement", () => {
  it("places every record exactly once", () => {
    const ids = STATE_PLACEMENT.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = STATE_PLACEMENT.map((record) => record.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the server to the address, authorization, and the body identifier", () => {
    const server = placedStateAt("server").map((record) => record.id);
    expect(server).toEqual([
      "identity.pubDress",
      "identity.authorization",
      "identity.avatarModel",
      "avatar.wardrobe",
    ]);
  });

  it("keeps the on-device model and the journal key on the device", () => {
    const device = placedStateAt("device").map((record) => record.id);
    expect(device).toContain("localModel.choice");
    expect(device).toContain("localModel.download");
    expect(device).toContain("presence.journalKey");
  });

  it("makes preferences and play synchronizable", () => {
    const synchronizable = placedStateAt("synchronizable").map(
      (record) => record.id,
    );
    expect(synchronizable).toEqual(
      expect.arrayContaining([
        "interface.locale",
        "interface.appearance",
        "interface.dimension",
        "progression",
        "fog.reveals",
        "avaia.landmarks",
        "world.memory",
        "presence.journal",
        "bond.chain",
      ]),
    );
  });

  it("leaves per-device achievements behind when progression travels", () => {
    const progression = STATE_PLACEMENT.find(
      (record) => record.id === "progression",
    );
    expect(progression?.deviceOnlyFields).toEqual([
      "deviceAchievements",
      "settingsHintSeen",
    ]);
  });

  it("resolves an owner-suffixed key to its record", () => {
    expect(placedStateForKey("nilx-one.fog.reveals.v1.0x0sky")?.id).toBe(
      "fog.reveals",
    );
    expect(
      placedStateForKey("nilx-one.bond-location-overrides.v1:0x0sky")?.id,
    ).toBe("bond.locationOverrides");
    expect(placedStateForKey("nilx-one.interface.locale")?.id).toBe(
      "interface.locale",
    );
  });

  it("does not claim a key it was not given", () => {
    expect(placedStateForKey("nilx-one.interface.locale.extra")).toBe(
      undefined,
    );
    expect(placedStateForKey("nilx-one.progression.v20.0x0sky")).toBe(
      undefined,
    );
    expect(placedStateForKey("identities.pub_dress")).toBe(undefined);
  });
});
