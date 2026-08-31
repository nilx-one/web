// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  IdentityLookupResult,
  IdentityRegistrationResult,
  RuntimeReadiness,
} from "@nilx-one/application";
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
  registration: RegistrationViewState;
  runtime: RuntimeViewState;
  safeArea: HostSnapshot["safeArea"];
}

export type RegistrationViewState =
  | {
      kind: "telegram-required";
      detail: "Registration is currently available through the 0x1 Telegram Mini App.";
    }
  | {
      kind: "loading";
      detail: "Checking whether this Telegram account already has a pub_dress.";
    }
  | {
      kind: "form";
      busy: boolean;
      error?: string;
    }
  | {
      kind: "registered";
      pubDress: string;
    }
  | {
      kind: "unavailable";
      detail: "Identity registration is temporarily unavailable.";
    };

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
  identity: IdentityLookupResult | undefined = undefined,
  registration: IdentityRegistrationResult | undefined = undefined,
  registrationPending = false,
): IdentityFoundationViewModel {
  const registrationView = createRegistrationViewState(
    host,
    identity,
    registration,
    registrationPending,
  );

  if (readiness === undefined) {
    return {
      hostLabel: hostLabel(host),
      registration: registrationView,
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
      registration: registrationView,
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
    registration: registrationView,
    safeArea: host.safeArea,
    runtime: {
      tone: "blocked",
      label: "Shared Core required",
      detail: blockedDetail(readiness.reason),
    },
  };
}

function createRegistrationViewState(
  host: HostSnapshot,
  identity: IdentityLookupResult | undefined,
  registration: IdentityRegistrationResult | undefined,
  pending: boolean,
): RegistrationViewState {
  if (
    host.kind !== "telegram" ||
    !host.available ||
    host.authentication.kind !== "telegram-init-data" ||
    host.authentication.initData.length === 0
  ) {
    return {
      kind: "telegram-required",
      detail:
        "Registration is currently available through the 0x1 Telegram Mini App.",
    };
  }

  if (registration?.kind === "registered") {
    return { kind: "registered", pubDress: registration.identity.pubDress };
  }

  if (identity?.kind === "registered") {
    return { kind: "registered", pubDress: identity.identity.pubDress };
  }

  if (identity === undefined) {
    return {
      kind: "loading",
      detail: "Checking whether this Telegram account already has a pub_dress.",
    };
  }

  if (identity.kind === "service-unavailable") {
    return {
      kind: "unavailable",
      detail: "Identity registration is temporarily unavailable.",
    };
  }

  if (identity.kind === "authentication-required") {
    return {
      kind: "telegram-required",
      detail:
        "Registration is currently available through the 0x1 Telegram Mini App.",
    };
  }

  let error: string | undefined;
  if (registration?.kind === "service-unavailable") {
    error = "Identity registration is temporarily unavailable.";
  } else if (registration?.kind === "rejected") {
    switch (registration.reason) {
      case "authentication-required":
        error = "Reopen 0x1 from Telegram and try again.";
        break;
      case "invalid-length":
        error = "Use 2–32 characters after 0x.";
        break;
      case "invalid-character":
        error = "That slug contains a character 0x1 does not accept.";
        break;
      case "unavailable":
        error = "That pub_dress cannot be registered. Choose another one.";
        break;
    }
  }

  return {
    kind: "form",
    busy: pending,
    ...(error === undefined ? {} : { error }),
  };
}
