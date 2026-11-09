// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreRecipe, FindAttestationPort } from "@nilx-one/application";
import { useEffect } from "react";

import { applyInventory, type InventoryPort } from "../inventory/inventory";
import type { CraftPlace } from "../inventory/craft";
import {
  noteFindAttested,
  noteFindSpent,
  noteFindUnattestable,
  readCommittedJournal,
  subscribeCommittedJournal,
  type AttestedFind,
} from "../progression/committed-journal";

/**
 * Attested finds on this device (nilx-one/core `docs/find-attestation.md`).
 * The device keeps the things; Identity attests each pick-up and answers an
 * opaque id. Only that id leaves the device again, to sell the thing or to use
 * it up in a craft Identity pays for. Identity credits and debits the wallet;
 * the device's own Seeds are retired and never shown.
 */

/** How long Identity accepts a pick-up after it happened (core's rule). */
export const PICKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const attesting = new Set<string>();

/**
 * Asks Identity to attest every pick-up this device kept and has not had
 * attested. A refusal is final and recorded; a pick-up too old for Identity
 * is given up; an unreachable service is tried again on the next change.
 */
export async function attestKeptFinds(
  owner: string,
  port: FindAttestationPort,
  now: () => number = Date.now,
): Promise<number> {
  const snapshot = await readCommittedJournal(owner);
  let credited = 0;
  for (const find of snapshot.finds.located) {
    if (!snapshot.inventory.pickedUp.has(find.artifactId)) {
      if (find.foundAtMs < now() - PICKUP_MAX_AGE_MS) {
        await noteFindUnattestable(owner, find.artifactId, "expired");
      }
      continue;
    }
    const key = `${owner}:${find.artifactId}`;
    if (attesting.has(key)) continue;
    attesting.add(key);
    try {
      const answer = await port.attestFind(find);
      if (answer.kind === "attested") {
        await noteFindAttested(owner, {
          artifactId: find.artifactId,
          attestationId: answer.attestationId,
          itemId: answer.itemId,
        });
        if (answer.seedsCredited > 0n) credited += 1;
      } else if (answer.kind === "refused") {
        await noteFindUnattestable(owner, find.artifactId, answer.reason);
      }
    } finally {
      attesting.delete(key);
    }
  }
  return credited;
}

/** Keeps kept pick-ups attested while the journal changes. */
export function useFindAttestation(
  owner: string,
  port: FindAttestationPort | undefined,
  onCredited?: () => void,
): void {
  useEffect(() => {
    if (port === undefined) return;
    let live = true;
    const sweep = () => {
      void attestKeptFinds(owner, port)
        .then((credited) => {
          if (live && credited > 0) onCredited?.();
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeCommittedJournal(owner, sweep);
    sweep();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [owner, port, onCredited]);
}

/** An attested thing of `itemId` this device still holds, if any. */
export function attestedThing(
  attested: readonly AttestedFind[],
  itemId: string,
): AttestedFind | undefined {
  return attested.find((find) => find.itemId === itemId);
}

export type SellOutcome =
  | { readonly kind: "sold"; readonly seeds: bigint }
  | { readonly kind: "unverified" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unavailable" };

/**
 * Sells one attested `itemId` through Identity, then takes it out of the
 * Bond's grid. A thing with no attestation (found before attestation, or
 * refused it) cannot be sold.
 */
export async function sellAttested(
  owner: string,
  port: FindAttestationPort,
  core: InventoryPort,
  itemId: string,
): Promise<SellOutcome> {
  const snapshot = await readCommittedJournal(owner);
  const thing = attestedThing(snapshot.finds.attested, itemId);
  if (thing === undefined) return { kind: "unverified" };
  const answer = await port.sellFind(thing.attestationId);
  if (answer.kind === "unavailable") return answer;
  if (answer.kind === "refused" && answer.reason !== "used_up") {
    return { kind: "refused", reason: answer.reason };
  }
  // Sold now or before, or used up already: either way it is gone. Core's
  // local sale only takes it out of the grid; its local Seeds are retired.
  await noteFindSpent(owner, thing.attestationId, "sold");
  await applyInventory(owner, core, { op: "sell", id: itemId, count: 1 });
  return answer.kind === "sold"
    ? { kind: "sold", seeds: answer.seedsCredited }
    : { kind: "refused", reason: answer.reason };
}

export type CraftStart =
  | { readonly kind: "started"; readonly seeds: bigint }
  | { readonly kind: "unverified" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unavailable" };

/**
 * The attested things a recipe uses up, one per thing it consumes, or
 * `undefined` when this device does not hold enough attested ones.
 */
export function recipeInputs(
  attested: readonly AttestedFind[],
  recipe: Pick<CoreRecipe, "consumes">,
): readonly AttestedFind[] | undefined {
  const free = [...attested];
  const inputs: AttestedFind[] = [];
  for (const input of recipe.consumes) {
    for (let index = 0; index < input.count; index += 1) {
      const at = free.findIndex((find) => find.itemId === input.id);
      if (at < 0) return undefined;
      inputs.push(...free.splice(at, 1));
    }
  }
  return inputs;
}

function newCraftId(): string {
  return `craft-${globalThis.crypto.randomUUID()}`;
}

/**
 * Pays a craft through Identity, then starts it on the device with Core's
 * `start_paid_craft`. Identity checks the inputs, debits Core's price and uses
 * them up; the device only names which attested things it uses.
 */
export async function startPaidCraft(
  owner: string,
  port: FindAttestationPort,
  core: InventoryPort,
  recipe: CoreRecipe,
  place: CraftPlace,
  craftId: string = newCraftId(),
): Promise<CraftStart> {
  const snapshot = await readCommittedJournal(owner);
  const inputs = recipeInputs(snapshot.finds.attested, recipe);
  if (inputs === undefined) return { kind: "unverified" };
  const paid = await port.payCraft(
    craftId,
    recipe.id,
    inputs.map((input) => input.attestationId),
  );
  if (paid.kind !== "paid") return paid;
  for (const input of inputs) {
    await noteFindSpent(owner, input.attestationId, "crafted");
  }
  const answer = await applyInventory(owner, core, {
    op: "start_paid_craft",
    recipe: recipe.id,
    place,
  });
  return answer.ok
    ? { kind: "started", seeds: paid.seedsDebited }
    : { kind: "refused", reason: answer.error };
}
