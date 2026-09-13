from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


replace_once(
    "packages/application/src/bond-providers.ts",
    'export const BOND_PROVIDER_TYPES = ["telegram", "discord"] as const;',
    'export const BOND_PROVIDER_TYPES = ["telegram", "discord", "github"] as const;',
)
replace_once(
    "packages/application/src/bond-providers.ts",
    '''  const id = discordAccountId(account);
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
''',
    '''  if (account.provider === "discord") {
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

  // The identity-only GitHub binding deliberately stores no login or OAuth
  // token. Without an account address, opening GitHub itself is the only target
  // this attachment can truthfully resolve.
  targets.push({ kind: "provider-page", url: "https://github.com" });
  return targets;
''',
)

replace_once(
    "packages/application/src/bond-providers.test.ts",
    '''const DISCORD = {
  provider: "discord",
  externalId: "84759302847591038",
} as const;
''',
    '''const DISCORD = {
  provider: "discord",
  externalId: "84759302847591038",
} as const;
const GITHUB = { provider: "github" } as const;
''',
)
replace_once(
    "packages/application/src/bond-providers.test.ts",
    '''    const second = connectBondProvider(first.connections, DISCORD);

    expect(second).toEqual({
      kind: "attached",
      connections: [TELEGRAM, DISCORD],
    });
''',
    '''    const second = connectBondProvider(first.connections, DISCORD);
    expect(second.kind).toBe("attached");
    if (second.kind !== "attached") return;

    const third = connectBondProvider(second.connections, GITHUB);

    expect(third).toEqual({
      kind: "attached",
      connections: [TELEGRAM, DISCORD, GITHUB],
    });
''',
)
replace_once(
    "packages/application/src/bond-providers.test.ts",
    '''    expect(isBondProviderType("telegram")).toBe(true);
    expect(isBondProviderType("matrix")).toBe(false);
''',
    '''    expect(isBondProviderType("telegram")).toBe(true);
    expect(isBondProviderType("github")).toBe(true);
    expect(isBondProviderType("matrix")).toBe(false);
''',
)
replace_once(
    "packages/application/src/bond-providers.test.ts",
    '''  it("falls back to the provider itself when the address is unusable", () => {
''',
    '''  it("opens an identity-only GitHub binding without inventing a login", () => {
    expect(bondProviderOpenTargets(GITHUB)).toEqual([
      { kind: "provider-page", url: "https://github.com" },
    ]);
  });

  it("falls back to the provider itself when the address is unusable", () => {
''',
)

replace_once(
    "packages/application/src/identity-registration.ts",
    "// SPDX-License-Identifier: MPL-2.0\n\n",
    '''// SPDX-License-Identifier: MPL-2.0

import type {
  BondProviderConnections,
  BondProviderType,
} from "./bond-providers";

''',
)
replace_once(
    "packages/application/src/identity-registration.ts",
    '''export type BrowserProviderLinkResult =
  | { kind: "linked"; provider: BrowserIdentityProvider }
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "provider-proof-required"
        | "provider-already-linked"
        | "session-changed";
    }
  | { kind: "service-unavailable" };
''',
    '''export type BrowserProviderLinkResult =
  | { kind: "linked"; provider: BrowserIdentityProvider }
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "provider-proof-required"
        | "provider-already-linked"
        | "provider-type-already-linked"
        | "session-changed";
    }
  | { kind: "service-unavailable" };

export type BrowserProviderConnectionsResult =
  | { kind: "available"; connections: BondProviderConnections }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type BrowserProviderDisconnectResult =
  | { kind: "disconnected"; provider: BondProviderType }
  | {
      kind: "rejected";
      reason: "authentication-required" | "not-connected";
    }
  | { kind: "service-unavailable" };
''',
)
replace_once(
    "packages/application/src/identity-registration.ts",
    '''  linkBrowserProvider?(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult>;
}
''',
    '''  linkBrowserProvider?(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult>;
  /** Authenticated browser projection of the provider bindings this Bond owns. */
  readBrowserProviderConnections?(): Promise<BrowserProviderConnectionsResult>;
  /**
   * Removes only the 0x1 binding. The external provider account is outside this
   * port and cannot be deleted by this operation.
   */
  disconnectBrowserProvider?(
    provider: BondProviderType,
  ): Promise<BrowserProviderDisconnectResult>;
}
''',
)
replace_once(
    "packages/application/src/identity-registration.ts",
    '''export class LinkBrowserProvider {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult> {
    const link = this.identity.linkBrowserProvider;
    if (link === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await link.call(this.identity, expectedPubDress);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}
''',
    '''export class LinkBrowserProvider {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult> {
    const link = this.identity.linkBrowserProvider;
    if (link === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await link.call(this.identity, expectedPubDress);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ReadBrowserProviderConnections {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<BrowserProviderConnectionsResult> {
    const read = this.identity.readBrowserProviderConnections;
    if (read === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await read.call(this.identity);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class DisconnectBrowserProvider {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    provider: BondProviderType,
  ): Promise<BrowserProviderDisconnectResult> {
    const disconnect = this.identity.disconnectBrowserProvider;
    if (disconnect === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await disconnect.call(this.identity, provider);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}
''',
)

