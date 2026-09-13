# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:80]!r}")
    target.write_text(text.replace(old, new, 1))


def append_before(path: str, marker: str, addition: str) -> None:
    replace_once(path, marker, addition + marker)


# Persistence: GitHub is a real provider namespace, never encoded as Telegram/Discord.
replace_once(
    "services/identity/src/repository.rs",
    "pub enum IdentityProvider {\n    Telegram,\n    Discord,\n}",
    "pub enum IdentityProvider {\n    Telegram,\n    Discord,\n    Github,\n}",
)
replace_once(
    "services/identity/src/repository.rs",
    '            Self::Telegram => "telegram",\n            Self::Discord => "discord",',
    '            Self::Telegram => "telegram",\n            Self::Discord => "discord",\n            Self::Github => "github",',
)
replace_once(
    "services/identity/src/repository.rs",
    "    pub fn discord(user_id: impl Into<String>) -> Self {\n        Self {\n            provider: IdentityProvider::Discord,\n            subject: user_id.into(),\n        }\n    }\n}",
    "    pub fn discord(user_id: impl Into<String>) -> Self {\n        Self {\n            provider: IdentityProvider::Discord,\n            subject: user_id.into(),\n        }\n    }\n\n    pub fn github(user_id: u64) -> Self {\n        Self {\n            provider: IdentityProvider::Github,\n            subject: user_id.to_string(),\n        }\n    }\n}",
)
replace_once(
    "services/identity/src/repository.rs",
    "        if self.has_identity_column(\"tg_id\").await? {\n            sqlx::raw_sql(include_str!(\"../migrations/0002_provider_accounts.sql\"))\n                .execute(&self.pool)\n                .await?;\n        }\n\n        sqlx::raw_sql(include_str!(\"../migrations/0003_native_auth.sql\"))",
    "        if self.has_identity_column(\"tg_id\").await? {\n            sqlx::raw_sql(include_str!(\"../migrations/0002_provider_accounts.sql\"))\n                .execute(&self.pool)\n                .await?;\n        }\n        self.migrate_provider_catalog().await?;\n\n        sqlx::raw_sql(include_str!(\"../migrations/0003_native_auth.sql\"))",
)
append_before(
    "services/identity/src/repository.rs",
    "    async fn migrate_avatar_catalog(&self) -> Result<(), RepositoryError> {",
    "    async fn migrate_provider_catalog(&self) -> Result<(), RepositoryError> {\n        let mut transaction = self.pool.begin().await?;\n        let schema: String = sqlx::query_scalar(\n            \"SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'identity_providers'\",\n        )\n        .fetch_one(&mut *transaction)\n        .await?;\n        if !schema.contains(\"'github'\") {\n            sqlx::raw_sql(include_str!(\"../migrations/0010_github_provider.sql\"))\n                .execute(&mut *transaction)\n                .await?;\n        }\n        transaction.commit().await?;\n        Ok(())\n    }\n\n",
)

migration = """-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

CREATE TABLE identity_providers_v3 (
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    pub_dress TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, provider_subject),
    FOREIGN KEY (pub_dress) REFERENCES identities(pub_dress)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CHECK (provider IN ('telegram', 'discord', 'github'))
) STRICT;

INSERT INTO identity_providers_v3 (provider, provider_subject, pub_dress, created_at)
SELECT provider, provider_subject, pub_dress, created_at
FROM identity_providers;

DROP TABLE identity_providers;
ALTER TABLE identity_providers_v3 RENAME TO identity_providers;
"""
(ROOT / "services/identity/migrations/0010_github_provider.sql").write_text(migration)

