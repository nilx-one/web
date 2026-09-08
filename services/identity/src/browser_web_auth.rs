// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, COOKIE, LOCATION, SET_COOKIE},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use url::Url;

use crate::{
    IdentityProvider, IdentityRecord, IdentityRepository, NativeAuthConfig, ProviderIdentity,
    ProviderLinkOutcome, ProviderLinkRepository, PubDress, SecretDigester, TokenFactory,
};

const TELEGRAM_AUTHORIZE_URL: &str = "https://oauth.telegram.org/auth";
const TELEGRAM_TOKEN_URL: &str = "https://oauth.telegram.org/token";
const TELEGRAM_JWKS_URL: &str = "https://oauth.telegram.org/.well-known/jwks.json";
const TELEGRAM_ISSUER: &str = "https://oauth.telegram.org";
const DISCORD_AUTHORIZE_URL: &str = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL: &str = "https://discord.com/api/v10/oauth2/token";
const DISCORD_CURRENT_USER_URL: &str = "https://discord.com/api/v10/users/@me";
const OAUTH_TRANSACTION_COOKIE: &str = "__Host-ox1_oauth";
const PENDING_PROVIDER_COOKIE: &str = "__Host-ox1_provider";
const SESSION_COOKIE: &str = "__Host-ox1_session";
const REMEMBERED_BOND_COOKIE: &str = "__Host-ox1_bond";
const CSRF_HEADER: &str = "x-0x1-csrf";
const OAUTH_TRANSACTION_TTL_SECONDS: u64 = 10 * 60;
const PENDING_PROVIDER_TTL_SECONDS: u64 = 15 * 60;

#[derive(Clone, Debug)]
pub struct OAuthClientCredentials {
    pub client_id: String,
    pub client_secret: String,
}

impl OAuthClientCredentials {
    pub fn new(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret: client_secret.into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct BrowserOAuthConfig {
    public_origin: Url,
    telegram: Option<OAuthClientCredentials>,
    discord: Option<OAuthClientCredentials>,
}

impl BrowserOAuthConfig {
    pub fn new(
        public_origin: Url,
        telegram: Option<OAuthClientCredentials>,
        discord: Option<OAuthClientCredentials>,
    ) -> Self {
        Self {
            public_origin,
            telegram,
            discord,
        }
    }

    fn callback_url(&self, provider: BrowserProvider) -> Url {
        self.public_origin
            .join(provider.callback_path())
            .expect("browser provider callback path must stay on the configured origin")
    }
}

#[derive(Clone)]
struct BrowserAuthState {
    repository: IdentityRepository,
    provider_links: ProviderLinkRepository,
    native_auth: NativeAuthConfig,
    config: BrowserOAuthConfig,
    http: reqwest::Client,
    cookie_signer: SignedCookie,
}

pub fn router(
    repository: IdentityRepository,
    provider_links: ProviderLinkRepository,
    native_auth: NativeAuthConfig,
    config: BrowserOAuthConfig,
) -> Router {
    let state = BrowserAuthState {
        repository,
        provider_links,
        cookie_signer: SignedCookie::new(native_auth.secret_digester()),
        native_auth,
        config,
        http: reqwest::Client::new(),
    };

    Router::new()
        .route("/api/v1/auth/browser/telegram/start", get(start_telegram))
        .route(
            "/api/v1/auth/browser/telegram/callback",
            get(telegram_callback),
        )
        .route("/api/v1/auth/browser/discord/start", get(start_discord))
        .route(
            "/api/v1/auth/browser/discord/callback",
            get(discord_callback),
        )
        .route(
            "/api/v1/auth/browser/provider/context",
            get(read_provider_context),
        )
        .route(
            "/api/v1/auth/browser/provider/link",
            post(link_pending_provider),
        )
        .with_state(state)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum BrowserProvider {
    Telegram,
    Discord,
}

impl BrowserProvider {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Discord => "discord",
        }
    }

    const fn callback_path(self) -> &'static str {
        match self {
            Self::Telegram => "/api/v1/auth/browser/telegram/callback",
            Self::Discord => "/api/v1/auth/browser/discord/callback",
        }
    }

