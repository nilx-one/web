// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreEconomyCatalog,
  CoreHolder,
  CoreInventoryAnswer,
  CoreInventoryCommand,
  CoreRuntimePort,
} from "@nilx-one/application";
import { useEffect, useState } from "react";

import {
  readCommittedJournal,
  subscribeCommittedJournal,
  updateInventory,
} from "../progression/committed-journal";

/**
 * What the Bond and its Avaia carry (`docs/economy.md` in core). Core owns
 * every rule: what fits where, what sells for what, what a craft takes. This
 * module only stores Core's answer in the sealed finds journal and reads it
 * back for the screen.
 */
export type InventoryPort = Pick<
  CoreRuntimePort,
  "applyInventoryCommand" | "economyCatalog"
> &
  Partial<Pick<CoreRuntimePort, "backpackGiftDue">>;

export interface PlacedThing {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export type CarryId = "pocket" | "backpack" | "bag";

export interface CarriedGrid {
  readonly carry: CarryId;
  readonly things: readonly PlacedThing[];
  /** What this holder owns to carry things in: pockets, always. */
  readonly owned: readonly CarryId[];
}

export interface CraftInProgress {
  readonly recipe: string;
  readonly startedMs: number;
  readonly readyMs: number;
}

/** The stored inventory as the screen reads it. */
export interface InventoryModel {
  readonly seeds: number;
  readonly bond: CarriedGrid;
  readonly avaia: CarriedGrid;
  readonly craft: CraftInProgress | undefined;
  /** Whether xSasha's backpack gift was given. */
  readonly gifted: boolean;
}

/** Pockets for both, as Core starts an inventory. */
export const EMPTY_INVENTORY: InventoryModel = {
  seeds: 0,
  bond: { carry: "pocket", things: [], owned: ["pocket"] },
  avaia: { carry: "pocket", things: [], owned: ["pocket"] },
  craft: undefined,
  gifted: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: unknown): number {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    const amount = Number(value);
    if (Number.isSafeInteger(amount)) return amount;
  }
  throw new Error("Stored inventory holds an invalid amount");
}

function isCarry(value: unknown): value is CarryId {
  return value === "pocket" || value === "backpack" || value === "bag";
}

function grid(value: unknown, owned: unknown): CarriedGrid {
  if (
    isRecord(value) &&
    (value.carry === "pocket" ||
      value.carry === "backpack" ||
      value.carry === "bag") &&
    Array.isArray(value.things)
  ) {
    const carry = value.carry;
    const owns = new Set<CarryId>([
      "pocket",
      carry,
      ...(Array.isArray(owned) ? owned.filter(isCarry) : []),
    ]);
    return {
      carry,
      owned: (["pocket", "backpack", "bag"] as const).filter((id) =>
        owns.has(id),
      ),
      things: value.things.map((thing: unknown) => {
        if (
          isRecord(thing) &&
          typeof thing.id === "string" &&
          typeof thing.x === "number" &&
          typeof thing.y === "number"
        ) {
          return { id: thing.id, x: thing.x, y: thing.y };
        }
        throw new Error("Stored inventory holds an invalid thing");
      }),
    };
  }
  throw new Error("Stored inventory holds an invalid grid");
}

/**
 * Reads Core's stored inventory for display. The empty string is a new one.
 * Only Core validates it; a value this cannot read shows as empty rather than
 * as something it is not.
 */
export function readInventoryModel(state: string): InventoryModel {
  if (state === "") return EMPTY_INVENTORY;
  try {
    const parsed: unknown = JSON.parse(state);
    if (!isRecord(parsed)) return EMPTY_INVENTORY;
    const craft = isRecord(parsed.craft)
      ? {
          recipe: String(parsed.craft.recipe),
          startedMs: decimal(parsed.craft.started_ms),
          readyMs: decimal(parsed.craft.ready_ms),
        }
      : undefined;
    const owned = isRecord(parsed.owned) ? parsed.owned : {};
    const bond = grid(parsed.bond, owned.bond);
    return {
      seeds: decimal(parsed.seeds),
      bond,
      avaia: grid(parsed.avaia, owned.avaia),
      craft,
      // A state stored before the gift counts a backpack worn as given.
      gifted:
        typeof parsed.gifted === "boolean"
          ? parsed.gifted
          : bond.carry !== "pocket",
    };
  } catch {
    return EMPTY_INVENTORY;
  }
}

/**
 * Puts a kept find into its finder's grid, once. A find already in, or one
 * that fits nowhere, changes nothing; the answer says which.
 */
export async function pickUpFind(
  owner: string,
  core: InventoryPort,
  find: {
    readonly artifactId: string;
    readonly tier: number;
    readonly holder: CoreHolder;
  },
  now: () => number = Date.now,
): Promise<CoreInventoryAnswer | "already-in"> {
  const apply = core.applyInventoryCommand;
  if (apply === undefined) return { ok: false, error: "unavailable" };
  let answer: CoreInventoryAnswer | "already-in" = "already-in";
  await updateInventory(owner, async (current) => {
    if (current.pickedUp.has(find.artifactId)) return undefined;
    answer = await apply.call(
      core,
      current.state,
      {
        op: "pick_up",
        holder: find.holder,
        artifact_id: find.artifactId,
        tier: find.tier,
      },
      now(),
    );
    return answer.ok
      ? { state: answer.state, pickedUp: find.artifactId }
      : undefined;
  });
  return answer;
}

/** Applies one command a person chose: sell, hand over, rearrange, craft. */
export async function applyInventory(
  owner: string,
  core: InventoryPort,
  command: Exclude<CoreInventoryCommand, { op: "pick_up" }>,
  now: () => number = Date.now,
): Promise<CoreInventoryAnswer> {
  const apply = core.applyInventoryCommand;
  if (apply === undefined) return { ok: false, error: "unavailable" };
  let answer: CoreInventoryAnswer = { ok: false, error: "unavailable" };
  await updateInventory(owner, async (current) => {
    answer = await apply.call(core, current.state, command, now());
    return answer.ok ? { state: answer.state } : undefined;
  });
  return answer;
}

export interface InventoryState {
  readonly model: InventoryModel;
  readonly catalog: CoreEconomyCatalog | undefined;
}

/** The inventory as stored, kept current with the journal, and the catalog. */
export function useInventory(
  owner: string,
  core: InventoryPort | undefined,
): InventoryState {
  const [model, setModel] = useState<InventoryModel>(EMPTY_INVENTORY);
  const [catalog, setCatalog] = useState<CoreEconomyCatalog | undefined>();

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void readCommittedJournal(owner)
        .then((snapshot) => {
          if (active) setModel(readInventoryModel(snapshot.inventory.state));
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeCommittedJournal(owner, refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [owner]);

  useEffect(() => {
    let active = true;
    void core
      ?.economyCatalog?.()
      .then((loaded) => {
        if (active) setCatalog(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [core]);

  return { model, catalog };
}