# Generic browser OAuth: add GitHub as identity-only proof. No repository scope/token persistence.
path = "services/identity/src/browser_web_auth.rs"
replace_once(
    path,
    'const DISCORD_CURRENT_USER_URL: &str = "https://discord.com/api/v10/users/@me";\n',
    'const DISCORD_CURRENT_USER_URL: &str = "https://discord.com/api/v10/users/@me";\nconst GITHUB_AUTHORIZE_URL: &str = "https://github.com/login/oauth/authorize";\nconst GITHUB_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";\nconst GITHUB_CURRENT_USER_URL: &str = "https://api.github.com/user";\n',
)
replace_once(
    path,
    "    telegram: Option<OAuthClientCredentials>,\n    discord: Option<OAuthClientCredentials>,",
    "    telegram: Option<OAuthClientCredentials>,\n    discord: Option<OAuthClientCredentials>,\n    github: Option<OAuthClientCredentials>,",
)
replace_once(
    path,
    "        telegram: Option<OAuthClientCredentials>,\n        discord: Option<OAuthClientCredentials>,\n    ) -> Self {\n        Self {\n            public_origin,\n            telegram,\n            discord,\n        }",
    "        telegram: Option<OAuthClientCredentials>,\n        discord: Option<OAuthClientCredentials>,\n        github: Option<OAuthClientCredentials>,\n    ) -> Self {\n        Self {\n            public_origin,\n            telegram,\n            discord,\n            github,\n        }",
)
replace_once(
    path,
    '        .route(\n            "/api/v1/auth/browser/discord/callback",\n            get(discord_callback),\n        )\n        .route(\n            "/api/v1/auth/browser/provider/context",',
    '        .route(\n            "/api/v1/auth/browser/discord/callback",\n            get(discord_callback),\n        )\n        .route(\n            "/api/v1/auth/browser/github/callback",\n            get(github_callback),\n        )\n        .route(\n            "/api/v1/auth/browser/provider/context",',
)
replace_once(
    path,
    "enum BrowserProvider {\n    Telegram,\n    Discord,\n}",
    "enum BrowserProvider {\n    Telegram,\n    Discord,\n    Github,\n}",
)
replace_once(
    path,
    '            Self::Telegram => "telegram",\n            Self::Discord => "discord",',
    '            Self::Telegram => "telegram",\n            Self::Discord => "discord",\n            Self::Github => "github",',
)
replace_once(
    path,
    '            Self::Telegram => "/api/v1/auth/browser/telegram/callback",\n            Self::Discord => "/api/v1/auth/browser/discord/callback",',
    '            Self::Telegram => "/api/v1/auth/browser/telegram/callback",\n            Self::Discord => "/api/v1/auth/browser/discord/callback",\n            Self::Github => "/api/v1/auth/browser/github/callback",',
)
replace_once(
    path,
    '            "telegram" => Some(Self::Telegram),\n            "discord" => Some(Self::Discord),',
    '            "telegram" => Some(Self::Telegram),\n            "discord" => Some(Self::Discord),\n            "github" => Some(Self::Github),',
)
replace_once(
    path,
    "                Self::Telegram => IdentityProvider::Telegram,\n                Self::Discord => IdentityProvider::Discord,",
    "                Self::Telegram => IdentityProvider::Telegram,\n                Self::Discord => IdentityProvider::Discord,\n                Self::Github => IdentityProvider::Github,",
)
replace_once(
    path,
    '            "Choose telegram or discord as the browser provider.",',
    '            "Choose telegram, discord, or github as the browser provider.",',
)
replace_once(
    path,
    "        BrowserProvider::Telegram => state.config.telegram.as_ref(),\n        BrowserProvider::Discord => state.config.discord.as_ref(),",
    "        BrowserProvider::Telegram => state.config.telegram.as_ref(),\n        BrowserProvider::Discord => state.config.discord.as_ref(),\n        BrowserProvider::Github => state.config.github.as_ref(),",
)
replace_once(
    path,
    '            BrowserProvider::Telegram => "telegram_browser_auth_not_configured",\n            BrowserProvider::Discord => "discord_browser_auth_not_configured",',
    '            BrowserProvider::Telegram => "telegram_browser_auth_not_configured",\n            BrowserProvider::Discord => "discord_browser_auth_not_configured",\n            BrowserProvider::Github => "github_browser_auth_not_configured",',
)
replace_once(
    path,
    "        BrowserProvider::Telegram => TELEGRAM_AUTHORIZE_URL,\n        BrowserProvider::Discord => DISCORD_AUTHORIZE_URL,",
    "        BrowserProvider::Telegram => TELEGRAM_AUTHORIZE_URL,\n        BrowserProvider::Discord => DISCORD_AUTHORIZE_URL,\n        BrowserProvider::Github => GITHUB_AUTHORIZE_URL,",
)
replace_once(
    path,
    '''        let mut query = authorization_url.query_pairs_mut();
        query
            .append_pair("client_id", &client.client_id)
            .append_pair("redirect_uri", callback.as_str())
            .append_pair("response_type", "code")
            .append_pair("state", &state_token)
            .append_pair("code_challenge", &code_challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair(
                "scope",
                match provider {
                    BrowserProvider::Telegram => "openid profile",
                    BrowserProvider::Discord => "identify",
                },
            );
''',
    '''        let mut query = authorization_url.query_pairs_mut();
        query
            .append_pair("client_id", &client.client_id)
            .append_pair("redirect_uri", callback.as_str())
            .append_pair("state", &state_token)
            .append_pair("code_challenge", &code_challenge)
            .append_pair("code_challenge_method", "S256");
        if provider != BrowserProvider::Github {
            query.append_pair("response_type", "code");
        }
        if let Some(scope) = match provider {
            BrowserProvider::Telegram => Some("openid profile"),
            BrowserProvider::Discord => Some("identify"),
            BrowserProvider::Github => None,
        } {
            query.append_pair("scope", scope);
        }
''',
)