    fn identity(self, subject: String) -> ProviderIdentity {
        ProviderIdentity {
            provider: match self {
                Self::Telegram => IdentityProvider::Telegram,
                Self::Discord => IdentityProvider::Discord,
            },
            subject,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct OAuthTransaction {
    provider: BrowserProvider,
    state: String,
    code_verifier: String,
    expires_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PendingProvider {
    provider: BrowserProvider,
    subject: String,
    expires_at: u64,
}

#[derive(Clone)]
struct SignedCookie {
    digester: SecretDigester,
}

impl SignedCookie {
    fn new(digester: SecretDigester) -> Self {
        Self { digester }
    }

    fn issue<T: Serialize>(&self, domain: &str, payload: &T) -> Option<String> {
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).ok()?);
        let signature = self.digester.digest(domain, &encoded);
        Some(format!("v1.{encoded}.{}", URL_SAFE_NO_PAD.encode(signature)))
    }

    fn verify<T: DeserializeOwned>(&self, domain: &str, value: &str) -> Option<T> {
        let mut fields = value.split('.');
        if fields.next()? != "v1" {
            return None;
        }
        let encoded = fields.next()?;
        let encoded_signature = fields.next()?;
        if fields.next().is_some() {
            return None;
        }
        let supplied = URL_SAFE_NO_PAD.decode(encoded_signature).ok()?;
        let expected = self.digester.digest(domain, encoded);
        if supplied.len() != expected.len()
            || supplied.as_slice().ct_eq(expected.as_slice()).unwrap_u8() != 1
        {
            return None;
        }
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded).ok()?).ok()
    }
}

async fn start_telegram(State(state): State<BrowserAuthState>) -> Response {
    let Some(client) = state.config.telegram.as_ref() else {
        return provider_unavailable("telegram_browser_auth_not_configured");
    };
    start_provider(&state, BrowserProvider::Telegram, client)
}

async fn start_discord(State(state): State<BrowserAuthState>) -> Response {
    let Some(client) = state.config.discord.as_ref() else {
        return provider_unavailable("discord_browser_auth_not_configured");
    };
    start_provider(&state, BrowserProvider::Discord, client)
}

fn start_provider(
    state: &BrowserAuthState,
    provider: BrowserProvider,
    client: &OAuthClientCredentials,
) -> Response {
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let (Some(state_token), Some(code_verifier)) = (random_urlsafe(24), random_urlsafe(32)) else {
        return service_unavailable();
    };
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let transaction = OAuthTransaction {
        provider,
        state: state_token.clone(),
        code_verifier,
        expires_at: now.saturating_add(OAUTH_TRANSACTION_TTL_SECONDS),
    };
    let Some(transaction_cookie) = state
        .cookie_signer
        .issue("browser-oauth-transaction", &transaction)
    else {
        return service_unavailable();
    };
    let callback = state.config.callback_url(provider);
    let mut authorization_url = match Url::parse(match provider {
        BrowserProvider::Telegram => TELEGRAM_AUTHORIZE_URL,
        BrowserProvider::Discord => DISCORD_AUTHORIZE_URL,
    }) {
        Ok(value) => value,
        Err(_) => return service_unavailable(),
    };
    {
        let mut query = authorization_url.query_pairs_mut();
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
    }

    redirect_with_cookies(
        authorization_url.as_str(),
        [secure_cookie(
            OAUTH_TRANSACTION_COOKIE,
            &transaction_cookie,
            OAUTH_TRANSACTION_TTL_SECONDS,
        )],
    )
}

#[derive(Debug, Deserialize)]
struct OAuthCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn telegram_callback(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
    Query(query): Query<OAuthCallbackQuery>,
) -> Response {
    let transaction = match callback_transaction(&state, &headers, &query, BrowserProvider::Telegram)
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(client) = state.config.telegram.as_ref() else {
        return callback_failure("telegram_browser_auth_not_configured");
    };
    let callback = state.config.callback_url(BrowserProvider::Telegram);
    let response = match state
        .http
        .post(TELEGRAM_TOKEN_URL)
        .basic_auth(&client.client_id, Some(&client.client_secret))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", query.code.as_deref().unwrap_or_default()),
            ("redirect_uri", callback.as_str()),
            ("client_id", client.client_id.as_str()),
            ("code_verifier", transaction.code_verifier.as_str()),
        ])
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "Telegram browser code exchange failed");
            return callback_failure("provider_authentication_unavailable");
        }
    };
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "Telegram browser code exchange rejected");
        return callback_failure("telegram_authentication_failed");
    }
    let token = match response.json::<TelegramTokenResponse>().await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "Telegram browser token response was invalid");
            return callback_failure("telegram_authentication_failed");
        }
    };
    let subject = match telegram_subject(&state, client, &token.id_token).await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "Telegram browser ID token validation failed");
            return callback_failure("telegram_authentication_failed");
        }
    };
    finish_provider_callback(&state, &headers, BrowserProvider::Telegram.identity(subject)).await
}