replace_once(
    "packages/application/src/index.ts",
    '''  BeginBrowserProviderAuthorization,
  ForgetRememberedBond,
  LinkBrowserProvider,
  LogoutNativeIdentity,
  ReadBrowserProviderContext,
''',
    '''  BeginBrowserProviderAuthorization,
  DisconnectBrowserProvider,
  ForgetRememberedBond,
  LinkBrowserProvider,
  LogoutNativeIdentity,
  ReadBrowserProviderConnections,
  ReadBrowserProviderContext,
''',
)
replace_once(
    "packages/application/src/index.ts",
    '''  type BrowserProviderAvailability,
  type BrowserProviderContextResult,
  type BrowserProviderLinkResult,
''',
    '''  type BrowserProviderAvailability,
  type BrowserProviderConnectionsResult,
  type BrowserProviderContextResult,
  type BrowserProviderDisconnectResult,
  type BrowserProviderLinkResult,
''',
)

replace_once(
    "packages/identity-http/src/index.ts",
    '''  isAvatarModel,
  formatPubDress,
  type BrowserIdentityProvider,
  type BrowserProviderContextResult,
  type BrowserProviderLinkResult,
''',
    '''  isAvatarModel,
  formatPubDress,
  isBondProviderType,
  type BondProviderType,
  type BrowserIdentityProvider,
  type BrowserProviderConnectionsResult,
  type BrowserProviderContextResult,
  type BrowserProviderDisconnectResult,
  type BrowserProviderLinkResult,
''',
)
replace_once(
    "packages/identity-http/src/index.ts",
    '''      case "provider_already_linked":
        return { kind: "rejected", reason: "provider-already-linked" };
      case "native_session_changed":
''',
    '''      case "provider_already_linked":
        return { kind: "rejected", reason: "provider-already-linked" };
      case "provider_type_already_linked":
        return { kind: "rejected", reason: "provider-type-already-linked" };
      case "native_session_changed":
''',
)
replace_once(
    "packages/identity-http/src/index.ts",
    '''  private async nativeAuthenticationRequest(
''',
    '''  public async readBrowserProviderConnections(): Promise<BrowserProviderConnectionsResult> {
    const response = await this.fetch(
      "/api/v1/auth/browser/provider/connections",
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      body.state === "available" &&
      Array.isArray(body.providers) &&
      body.providers.every(isBondProviderType)
    ) {
      return {
        kind: "available",
        connections: body.providers.map((provider) => ({ provider })),
      };
    }
    return parseErrorCode(body) === "native_authentication_required"
      ? { kind: "authentication-required" }
      : { kind: "service-unavailable" };
  }

  public async disconnectBrowserProvider(
    provider: BondProviderType,
  ): Promise<BrowserProviderDisconnectResult> {
    const response = await this.fetch(
      "/api/v1/auth/browser/provider/disconnect",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ provider }),
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      body.state === "disconnected" &&
      isBondProviderType(body.provider)
    ) {
      return { kind: "disconnected", provider: body.provider };
    }
    switch (parseErrorCode(body)) {
      case "native_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "provider_not_connected":
        return { kind: "rejected", reason: "not-connected" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  private async nativeAuthenticationRequest(
''',
)

