// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AVATAR_CATALOG,
  AVATAR_CATALOG_MATCHES_IDENTITY,
  WARDROBE_ITEMS,
  avatarModelDefinition,
  clearAvatarSlot,
  editableSlots,
  equipWardrobeItem,
  equippedWardrobe,
  hiddenBodyRegions,
  isAvatarModelEditable,
  isPublishedAvatarModel,
  parseAvatarAppearance,
  resolveAvatarAppearance,
  resolveAvatarSelection,
  serializeAvatarAppearance,
  validateAvatarAppearance,
  wardrobeItemsFor,
  type AvatarAppearance,
  type AvatarSlot,
} from "./avatar-appearance";

const DASHA_2 = "dasha-v2-study" as const;

function equip(appearance: AvatarAppearance, itemId: string): AvatarAppearance {
  const change = equipWardrobeItem(DASHA_2, appearance, itemId);
  if (change.kind !== "changed") {
    throw new Error(`expected ${itemId} to be equipable`);
  }
  return change.appearance;
}

describe("the published catalog", () => {
  it("registers exactly four selectable studies", () => {
    expect(AVATAR_CATALOG).toHaveLength(4);
    expect(AVATAR_CATALOG.map((model) => model.id)).toEqual([
      "sky-study",
      "dasha-study",
      "kai-study",
      "dasha-v2-study",
    ]);
  });

  it("registers every model the identity contract publishes", () => {
    expect(AVATAR_CATALOG_MATCHES_IDENTITY).toBe(true);
  });

  it("makes Dasha 2.0 the only editable study", () => {
    expect(isAvatarModelEditable(DASHA_2)).toBe(true);
    for (const id of ["sky-study", "dasha-study", "kai-study"] as const) {
      expect(isAvatarModelEditable(id)).toBe(false);
    }
  });

  it("gives an editable capability exactly to the editable studies", () => {
    for (const model of AVATAR_CATALOG) {
      expect(model.editable).toBe(model.capability === "modular-appearance");
      expect(model.editable).toBe(model.schema.slots.length > 0);
    }
  });

  it("rejects a model id this client does not publish", () => {
    expect(isPublishedAvatarModel("dasha-v3-study")).toBe(false);
    expect(() => avatarModelDefinition("dasha-v3-study" as never)).toThrowError(
      /unregistered avatar model/,
    );
  });

  it("ships more than one outfit's worth of wardrobe", () => {
    const count = (slot: AvatarSlot) => wardrobeItemsFor(DASHA_2, slot).length;
    expect(count("hair")).toBeGreaterThanOrEqual(2);
    expect(count("top")).toBeGreaterThanOrEqual(2);
    expect(count("bottom")).toBeGreaterThanOrEqual(2);
    expect(count("dress")).toBeGreaterThanOrEqual(1);
    expect(count("shoes")).toBeGreaterThanOrEqual(2);
    expect(count("accessories")).toBeGreaterThanOrEqual(1);
  });

  it("declares a supported model and rig on every wardrobe item", () => {
    const dasha2 = avatarModelDefinition(DASHA_2);
    for (const item of WARDROBE_ITEMS) {
      expect(item.supportedModels.length).toBeGreaterThan(0);
      expect(item.rigVersion).toBe(dasha2.schema.rigVersion);
    }
  });
});

describe("a study that publishes no wardrobe", () => {
  it("offers no editable slots and no items", () => {
    expect(editableSlots("sky-study")).toEqual([]);
    expect(wardrobeItemsFor("sky-study", "top")).toEqual([]);
  });

  it("always resolves to the empty appearance", () => {
    expect(
      resolveAvatarAppearance("sky-study", { top: "top/tee-black" }),
    ).toEqual({});
  });

  it("refuses to be dressed", () => {
    const change = equipWardrobeItem("sky-study", {}, "top/tee-black");
    expect(change).toEqual({
      kind: "rejected",
      reason: { kind: "model-not-editable", slot: "top" },
    });
  });

  it("treats any appearance at all as invalid", () => {
    expect(
      validateAvatarAppearance("kai-study", { hair: "hair/swept-bun" }),
    ).toEqual({
      kind: "invalid",
      rejections: [{ kind: "model-not-editable", slot: "hair" }],
    });
    expect(validateAvatarAppearance("kai-study", {})).toEqual({
      kind: "valid",
    });
  });
});

