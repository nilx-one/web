// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreInventoryAnswer, CoreRecipe } from "@nilx-one/application";
import { useEffect, useRef } from "react";

import { craftSubject } from "../progression/commitment";
import { earnActivity } from "../progression/committed-sync";
import {
  applyInventory,
  useInventory,
  type CraftInProgress,
  type InventoryPort,
} from "./inventory";

/**
 * Crafting (`docs/economy.md` in core): a confirmed recipe takes its inputs
 * and Seeds at once, then runs in the background, like a cell opening. When
 * it is done the thing goes into the Bond's grid and the Bond earns its
 * experience, as a committed `craft_finished` award the service prices by
 * the recipe.
 */

/** Where the Bond stands, as far as a recipe cares. Workshops come later. */
export type CraftPlace = "anywhere" | "repair_workshop";

export function startCraft(
  owner: string,
  core: InventoryPort,
  recipe: CoreRecipe,
  place: CraftPlace = "anywhere",
  now?: () => number,
): Promise<CoreInventoryAnswer> {
  return applyInventory(
    owner,
    core,
    { op: "start_craft", recipe: recipe.id, place },
    now,
  );
}

export interface FinishedCraft {
  readonly recipe: string;
  readonly experience: number;
}

/** A finished craft, with the thing it made when the catalog names it. */
export interface CompletedCraft extends FinishedCraft {
  readonly makes: string | undefined;
}

/**
 * Finishes the running craft once it is due and earns its experience. A
 * craft that is not due, or has no room to land, stays running.
 */
export async function finishCraft(
  owner: string,
  core: InventoryPort,
  craft: CraftInProgress,
  committed: boolean,
  now: () => number = Date.now,
): Promise<FinishedCraft | CoreInventoryAnswer> {
  const answer = await applyInventory(owner, core, { op: "finish_craft" }, now);
  if (!answer.ok) return answer;
  await earnActivity(
    owner,
    {
      kind: "craft_finished",
      earner: "bond",
      subject: craftSubject(craft.recipe, craft.startedMs),
      at: now(),
    },
    committed,
  ).catch(() => undefined);
  return { recipe: craft.recipe, experience: answer.experience };
}

export function isFinished(
  value: FinishedCraft | CoreInventoryAnswer,
): value is FinishedCraft {
  return "recipe" in value;
}

/** Longest a background timer waits before looking again. */
const MAX_WAIT_MS = 60_000;

/**
 * Finishes the running craft in the background when it is due, wherever the
 * person is in the app. Mounted once, with the world.
 */
export function useCraftCompletion({
  owner,
  core,
  committed,
  onFinished,
}: {
  readonly owner: string;
  readonly core: InventoryPort | undefined;
  readonly committed: boolean;
  readonly onFinished: (finished: CompletedCraft) => void;
}): void {
  const { model, catalog } = useInventory(owner, core);
  const latestCatalog = useRef(catalog);
  useEffect(() => {
    latestCatalog.current = catalog;
  }, [catalog]);
  const latest = useRef(onFinished);
  useEffect(() => {
    latest.current = onFinished;
  }, [onFinished]);

  const craft = model.craft;
  // Things in the Bond's grid change when room is made for a craft that
  // could not land; looking again then is what lets it finish.
  const bondThings = model.bond.things.length;
  useEffect(() => {
    if (core?.applyInventoryCommand === undefined || craft === undefined) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (cancelled) return;
      const wait = craft.readyMs - Date.now();
      if (wait > 0) {
        timer = globalThis.setTimeout(attempt, Math.min(wait, MAX_WAIT_MS));
        return;
      }
      void finishCraft(owner, core, craft, committed)
        .then((result) => {
          if (cancelled || !isFinished(result)) return;
          latest.current({
            ...result,
            makes: latestCatalog.current?.recipes.find(
              (recipe) => recipe.id === result.recipe,
            )?.makes,
          });
        })
        .catch(() => undefined);
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [bondThings, committed, core, craft, owner]);
}