async fn discord_callback(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
    Query(query): Query<OAuthCallbackQuery>,
) -> Response {
    let transaction = match callback_transaction(&state, &headers, &query, BrowserProvider::Discord)
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(client) = state.config.discord.as_ref() else {
        return callback_failure("discord_browser_auth_not_configured");
    };
    let callback = state.config.callback_url(BrowserProvider::Discord);
    let response = match state
        .http
        .post(DISCORD_TOKEN_URL)
        .form(&[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", query.code.as_deref().unwrap_or_default()),
            ("redirect_uri", callback.as_str()),
            ("code_verifier", transaction.code_verifier.as_str()),
        ])
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "Discord browser code exchange failed");
            return callback_failure("provider_authentication_unavailable");
        }
    };
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "Discord browser code exchange rejected");
        return callback_failure("discord_authentication_failed");
    }
    let token = match response.json::<DiscordTokenResponse>().await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "Discord browser token response was invalid");
            return callback_failure("discord_authentication_failed");
        }
    };
    let response = match state
        .http
        .get(DISCORD_CURRENT_USER_URL)
        .bearer_auth(&token.access_token)
        .send()
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "Discord browser user lookup failed");
            return callback_failure("provider_authentication_unavailable");
        }
    };
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "Discord browser user lookup rejected");
        return callback_failure("discord_authentication_failed");
    }
    let user = match response.json::<DiscordUser>().await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "Discord browser user response was invalid");
            return callback_failure("discord_authentication_failed");
        }
    };
    finish_provider_callback(&state, &headers, BrowserProvider::Discord.identity(user.id)).await
}

fn callback_transaction(
    state: &BrowserAuthState,
    headers: &HeaderMap,
    query: &OAuthCallbackQuery,
    provider: BrowserProvider,
) -> Result<OAuthTransaction, Response> {
    if query.error.is_some() {
        return Err(callback_failure("provider_authorization_rejected"));
    }
    let (Some(code), Some(query_state)) = (query.code.as_deref(), query.state.as_deref()) else {
        return Err(callback_failure("provider_callback_invalid"));
    };
    if code.is_empty() || query_state.is_empty() {
        return Err(callback_failure("provider_callback_invalid"));
    }
    let Some(cookie) = read_cookie(headers, OAUTH_TRANSACTION_COOKIE) else {
        return Err(callback_failure("provider_callback_expired"));
    };
    let Some(transaction) = state
        .cookie_signer
        .verify::<OAuthTransaction>("browser-oauth-transaction", &cookie)
    else {
        return Err(callback_failure("provider_callback_invalid"));
    };
    let Some(now) = now_unix_seconds() else {
        return Err(callback_failure("provider_authentication_unavailable"));
    };
    if transaction.provider != provider
        || transaction.expires_at <= now
        || transaction.state.as_bytes().ct_eq(query_state.as_bytes()).unwrap_u8() != 1
    {
        return Err(callback_failure("provider_callback_invalid"));
    }
    Ok(transaction)
}

