// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * xPing's engine as the identity service stores it (nilx-one/core
 * `docs/xping-engine.md`). Core owns the rules; the service is the store and
 * the clock. Apart from the other identity ports so a service without it
 * stays a valid host: its Bonds simply never force.
 */

/** The stored engine, sent back as `expected` to price a repair from. */
export interface XpingEngineState {
  readonly energy_permille: number;
  readonly at_ms: string;
  readonly empty_forced_ms?: string;
  readonly broken_at_ms?: string;
}

export interface XpingEngineView {
  readonly energyPermille: number;
  readonly smokePermille: number;
  readonly broken: boolean;
  readonly emptyMarginMs: number;
  /** When it is whole and full again, on the service's clock. */
  readonly fullAtMs: number | undefined;
  readonly repairSeeds: number;
}

export interface XpingEngineRead {
  readonly state: XpingEngineState;
  readonly view: XpingEngineView;
  /** The service's clock when it answered. */
  readonly nowMs: number;
}

export type XpingEngineRejection =
  | "authentication-required"
  | "inactive"
  | "invalid"
  | "rate-limited"
  | "broken"
  | "full"
  | "underpaid"
  | "stale";

export type XpingEngineResult =
  | ({ readonly kind: "read" } & XpingEngineRead)
  | { readonly kind: "rejected"; readonly reason: XpingEngineRejection }
  | { readonly kind: "service-unavailable" };

export interface XpingEngineAccessPort {
  readXpingEngine(): Promise<XpingEngineResult>;
  /** Reports forcing spent; Core breaks the engine past two seconds on empty. */
  forceXpingEngine(forcedMs: number): Promise<XpingEngineResult>;
  /** Records a repair paid at the price of `expected`, the state it read. */
  repairXpingEngine(
    paidSeeds: number,
    expected: XpingEngineState,
  ): Promise<XpingEngineResult>;
}

export function hasXpingEngineAccess(
  value: unknown,
): value is XpingEngineAccessPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<XpingEngineAccessPort>;
  return (
    typeof candidate.readXpingEngine === "function" &&
    typeof candidate.forceXpingEngine === "function" &&
    typeof candidate.repairXpingEngine === "function"
  );
}

const DECIMAL = /^(0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: unknown): number | undefined {
  if (typeof value !== "string" || !DECIMAL.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function permille(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000
    ? value
    : undefined;
}

/** Reads a service answer strictly; anything unexpected is `undefined`. */
export function parseXpingEngineRead(
  body: unknown,
): XpingEngineRead | undefined {
  if (!isRecord(body) || !isRecord(body.state) || !isRecord(body.engine))
    return undefined;
  const state = body.state;
  const engine = body.engine;
  const stateEnergy = permille(state.energy_permille);
  const atMs = decimal(state.at_ms);
  const energy = permille(engine.energy_permille);
  const smoke = permille(engine.smoke_permille);
  const margin = decimal(engine.empty_margin_ms);
  const repair = decimal(engine.repair_seeds);
  const fullAt = engine.full_at_ms === null ? null : decimal(engine.full_at_ms);
  const nowMs =
    typeof body.now_ms === "number" && Number.isSafeInteger(body.now_ms)
      ? body.now_ms
      : undefined;
  if (
    stateEnergy === undefined ||
    atMs === undefined ||
    (state.empty_forced_ms !== undefined &&
      decimal(state.empty_forced_ms) === undefined) ||
    (state.broken_at_ms !== undefined &&
      decimal(state.broken_at_ms) === undefined) ||
    energy === undefined ||
    smoke === undefined ||
    margin === undefined ||
    repair === undefined ||
    fullAt === undefined ||
    typeof engine.broken !== "boolean" ||
    nowMs === undefined
  )
    return undefined;
  return {
    state: {
      energy_permille: stateEnergy,
      at_ms: state.at_ms as string,
      ...(state.empty_forced_ms === undefined
        ? {}
        : { empty_forced_ms: state.empty_forced_ms as string }),
      ...(state.broken_at_ms === undefined
        ? {}
        : { broken_at_ms: state.broken_at_ms as string }),
    },
    view: {
      energyPermille: energy,
      smokePermille: smoke,
      broken: engine.broken,
      emptyMarginMs: margin,
      fullAtMs: fullAt ?? undefined,
      repairSeeds: repair,
    },
    nowMs,
  };
}
