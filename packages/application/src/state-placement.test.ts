// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  STATE_PLACEMENT,
  mobilityAgreesWithPlacement,
  placedStateAt,
  placedStateForKey,
  placementAgreesWithMedium,
} from "./state-placement";

describe("State placement", () => {
  it("places every record exactly once", () => {
    const ids = STATE_PLACEMENT.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = STATE_PLACEMENT.map((record) => record.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps residence and medium on the same side of the service boundary", () => {
    const contradictions = STATE_PLACEMENT.filter(
      (record) => !placementAgreesWithMedium(record),
    ).map((record) => `${record.id}: ${record.placement} in ${record.medium}`);

    expect(contradictions).toEqual([]);
  });

  it("keeps the server to identity tables", () => {
    expect(placedStateAt("server").map((record) => record.id)).toEqual([
      "identity.pubDress",
      "identity.authorization",
      "identity.avatarModel",
      "pubInfo.experience",
      "experience.committedChains",
      "finds.claims",
    ]);
    for (const record of placedStateAt("server")) {
      expect(record.medium).toBe("identity-service");
      expect(record.mobility).toBe("resident");
    }
  });

  it("keeps the wardrobe on the device that stored it", () => {
    const wardrobe = STATE_PLACEMENT.find(
      (record) => record.id === "avatar.wardrobe",
    );
    expect(wardrobe).toMatchObject({
      placement: "device",
      mobility: "resident",
      medium: "local-storage",
    });
  });

  it("keeps the session row on the server and the session cookie on the device", () => {
    const sessions = STATE_PLACEMENT.find(
      (record) => record.id === "identity.authorization",
    );
    expect(sessions?.medium).toBe("identity-service");
    expect(sessions?.key).toContain("native_sessions");
    expect(sessions?.key).not.toContain("__Host-");

    const cookie = STATE_PLACEMENT.find(
      (record) => record.id === "identity.sessionCookie",
    );
    expect(cookie).toMatchObject({
      placement: "device",
      mobility: "resident",
      medium: "cookie",
      key: "__Host-0x1_session",
    });
  });

  it("keeps the on-device model and the journal key on the device", () => {
    const device = placedStateAt("device").map((record) => record.id);
    expect(device).toContain("localModel.choice");
    expect(device).toContain("localModel.download");
    expect(device).toContain("presence.journalKey");
    expect(device).toContain("avatar.wardrobe");
  });

  it("names transport eligibility without calling sealed history a preference", () => {
    const transport = STATE_PLACEMENT.filter(
      (record) => record.mobility === "transport",
    ).map((record) => record.id);
    expect(transport).toEqual(
      expect.arrayContaining([
        "interface.locale",
        "interface.appearance",
        "interface.dimension",
        "progression",
        "fog.reveals",
        "avaia.landmarks",
        "world.memory",
      ]),
    );

    const sealed = STATE_PLACEMENT.filter(
      (record) => record.mobility === "sealed-transport",
    ).map((record) => record.id);
    expect(sealed).toEqual([
      "presence.journal",
      "finds.events",
      "finds.historyKey",
      "finds.chainMeta",
      "bond.chain",
    ]);
  });

  it("does not grant transport to a record that lives where it stays", () => {
    const disagreements = STATE_PLACEMENT.filter(
      (record) => !mobilityAgreesWithPlacement(record),
    ).map((record) => record.id);

    expect(disagreements).toEqual([]);
    for (const record of STATE_PLACEMENT) {
      if (record.placement !== "synchronizable") {
        expect(record.mobility).toBe("resident");
      }
    }
  });

  it("records the progression key this client actually writes", () => {
    const progression = STATE_PLACEMENT.find(
      (record) => record.id === "progression",
    );
    expect(progression?.key).toBe("nilx-one.progression.v3");
    expect(progression?.legacy).toBeUndefined();
    expect(progression?.deviceOnlyFields).toEqual([
      "deviceAchievements",
      "settingsHintSeen",
    ]);
    const experience = STATE_PLACEMENT.find(
      (record) => record.id === "pubInfo.experience",
    );
    expect(experience?.what).toContain("authority: client");
  });

  it("resolves an owner-suffixed key to its record", () => {
    expect(placedStateForKey("nilx-one.fog.reveals.v1.0x0sky")?.id).toBe(
      "fog.reveals",
    );
    expect(placedStateForKey("nilx-one.fog.reveals.v1.")?.id).toBe(
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