test_path = "packages/identity-http/src/index.test.ts"
test_text = read(test_path)
test_text += r'''

describe("Browser provider connection transport", () => {
  it("reads canonical provider bindings from the authenticated service", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "available",
        providers: ["telegram", "github"],
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readBrowserProviderConnections?.()).resolves.toEqual({
      kind: "available",
      connections: [{ provider: "telegram" }, { provider: "github" }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/browser/provider/connections",
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
  });

  it("disconnects only the selected provider binding with CSRF protection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "disconnected",
        provider: "github",
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.disconnectBrowserProvider?.("github")).resolves.toEqual({
      kind: "disconnected",
      provider: "github",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/browser/provider/disconnect",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ provider: "github" }),
      },
    );
  });

  it("rejects malformed provider lists instead of inventing connection truth", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "available",
        providers: ["github", "matrix"],
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readBrowserProviderConnections?.()).resolves.toEqual({
      kind: "service-unavailable",
    });
  });
});
'''
write(test_path, test_text)

write(
    "services/identity/src/provider_link.rs",
r'''// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};

use crate::{IdentityProvider, ProviderIdentity, PubDress};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderLinkOutcome {
    Linked,
    AlreadyLinked,
    ProviderAlreadyLinked,
    ProviderTypeAlreadyLinked,
    IdentityMissing,
}

#[derive(Clone, Debug)]
pub struct ProviderLinkRepository {
    pool: SqlitePool,
}

impl ProviderLinkRepository {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let max_connections = if database_url.contains(":memory:") { 1 } else { 5 };
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(false)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    pub async fn link(
        &self,
        pub_dress: &PubDress,
        provider: &ProviderIdentity,
    ) -> Result<ProviderLinkOutcome, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let human_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE pub_dress = ? AND identity_kind = 'human')",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if !human_exists {
            transaction.rollback().await?;
            return Ok(ProviderLinkOutcome::IdentityMissing);
        }

        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = ? AND provider_subject = ?",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .fetch_optional(&mut *transaction)
        .await?
        {
            transaction.commit().await?;
            return Ok(if existing_pub_dress == pub_dress.as_str() {
                ProviderLinkOutcome::AlreadyLinked
            } else {
                ProviderLinkOutcome::ProviderAlreadyLinked
            });
        }

        let same_provider_subject = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = ? LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .bind(provider.provider.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        if same_provider_subject.is_some() {
            transaction.commit().await?;
            return Ok(ProviderLinkOutcome::ProviderTypeAlreadyLinked);
        }

        let insert = sqlx::query(
            "INSERT INTO identity_providers (provider, provider_subject, pub_dress) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .bind(pub_dress.as_str())
        .execute(&mut *transaction)
        .await?;
        if insert.rows_affected() == 1 {
            transaction.commit().await?;
            return Ok(ProviderLinkOutcome::Linked);
        }

        let existing_pub_dress = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = ? AND provider_subject = ?",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing_pub_dress) = existing_pub_dress {
            transaction.commit().await?;
            return Ok(if existing_pub_dress == pub_dress.as_str() {
                ProviderLinkOutcome::AlreadyLinked
            } else {
                ProviderLinkOutcome::ProviderAlreadyLinked
            });
        }

        let same_provider_subject = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = ? LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .bind(provider.provider.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(if same_provider_subject.is_some() {
            ProviderLinkOutcome::ProviderTypeAlreadyLinked
        } else {
            ProviderLinkOutcome::IdentityMissing
        })
    }

    pub async fn list(&self, pub_dress: &PubDress) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar::<_, String>(
            "SELECT provider FROM identity_providers WHERE pub_dress = ? ORDER BY CASE provider WHEN 'telegram' THEN 0 WHEN 'discord' THEN 1 WHEN 'github' THEN 2 ELSE 99 END",
        )
        .bind(pub_dress.as_str())
        .fetch_all(&self.pool)
        .await
    }

    pub async fn unlink(
        &self,
        pub_dress: &PubDress,
        provider: IdentityProvider,
    ) -> Result<bool, sqlx::Error> {
        let deleted = sqlx::query(
            "DELETE FROM identity_providers WHERE pub_dress = ? AND provider = ?",
        )
        .bind(pub_dress.as_str())
        .bind(provider.as_str())
        .execute(&self.pool)
        .await?;
        Ok(deleted.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{ProviderLinkOutcome, ProviderLinkRepository};
    use crate::{IdentityProvider, IdentityRepository, ProviderIdentity, PubDress};

    async fn register_bond(identities: &IdentityRepository, pub_dress: &str, seed: &str) -> PubDress {
        let bond = PubDress::from_str(pub_dress).expect("valid Bond");
        identities
            .register_native(
                &bond,
                "hash",
                1,
                format!("recovery-{seed}").as_bytes(),
                format!("challenge-{seed}").as_bytes(),
                format!("idempotency-{seed}").as_bytes(),
                100,
                200,
            )
            .await
            .expect("native Bond registration");
        bond
    }

    #[tokio::test]
    async fn verified_provider_can_only_link_to_an_existing_human_bond() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url).await.expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url).await.expect("provider link repository");
        let bond = register_bond(&identities, "0x0sky", "first").await;

        assert_eq!(links.link(&bond, &ProviderIdentity::telegram(42)).await.expect("link"), ProviderLinkOutcome::Linked);
        assert_eq!(links.link(&bond, &ProviderIdentity::telegram(42)).await.expect("idempotent link"), ProviderLinkOutcome::AlreadyLinked);
        assert_eq!(identities.find_by_provider(&ProviderIdentity::telegram(42)).await.expect("provider lookup").expect("bound identity").pub_dress, "0x0sky");
        assert_eq!(links.link(&bond, &ProviderIdentity::github(75973992)).await.expect("GitHub link"), ProviderLinkOutcome::Linked);
        assert_eq!(links.list(&bond).await.expect("provider list"), vec!["telegram".to_owned(), "github".to_owned()]);
    }

    #[tokio::test]
    async fn one_bond_has_one_account_per_provider_type_and_can_disconnect_it() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url).await.expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url).await.expect("provider link repository");
        let bond = register_bond(&identities, "0x0sky", "one-provider").await;

        assert_eq!(links.link(&bond, &ProviderIdentity::github(1)).await.expect("first GitHub link"), ProviderLinkOutcome::Linked);
        assert_eq!(links.link(&bond, &ProviderIdentity::github(2)).await.expect("second GitHub link"), ProviderLinkOutcome::ProviderTypeAlreadyLinked);
        assert_eq!(links.list(&bond).await.expect("provider list"), vec!["github".to_owned()]);
        assert!(links.unlink(&bond, IdentityProvider::Github).await.expect("unlink"));
        assert!(links.list(&bond).await.expect("provider list").is_empty());
        assert!(!links.unlink(&bond, IdentityProvider::Github).await.expect("idempotent absence"));
    }

    #[tokio::test]
    async fn provider_binding_cannot_be_moved_between_bonds() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url).await.expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url).await.expect("provider link repository");
        let first = register_bond(&identities, "0x0sky", "first").await;
        let second = register_bond(&identities, "0x1sky", "second").await;
        let provider = ProviderIdentity::discord("42");

        assert_eq!(links.link(&first, &provider).await.expect("first link"), ProviderLinkOutcome::Linked);
        assert_eq!(links.link(&second, &provider).await.expect("second link"), ProviderLinkOutcome::ProviderAlreadyLinked);
    }
}
''')

