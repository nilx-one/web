// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useMemo, type ReactNode } from "react";

import {
  createActivationPayload,
  hasClientActivationAccess,
  type ActivationPayloadPort,
  type ActivationSyncCore,
  type CoreRuntimePort,
  type IdentityAccessPort,
} from "@nilx-one/application";

import { ClientActivationGate } from "./client-activation-gate";

function browserPayload(owner: string): ActivationPayloadPort | undefined {
  try {
    return createActivationPayload(window.localStorage, owner);
  } catch {
    return undefined;
  }
}

function syncCore(core: CoreRuntimePort): ActivationSyncCore | undefined {
  const part = core.activationSyncPart;
  const digest = core.activationSyncDigest;
  if (part === undefined || digest === undefined) return undefined;
  return {
    activationSyncPart: (totalBytes, offset) =>
      part.call(core, totalBytes, offset),
    activationSyncDigest: (data) => digest.call(core, data),
  };
}

export interface ProductActivationProps {
  readonly identity: IdentityAccessPort;
  readonly core: CoreRuntimePort;
  /** The signed-in Bond whose records a handoff carries. */
  readonly owner: string;
  readonly children: ReactNode;
}

/** The activation gate for a host whose identity service serves the routes. */
export function ProductActivation({
  identity,
  core,
  owner,
  children,
}: ProductActivationProps) {
  const payload = useMemo(() => browserPayload(owner), [owner]);
  const sync = useMemo(() => syncCore(core), [core]);
  if (!hasClientActivationAccess(identity)) return children;
  return (
    <ClientActivationGate
      access={identity}
      {...(sync === undefined ? {} : { core: sync })}
      {...(payload === undefined ? {} : { payload })}
    >
      {children}
    </ClientActivationGate>
  );
}
