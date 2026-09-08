// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * A Bond may present itself through provider accounts it already owns.
 *
 * A provider account is not a Bond and never becomes one: it is an external
 * identity a Bond points at. The pointing is what this module owns — which
 * providers a Bond is attached to, that at most one account of a provider is
 * attached at a time, and where an attached account is opened. None of that is
 * presentation, so none of it may be re-decided by a screen.
 *
 * Detaching is local to this pointing. Nothing here can reach an external
 * account, and nothing here should ever be given the ability to.
 */

export const BOND_PROVIDER_TYPES = ["telegram", "discord"] as const;

export type BondProviderType = (typeof BOND_PROVIDER_TYPES)[number];

/**
 * One provider account attached to one Bond. The identity is the pair
 * (Bond, provider type) — the external address is what the attachment carries,
 * never what distinguishes one attachment from another.
 */
export interface BondProviderAccount {
  readonly provider: BondProviderType;
  /** Telegram's public @name, without the "@". Resolves an open target only. */
  readonly handle?: string | undefined;
  /** The provider's own account id, when the provider addresses by id. */
  readonly externalId?: string | undefined;
}

export type BondProviderConnections = readonly BondProviderAccount[];

export type BondProviderAttachment =
  | { kind: "attached"; connections: BondProviderConnections }
  | { kind: "rejected"; reason: "provider-already-attached" };

export type BondProviderDetachment =
  | { kind: "detached"; connections: BondProviderConnections }
  | { kind: "rejected"; reason: "not-attached" };

export function isBondProviderType(value: string): value is BondProviderType {
  return (BOND_PROVIDER_TYPES as readonly string[]).includes(value);
}

/**
 * The attachments of a Bond in one canonical order, holding at most one
 * account per provider. A caller that hands over two Telegram accounts gets
 * the first back, not both: the constraint is answered here rather than
 * wherever the list happens to be rendered.
 */
export function connectedBondProviders(
  connections: BondProviderConnections,
): BondProviderConnections {
  return BOND_PROVIDER_TYPES.flatMap((provider) => {
    const attached = connections.find(
      (account) => account.provider === provider,
    );
    return attached === undefined ? [] : [attached];
  });
}

export function bondProviderConnection(
  connections: BondProviderConnections,
  provider: BondProviderType,
): BondProviderAccount | undefined {
  return connectedBondProviders(connections).find(
    (account) => account.provider === provider,
  );
}

export function isBondProviderConnected(
  connections: BondProviderConnections,
  provider: BondProviderType,
): boolean {
  return bondProviderConnection(connections, provider) !== undefined;
}

/** One account per provider per Bond. A second one is refused, not merged. */
export function connectBondProvider(
  connections: BondProviderConnections,
  account: BondProviderAccount,
): BondProviderAttachment {
  if (isBondProviderConnected(connections, account.provider)) {
    return { kind: "rejected", reason: "provider-already-attached" };
  }

  return {
    kind: "attached",
    connections: connectedBondProviders([...connections, account]),
  };
}

/**
 * Detaches the Bond's pointer at an external account. The account itself is
 * untouched: this repository has no way to delete one, and gaining one would
 * be a different decision than this.
 */
export function disconnectBondProvider(
  connections: BondProviderConnections,
  provider: BondProviderType,
): BondProviderDetachment {
  if (!isBondProviderConnected(connections, provider)) {
    return { kind: "rejected", reason: "not-attached" };
  }

  return {
    kind: "detached",
    connections: connectedBondProviders(connections).filter(
      (account) => account.provider !== provider,
    ),
  };
}

/** How an attached account is reached, in the order a host should try. */
export type BondProviderOpenKind =
  "deep-link" | "canonical-web" | "provider-page";

export interface BondProviderOpenTarget {
  readonly kind: BondProviderOpenKind;
  readonly url: string;
}

export interface BondProviderOpenOptions {
  /** Whether this host can hand a provider URL scheme to the platform. */
  readonly deepLinkCapable?: boolean;
}

const TELEGRAM_HANDLE = /^[A-Za-z0-9_]{5,32}$/;
const DISCORD_SNOWFLAKE = /^[0-9]{17,20}$/;

function telegramHandle(account: BondProviderAccount): string | undefined {
  const handle = account.handle?.trim().replace(/^@/, "");
  return handle !== undefined && TELEGRAM_HANDLE.test(handle)
    ? handle
    : undefined;
}

function discordAccountId(account: BondProviderAccount): string | undefined {
  const id = account.externalId?.trim();
  return id !== undefined && DISCORD_SNOWFLAKE.test(id) ? id : undefined;
}

/**
 * Where a connected account is opened, best target first.
 *
 * A provider scheme is offered only to a host that can follow one; a web
 * address that names the account comes next; and the provider's own entry
 * point is always last, so an attachment whose external address this client
 * does not know still opens somewhere rather than nowhere.
 */
export function bondProviderOpenTargets(
  account: BondProviderAccount,
  options: BondProviderOpenOptions = {},
): readonly BondProviderOpenTarget[] {
  const deepLinkCapable = options.deepLinkCapable ?? false;
  const targets: BondProviderOpenTarget[] = [];

  if (account.provider === "telegram") {
    const handle = telegramHandle(account);
    if (handle !== undefined) {
      if (deepLinkCapable) {
        targets.push({
          kind: "deep-link",
          url: `tg://resolve?domain=${handle}`,
        });
      }
      targets.push({ kind: "canonical-web", url: `https://t.me/${handle}` });
    }
    targets.push({ kind: "provider-page", url: "https://t.me" });
    return targets;
  }

  const id = discordAccountId(account);
  if (id !== undefined) {
    if (deepLinkCapable) {
      targets.push({ kind: "deep-link", url: `discord://-/users/${id}` });
    }
    targets.push({
      kind: "canonical-web",
      url: `https://discord.com/users/${id}`,
    });
  }
  targets.push({
    kind: "provider-page",
    url: "https://discord.com/channels/@me",
  });
  return targets;
}

/**
 * The one target a host should try first. The provider page is appended
 * unconditionally, so a first target always exists.
 */
export function bondProviderOpenTarget(
  account: BondProviderAccount,
  options: BondProviderOpenOptions = {},
): BondProviderOpenTarget {
  const targets = bondProviderOpenTargets(account, options);
  const first = targets[0];
  if (first === undefined) {
    throw new Error("0x1 resolved no open target for a provider account");
  }
  return first;
}
