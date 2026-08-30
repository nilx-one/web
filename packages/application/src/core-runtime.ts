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

export interface CoreRuntimePort {
  probe(): Promise<CoreRuntimeStatus>;
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