github_callback = r'''async fn github_callback(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
    Query(query): Query<OAuthCallbackQuery>,
) -> Response {
    let transaction = match callback_transaction(&state, &headers, &query, BrowserProvider::Github)
    {
        Ok(value) => value,
        Err(code) => return callback_failure(code),
    };
    let Some(client) = state.config.github.as_ref() else {
        return callback_failure("github_browser_auth_not_configured");
    };
    let callback = state.config.callback_url(BrowserProvider::Github);
    let response = match state
        .http
        .post(GITHUB_TOKEN_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code", query.code.as_deref().unwrap_or_default()),
            ("redirect_uri", callback.as_str()),
            ("code_verifier", transaction.code_verifier.as_str()),
        ])
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "GitHub browser code exchange failed");
            return callback_failure("provider_authentication_unavailable");
        }
    };
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "GitHub browser code exchange rejected");
        return callback_failure("github_authentication_failed");
    }
    let token = match response.json::<GithubTokenResponse>().await {
        Ok(value) if !value.access_token.is_empty() => value,
        Ok(_) => return callback_failure("github_authentication_failed"),
        Err(error) => {
            tracing::warn!(%error, "GitHub browser token response was invalid");
            return callback_failure("github_authentication_failed");
        }
    };
    let response = match state
        .http
        .get(GITHUB_CURRENT_USER_URL)
        .bearer_auth(&token.access_token)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "nilx-one/web")
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "GitHub browser user lookup failed");
            return callback_failure("provider_authentication_unavailable");
        }
    };
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "GitHub browser user lookup rejected");
        return callback_failure("github_authentication_failed");
    }
    let user = match response.json::<GithubUser>().await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "GitHub browser user response was invalid");
            return callback_failure("github_authentication_failed");
        }
    };
    finish_provider_callback(
        &state,
        BrowserProvider::Github.identity(user.id.to_string()),
        &transaction,
    )
    .await
}

'''
append_before(path, "fn callback_transaction(\n", github_callback)
replace_once(
    path,
    "            IdentityProvider::Telegram => BrowserProvider::Telegram,\n            IdentityProvider::Discord => BrowserProvider::Discord,",
    "            IdentityProvider::Telegram => BrowserProvider::Telegram,\n            IdentityProvider::Discord => BrowserProvider::Discord,\n            IdentityProvider::Github => BrowserProvider::Github,",
)
replace_once(
    path,
    "struct BrowserProviderAvailability {\n    telegram: bool,\n    discord: bool,\n}",
    "struct BrowserProviderAvailability {\n    telegram: bool,\n    discord: bool,\n    github: bool,\n}",
)
replace_once(
    path,
    "        telegram: state.config.telegram.is_some(),\n        discord: state.config.discord.is_some(),",
    "        telegram: state.config.telegram.is_some(),\n        discord: state.config.discord.is_some(),\n        github: state.config.github.is_some(),",
)
append_before(
    path,
    "#[derive(Debug, thiserror::Error)]\nenum BrowserProviderError {",
    "#[derive(Debug, Deserialize)]\nstruct GithubTokenResponse {\n    access_token: String,\n}\n\n#[derive(Debug, Deserialize)]\nstruct GithubUser {\n    id: u64,\n}\n\n",
)
replace_once(
    path,
    "            None,\n            None,\n        );",
    "            None,\n            None,\n            None,\n        );",
)
replace_once(
    path,
    '        assert_eq!(\n            config.callback_url(BrowserProvider::Discord).as_str(),\n            "https://nilx.one/api/v1/auth/browser/discord/callback"\n        );\n',
    '        assert_eq!(\n            config.callback_url(BrowserProvider::Discord).as_str(),\n            "https://nilx.one/api/v1/auth/browser/discord/callback"\n        );\n        assert_eq!(\n            config.callback_url(BrowserProvider::Github).as_str(),\n            "https://nilx.one/api/v1/auth/browser/github/callback"\n        );\n',
)
append_before(
    path,
    "    #[test]\n    fn callbacks_are_pinned_to_the_public_origin() {",
    "    #[test]\n    fn github_identity_uses_the_stable_numeric_subject_namespace() {\n        let identity = BrowserProvider::Github.identity(75973992_u64.to_string());\n        assert_eq!(identity.provider, crate::IdentityProvider::Github);\n        assert_eq!(identity.subject, \"75973992\");\n    }\n\n",
)

