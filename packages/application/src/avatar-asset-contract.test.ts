// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AVATAR_SLOTS,
  WARDROBE_ITEMS,
  avatarModelDefinition,
  resolveAvatarAppearance,
} from "./avatar-appearance";

/**
 * The clothes a person can choose and the clothes that exist are one table.
 *
 * Web publishes a wardrobe; the asset build cuts the geometry. Nothing stops
 * those two from drifting except reading the same file, so this is that
 * reading: an item offered here with no geometry would be a choice that
 * changes nothing, and geometry with no item would be cloth nobody can reach.
 */
interface WardrobeTable {
  readonly rig_version: string;
  readonly asset_version: string;
  readonly body_regions: readonly string[];
  readonly always_visible: readonly string[];
  readonly slots: readonly {
    readonly slot: string;
    readonly cardinality: string;
    readonly conflicts: readonly string[];
  }[];
  readonly default_outfit: Readonly<Record<string, string | readonly string[]>>;
  readonly items: readonly {
    readonly id: string;
    readonly slot: string;
    readonly name: string;
    readonly hides: readonly string[];
  }[];
}

const WARDROBE_TABLE_PATH = "tools/avatars/dasha2/wardrobe.json";

function findWardrobeTable(): string {
  let directory = process.cwd();
  for (;;) {
    const candidate = resolve(directory, WARDROBE_TABLE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`cannot find ${WARDROBE_TABLE_PATH}`);
    }
    directory = parent;
  }
}

const table = JSON.parse(
  readFileSync(findWardrobeTable(), "utf8"),
) as WardrobeTable;

const dasha2 = avatarModelDefinition("dasha-v2-study");

describe("the published wardrobe and the built asset", () => {
  it("agree on the rig and the asset version", () => {
    expect(dasha2.schema.rigVersion).toBe(table.rig_version);
    expect(dasha2.assetVersion).toBe(table.asset_version);
  });

  it("offer the same items, in the same slots, with the same names", () => {
    expect(
      WARDROBE_ITEMS.map((item) => ({
        id: item.id,
        slot: item.slot,
        name: item.name,
        hides: [...item.hides],
      })),
    ).toEqual(
      table.items.map((item) => ({
        id: item.id,
        slot: item.slot,
        name: item.name,
        hides: [...item.hides],
      })),
    );
  });

  it("publish the same slots, cardinalities and conflicts", () => {
    expect(
      dasha2.schema.slots.map((slot) => ({
        slot: slot.slot,
        cardinality: slot.cardinality,
        conflicts: [...slot.conflicts],
      })),
    ).toEqual(
      table.slots.map((slot) => ({
        slot: slot.slot,
        cardinality: slot.cardinality,
        conflicts: [...slot.conflicts],
      })),
    );
    expect(dasha2.schema.slots.map((slot) => slot.slot)).toEqual([
      ...AVATAR_SLOTS,
    ]);
  });

  it("dress the body the same way when nothing has been chosen", () => {
    const worn = resolveAvatarAppearance("dasha-v2-study", undefined);
    const asBuilt: Record<string, string | readonly string[]> = {};
    for (const [slot, value] of Object.entries(table.default_outfit)) {
      asBuilt[slot] = value;
    }
    expect(JSON.parse(JSON.stringify(worn))).toEqual(asBuilt);
  });

  it("never let a garment hide a region the body always shows", () => {
    for (const item of WARDROBE_ITEMS) {
      for (const region of item.hides) {
        expect(table.body_regions).toContain(region);
        expect(table.always_visible).not.toContain(region);
      }
    }
  });
});