replace_once(
    "services/identity/src/browser_web_auth.rs",
    '''        .route(
            "/api/v1/auth/browser/provider/link",
            post(link_pending_provider),
        )
        .with_state(state)
''',
    '''        .route(
            "/api/v1/auth/browser/provider/link",
            post(link_pending_provider),
        )
        .route(
            "/api/v1/auth/browser/provider/connections",
            get(read_provider_connections),
        )
        .route(
            "/api/v1/auth/browser/provider/disconnect",
            post(disconnect_provider),
        )
        .with_state(state)
''',
)
replace_once(
    "services/identity/src/browser_web_auth.rs",
    '''    fn identity(self, subject: String) -> ProviderIdentity {
        ProviderIdentity {
            provider: match self {
                Self::Telegram => IdentityProvider::Telegram,
                Self::Discord => IdentityProvider::Discord,
                Self::Github => IdentityProvider::Github,
            },
            subject,
        }
    }
''',
    '''    const fn identity_provider(self) -> IdentityProvider {
        match self {
            Self::Telegram => IdentityProvider::Telegram,
            Self::Discord => IdentityProvider::Discord,
            Self::Github => IdentityProvider::Github,
        }
    }

    fn identity(self, subject: String) -> ProviderIdentity {
        ProviderIdentity {
            provider: self.identity_provider(),
            subject,
        }
    }
''',
)
replace_once(
    "services/identity/src/browser_web_auth.rs",
    '''            Ok(ProviderLinkOutcome::ProviderAlreadyLinked) => {
                callback_failure("provider_already_linked")
            }
            Ok(ProviderLinkOutcome::IdentityMissing) => {
''',
    '''            Ok(ProviderLinkOutcome::ProviderAlreadyLinked) => {
                callback_failure("provider_already_linked")
            }
            Ok(ProviderLinkOutcome::ProviderTypeAlreadyLinked) => {
                callback_failure("provider_type_already_linked")
            }
            Ok(ProviderLinkOutcome::IdentityMissing) => {
''',
)
replace_once(
    "services/identity/src/browser_web_auth.rs",
    '''async fn link_pending_provider(
''',
    '''#[derive(Debug, Serialize)]
struct BrowserProviderConnectionsResponse {
    state: &'static str,
    providers: Vec<String>,
}

async fn read_provider_connections(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
) -> Response {
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let Some(native_identity) = native_session_identity(&state, &headers, now).await else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before reading provider connections.",
        );
    };
    let pub_dress = match native_identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return service_unavailable(),
    };
    match state.provider_links.list(&pub_dress).await {
        Ok(providers) => no_store_json(
            StatusCode::OK,
            BrowserProviderConnectionsResponse {
                state: "available",
                providers,
            },
        ),
        Err(error) => {
            tracing::error!(%error, "browser provider connection lookup failed");
            service_unavailable()
        }
    }
}

#[derive(Debug, Deserialize)]
struct BrowserProviderDisconnectRequest {
    provider: String,
}

#[derive(Debug, Serialize)]
struct BrowserProviderDisconnectResponse {
    state: &'static str,
    provider: &'static str,
}

async fn disconnect_provider(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
    Json(request): Json<BrowserProviderDisconnectRequest>,
) -> Response {
    if headers.get(CSRF_HEADER).and_then(|value| value.to_str().ok()) != Some("1") {
        return no_store_error(
            StatusCode::FORBIDDEN,
            "csrf_protection_required",
            "This state-changing request requires the 0x1 CSRF header.",
        );
    }
    let Some(provider) = BrowserProvider::parse(&request.provider) else {
        return no_store_error(
            StatusCode::BAD_REQUEST,
            "unsupported_provider",
            "That provider is not supported by this identity service.",
        );
    };
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let Some(native_identity) = native_session_identity(&state, &headers, now).await else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before disconnecting a provider.",
        );
    };
    let pub_dress = match native_identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return service_unavailable(),
    };
    match state.provider_links.unlink(&pub_dress, provider.identity_provider()).await {
        Ok(true) => no_store_json(
            StatusCode::OK,
            BrowserProviderDisconnectResponse {
                state: "disconnected",
                provider: provider.as_str(),
            },
        ),
        Ok(false) => no_store_error(
            StatusCode::NOT_FOUND,
            "provider_not_connected",
            "That provider is not connected to this Bond.",
        ),
        Err(error) => {
            tracing::error!(%error, "browser provider disconnect failed");
            service_unavailable()
        }
    }
}

async fn link_pending_provider(
''',
)
replace_once(
    "services/identity/src/browser_web_auth.rs",
    '''        Ok(ProviderLinkOutcome::ProviderAlreadyLinked) => no_store_error(
            StatusCode::CONFLICT,
            "provider_already_linked",
            "That provider account is already linked to another Bond.",
        ),
        Ok(ProviderLinkOutcome::IdentityMissing) => no_store_error(
''',
    '''        Ok(ProviderLinkOutcome::ProviderAlreadyLinked) => no_store_error(
            StatusCode::CONFLICT,
            "provider_already_linked",
            "That provider account is already linked to another Bond.",
        ),
        Ok(ProviderLinkOutcome::ProviderTypeAlreadyLinked) => no_store_error(
            StatusCode::CONFLICT,
            "provider_type_already_linked",
            "This Bond already has an account for that provider.",
        ),
        Ok(ProviderLinkOutcome::IdentityMissing) => no_store_error(
''',
)

