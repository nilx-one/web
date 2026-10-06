// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from "react";

import { readCommittedJournal } from "../progression/committed-journal";
import { applyInventory, useInventory, type InventoryPort } from "./inventory";

/**
 * xSasha's backpack gift (`docs/economy.md` in core): once, when the Bond's
 * pockets are four cells of five full or the Bond reaches level 3, she gives
 * the Bond and its Avaia a backpack each. Core decides when it is due and
 * moves both into them; this gives it when a scene can be played, and says
 * so. Like an achievement, the gift is given before she says it: a scene
 * skipped or cut short gives exactly the same.
 */
export async function giveBackpacksIfDue(
  owner: string,
  core: InventoryPort,
  bondLevel: number,
): Promise<boolean> {
  if (core.backpackGiftDue === undefined) return false;
  const snapshot = await readCommittedJournal(owner);
  const due = await core.backpackGiftDue(snapshot.inventory.state, bondLevel);
  if (!due) return false;
  const answer = await applyInventory(owner, core, {
    op: "gift_backpacks",
    bond_level: bondLevel,
  });
  return answer.ok;
}

export function useBackpackGift({
  owner,
  core,
  bondLevel,
  ready,
  onGiven,
}: {
  readonly owner: string;
  readonly core: InventoryPort | undefined;
  readonly bondLevel: number;
  /** Whether a scene could be played now: the world in view, nothing open. */
  readonly ready: boolean;
  readonly onGiven: () => void;
}): void {
  const { model } = useInventory(owner, core);
  const latest = useRef(onGiven);
  useEffect(() => {
    latest.current = onGiven;
  }, [onGiven]);
  const asking = useRef(false);

  const gifted = model.gifted;
  const bondCells = model.bond.things.length;
  useEffect(() => {
    if (!ready || gifted || core === undefined || asking.current) return;
    asking.current = true;
    void giveBackpacksIfDue(owner, core, bondLevel)
      .then((given) => {
        if (given) latest.current();
      })
      .catch(() => undefined)
      .finally(() => {
        asking.current = false;
      });
  }, [bondCells, bondLevel, core, gifted, owner, ready]);
}
