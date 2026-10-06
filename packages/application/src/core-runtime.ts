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
}

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
}

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