async fn finish_provider_callback(
    state: &BrowserAuthState,
    headers: &HeaderMap,
    provider: ProviderIdentity,
) -> Response {
    let Some(now) = now_unix_seconds() else {
        return callback_failure("provider_authentication_unavailable");
    };
    match state.repository.find_by_provider(&provider).await {
        Ok(Some(identity)) => return issue_native_session(state, identity, now).await,
        Ok(None) => {}
        Err(error) => {
            tracing::error!(%error, "browser provider binding lookup failed");
            return callback_failure("provider_authentication_unavailable");
        }
    }

    if let Some(identity) = native_session_identity(state, headers, now).await {
        let pub_dress = match identity.pub_dress.parse::<PubDress>() {
            Ok(value) => value,
            Err(_) => return callback_failure("provider_authentication_unavailable"),
        };
        match state.provider_links.link(&pub_dress, &provider).await {
            Ok(ProviderLinkOutcome::Linked | ProviderLinkOutcome::AlreadyLinked) => {
                return redirect_with_cookies(
                    "/",
                    [
                        clear_cookie(OAUTH_TRANSACTION_COOKIE),
                        clear_cookie(PENDING_PROVIDER_COOKIE),
                    ],
                );
            }
            Ok(ProviderLinkOutcome::ProviderAlreadyLinked) => {
                return callback_failure("provider_already_linked");
            }
            Ok(ProviderLinkOutcome::IdentityMissing) => {
                return callback_failure("provider_authentication_unavailable");
            }
            Err(error) => {
                tracing::error!(%error, "browser provider binding failed");
                return callback_failure("provider_authentication_unavailable");
            }
        }
    }

    let pending = PendingProvider {
        provider: match provider.provider {
            IdentityProvider::Telegram => BrowserProvider::Telegram,
            IdentityProvider::Discord => BrowserProvider::Discord,
        },
        subject: provider.subject,
        expires_at: now.saturating_add(PENDING_PROVIDER_TTL_SECONDS),
    };
    let Some(pending_cookie) = state
        .cookie_signer
        .issue("browser-pending-provider", &pending)
    else {
        return callback_failure("provider_authentication_unavailable");
    };
    redirect_with_cookies(
        "/",
        [
            clear_cookie(OAUTH_TRANSACTION_COOKIE),
            secure_cookie(
                PENDING_PROVIDER_COOKIE,
                &pending_cookie,
                PENDING_PROVIDER_TTL_SECONDS,
            ),
        ],
    )
}

async fn native_session_identity(
    state: &BrowserAuthState,
    headers: &HeaderMap,
    now: u64,
) -> Option<IdentityRecord> {
    let token = read_cookie(headers, SESSION_COOKIE)?;
    let hash = state
        .native_auth
        .secret_digester()
        .digest("native-session", &token);
    state.repository.find_native_session(&hash, now).await.ok()?
}

async fn issue_native_session(
    state: &BrowserAuthState,
    mut identity: IdentityRecord,
    now: u64,
) -> Response {
    let pub_dress = match identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return callback_failure("provider_authentication_unavailable"),
    };
    if identity.avaia_pub_dress.is_none() {
        identity = match state.repository.reconcile_owned_avaia(&pub_dress, now).await {
            Ok(Some(value)) => value,
            _ => return callback_failure("provider_authentication_unavailable"),
        };
    }
    let Ok(token) = TokenFactory::session() else {
        return callback_failure("provider_authentication_unavailable");
    };
    let token_hash = state
        .native_auth
        .secret_digester()
        .digest("native-session", &token);
    if let Err(error) = state
        .repository
        .create_native_session(
            &token_hash,
            &identity.pub_dress,
            now,
            now.saturating_add(state.native_auth.session_ttl_seconds),
        )
        .await
    {
        tracing::error!(%error, "browser provider native session creation failed");
        return callback_failure("provider_authentication_unavailable");
    }
    let remembered = match state.native_auth.remembered_bond_signer().issue(
        &identity.pub_dress,
        now.saturating_add(state.native_auth.remembered_bond_ttl_seconds),
    ) {
        Ok(value) => value,
        Err(_) => return callback_failure("provider_authentication_unavailable"),
    };
    redirect_with_cookies(
        "/",
        [
            clear_cookie(OAUTH_TRANSACTION_COOKIE),
            clear_cookie(PENDING_PROVIDER_COOKIE),
            secure_cookie(SESSION_COOKIE, &token, state.native_auth.session_ttl_seconds),
            secure_cookie(
                REMEMBERED_BOND_COOKIE,
                &remembered,
                state.native_auth.remembered_bond_ttl_seconds,
            ),
        ],
    )
}

#[derive(Debug, Serialize)]
struct BrowserProviderAvailability {
    telegram: bool,
    discord: bool,
}

#[derive(Debug, Serialize)]
struct BrowserProviderContextResponse {
    state: &'static str,
    available: BrowserProviderAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<&'static str>,
}

