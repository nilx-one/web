// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreRuntimePort,
  XpingEngineAccessPort,
  XpingEngineRead,
  XpingEngineRejection,
} from "@nilx-one/application";
import { useCallback, useEffect, useState } from "react";

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
 * Repairs xPing exclusively through the Identity wallet. The client reads
 * the engine and sends its expected state; it never claims seeds were paid
 * or writes a local spending event. Identity atomically debits and repairs.
 */
export async function repairXping(
  _owner: string,
  engine: XpingEngineAccessPort,
  _core?: XpingRepairPort,
): Promise<XpingRepairOutcome> {
  const read = await engine.readXpingEngine();
  if (read.kind !== "read") {
    return read.kind === "rejected"
      ? { kind: "refused", reason: read.reason }
      : { kind: "unavailable" };
  }
  const repaired = await engine.repairXpingEngine(read.state);
  if (repaired.kind === "read") return { kind: "repaired", read: repaired };
  return repaired.kind === "rejected"
    ? { kind: "refused", reason: repaired.reason }
    : { kind: "unavailable" };
}

export interface XpingEngineState {
  readonly read: XpingEngineRead | undefined;
  /** This device's clock when `read` arrived, to carry the service's on. */
  readonly receivedAt: number;
  readonly busy: boolean;
  readonly error: XpingRepairOutcome | undefined;
  /**
   * How many repairs Identity confirmed (and so debited) in this view. It
   * changes only on a confirmed repair, never on a mere engine read.
   */
  readonly repairs: number;
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
  const [repairs, setRepairs] = useState(0);
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
    if (engine === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    void repairXping(owner, engine, core)
      .then((outcome) => {
        if (outcome.kind === "repaired") {
          setRead(outcome.read);
          setRepairs((count) => count + 1);
        } else setError(outcome);
      })
      .catch(() => setError({ kind: "unavailable" }))
      .finally(() => setBusy(false));
  }, [busy, core, engine, owner, setRead]);
  return { read, receivedAt, busy, error, repairs, repair };
}
