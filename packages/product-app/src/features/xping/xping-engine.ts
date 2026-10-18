// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreRuntimePort,
  XpingEngineAccessPort,
  XpingEngineRead,
  XpingEngineRejection,
} from "@nilx-one/application";
import { useCallback, useEffect, useState } from "react";

import { updateInventory } from "../progression/committed-journal";
import { applyInventory, type InventoryPort } from "../inventory/inventory";

/** How often the Dock reads the engine again while it is shown. */
export const XPING_ENGINE_REFRESH_MS = 30_000;

export type XpingRepairPort = Pick<CoreRuntimePort, "xpingRepair">;

export type XpingRepairOutcome =
  | { readonly kind: "repaired"; readonly read: XpingEngineRead }
  | {
      readonly kind: "refused";
      readonly reason: XpingEngineRejection | "not_enough_seeds" | "not_due";
    }
  | { readonly kind: "unavailable" };

/**
 * Pays for a repair and records it, in the order Core's hosting obligations
 * set (`docs/xping-engine.md`): read the engine and the service's clock,
 * price the payment from that engine against the inventory, have the
 * service record it on exactly that state, and only then store the
 * inventory. All of it runs inside the owner's inventory queue, so nothing
 * else changes the Seeds in between; a refusal stores nothing.
 */
export async function repairXping(
  owner: string,
  engine: XpingEngineAccessPort,
  core: XpingRepairPort,
): Promise<XpingRepairOutcome> {
  const pay = core.xpingRepair;
  if (pay === undefined) return { kind: "unavailable" };
  let outcome: XpingRepairOutcome = { kind: "unavailable" };
  await updateInventory(owner, async (current) => {
    const read = await engine.readXpingEngine();
    if (read.kind !== "read") {
      outcome =
        read.kind === "rejected"
          ? { kind: "refused", reason: read.reason }
          : { kind: "unavailable" };
      return undefined;
    }
    const payment = await pay.call(
      core,
      JSON.stringify(read.state),
      current.state,
      read.nowMs,
    );
    if (!payment.ok) {
      outcome =
        payment.error === "not_enough_seeds" || payment.error === "not_due"
          ? { kind: "refused", reason: payment.error }
          : { kind: "unavailable" };
      return undefined;
    }
    const recorded = await engine.repairXpingEngine(
      payment.seedsSpent,
      read.state,
    );
    if (recorded.kind !== "read") {
      outcome =
        recorded.kind === "rejected"
          ? { kind: "refused", reason: recorded.reason }
          : { kind: "unavailable" };
      return undefined;
    }
    outcome = { kind: "repaired", read: recorded };
    return { state: payment.inventory };
  });
  return outcome;
}

const granted = new Set<string>();

/**
 * Gives the ten thousand starter Seeds ₴€£ once. Core keeps the once-only
 * flag in the inventory and refuses a second grant as `not_due`; this only
 * saves asking twice in one session.
 */
export async function grantStarterSeeds(
  owner: string,
  core: InventoryPort,
): Promise<boolean> {
  if (granted.has(owner)) return false;
  granted.add(owner);
  const answer = await applyInventory(owner, core, {
    op: "grant_starter_seeds",
  });
  return answer.ok;
}

/** Forgets which owners were granted this session; for tests only. */
export function resetStarterSeedsForTest(): void {
  granted.clear();
}

export function useStarterSeeds(
  owner: string,
  core: InventoryPort | undefined,
): void {
  useEffect(() => {
    if (core?.applyInventoryCommand === undefined) return;
    void grantStarterSeeds(owner, core).catch(() => undefined);
  }, [core, owner]);
}

export interface XpingEngineState {
  readonly read: XpingEngineRead | undefined;
  /** This device's clock when `read` arrived, to carry the service's on. */
  readonly receivedAt: number;
  readonly busy: boolean;
  readonly error: XpingRepairOutcome | undefined;
  repair(): void;
}

/** The engine as the Dock shows it, read again while the section is open. */
export function useXpingEngine(
  owner: string,
  engine: XpingEngineAccessPort | undefined,
  core: XpingRepairPort | undefined,
): XpingEngineState {
  const [{ read, receivedAt }, setLatest] = useState<{
    read: XpingEngineRead | undefined;
    receivedAt: number;
  }>({ read: undefined, receivedAt: 0 });
  const setRead = useCallback(
    (next: XpingEngineRead) =>
      setLatest({ read: next, receivedAt: Date.now() }),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<XpingRepairOutcome>();
  useEffect(() => {
    if (engine === undefined) return;
    let active = true;
    const load = () =>
      void engine
        .readXpingEngine()
        .then((answer) => {
          if (active && answer.kind === "read") setRead(answer);
        })
        .catch(() => undefined);
    load();
    const timer = globalThis.setInterval(load, XPING_ENGINE_REFRESH_MS);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [engine, owner, setRead]);
  const repair = useCallback(() => {
    if (engine === undefined || core === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    void repairXping(owner, engine, core)
      .then((outcome) => {
        if (outcome.kind === "repaired") setRead(outcome.read);
        else setError(outcome);
      })
      .catch(() => setError({ kind: "unavailable" }))
      .finally(() => setBusy(false));
  }, [busy, core, engine, owner, setRead]);
  return { read, receivedAt, busy, error, repair };
}
