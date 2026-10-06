// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type CoreUnavailableReason =
  "artifact-missing" | "binding-invalid" | "load-failed";

export type CoreRuntimeStatus =
  | {
      kind: "ready";
      contractVersion: string;
    }
  | {
      kind: "unavailable";
      reason: CoreUnavailableReason;
    };

export type CorePubDressLabelErrorCode =
  | "not_a_pub_dress"
  | "invalid_character"
  | "disallowed_scalar"
  | "bidi_rule"
  | "not_encodable"
  | "boundary_hyphen"
  | "too_long"
  | "suffix_too_long";

export type CorePubDressLabelResult =
  | { kind: "label"; label: string }
  | { kind: "error"; code: CorePubDressLabelErrorCode };

/** Which item of Core's catalog a rolled find is. */
export type CoreFindItemResult =
  { kind: "item"; id: string } | { kind: "error"; code: string };

/** One thing a find can be, as Core's economy catalog lists it. */
export interface CoreFoundItem {
  readonly id: string;
  readonly tier: number;
  readonly rarity: "common" | "uncommon" | "rare" | "legendary";
  /** What picking it up pays: the item's own, not its tier's. */
  readonly experience: number;
  /** Seeds it is worth on the spot: money, never kept as a thing. */
  readonly seeds: number;
  /** What a sale pays, or `null` for a thing nobody buys. */
  readonly sellPrice: number | null;
  /** The cells it takes, or `null` for money. */
  readonly size: CoreSize | null;
}

export interface CoreSize {
  readonly width: number;
  readonly height: number;
}

/** A thing only made, never found. */
export interface CoreCraftedItem {
  readonly id: string;
  readonly sellPrice: number | null;
  readonly size: CoreSize | null;
}

/** What things are carried in, and its grid. */
export interface CoreCarry extends CoreSize {
  readonly id: "pocket" | "backpack" | "bag";
}

/**
 * Core's economy catalog (`economy_catalog`), as far as the client reads it
 * today. The wire carries more (prices, sizes, recipes, grids); a field is
 * added here when a surface uses it.
 */
export interface CoreEconomyCatalog {
  readonly findCatalogVersion: number;
  readonly economyVersion: number;
  readonly currency: { readonly code: string; readonly emblem: string };
  readonly found: readonly CoreFoundItem[];
  readonly crafted: readonly CoreCraftedItem[];
  readonly carries: readonly CoreCarry[];
}

/**
 * Core's answer to one inventory command (`apply_inventory_command`). `state`
 * is the next stored inventory, opaque here: only Core reads it.
 */
export type CoreInventoryAnswer =
  | {
      readonly ok: true;
      readonly state: string;
      readonly seedsGained: number;
      readonly seedsSpent: number;
      readonly experience: number;
      /** The item a pick-up turned out to be. */
      readonly item?: string;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Product-facing boundary to the versioned 0x1 Core runtime.
 *
 * Label operations are optional at the interface level so older test doubles
 * and deliberately unavailable runtimes remain representable. A ready
 * production adapter supplied by `@nilx-one/core-wasm` implements them; product
 * code must fail closed when they are absent rather than reimplement UTS-46.
 */
export interface CoreRuntimePort {
  probe(): Promise<CoreRuntimeStatus>;
  derivePubDressLabel?(pubDress: string): Promise<CorePubDressLabelResult>;
  composePubDressLabel?(
    pubDress: string,
    suffix: string,
  ): Promise<CorePubDressLabelResult>;
  /** Core's catalog pick for a rolled find (`docs/find-items.md` in core). */
  findItem?(artifactId: string, tier: number): Promise<CoreFindItemResult>;
  /**
   * Whether the stored pick-up setting (Core's wire form, e.g.
   * `common,rare`) picks up a find of `tier`. Rejects on a malformed setting.
   */
  picksUp?(rarities: string, tier: number): Promise<boolean>;
  /** Core's economy catalog. Rejects on a malformed one. */
  economyCatalog?(): Promise<CoreEconomyCatalog>;
  /**
   * Applies one inventory command (Core's wire form, `docs/economy.md` in
   * core) to a stored inventory, `""` for a new one. A refused command
   * resolves `ok: false`; the stored state is then kept as it was.
   */
  applyInventoryCommand?(
    state: string,
    command: CoreInventoryCommand,
    nowMs: number,
  ): Promise<CoreInventoryAnswer>;
}

export type CoreHolder = "bond" | "avaia";

/** One inventory command, as Core's wire names it. */
export type CoreInventoryCommand =
  | {
      readonly op: "pick_up";
      readonly holder: CoreHolder;
      readonly artifact_id: string;
      readonly tier: number;
    }
  | {
      readonly op: "rearrange";
      readonly holder: CoreHolder;
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
    }
  | {
      readonly op: "hand_over";
      readonly from: CoreHolder;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly op: "switch_carry";
      readonly holder: CoreHolder;
      readonly carry: "pocket" | "backpack" | "bag";
    }
  | { readonly op: "sell"; readonly id: string; readonly count: number }
  | {
      readonly op: "start_craft";
      readonly recipe: string;
      readonly place: "anywhere" | "repair_workshop";
    }
  | { readonly op: "finish_craft" }
  | { readonly op: "finish_paid" };

export type RuntimeReadiness =
  | {
      kind: "ready";
      contractVersion: string;
    }
  | {
      kind: "blocked";
      reason: CoreUnavailableReason;
    };

export class ReadRuntimeReadiness {
  public constructor(private readonly core: CoreRuntimePort) {}

  public async execute(): Promise<RuntimeReadiness> {
    try {
      const status = await this.core.probe();

      if (status.kind === "ready") {
        return status;
      }

      return {
        kind: "blocked",
        reason: status.reason,
      };
    } catch {
      return {
        kind: "blocked",
        reason: "load-failed",
      };
    }
  }
}
