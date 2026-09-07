// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type CoreUnavailableReason =
  | "artifact-missing"
  | "binding-invalid"
  | "load-failed";

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
  derivePubDressLabel?(
    pubDress: string,
  ): Promise<CorePubDressLabelResult>;
  composePubDressLabel?(
    pubDress: string,
    suffix: string,
  ): Promise<CorePubDressLabelResult>;
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
