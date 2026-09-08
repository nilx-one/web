// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  connectBondProvider,
  disconnectBondProvider,
  type BondProviderAccount,
  type BondProviderConnections,
  type BondProviderType,
} from "@nilx-one/application";
import { useState } from "react";

/**
 * The provider attachments this client can actually attest to.
 *
 * A Bond's attachments are a service fact, and this client is not yet told
 * them: what it knows is the provider a session was proved through. Those
 * accounts are offered to the application layer one at a time, which is what
 * decides whether each one joins — the screen never counts them itself.
 *
 * Disconnecting detaches the attachment this client is holding. It reaches no
 * external account, and it does not pretend to have reached a service either.
 */

export interface BondProviderConnectionsState {
  readonly connections: BondProviderConnections;
  readonly disconnect: (provider: BondProviderType) => void;
}

export function useBondProviderConnections(
  attested: readonly BondProviderAccount[],
): BondProviderConnectionsState {
  const [detached, setDetached] = useState<readonly BondProviderType[]>([]);

  const attached = attested.reduce<BondProviderConnections>(
    (carried, account) => {
      const result = connectBondProvider(carried, account);
      // A second account of a provider the Bond already carries is refused
      // there, so it simply never arrives here.
      return result.kind === "attached" ? result.connections : carried;
    },
    [],
  );
  const connections = attached.filter(
    (account) => !detached.includes(account.provider),
  );

  return {
    connections,
    disconnect: (provider) => {
      if (disconnectBondProvider(connections, provider).kind === "rejected") {
        return;
      }
      setDetached((carried) =>
        carried.includes(provider) ? carried : [...carried, provider],
      );
    },
  };
}