async fn read_provider_context(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
) -> Response {
    let available = BrowserProviderAvailability {
        telegram: state.config.telegram.is_some(),
        discord: state.config.discord.is_some(),
    };
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let raw_pending = read_cookie(&headers, PENDING_PROVIDER_COOKIE);
    let pending = raw_pending.as_deref().and_then(|value| {
        state
            .cookie_signer
            .verify::<PendingProvider>("browser-pending-provider", value)
            .filter(|proof| proof.expires_at > now)
    });
    let mut response = no_store_json(
        StatusCode::OK,
        BrowserProviderContextResponse {
            state: if pending.is_some() { "pending" } else { "none" },
            available,
            provider: pending.as_ref().map(|value| value.provider.as_str()),
        },
    );
    if raw_pending.is_some() && pending.is_none() {
        append_cookie(&mut response, clear_cookie(PENDING_PROVIDER_COOKIE));
    }
    response
}

#[derive(Debug, Serialize)]
struct BrowserProviderLinkResponse {
    state: &'static str,
    provider: &'static str,
}

async fn link_pending_provider(
    State(state): State<BrowserAuthState>,
    headers: HeaderMap,
) -> Response {
    if headers
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        != Some("1")
    {
        return no_store_error(
            StatusCode::FORBIDDEN,
            "csrf_protection_required",
            "This state-changing request requires the 0x1 CSRF header.",
        );
    }
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let Some(native_identity) = native_session_identity(&state, &headers, now).await else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before linking this provider.",
        );
    };
    let Some(cookie) = read_cookie(&headers, PENDING_PROVIDER_COOKIE) else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "provider_proof_required",
            "Authorize a provider before linking it to a Bond.",
        );
    };
    let Some(pending) = state
        .cookie_signer
        .verify::<PendingProvider>("browser-pending-provider", &cookie)
        .filter(|proof| proof.expires_at > now)
    else {
        let mut response = no_store_error(
            StatusCode::UNAUTHORIZED,
            "provider_proof_required",
            "Authorize the provider again before linking it to a Bond.",
        );
        append_cookie(&mut response, clear_cookie(PENDING_PROVIDER_COOKIE));
        return response;
    };
    let pub_dress = match native_identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return service_unavailable(),
    };
    let provider_name = pending.provider.as_str();
    let provider = pending.provider.identity(pending.subject);
    match state.provider_links.link(&pub_dress, &provider).await {
        Ok(ProviderLinkOutcome::Linked | ProviderLinkOutcome::AlreadyLinked) => {
            let mut response = no_store_json(
                StatusCode::OK,
                BrowserProviderLinkResponse {
                    state: "linked",
                    provider: provider_name,
                },
            );
            append_cookie(&mut response, clear_cookie(PENDING_PROVIDER_COOKIE));
            response
        }
        Ok(ProviderLinkOutcome::ProviderAlreadyLinked) => no_store_error(
            StatusCode::CONFLICT,
            "provider_already_linked",
            "That provider account is already linked to another Bond.",
        ),
        Ok(ProviderLinkOutcome::IdentityMissing) => no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before linking this provider.",
        ),
        Err(error) => {
            tracing::error!(%error, "pending browser provider link failed");
            service_unavailable()
        }
    }
}

#[derive(Debug, Deserialize)]
struct TelegramTokenResponse {
    id_token: String,
}

#[derive(Debug, Deserialize)]
struct TelegramClaims {
    sub: String,
}

async fn telegram_subject(
    state: &BrowserAuthState,
    client: &OAuthClientCredentials,
    id_token: &str,
) -> Result<String, BrowserProviderError> {
    let header = decode_header(id_token).map_err(|_| BrowserProviderError::InvalidToken)?;
    let kid = header.kid.ok_or(BrowserProviderError::InvalidToken)?;
    let jwks = state
        .http
        .get(TELEGRAM_JWKS_URL)
        .send()
        .await
        .map_err(|_| BrowserProviderError::ProviderUnavailable)?;
    if !jwks.status().is_success() {
        return Err(BrowserProviderError::ProviderUnavailable);
    }
    let jwks = jwks
        .json::<JwkSet>()
        .await
        .map_err(|_| BrowserProviderError::ProviderUnavailable)?;
    let jwk = jwks.find(&kid).ok_or(BrowserProviderError::InvalidToken)?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| BrowserProviderError::InvalidToken)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client.client_id.as_str()]);
    validation.set_issuer(&[TELEGRAM_ISSUER]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    let claims = decode::<TelegramClaims>(id_token, &key, &validation)
        .map_err(|_| BrowserProviderError::InvalidToken)?
        .claims;
    if claims.sub.is_empty() {
        return Err(BrowserProviderError::InvalidToken);
    }
    Ok(claims.sub)
}

