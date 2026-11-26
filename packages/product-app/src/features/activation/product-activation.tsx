// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useMemo, type ReactNode } from "react";

import {
  createActivationPayload,
  hasClientActivationAccess,
  parkActivationPayload,
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

/**
 * Before this browser signs out, the active client parks its data on the
 * back-end, so the next client to become active applies it. Parking never
 * blocks signing out: when it cannot happen (an inactive client, no route,
 * no Core binding, a failure), the data stays on this device as before.
 */
export async function parkBeforeSignOut(
  identity: IdentityAccessPort,
  core: CoreRuntimePort,
  owner: string | undefined,
): Promise<void> {
  if (owner === undefined || !hasClientActivationAccess(identity)) return;
  const sync = syncCore(core);
  const payload = browserPayload(owner);
  if (sync === undefined || payload === undefined) return;
  try {
    const reading = await identity.readActivationState();
    if (reading.kind !== "state" || !reading.view.active) return;
    await parkActivationPayload({
      access: identity,
      core: sync,
      payload: payload.build(),
    });
  } catch {
    // Signing out goes on; the data stays on this device.
  }
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