write(
    "services/identity/migrations/0011_provider_type_cardinality.sql",
    '''-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- A Bond may bind at most one account of each provider. Existing duplicate
-- rows are not silently discarded: if any exist, this migration fails so the
-- conflict is observable and can be resolved deliberately.
CREATE UNIQUE INDEX identity_providers_one_account_per_type
ON identity_providers (pub_dress, provider);
''',
)

replace_once(
    "packages/product-app/src/features/identity/bond-providers-view-model.ts",
    '''function providerLabel(provider: BondProviderType): string {
  return provider === "telegram" ? "Telegram" : "Discord";
}

function providerGlyph(provider: BondProviderType): string {
  return provider === "telegram" ? "TG" : "DC";
}
''',
    '''function providerLabel(provider: BondProviderType): string {
  switch (provider) {
    case "telegram":
      return "Telegram";
    case "discord":
      return "Discord";
    case "github":
      return "GitHub";
  }
}

function providerGlyph(provider: BondProviderType): string {
  switch (provider) {
    case "telegram":
      return "TG";
    case "discord":
      return "DC";
    case "github":
      return "GH";
  }
}
''',
)
replace_once(
    "packages/product-app/src/features/identity/bond-providers-view-model.test.ts",
    '''    expect(state.rows.map((row) => row.provider)).toEqual([
      "telegram",
      "discord",
    ]);
    expect(state.rows[0]?.status).toBe("Connected");
    expect(state.rows[1]?.status).toBe("Not connected");
''',
    '''    expect(state.rows.map((row) => row.provider)).toEqual([
      "telegram",
      "discord",
      "github",
    ]);
    expect(state.rows[0]?.status).toBe("Connected");
    expect(state.rows[1]?.status).toBe("Not connected");
    expect(state.rows[2]?.status).toBe("Not connected");
''',
)
replace_once(
    "packages/product-app/src/features/identity/bond-providers-view-model.test.ts",
    '''  it("gives the compact row the attached providers and nothing else", () => {
''',
    '''  it("presents GitHub without inventing an account address", () => {
    const state = createBondProvidersViewState([{ provider: "github" }]);
    const github = state.rows.find((row) => row.provider === "github");

    expect(github).toMatchObject({
      label: "GitHub",
      glyph: "GH",
      status: "Connected",
      openUrl: "https://github.com",
      openKind: "provider-page",
    });
  });

  it("gives the compact row the attached providers and nothing else", () => {
''',
)