#[derive(Debug, Deserialize)]
struct DiscordTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct DiscordUser {
    id: String,
}

#[derive(Debug, thiserror::Error)]
enum BrowserProviderError {
    #[error("provider token is invalid")]
    InvalidToken,
    #[error("provider is unavailable")]
    ProviderUnavailable,
}

fn random_urlsafe(bytes: usize) -> Option<String> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value).ok()?;
    Some(URL_SAFE_NO_PAD.encode(value))
}

fn now_unix_seconds() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (candidate_name, value) = cookie.trim().split_once('=')?;
                (candidate_name == name && !value.is_empty()).then(|| value.to_owned())
            })
        })
}

fn secure_cookie(name: &str, value: &str, max_age_seconds: u64) -> String {
    format!("{name}={value}; Path=/; Max-Age={max_age_seconds}; Secure; HttpOnly; SameSite=Lax")
}

fn clear_cookie(name: &str) -> String {
    format!("{name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax")
}

fn append_cookie(response: &mut Response, cookie: String) {
    let value = HeaderValue::from_str(&cookie).expect("generated cookie must be a valid header");
    response.headers_mut().append(SET_COOKIE, value);
}

fn redirect_with_cookies<const N: usize>(location: &str, cookies: [String; N]) -> Response {
    let mut response = StatusCode::SEE_OTHER.into_response();
    let location = HeaderValue::from_str(location).expect("redirect URL must be a valid header");
    response.headers_mut().insert(LOCATION, location);
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for cookie in cookies {
        append_cookie(&mut response, cookie);
    }
    response
}

fn callback_failure(code: &'static str) -> Response {
    let location = format!("/?auth_error={code}");
    redirect_with_cookies(&location, [clear_cookie(OAUTH_TRANSACTION_COOKIE)])
}

fn provider_unavailable(code: &'static str) -> Response {
    no_store_error(
        StatusCode::SERVICE_UNAVAILABLE,
        code,
        "Browser provider authentication is not configured.",
    )
}

fn service_unavailable() -> Response {
    no_store_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "identity_service_unavailable",
        "Identity authentication is temporarily unavailable.",
    )
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ApiError,
}

#[derive(Debug, Serialize)]
struct ApiError {
    code: &'static str,
    message: &'static str,
}

fn no_store_error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    no_store_json(status, ErrorEnvelope { error: ApiError { code, message } })
}

fn no_store_json<T: Serialize>(status: StatusCode, body: T) -> Response {
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::{BrowserOAuthConfig, BrowserProvider, PendingProvider, SignedCookie};
    use crate::NativeAuthConfig;
    use url::Url;

    fn native_auth() -> NativeAuthConfig {
        NativeAuthConfig::new(
            "test-auth-secret-that-is-at-least-thirty-two-bytes",
            "test-password-pepper-that-is-at-least-thirty-two-bytes",
        )
        .expect("valid native auth configuration")
    }

    #[test]
    fn pending_provider_cookie_is_tamper_evident() {
        let signer = SignedCookie::new(native_auth().secret_digester());
        let pending = PendingProvider {
            provider: BrowserProvider::Telegram,
            subject: "42".to_owned(),
            expires_at: 500,
        };
        let value = signer
            .issue("browser-pending-provider", &pending)
            .expect("signed pending provider");
        let parsed = signer
            .verify::<PendingProvider>("browser-pending-provider", &value)
            .expect("valid signed cookie");
        assert_eq!(parsed.provider, BrowserProvider::Telegram);
        assert_eq!(parsed.subject, "42");
        assert!(
            signer
                .verify::<PendingProvider>("browser-pending-provider", &format!("{value}x"))
                .is_none()
        );
    }

    #[test]
    fn callbacks_are_pinned_to_the_public_origin() {
        let config = BrowserOAuthConfig::new(
            Url::parse("https://nilx.one").expect("valid origin"),
            None,
            None,
        );
        assert_eq!(
            config.callback_url(BrowserProvider::Telegram).as_str(),
            "https://nilx.one/api/v1/auth/browser/telegram/callback"
        );
        assert_eq!(
            config.callback_url(BrowserProvider::Discord).as_str(),
            "https://nilx.one/api/v1/auth/browser/discord/callback"
        );
    }
}
