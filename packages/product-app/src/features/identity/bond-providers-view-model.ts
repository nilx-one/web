// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  BOND_PROVIDER_TYPES,
  bondProviderConnection,
  bondProviderOpenTarget,
  connectedBondProviders,
  type BondProviderConnections,
  type BondProviderOpenKind,
  type BondProviderType,
} from "@nilx-one/application";

/**
 * The Bond's providers as two surfaces read the same facts.
 *
 * The compact edit surface shows which providers are attached and nothing
 * about the accounts behind them. The Providers screen shows every provider
 * this client supports, attached or not, and what may be done about each. No
 * screen decides whether an attachment is allowed: that answer arrives from
 * the application layer already made.
 */

export interface ProviderRowViewState {
  readonly provider: BondProviderType;
  readonly label: string;
  /** The mark the compact row shows in place of any account text. */
  readonly glyph: string;
  readonly connected: boolean;
  readonly status: string;
  /** Where this account opens, and by which of the resolved routes. */
  readonly openUrl: string | undefined;
  readonly openKind: BondProviderOpenKind | undefined;
  readonly openLabel: string;
  readonly connectHref: string;
  readonly connectLabel: string;
  readonly disconnectLabel: string;
}

export interface BondProvidersViewState {
  /** Every supported provider, in one stable order. */
  readonly rows: readonly ProviderRowViewState[];
  /** Only what the Bond already carries — the compact row's whole content. */
  readonly connected: readonly ProviderRowViewState[];
  /** Whether any provider is still unattached, so "add" leads somewhere. */
  readonly connectable: boolean;
}

export interface BondProvidersViewOptions {
  /**
   * The providers whose URL scheme this host can hand to the platform. A host
   * that is itself the provider can; a browser tab generally cannot, and a
   * scheme nothing answers is a dead end rather than a shortcut.
   */
  readonly deepLinkProviders?: readonly BondProviderType[];
}

function providerLabel(provider: BondProviderType): string {
  return provider === "telegram" ? "Telegram" : "Discord";
}

function providerGlyph(provider: BondProviderType): string {
  return provider === "telegram" ? "TG" : "DC";
}

export function providerConnectHref(provider: BondProviderType): string {
  return `/auth?provider=${provider}&intent=connect`;
}

export function createBondProvidersViewState(
  connections: BondProviderConnections,
  options: BondProvidersViewOptions = {},
): BondProvidersViewState {
  const attached = connectedBondProviders(connections);
  const rows = BOND_PROVIDER_TYPES.map((provider): ProviderRowViewState => {
    const account = bondProviderConnection(attached, provider);
    const label = providerLabel(provider);
    const target =
      account === undefined
        ? undefined
        : bondProviderOpenTarget(account, {
            deepLinkCapable:
              options.deepLinkProviders?.includes(provider) ?? false,
          });

    return {
      provider,
      label,
      glyph: providerGlyph(provider),
      connected: account !== undefined,
      status: account === undefined ? "Not connected" : "Connected",
      openUrl: target?.url,
      openKind: target?.kind,
      openLabel: `Open ${label}`,
      connectHref: providerConnectHref(provider),
      connectLabel: `Connect ${label}`,
      // A delete glyph carries this action, so its name has to say what the
      // glyph does not: the external account is never touched.
      disconnectLabel: `Disconnect ${label} from this Bond`,
    };
  });

  return {
    rows,
    connected: rows.filter((row) => row.connected),
    connectable: rows.some((row) => !row.connected),
  };
}
