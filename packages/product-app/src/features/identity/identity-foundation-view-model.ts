// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { RuntimeReadiness } from "@nilx-one/application";
import type { HostSnapshot } from "@nilx-one/host-contract";

export type RuntimeViewState =
  | {
      tone: "loading";
      label: "Loading shared Core";
      detail: "Checking the versioned WebAssembly boundary.";
    }
  | {
      tone: "ready";
      label: "Shared Core ready";
      detail: string;
    }
  | {
      tone: "blocked";
      label: "Shared Core required";
      detail: string;
    };

export interface IdentityFoundationViewModel {
  hostLabel: string;
  runtime: RuntimeViewState;
  safeArea: HostSnapshot["safeArea"];
}

function blockedDetail(
  reason: Extract<RuntimeReadiness, { kind: "blocked" }>["reason"],
): string {
  switch (reason) {
    case "artifact-missing":
      return "The versioned Rust artifact is not connected to this build. The interface will not invent its behavior in TypeScript.";
    case "binding-invalid":
      return "The loaded binding did not expose a valid contract version, so the client stopped before creating product state.";
    case "load-failed":
      return "The shared runtime could not be loaded. This remains a visible unavailable state.";
  }
}

function hostLabel(snapshot: HostSnapshot): string {
  if (!snapshot.available) {
    return `${snapshot.kind} unavailable`;
  }

  return `${snapshot.kind} host`;
}

export function createIdentityFoundationViewModel(
  host: HostSnapshot,
  readiness: RuntimeReadiness | undefined,
): IdentityFoundationViewModel {
  if (readiness === undefined) {
    return {
      hostLabel: hostLabel(host),
      safeArea: host.safeArea,
      runtime: {
        tone: "loading",
        label: "Loading shared Core",
        detail: "Checking the versioned WebAssembly boundary.",
      },
    };
  }

  if (readiness.kind === "ready") {
    return {
      hostLabel: hostLabel(host),
      safeArea: host.safeArea,
      runtime: {
        tone: "ready",
        label: "Shared Core ready",
        detail: `Contract ${readiness.contractVersion} is available to the Web client.`,
      },
    };
  }

  return {
    hostLabel: hostLabel(host),
    safeArea: host.safeArea,
    runtime: {
      tone: "blocked",
      label: "Shared Core required",
      detail: blockedDetail(readiness.reason),
    },
  };
}
