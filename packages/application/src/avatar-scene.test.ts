// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  clearAvatarSlot,
  equipWardrobeItem,
  resolveAvatarAppearance,
  type AvatarAppearance,
} from "./avatar-appearance";
import {
  AVATAR_IDENTITY_NODES,
  resolveAvatarScene,
  resolveSelectedAvatarScene,
  sceneDrawsNode,
} from "./avatar-scene";

const DASHA_2 = "dasha-v2-study" as const;

function equip(appearance: AvatarAppearance, itemId: string): AvatarAppearance {
  const change = equipWardrobeItem(DASHA_2, appearance, itemId);
  if (change.kind !== "changed") throw new Error(`cannot equip ${itemId}`);
  return change.appearance;
}

describe("one resolved body", () => {
  it("points every consumer at the same geometry", () => {
    const scene = resolveAvatarScene(DASHA_2, undefined);
    expect(scene.assetUrl).toBe("/avatars/0.3.0/dasha-v2-study.glb");
    expect(scene.stillUrl).toBe("/avatars/0.3.0/dasha-v2-study.png");
    expect(scene.modular).toBe(true);
  });

  it("draws a baked study exactly as it was authored", () => {
    const scene = resolveAvatarScene("sky-study", undefined);
    expect(scene.assetUrl).toBe("/avatars/0.1.0/sky-study.glb");
    expect(scene.modular).toBe(false);
    expect(scene.visibleNodes).toEqual([]);
    expect(scene.equipped).toEqual([]);
    expect(sceneDrawsNode(scene, "anything at all")).toBe(true);
  });

  it("keeps the head and hands whatever is worn", () => {
    const bare = resolveAvatarScene(DASHA_2, {});
    const dressed = resolveAvatarScene(DASHA_2, undefined);
    for (const node of AVATAR_IDENTITY_NODES) {
      expect(sceneDrawsNode(bare, node)).toBe(true);
      expect(sceneDrawsNode(dressed, node)).toBe(true);
    }
  });

  it("draws the wearables that are on and no others", () => {
    const scene = resolveAvatarScene(DASHA_2, undefined);
    expect(scene.visibleNodes).toContain("wear:top/tee-black");
    expect(scene.visibleNodes).not.toContain("wear:top/shell-ecru");
    expect(scene.visibleNodes).not.toContain("wear:dress/shift-indigo");
  });

  it("hides the body a garment encloses and shows what it does not", () => {
    const scene = resolveAvatarScene(DASHA_2, undefined);
    expect(scene.visibleNodes).not.toContain("body:torso");
    expect(scene.visibleNodes).toContain("body:upper_arms");
    expect(scene.visibleNodes).toContain("body:lower_arms");
  });

  it("brings a region back when the garment covering it comes off", () => {
    const dressed = resolveAvatarAppearance(DASHA_2, undefined);
    const barefoot = clearAvatarSlot(DASHA_2, dressed, "shoes");
    const scene = resolveAvatarScene(
      DASHA_2,
      barefoot.kind === "changed" ? barefoot.appearance : dressed,
    );
    expect(scene.visibleNodes).toContain("body:feet");
    expect(scene.visibleNodes).not.toContain("wear:shoes/loafers-black");
  });

  it("uncovers the shin under a skirt that a trouser leg covered", () => {
    const inASkirt = equip(
      resolveAvatarAppearance(DASHA_2, undefined),
      "bottom/skirt-charcoal",
    );
    const scene = resolveAvatarScene(DASHA_2, inASkirt);
    expect(scene.visibleNodes).toContain("body:lower_legs");
    expect(scene.visibleNodes).not.toContain("body:upper_legs");
  });

  it("never draws a body region and the garment slot that hides it at once", () => {
    const scene = resolveAvatarScene(DASHA_2, undefined);
    for (const item of scene.equipped) {
      for (const region of item.hides) {
        expect(scene.visibleNodes).not.toContain(`body:${region}`);
      }
    }
  });
});

describe("the same state always draws the same body", () => {
  it("gives two resolutions of one state the same key", () => {
    const stored = { hair: "hair/loose-long", dress: "dress/shift-indigo" };
    expect(resolveAvatarScene(DASHA_2, stored).key).toBe(
      resolveAvatarScene(DASHA_2, stored).key,
    );
    expect(resolveAvatarScene(DASHA_2, stored).visibleNodes).toEqual(
      resolveAvatarScene(DASHA_2, stored).visibleNodes,
    );
  });

  it("gives a changed outfit a different key", () => {
    const before = resolveAvatarScene(DASHA_2, undefined);
    const after = resolveAvatarScene(
      DASHA_2,
      equip(before.appearance, "shoes/sneakers-white"),
    );
    expect(after.key).not.toBe(before.key);
    expect(after.assetUrl).toBe(before.assetUrl);
  });

  it("resolves an appearance authored for another study to that study's own", () => {
    const scene = resolveAvatarScene("kai-study", {
      top: "top/tee-black",
    });
    expect(scene.appearance).toEqual({});
    expect(scene.key).toBe("kai-study#{}");
  });

  it("says whether the published still is a still of this very outfit", () => {
    expect(
      resolveAvatarScene(DASHA_2, undefined).stillShowsThisAppearance,
    ).toBe(true);
    expect(
      resolveAvatarScene(DASHA_2, { dress: "dress/shift-indigo" })
        .stillShowsThisAppearance,
    ).toBe(false);
    expect(
      resolveAvatarScene("sky-study", undefined).stillShowsThisAppearance,
    ).toBe(true);
  });

  it("resolves a selection the same way it resolves its parts", () => {
    const selection = { modelId: DASHA_2, appearance: {} } as const;
    expect(resolveSelectedAvatarScene(selection).key).toBe(
      resolveAvatarScene(DASHA_2, {}).key,
    );
  });
});