describe("deterministic defaults", () => {
  it("resolves nothing stored to the model's own default", () => {
    const model = avatarModelDefinition(DASHA_2);
    expect(resolveAvatarAppearance(DASHA_2, undefined)).toEqual(
      model.defaultAppearance,
    );
  });

  it("resolves the same stored value to the same appearance every time", () => {
    const stored = { top: "top/shell-ecru", hair: "hair/loose-long" };
    const once = resolveAvatarAppearance(DASHA_2, stored);
    const twice = resolveAvatarAppearance(DASHA_2, stored);
    expect(once).toEqual(twice);
    expect(serializeAvatarAppearance(once)).toBe(
      serializeAvatarAppearance(twice),
    );
  });

  it("fills a required slot that stored nothing", () => {
    const resolved = resolveAvatarAppearance(DASHA_2, {
      top: "top/shell-ecru",
    });
    expect(resolved.hair).toBe("hair/swept-bun");
    expect(resolved.top).toBe("top/shell-ecru");
  });

  it("keeps a required slot filled even when it stored something unknown", () => {
    const resolved = resolveAvatarAppearance(DASHA_2, {
      hair: "hair/never-published",
    });
    expect(resolved.hair).toBe("hair/swept-bun");
  });
});

describe("appearance is model specific", () => {
  it("never inherits an item another study was authored for", () => {
    const foreign = { top: "top/tee-black" } satisfies AvatarAppearance;
    expect(resolveAvatarAppearance("dasha-study", foreign)).toEqual({});
  });

  it("drops an item stored into the wrong slot", () => {
    const resolved = resolveAvatarAppearance(DASHA_2, {
      top: "shoes/loafers-black",
    });
    expect(resolved.top).toBeUndefined();
  });

  it("drops an unknown accessory without dropping a known one", () => {
    const resolved = resolveAvatarAppearance(DASHA_2, {
      accessories: ["accessory/never-published", "accessory/earrings-silver"],
    });
    expect(resolved.accessories).toEqual(["accessory/earrings-silver"]);
  });
});

describe("slot compatibility", () => {
  it("takes a top and a bottom off when a dress goes on", () => {
    const dressed = equip(
      resolveAvatarAppearance(DASHA_2, undefined),
      "dress/shift-indigo",
    );
    expect(dressed.dress).toBe("dress/shift-indigo");
    expect(dressed.top).toBeUndefined();
    expect(dressed.bottom).toBeUndefined();
    expect(validateAvatarAppearance(DASHA_2, dressed)).toEqual({
      kind: "valid",
    });
  });

  it("takes the dress off when a top goes back on", () => {
    const dressed = equip(
      resolveAvatarAppearance(DASHA_2, undefined),
      "dress/shift-indigo",
    );
    const inATop = equip(dressed, "top/shell-ecru");
    expect(inATop.dress).toBeUndefined();
    expect(inATop.top).toBe("top/shell-ecru");
  });

  it("refuses a stored combination that wears a dress over a top", () => {
    const validation = validateAvatarAppearance(DASHA_2, {
      hair: "hair/swept-bun",
      top: "top/tee-black",
      dress: "dress/shift-indigo",
    });
    expect(validation.kind).toBe("invalid");
    expect(
      validation.kind === "invalid" ? validation.rejections : [],
    ).toContainEqual({
      kind: "slot-conflict",
      slot: "dress",
      conflictsWith: "top",
    });
  });

  it("repairs such a combination in favour of the separates", () => {
    const resolved = resolveAvatarAppearance(DASHA_2, {
      hair: "hair/swept-bun",
      top: "top/tee-black",
      dress: "dress/shift-indigo",
    });
    expect(resolved.top).toBe("top/tee-black");
    expect(resolved.dress).toBeUndefined();
  });

  it("replaces the item in a slot that holds one", () => {
    const swapped = equip(
      resolveAvatarAppearance(DASHA_2, undefined),
      "shoes/sneakers-white",
    );
    expect(swapped.shoes).toBe("shoes/sneakers-white");
  });

  it("toggles a slot that holds many", () => {
    const base = resolveAvatarAppearance(DASHA_2, { hair: "hair/swept-bun" });
    const on = equip(base, "accessory/earrings-silver");
    expect(on.accessories).toEqual(["accessory/earrings-silver"]);
    const off = equip(on, "accessory/earrings-silver");
    expect(off.accessories ?? []).toEqual([]);
  });

  it("refuses to empty a slot the model requires", () => {
    expect(
      clearAvatarSlot(
        DASHA_2,
        resolveAvatarAppearance(DASHA_2, undefined),
        "hair",
      ),
    ).toEqual({
      kind: "rejected",
      reason: { kind: "missing-required-slot", slot: "hair" },
    });
  });

  it("empties a slot the model does not require", () => {
    const bare = clearAvatarSlot(
      DASHA_2,
      resolveAvatarAppearance(DASHA_2, undefined),
      "shoes",
    );
    expect(bare.kind).toBe("changed");
    expect(
      bare.kind === "changed" ? bare.appearance.shoes : "",
    ).toBeUndefined();
  });

  it("refuses an item no study published", () => {
    expect(equipWardrobeItem(DASHA_2, {}, "top/never-published")).toEqual({
      kind: "rejected",
      reason: {
        kind: "unknown-item",
        slot: "accessories",
        itemId: "top/never-published",
      },
    });
  });
});