# Service bootstrap: GitHub auth credentials are optional and separate from future repo evidence access.
replace_once(
    "services/identity/src/main.rs",
    '''    let discord_credentials = oauth_credentials_from_environment(
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "Discord authentication",
    );
    let discord_activity_oauth = discord_credentials.as_ref().map(|credentials| {
''',
    '''    let discord_credentials = oauth_credentials_from_environment(
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "Discord authentication",
    );
    let github_browser_oauth = oauth_credentials_from_environment(
        "GITHUB_AUTH_CLIENT_ID",
        "GITHUB_AUTH_CLIENT_SECRET",
        "GitHub browser authentication",
    );
    let discord_activity_oauth = discord_credentials.as_ref().map(|credentials| {
''',
)
replace_once(
    "services/identity/src/main.rs",
    "        BrowserOAuthConfig::new(public_origin, telegram_browser_oauth, discord_credentials),",
    "        BrowserOAuthConfig::new(\n            public_origin,\n            telegram_browser_oauth,\n            discord_credentials,\n            github_browser_oauth,\n        ),",
)

# Browser-facing typed contracts.
replace_once(
    "packages/application/src/identity-registration.ts",
    'export type BrowserIdentityProvider = "telegram" | "discord";\n\nexport interface BrowserProviderAvailability {\n  telegram: boolean;\n  discord: boolean;\n}',
    'export type BrowserIdentityProvider = "telegram" | "discord" | "github";\n\nexport interface BrowserProviderAvailability {\n  telegram: boolean;\n  discord: boolean;\n  github: boolean;\n}',
)

