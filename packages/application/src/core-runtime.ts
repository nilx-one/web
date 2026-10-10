// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { OrbWorldInput, OrbWorldView } from "./orb-world";
import type {
  AvaiaDriveAnswer,
  AvaiaDriveInput,
  AvaiaLifeAnswer,
  AvaiaLifeCommand,
  AvaiaProximityPolicy,
} from "./avaia-drive";

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

/** A repair or a craft, as Core's catalog lists it. */
export interface CoreRecipe {
  readonly id: string;
  readonly consumes: readonly { readonly id: string; readonly count: number }[];
  /** Needed, and kept. */
  readonly tools: readonly string[];
  readonly seeds: number;
  readonly makes: string;
  /** What finishing it pays the Bond. */
  readonly experience: number;
  readonly place: "anywhere" | "repair_workshop";
  readonly minutes: number;
  /** A week, or at once for real money. */
  readonly legendary: boolean;
}

/** What things are carried in, and its grid. */
export interface CoreCarry extends CoreSize {
  readonly id: "pocket" | "backpack" | "bag";
  /** Seeds it costs, or `null` for pockets, which everyone has. */
  readonly price: number | null;
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
  readonly recipes: readonly CoreRecipe[];
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
   * Whether xSasha's backpack gift is due for a stored inventory at the
   * Bond's level (`docs/economy.md` in core). Rejects a malformed state.
   */
  backpackGiftDue?(state: string, bondLevel: number): Promise<boolean>;
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
  /**
   * One step of the Avaia's drive (`docs/avaia-drive.md` in core): the stored
   * drive, `""` for a fresh one, one input, the wall clock and the local hour.
   * A refused input resolves `ok: false`; the stored drive is then kept.
   */
  avaiaDriveStep?(
    state: string,
    input: AvaiaDriveInput,
    nowMs: number,
    hour: number,
  ): Promise<AvaiaDriveAnswer>;
  /**
   * One command to Avaia life (`docs/avaia-life.md` in core) for the Avaia
   * `subject` its Bond `owner` owns, on the stored state, `""` before it is
   * initialized. A refused command resolves `ok: false`.
   */
  applyAvaiaLife?(
    state: string,
    owner: string,
    subject: string,
    command: AvaiaLifeCommand,
  ): Promise<AvaiaLifeAnswer>;
  /**
   * Core is the sole authority for fog capability and reveal duration. The
   * host hands back whether the last answer blocked reveals (`true` when it
   * has none), which is what makes the restore below 90% of red a transition.
   */
  avaiaProximity?(
    distanceMeters: number,
    artifacts: number,
    previouslyBlocked: boolean,
  ): Promise<AvaiaProximityPolicy>;
  /**
   * Core is the sole authority for orbs: what lies where, when it lands, and
   * what the Bond and the Avaia reach now. The host draws the answer and
   * claims what is in reach; it decides nothing about an orb itself.
   */
  orbWorld?(world: OrbWorldInput, nowMs: number): Promise<OrbWorldView>;
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
  | { readonly op: "finish_paid" }
  | {
      readonly op: "buy_carry";
      readonly holder: CoreHolder;
      readonly carry: "backpack" | "bag";
    }
  | { readonly op: "gift_backpacks"; readonly bond_level: number };

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