describe("body region visibility", () => {
  it("derives hidden regions from what is worn", () => {
    const dressed = resolveAvatarAppearance(DASHA_2, undefined);
    expect(hiddenBodyRegions(DASHA_2, dressed)).toEqual([
      "torso",
      "hips",
      "upper_legs",
      "lower_legs",
      "feet",
    ]);
  });

  it("restores a region when the garment covering it comes off", () => {
    const dressed = resolveAvatarAppearance(DASHA_2, undefined);
    const barefoot = clearAvatarSlot(DASHA_2, dressed, "shoes");
    const appearance =
      barefoot.kind === "changed" ? barefoot.appearance : dressed;
    expect(hiddenBodyRegions(DASHA_2, appearance)).not.toContain("feet");
  });

  it("uncovers the shin a trouser leg covered when a skirt replaces it", () => {
    const inASkirt = equip(
      resolveAvatarAppearance(DASHA_2, undefined),
      "bottom/skirt-charcoal",
    );
    expect(hiddenBodyRegions(DASHA_2, inASkirt)).not.toContain("lower_legs");
    expect(hiddenBodyRegions(DASHA_2, inASkirt)).toContain("upper_legs");
  });

  it("leaves the arms bare: no published item encloses one yet", () => {
    for (const item of WARDROBE_ITEMS) {
      expect(item.hides).not.toContain("upper_arms");
      expect(item.hides).not.toContain("lower_arms");
    }
  });

  it("hides nothing for a study that wears nothing separately", () => {
    expect(hiddenBodyRegions("sky-study", {})).toEqual([]);
  });
});

describe("serialization", () => {
  it("round-trips an appearance", () => {
    const appearance = equip(
      resolveAvatarAppearance(DASHA_2, undefined),
      "hair/loose-long",
    );
    const text = serializeAvatarAppearance(appearance);
    expect(parseAvatarAppearance(DASHA_2, text)).toEqual(appearance);
  });

  it("writes slots in contract order whatever order they were built in", () => {
    const built = equip(
      equip(
        resolveAvatarAppearance(DASHA_2, undefined),
        "shoes/sneakers-white",
      ),
      "hair/loose-long",
    );
    expect(Object.keys(JSON.parse(serializeAvatarAppearance(built)))).toEqual([
      "hair",
      "top",
      "bottom",
      "shoes",
      "accessories",
    ]);
  });

  it("falls back to the default for text that is not an appearance", () => {
    const fallback = resolveAvatarAppearance(DASHA_2, undefined);
    expect(parseAvatarAppearance(DASHA_2, "not json")).toEqual(fallback);
    expect(parseAvatarAppearance(DASHA_2, "[]")).toEqual(fallback);
    expect(parseAvatarAppearance(DASHA_2, undefined)).toEqual(fallback);
  });

  it("ignores stored entries of the wrong shape", () => {
    const parsed = parseAvatarAppearance(
      DASHA_2,
      JSON.stringify({ hair: 4, accessories: "earrings" }),
    );
    expect(parsed.hair).toBe("hair/swept-bun");
    expect(parsed.accessories).toBeUndefined();
  });
});

describe("resolving a whole selection", () => {
  it("has no selection for a model this client cannot render", () => {
    expect(resolveAvatarSelection("dasha-v3-study", undefined)).toBeUndefined();
    expect(resolveAvatarSelection(undefined, undefined)).toBeUndefined();
  });

  it("pairs a published model with an appearance it may wear", () => {
    const selection = resolveAvatarSelection(DASHA_2, {
      dress: "dress/shift-indigo",
    });
    expect(selection?.modelId).toBe(DASHA_2);
    expect(selection?.appearance.dress).toBe("dress/shift-indigo");
    expect(
      validateAvatarAppearance(DASHA_2, selection?.appearance ?? {}),
    ).toEqual({ kind: "valid" });
  });

  it("lists what is worn in contract slot order", () => {
    const selection = resolveAvatarSelection(DASHA_2, undefined);
    expect(
      equippedWardrobe(DASHA_2, selection?.appearance ?? {}).map(
        (item) => item.slot,
      ),
    ).toEqual(["hair", "top", "bottom", "shoes", "accessories"]);
  });
});

describe("nothing stored is not the same as wearing nothing", () => {
  it("dresses an identity that has never chosen an appearance", () => {
    expect(resolveAvatarAppearance(DASHA_2, undefined).shoes).toBe(
      "shoes/loafers-black",
    );
  });

  it("leaves an identity that took its shoes off barefoot", () => {
    const barefoot = clearAvatarSlot(
      DASHA_2,
      resolveAvatarAppearance(DASHA_2, undefined),
      "shoes",
    );
    const appearance = barefoot.kind === "changed" ? barefoot.appearance : {};
    expect(resolveAvatarAppearance(DASHA_2, appearance).shoes).toBeUndefined();
  });
});