replace_once(
    "packages/identity-http/src/index.ts",
    '  return value === "telegram" || value === "discord";',
    '  return value === "telegram" || value === "discord" || value === "github";',
)
replace_once(
    "packages/identity-http/src/index.ts",
    '''      typeof body.available.telegram !== "boolean" ||
      typeof body.available.discord !== "boolean"
''',
    '''      typeof body.available.telegram !== "boolean" ||
      typeof body.available.discord !== "boolean" ||
      typeof body.available.github !== "boolean"
''',
)
replace_once(
    "packages/identity-http/src/index.ts",
    '''    const available = {
      telegram: body.available.telegram,
      discord: body.available.discord,
    };
''',
    '''    const available = {
      telegram: body.available.telegram,
      discord: body.available.discord,
      github: body.available.github,
    };
''',
)

# Product auth UI. Provider settings intentionally remain Telegram/Discord until PR2.
replace_once(
    "packages/product-app/src/index.tsx",
    '''function providerDisplayName(provider: BrowserIdentityProvider): string {
  return provider === "telegram" ? "Telegram" : "Discord";
}
''',
    '''function providerDisplayName(provider: BrowserIdentityProvider): string {
  switch (provider) {
    case "telegram":
      return "Telegram";
    case "discord":
      return "Discord";
    case "github":
      return "GitHub";
  }
}
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    '''  const attestedProvider: BondProviderType | undefined =
    host.kind === "telegram" || host.kind === "discord"
      ? host.kind
      : browserProviderLink.data?.kind === "linked"
        ? browserProviderLink.data.provider
        : undefined;
''',
    '''  const linkedBrowserProvider =
    browserProviderLink.data?.kind === "linked"
      ? browserProviderLink.data.provider
      : undefined;
  const attestedProvider: BondProviderType | undefined =
    host.kind === "telegram" || host.kind === "discord"
      ? host.kind
      : linkedBrowserProvider === "telegram" || linkedBrowserProvider === "discord"
        ? linkedBrowserProvider
        : undefined;
''',
)
replace_once(
    "packages/product-app/src/index.tsx",
    "            : { telegram: false, discord: false },",
    "            : { telegram: false, discord: false, github: false },",
)

view = "packages/product-app/src/features/identity/identity-foundation-view.tsx"
replace_once(
    view,
    "    telegram: boolean;\n    discord: boolean;",
    "    telegram: boolean;\n    discord: boolean;\n    github: boolean;",
)
replace_once(
    view,
    '''  const pendingLabel =
    auth?.pendingProvider === "telegram"
      ? "Telegram"
      : auth?.pendingProvider === "discord"
        ? "Discord"
        : undefined;
''',
    '''  const pendingLabel =
    auth?.pendingProvider === "telegram"
      ? "Telegram"
      : auth?.pendingProvider === "discord"
        ? "Discord"
        : auth?.pendingProvider === "github"
          ? "GitHub"
          : undefined;
''',
)
replace_once(
    view,
    '''        <button
          type="button"
          disabled={auth?.available.discord !== true}
          aria-label="Sign in with Discord"
          onClick={() => auth?.onAuthorize("discord")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.2 7.2A14 14 0 0 1 12 6.3a14 14 0 0 1 4.8.9c1.1 1.6 2 4.3 2.2 6.5a12 12 0 0 1-3.2 2.1l-.8-1.1a8.6 8.6 0 0 0 1.4-.7c-2.7 1.2-6.1 1.2-8.8 0 .4.3.9.5 1.4.7l-.8 1.1A12 12 0 0 1 5 13.7c.2-2.2 1.1-4.9 2.2-6.5Z" />
            <circle cx="9.5" cy="11.5" r="1" />
            <circle cx="14.5" cy="11.5" r="1" />
          </svg>
          <span>Discord</span>
          <small>web</small>
        </button>
''',
    '''        <button
          type="button"
          disabled={auth?.available.discord !== true}
          aria-label="Sign in with Discord"
          onClick={() => auth?.onAuthorize("discord")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.2 7.2A14 14 0 0 1 12 6.3a14 14 0 0 1 4.8.9c1.1 1.6 2 4.3 2.2 6.5a12 12 0 0 1-3.2 2.1l-.8-1.1a8.6 8.6 0 0 0 1.4-.7c-2.7 1.2-6.1 1.2-8.8 0 .4.3.9.5 1.4.7l-.8 1.1A12 12 0 0 1 5 13.7c.2-2.2 1.1-4.9 2.2-6.5Z" />
            <circle cx="9.5" cy="11.5" r="1" />
            <circle cx="14.5" cy="11.5" r="1" />
          </svg>
          <span>Discord</span>
          <small>web</small>
        </button>
        <button
          type="button"
          disabled={auth?.available.github !== true}
          aria-label="Sign in with GitHub"
          onClick={() => auth?.onAuthorize("github")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.8a9.3 9.3 0 0 0-2.9 18.1c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 2.9.9.1-.7.4-1.1.7-1.4-2.3-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A9.3 9.3 0 0 0 12 2.8Z" />
          </svg>
          <span>GitHub</span>
          <small>web</small>
        </button>
''',
)

# Deployment contract keeps GitHub auth optional but validates credential pairing.
replace_once(
    "services/identity/deploy/env.example",
    "DISCORD_CLIENT_ID=replace-with-discord-application-id\nDISCORD_CLIENT_SECRET=replace-with-discord-client-secret",
    "DISCORD_CLIENT_ID=replace-with-discord-application-id\nDISCORD_CLIENT_SECRET=replace-with-discord-client-secret\nGITHUB_AUTH_CLIENT_ID=replace-with-github-oauth-client-id\nGITHUB_AUTH_CLIENT_SECRET=replace-with-github-oauth-client-secret",
)
replace_once(
    "services/identity/deploy/prepare-runtime-env.sh",
    '''discord_client_id="$(read_provider_value DISCORD_CLIENT_ID)"
discord_client_secret="$(read_provider_value DISCORD_CLIENT_SECRET)"
validate_pair "Discord OAuth" "$discord_client_id" "$discord_client_secret"
''',
    '''discord_client_id="$(read_provider_value DISCORD_CLIENT_ID)"
discord_client_secret="$(read_provider_value DISCORD_CLIENT_SECRET)"
validate_pair "Discord OAuth" "$discord_client_id" "$discord_client_secret"

github_auth_client_id="$(read_provider_value GITHUB_AUTH_CLIENT_ID)"
github_auth_client_secret="$(read_provider_value GITHUB_AUTH_CLIENT_SECRET)"
validate_pair "GitHub browser OAuth" "$github_auth_client_id" "$github_auth_client_secret"
''',
)

# Extend the provider-link persistence test so a GitHub subject is proven distinct.
replace_once(
    "services/identity/src/provider_link.rs",
    '''        assert_eq!(
            identities
                .find_by_provider(&ProviderIdentity::telegram(42))
                .await
                .expect("provider lookup")
                .expect("bound identity")
                .pub_dress,
            "0x0sky"
        );
''',
    '''        assert_eq!(
            identities
                .find_by_provider(&ProviderIdentity::telegram(42))
                .await
                .expect("provider lookup")
                .expect("bound identity")
                .pub_dress,
            "0x0sky"
        );
        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::github(75973992))
                .await
                .expect("GitHub link"),
            ProviderLinkOutcome::Linked
        );
        assert_eq!(
            identities
                .find_by_provider(&ProviderIdentity::github(75973992))
                .await
                .expect("GitHub provider lookup")
                .expect("GitHub bound identity")
                .pub_dress,
            "0x0sky"
        );
''',
)

print("GitHub identity-only browser auth transformation applied")