replace_once(
    "packages/product-app/src/index.tsx",
    '''  ChooseAvatarModel,
  AuthenticateNativeIdentity,
  BeginBrowserProviderAuthorization,
  ForgetRememberedBond,
''',
    '''  ChooseAvatarModel,
  AuthenticateNativeIdentity,
  BeginBrowserProviderAuthorization,
  DisconnectBrowserProvider,
  ForgetRememberedBond,
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''  LinkBrowserProvider,
  LogoutNativeIdentity,
  ReadBrowserProviderContext,
  ReadNativeIdentityContext,
''',
    '''  LinkBrowserProvider,
  LogoutNativeIdentity,
  ReadBrowserProviderConnections,
  ReadBrowserProviderContext,
  ReadNativeIdentityContext,
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''  type BondProviderType,
  type BrowserIdentityProvider,
''',
    '''  type BondProviderConnections,
  type BondProviderType,
  type BrowserIdentityProvider,
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''import { useBondProviderConnections } from "./features/identity/use-bond-provider-connections";
''',
    "",
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''  const browserProviderContextQuery = useQuery({
    queryKey: ["browser-provider-context"],
    queryFn: () =>
      new ReadBrowserProviderContext(dependencies.identity).execute(),
    enabled: browserHost,
    retry: false,
    staleTime: 0,
  });
''',
    '''  const browserProviderContextQuery = useQuery({
    queryKey: ["browser-provider-context"],
    queryFn: () =>
      new ReadBrowserProviderContext(dependencies.identity).execute(),
    enabled: browserHost,
    retry: false,
    staleTime: 0,
  });
  const browserProviderConnectionsQuery = useQuery({
    queryKey: ["browser-provider-connections"],
    queryFn: () =>
      new ReadBrowserProviderConnections(dependencies.identity).execute(),
    enabled: browserHost && nativeContextQuery.data?.kind === "authenticated",
    retry: false,
    staleTime: 0,
  });
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''  const browserProviderLink = useMutation({
    mutationFn: (expectedPubDress: string) =>
      new LinkBrowserProvider(dependencies.identity).execute(expectedPubDress),
    onSuccess: (result) => {
      if (result.kind === "linked") {
        void queryClient.invalidateQueries({
          queryKey: ["browser-provider-context"],
        });
      }
    },
  });
''',
    '''  const browserProviderLink = useMutation({
    mutationFn: (expectedPubDress: string) =>
      new LinkBrowserProvider(dependencies.identity).execute(expectedPubDress),
    onSuccess: (result) => {
      if (result.kind === "linked") {
        void queryClient.invalidateQueries({
          queryKey: ["browser-provider-context"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["browser-provider-connections"],
        });
      }
    },
  });
  const browserProviderDisconnect = useMutation({
    mutationFn: (provider: BondProviderType) =>
      new DisconnectBrowserProvider(dependencies.identity).execute(provider),
    onSuccess: (result) => {
      if (result.kind === "disconnected") {
        void queryClient.invalidateQueries({
          queryKey: ["browser-provider-connections"],
        });
      }
    },
  });
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''  // The provider a session was proved through is the one attachment this
  // client can attest to. A Bond's full set of attachments is a service fact
  // no endpoint answers yet, so nothing here invents one.
  const linkedBrowserProvider =
    browserProviderLink.data?.kind === "linked"
      ? browserProviderLink.data.provider
      : undefined;
  const attestedProvider: BondProviderType | undefined =
    host.kind === "telegram" || host.kind === "discord"
      ? host.kind
      : linkedBrowserProvider === "telegram" ||
          linkedBrowserProvider === "discord"
        ? linkedBrowserProvider
        : undefined;
  const providers = useBondProviderConnections(
    attestedProvider === undefined ? [] : [{ provider: attestedProvider }],
  );
''',
    '''  // Browser provider attachments are service truth and survive reload.
  // Provider-native hosts still know the one account whose host proof they
  // carry; they do not fabricate any other attachment.
  const providerConnections: BondProviderConnections | undefined = browserHost
    ? browserProviderConnectionsQuery.data?.kind === "available"
      ? browserProviderConnectionsQuery.data.connections
      : undefined
    : host.kind === "telegram" || host.kind === "discord"
      ? [{ provider: host.kind }]
      : [];
  const providerDeepLinks: readonly BondProviderType[] =
    host.kind === "telegram" || host.kind === "discord" ? [host.kind] : [];
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''        connectedProviders={providers.connections}
        onDisconnectProvider={providers.disconnect}
        // A host that is itself the provider can follow that provider's URL
        // scheme. Every other host is offered the web address instead.
        providerDeepLinks={
          attestedProvider === undefined ? [] : [attestedProvider]
        }
''',
    '''        {...(providerConnections === undefined
          ? {}
          : { connectedProviders: providerConnections })}
        {...(!browserHost || providerConnections === undefined
          ? {}
          : {
              onDisconnectProvider: (provider: BondProviderType) => {
                if (!browserProviderDisconnect.isPending) {
                  browserProviderDisconnect.mutate(provider);
                }
              },
            })}
        // A host that is itself Telegram or Discord can follow that provider's
        // URL scheme. Browser GitHub bindings intentionally have no deep link.
        providerDeepLinks={providerDeepLinks}
''',
)

replace_once(
    "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
    '''  connectedProviders = [],
  providerDeepLinks = [],
''',
    '''  connectedProviders,
  providerDeepLinks = [],
''',
)
replace_once(
    "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
    '''  const providers = createBondProvidersViewState(connectedProviders, {
    deepLinkProviders: providerDeepLinks,
  });
''',
    '''  const providers =
    connectedProviders === undefined
      ? undefined
      : createBondProvidersViewState(connectedProviders, {
          deepLinkProviders: providerDeepLinks,
        });
''',
)
replace_once(
    "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
    '''                          <span className="provider-controls">
                            {providers.connected.map((row) => (
                              <ProviderMark key={row.provider} row={row} />
                            ))}
                            <button
                              className="provider-control provider-control--add"
                              type="button"
                              aria-label="Add a provider"
                              onClick={() => openDetail("providers")}
                            >
                              +
                            </button>
                          </span>
''',
    '''                          {providers === undefined ? (
                            <small className="profile-edit__note" role="status">
                              Loading…
                            </small>
                          ) : (
                            <span className="provider-controls">
                              {providers.connected.map((row) => (
                                <ProviderMark key={row.provider} row={row} />
                              ))}
                              <button
                                className="provider-control provider-control--add"
                                type="button"
                                aria-label="Add a provider"
                                onClick={() => openDetail("providers")}
                              >
                                +
                              </button>
                            </span>
                          )}
''',
)
replace_once(
    "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
    '''                {activeDetail === "providers" ? (
                  <div className="provider-management">
                    <ul className="provider-management__list">
                      {providers.rows.map((row) => (
                        <li key={row.provider} data-connected={row.connected}>
''',
    '''                {activeDetail === "providers" ? (
                  <div className="provider-management">
                    {providers === undefined ? (
                      <p className="interface-settings__note" role="status">
                        Loading provider connections…
                      </p>
                    ) : (
                      <>
                        <ul className="provider-management__list">
                          {providers.rows.map((row) => (
                            <li key={row.provider} data-connected={row.connected}>
''',
)
replace_once(
    "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
    '''                      ))}
                    </ul>
                    <p className="interface-settings__note">
                      A provider account is an identity this Bond points at, one
                      account per provider. Disconnecting detaches it from this
                      Bond; it never deletes the account on the provider.
                    </p>
                  </div>
                ) : null}
''',
    '''                          ))}
                        </ul>
                        <p className="interface-settings__note">
                          A provider account is an identity this Bond points at,
                          one account per provider. Disconnecting detaches it
                          from this Bond; it never deletes the account on the
                          provider.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
''',
)

Path("packages/product-app/src/features/identity/use-bond-provider-connections.ts").unlink()
Path("packages/product-app/src/features/identity/use-bond-provider-connections.test.tsx").unlink()
