// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{str::FromStr, time::{SystemTime, UNIX_EPOCH}};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest as _, Sha256};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use subtle::ConstantTimeEq as _;
use url::Url;

use crate::{
    IdentityRepository, NativeAuthConfig, OAuthClientCredentials, ProviderSecretCipher, PubDress,
    SecretDigester,
};
use crate::browser_web_auth::authenticated_native_session;

const EVIDENCE_TRANSACTION_COOKIE: &str = "__Host-ox1_github_evidence";
const CSRF_HEADER: &str = "x-0x1-csrf";
const TRANSACTION_TTL_SECONDS: u64 = 10 * 60;
const GITHUB_AUTHORIZE_URL: &str = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_API_ROOT: &str = "https://api.github.com";

#[derive(Clone)]
pub struct GithubEvidenceConfig {
    public_origin: Url,
    credentials: Option<OAuthClientCredentials>,
    cipher: ProviderSecretCipher,
    endpoints: GithubEvidenceEndpoints,
}

#[derive(Clone)]
struct GithubEvidenceEndpoints {
    authorize: Url,
    token: Url,
    api_root: Url,
}

impl GithubEvidenceConfig {
    pub fn new(
        public_origin: Url,
        credentials: Option<OAuthClientCredentials>,
        cipher: ProviderSecretCipher,
    ) -> Self {
        Self {
            public_origin,
            credentials,
            cipher,
            endpoints: GithubEvidenceEndpoints {
                authorize: Url::parse(GITHUB_AUTHORIZE_URL).expect("GitHub authorize URL"),
                token: Url::parse(GITHUB_TOKEN_URL).expect("GitHub token URL"),
                api_root: Url::parse(GITHUB_API_ROOT).expect("GitHub API root"),
            },
        }
    }

    fn callback_url(&self) -> Url {
        self.public_origin
            .join("/api/v1/github/evidence/callback")
            .expect("GitHub evidence callback stays on public origin")
    }

    #[cfg(test)]
    fn with_endpoints(mut self, authorize: Url, token: Url, api_root: Url) -> Self {
        self.endpoints = GithubEvidenceEndpoints {
            authorize,
            token,
            api_root,
        };
        self
    }
}

#[derive(Clone, Debug)]
pub struct GithubEvidenceRepository {
    pool: SqlitePool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct GithubEvidenceRecord {
    pub_dress: String,
    github_user_id: String,
    login: String,
    profile_url: String,
    avatar_url: String,
    encrypted_access_token: Vec<u8>,
    connection_state: String,
    diagnostic: Option<String>,
    connected_at: u64,
    refreshed_at: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GithubEvidenceConnectOutcome {
    Connected,
    Reconnected,
    BondMissing,
    ProviderIdentityMismatch,
    GithubAccountAlreadyConnected,
}

impl GithubEvidenceRepository {
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

    async fn get(&self, pub_dress: &PubDress) -> Result<Option<GithubEvidenceRecord>, sqlx::Error> {
        sqlx::query_as::<_, GithubEvidenceRow>(
            "SELECT pub_dress, github_user_id, login, profile_url, avatar_url, encrypted_access_token, connection_state, diagnostic, connected_at, refreshed_at FROM github_evidence_connections WHERE pub_dress = ?",
        )
        .bind(pub_dress.as_str())
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(Into::into))
    }

    async fn connect_account(
        &self,
        pub_dress: &PubDress,
        user: &GithubUser,
        encrypted_access_token: &[u8],
        now: u64,
    ) -> Result<GithubEvidenceConnectOutcome, sqlx::Error> {
        let github_user_id = user.id.to_string();
        let mut transaction = self.pool.begin().await?;
        let human_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE pub_dress = ? AND identity_kind = 'human')",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if !human_exists {
            transaction.rollback().await?;
            return Ok(GithubEvidenceConnectOutcome::BondMissing);
        }

        if let Some(bound_subject) = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = 'github' LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .fetch_optional(&mut *transaction)
        .await?
        {
            if bound_subject != github_user_id {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch);
            }
        }
        if let Some(bound_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = 'github' AND provider_subject = ? LIMIT 1",
        )
        .bind(&github_user_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            if bound_pub_dress != pub_dress.as_str() {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected);
            }
        }

        let existing_for_bond = sqlx::query_scalar::<_, String>(
            "SELECT github_user_id FROM github_evidence_connections WHERE pub_dress = ?",
        )
        .bind(pub_dress.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing) = &existing_for_bond {
            if existing != &github_user_id {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch);
            }
        }
        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM github_evidence_connections WHERE github_user_id = ?",
        )
        .bind(&github_user_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            if existing_pub_dress != pub_dress.as_str() {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected);
            }
        }

        sqlx::query(
            "INSERT INTO github_evidence_connections (pub_dress, github_user_id, login, profile_url, avatar_url, encrypted_access_token, connection_state, diagnostic, connected_at, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, 'connected', NULL, ?, ?) ON CONFLICT(pub_dress) DO UPDATE SET github_user_id = excluded.github_user_id, login = excluded.login, profile_url = excluded.profile_url, avatar_url = excluded.avatar_url, encrypted_access_token = excluded.encrypted_access_token, connection_state = 'connected', diagnostic = NULL, refreshed_at = excluded.refreshed_at",
        )
        .bind(pub_dress.as_str())
        .bind(&github_user_id)
        .bind(&user.login)
        .bind(&user.html_url)
        .bind(&user.avatar_url)
        .bind(encrypted_access_token)
        .bind(i64_from_u64(now))
        .bind(i64_from_u64(now))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(if existing_for_bond.is_some() {
            GithubEvidenceConnectOutcome::Reconnected
        } else {
            GithubEvidenceConnectOutcome::Connected
        })
    }

    async fn mark_degraded(
        &self,
        pub_dress: &PubDress,
        diagnostic: &str,
        now: u64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE github_evidence_connections SET connection_state = 'degraded', diagnostic = ?, refreshed_at = ? WHERE pub_dress = ?",
        )
        .bind(diagnostic)
        .bind(i64_from_u64(now))
        .bind(pub_dress.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn refresh(
        &self,
        pub_dress: &PubDress,
        user: &GithubUser,
        now: u64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE github_evidence_connections SET login = ?, profile_url = ?, avatar_url = ?, connection_state = 'connected', diagnostic = NULL, refreshed_at = ? WHERE pub_dress = ? AND github_user_id = ?",
        )
        .bind(&user.login)
        .bind(&user.html_url)
        .bind(&user.avatar_url)
        .bind(i64_from_u64(now))
        .bind(pub_dress.as_str())
        .bind(user.id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete(&self, pub_dress: &PubDress) -> Result<bool, sqlx::Error> {
        let deleted = sqlx::query("DELETE FROM github_evidence_connections WHERE pub_dress = ?")
            .bind(pub_dress.as_str())
            .execute(&self.pool)
            .await?;
        Ok(deleted.rows_affected() > 0)
    }
}

#[derive(sqlx::FromRow)]
struct GithubEvidenceRow {
    pub_dress: String,
    github_user_id: String,
    login: String,
    profile_url: String,
    avatar_url: String,
    encrypted_access_token: Vec<u8>,
    connection_state: String,
    diagnostic: Option<String>,
    connected_at: i64,
    refreshed_at: i64,
}

impl From<GithubEvidenceRow> for GithubEvidenceRecord {
    fn from(value: GithubEvidenceRow) -> Self {
        Self {
            pub_dress: value.pub_dress,
            github_user_id: value.github_user_id,
            login: value.login,
            profile_url: value.profile_url,
            avatar_url: value.avatar_url,
            encrypted_access_token: value.encrypted_access_token,
            connection_state: value.connection_state,
            diagnostic: value.diagnostic,
            connected_at: u64_from_i64(value.connected_at),
            refreshed_at: u64_from_i64(value.refreshed_at),
        }
    }
}

#[derive(Clone)]
struct GithubEvidenceState {
    identities: IdentityRepository,
    connections: GithubEvidenceRepository,
    native_auth: NativeAuthConfig,
    config: GithubEvidenceConfig,
    http: reqwest::Client,
    signer: EvidenceTransactionSigner,
}

pub fn router(
    identities: IdentityRepository,
    connections: GithubEvidenceRepository,
    native_auth: NativeAuthConfig,
    config: GithubEvidenceConfig,
) -> Router {
    let state = GithubEvidenceState {
        identities,
        connections,
        signer: EvidenceTransactionSigner::new(native_auth.secret_digester()),
        native_auth,
        config,
        http: reqwest::Client::new(),
    };
    Router::new()
        .route("/api/v1/github/evidence/start", get(start_connection))
        .route("/api/v1/github/evidence/callback", get(callback))
        .route("/api/v1/github/evidence", get(read_connection))
        .route("/api/v1/github/evidence/disconnect", post(disconnect))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn start_connection(
    State(state): State<GithubEvidenceState>,
    headers: HeaderMap,
) -> Response {
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let Some(identity) = authenticated_native_session(
        &state.identities,
        &state.native_auth,
        &headers,
        now,
    )
    .await
    else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before connecting GitHub evidence.",
        );
    };
    let Some(credentials) = state.config.credentials.as_ref() else {
        return no_store_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "github_evidence_not_configured",
            "GitHub evidence access is not configured on this service.",
        );
    };
    let Some(oauth_state) = random_url_token(24) else {
        return service_unavailable();
    };
    let Some(verifier) = random_url_token(48) else {
        return service_unavailable();
    };
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let transaction = EvidenceTransaction {
        pub_dress: identity.pub_dress,
        state: oauth_state.clone(),
        verifier,
        expires_at: now.saturating_add(TRANSACTION_TTL_SECONDS),
    };
    let Some(cookie_value) = state.signer.issue(&transaction) else {
        return service_unavailable();
    };
    let mut authorize = state.config.endpoints.authorize.clone();
    authorize.query_pairs_mut()
        .append_pair("client_id", &credentials.client_id)
        .append_pair("redirect_uri", state.config.callback_url().as_str())
        .append_pair("state", &oauth_state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    redirect_with_cookie(
        authorize.as_str(),
        secure_cookie(EVIDENCE_TRANSACTION_COOKIE, &cookie_value, TRANSACTION_TTL_SECONDS),
    )
}

async fn callback(
    State(state): State<GithubEvidenceState>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    if query.error.is_some() {
        return callback_failure("github_evidence_authorization_cancelled");
    }
    let Some(now) = now_unix_seconds() else {
        return callback_failure("github_evidence_unavailable");
    };
    let Some(cookie) = read_cookie(&headers, EVIDENCE_TRANSACTION_COOKIE) else {
        return callback_failure("github_evidence_transaction_required");
    };
    let Some(transaction) = state
        .signer
        .verify(&cookie)
        .filter(|transaction| transaction.expires_at > now)
    else {
        return callback_failure("github_evidence_transaction_expired");
    };
    let Some(callback_state) = query.state.as_deref() else {
        return callback_failure("github_evidence_state_mismatch");
    };
    if !constant_time_equal(callback_state.as_bytes(), transaction.state.as_bytes()) {
        return callback_failure("github_evidence_state_mismatch");
    }
    let Some(code) = query.code.as_deref() else {
        return callback_failure("github_evidence_code_missing");
    };
    let Some(identity) = authenticated_native_session(
        &state.identities,
        &state.native_auth,
        &headers,
        now,
    )
    .await
    else {
        return callback_failure("native_authentication_required");
    };
    if identity.pub_dress != transaction.pub_dress {
        return callback_failure("native_session_changed");
    }
    let Some(credentials) = state.config.credentials.as_ref() else {
        return callback_failure("github_evidence_not_configured");
    };
    let token = match exchange_code(&state, credentials, code, &transaction.verifier).await {
        Ok(token) => token,
        Err(reason) => return callback_failure(reason),
    };
    if !token.scope.trim().is_empty() {
        return callback_failure("github_evidence_scope_rejected");
    }
    let inspection = match inspect_token(&state, credentials, &token.access_token).await {
        Ok(TokenInspection::Valid(value)) => value,
        Ok(TokenInspection::Revoked) => return callback_failure("github_evidence_token_invalid"),
        Err(_) => return callback_failure("github_evidence_unavailable"),
    };
    if !inspection.scopes.is_empty() {
        return callback_failure("github_evidence_scope_rejected");
    }
    let pub_dress = match identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return callback_failure("github_evidence_unavailable"),
    };
    let github_user_id = inspection.user.id.to_string();
    let encrypted = match state.config.cipher.seal(
        &token.access_token,
        token_aad(pub_dress.as_str(), &github_user_id).as_bytes(),
    ) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "GitHub evidence token encryption failed");
            return callback_failure("github_evidence_unavailable");
        }
    };
    match state
        .connections
        .connect_account(&pub_dress, &inspection.user, &encrypted, now)
        .await
    {
        Ok(GithubEvidenceConnectOutcome::Connected | GithubEvidenceConnectOutcome::Reconnected) => {
            redirect_with_cookie(
                "/identity?github_evidence=connected",
                clear_cookie(EVIDENCE_TRANSACTION_COOKIE),
            )
        }
        Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch) => {
            callback_failure("github_evidence_identity_mismatch")
        }
        Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected) => {
            callback_failure("github_evidence_account_in_use")
        }
        Ok(GithubEvidenceConnectOutcome::BondMissing) => {
            callback_failure("native_authentication_required")
        }
        Err(error) => {
            tracing::error!(%error, "GitHub evidence connection persistence failed");
            callback_failure("github_evidence_unavailable")
        }
    }
}

#[derive(Debug, Serialize)]
struct GithubEvidenceResponse {
    state: &'static str,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    refreshed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<String>,
}

async fn read_connection(
    State(state): State<GithubEvidenceState>,
    headers: HeaderMap,
) -> Response {
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let Some(identity) = authenticated_native_session(
        &state.identities,
        &state.native_auth,
        &headers,
        now,
    )
    .await
    else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before reading GitHub evidence state.",
        );
    };
    let pub_dress = match identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return service_unavailable(),
    };
    let record = match state.connections.get(&pub_dress).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "GitHub evidence connection lookup failed");
            return service_unavailable();
        }
    };
    let Some(mut record) = record else {
        return no_store_json(
            StatusCode::OK,
            GithubEvidenceResponse {
                state: "disconnected",
                available: state.config.credentials.is_some(),
                login: None,
                profile_url: None,
                avatar_url: None,
                refreshed_at: None,
                diagnostic: None,
            },
        );
    };
    let Some(credentials) = state.config.credentials.as_ref() else {
        return projection_response(&record, false, Some("provider_configuration_missing"));
    };
    let token = match state.config.cipher.open(
        &record.encrypted_access_token,
        token_aad(&record.pub_dress, &record.github_user_id).as_bytes(),
    ) {
        Ok(token) => token,
        Err(error) => {
            tracing::error!(%error, "GitHub evidence token decryption failed");
            let _ = state.connections.mark_degraded(&pub_dress, "credential_unreadable", now).await;
            record.connection_state = "degraded".to_owned();
            record.diagnostic = Some("credential_unreadable".to_owned());
            record.refreshed_at = now;
            return projection_response(&record, true, None);
        }
    };
    match inspect_token(&state, credentials, &token).await {
        Ok(TokenInspection::Valid(inspection))
            if inspection.scopes.is_empty() && inspection.user.id.to_string() == record.github_user_id =>
        {
            if let Err(error) = state.connections.refresh(&pub_dress, &inspection.user, now).await {
                tracing::error!(%error, "GitHub evidence refresh persistence failed");
                return service_unavailable();
            }
            record.login = inspection.user.login;
            record.profile_url = inspection.user.html_url;
            record.avatar_url = inspection.user.avatar_url;
            record.connection_state = "connected".to_owned();
            record.diagnostic = None;
            record.refreshed_at = now;
            projection_response(&record, true, None)
        }
        Ok(TokenInspection::Valid(_)) => {
            let _ = state.connections.mark_degraded(&pub_dress, "credential_scope_or_identity_changed", now).await;
            record.connection_state = "degraded".to_owned();
            record.diagnostic = Some("credential_scope_or_identity_changed".to_owned());
            record.refreshed_at = now;
            projection_response(&record, true, None)
        }
        Ok(TokenInspection::Revoked) => {
            let _ = state.connections.mark_degraded(&pub_dress, "token_revoked", now).await;
            record.connection_state = "degraded".to_owned();
            record.diagnostic = Some("token_revoked".to_owned());
            record.refreshed_at = now;
            projection_response(&record, true, None)
        }
        Err(_) => projection_response(&record, true, Some("provider_unavailable")),
    }
}

async fn disconnect(
    State(state): State<GithubEvidenceState>,
    headers: HeaderMap,
) -> Response {
    if headers.get(CSRF_HEADER).and_then(|value| value.to_str().ok()) != Some("1") {
        return no_store_error(
            StatusCode::FORBIDDEN,
            "csrf_protection_required",
            "This state-changing request requires the 0x1 CSRF header.",
        );
    }
    let Some(now) = now_unix_seconds() else {
        return service_unavailable();
    };
    let Some(identity) = authenticated_native_session(
        &state.identities,
        &state.native_auth,
        &headers,
        now,
    )
    .await
    else {
        return no_store_error(
            StatusCode::UNAUTHORIZED,
            "native_authentication_required",
            "Sign in to the Bond before disconnecting GitHub evidence.",
        );
    };
    let pub_dress = match identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(_) => return service_unavailable(),
    };
    let Some(record) = (match state.connections.get(&pub_dress).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "GitHub evidence disconnect lookup failed");
            return service_unavailable();
        }
    }) else {
        return no_store_error(
            StatusCode::NOT_FOUND,
            "github_evidence_not_connected",
            "GitHub evidence is not connected to this Bond.",
        );
    };
    let Some(credentials) = state.config.credentials.as_ref() else {
        return no_store_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "github_evidence_not_configured",
            "GitHub evidence access is not configured on this service.",
        );
    };
    let token = match state.config.cipher.open(
        &record.encrypted_access_token,
        token_aad(&record.pub_dress, &record.github_user_id).as_bytes(),
    ) {
        Ok(token) => token,
        Err(error) => {
            tracing::error!(%error, "GitHub evidence token decryption failed during disconnect");
            return service_unavailable();
        }
    };
    match inspect_token(&state, credentials, &token).await {
        Ok(TokenInspection::Revoked) => {}
        Ok(TokenInspection::Valid(_)) => {
            if revoke_token(&state, credentials, &token).await.is_err() {
                return no_store_error(
                    StatusCode::BAD_GATEWAY,
                    "github_evidence_revocation_failed",
                    "GitHub did not confirm credential revocation; the local credential was retained.",
                );
            }
        }
        Err(_) => {
            return no_store_error(
                StatusCode::BAD_GATEWAY,
                "github_evidence_revocation_unavailable",
                "GitHub credential revocation is temporarily unavailable; the local credential was retained.",
            );
        }
    }
    match state.connections.delete(&pub_dress).await {
        Ok(true) => no_store_json(
            StatusCode::OK,
            serde_json::json!({"state": "disconnected"}),
        ),
        Ok(false) => no_store_error(
            StatusCode::NOT_FOUND,
            "github_evidence_not_connected",
            "GitHub evidence is not connected to this Bond.",
        ),
        Err(error) => {
            tracing::error!(%error, "GitHub evidence local disconnect failed after revocation");
            service_unavailable()
        }
    }
}

#[derive(Debug, Deserialize)]
struct GithubTokenResponse {
    access_token: String,
    #[serde(default)]
    scope: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubUser {
    id: u64,
    login: String,
    html_url: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubTokenInspection {
    #[serde(default)]
    scopes: Vec<String>,
    user: GithubUser,
}

enum TokenInspection {
    Valid(GithubTokenInspection),
    Revoked,
}

async fn exchange_code(
    state: &GithubEvidenceState,
    credentials: &OAuthClientCredentials,
    code: &str,
    verifier: &str,
) -> Result<GithubTokenResponse, &'static str> {
    let response = state.http
        .post(state.config.endpoints.token.clone())
        .header(header::ACCEPT, "application/json")
        .form(&[
            ("client_id", credentials.client_id.as_str()),
            ("client_secret", credentials.client_secret.as_str()),
            ("code", code),
            ("redirect_uri", state.config.callback_url().as_str()),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|_| "github_evidence_unavailable")?;
    if !response.status().is_success() {
        return Err("github_evidence_token_exchange_failed");
    }
    response.json::<GithubTokenResponse>().await.map_err(|_| "github_evidence_token_exchange_failed")
}

async fn inspect_token(
    state: &GithubEvidenceState,
    credentials: &OAuthClientCredentials,
    token: &str,
) -> Result<TokenInspection, ()> {
    let endpoint = state.config.endpoints.api_root
        .join(&format!("/applications/{}/token", credentials.client_id))
        .map_err(|_| ())?;
    let response = state.http
        .post(endpoint)
        .basic_auth(&credentials.client_id, Some(&credentials.client_secret))
        .header(header::ACCEPT, "application/vnd.github+json")
        .json(&serde_json::json!({"access_token": token}))
        .send()
        .await
        .map_err(|_| ())?;
    match response.status() {
        StatusCode::OK => response.json::<GithubTokenInspection>().await.map(TokenInspection::Valid).map_err(|_| ()),
        StatusCode::NOT_FOUND => Ok(TokenInspection::Revoked),
        _ => Err(()),
    }
}

async fn revoke_token(
    state: &GithubEvidenceState,
    credentials: &OAuthClientCredentials,
    token: &str,
) -> Result<(), ()> {
    let endpoint = state.config.endpoints.api_root
        .join(&format!("/applications/{}/token", credentials.client_id))
        .map_err(|_| ())?;
    let response = state.http
        .delete(endpoint)
        .basic_auth(&credentials.client_id, Some(&credentials.client_secret))
        .header(header::ACCEPT, "application/vnd.github+json")
        .json(&serde_json::json!({"access_token": token}))
        .send()
        .await
        .map_err(|_| ())?;
    if response.status() == StatusCode::NO_CONTENT { Ok(()) } else { Err(()) }
}

fn projection_response(
    record: &GithubEvidenceRecord,
    available: bool,
    override_diagnostic: Option<&str>,
) -> Response {
    no_store_json(
        StatusCode::OK,
        GithubEvidenceResponse {
            state: if override_diagnostic.is_some() || record.connection_state == "degraded" {
                "degraded"
            } else {
                "connected"
            },
            available,
            login: Some(record.login.clone()),
            profile_url: Some(record.profile_url.clone()),
            avatar_url: Some(record.avatar_url.clone()),
            refreshed_at: Some(record.refreshed_at),
            diagnostic: override_diagnostic
                .map(str::to_owned)
                .or_else(|| record.diagnostic.clone()),
        },
    )
}

#[derive(Debug, Serialize, Deserialize)]
struct EvidenceTransaction {
    pub_dress: String,
    state: String,
    verifier: String,
    expires_at: u64,
}

#[derive(Clone)]
struct EvidenceTransactionSigner {
    digester: SecretDigester,
}

impl EvidenceTransactionSigner {
    fn new(digester: SecretDigester) -> Self { Self { digester } }

    fn issue(&self, transaction: &EvidenceTransaction) -> Option<String> {
        let payload = serde_json::to_vec(transaction).ok()?;
        let encoded = URL_SAFE_NO_PAD.encode(payload);
        let signature = self.digester.digest("github-evidence-oauth", &encoded);
        Some(format!("{encoded}.{}", URL_SAFE_NO_PAD.encode(signature)))
    }

    fn verify<T: DeserializeOwned>(&self, value: &str) -> Option<T> {
        let (payload, signature) = value.rsplit_once('.')?;
        let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
        let expected = self.digester.digest("github-evidence-oauth", payload);
        if !constant_time_equal(&expected, &signature) {
            return None;
        }
        let payload = URL_SAFE_NO_PAD.decode(payload).ok()?;
        serde_json::from_slice(&payload).ok()
    }
}

fn token_aad(pub_dress: &str, github_user_id: &str) -> String {
    format!("github-evidence-token\0{pub_dress}\0{github_user_id}")
}

fn random_url_token(bytes: usize) -> Option<String> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value).ok()?;
    Some(URL_SAFE_NO_PAD.encode(value))
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && bool::from(left.ct_eq(right))
}

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get_all(header::COOKIE).iter().find_map(|value| {
        value.to_str().ok()?.split(';').find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name).then(|| value.to_owned())
        })
    })
}

fn secure_cookie(name: &str, value: &str, max_age: u64) -> String {
    format!("{name}={value}; Path=/; Max-Age={max_age}; Secure; HttpOnly; SameSite=Lax")
}

fn clear_cookie(name: &str) -> String {
    format!("{name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax")
}

fn redirect_with_cookie(location: &str, cookie: String) -> Response {
    let mut response = StatusCode::FOUND.into_response();
    if let Ok(value) = HeaderValue::from_str(location) {
        response.headers_mut().insert(header::LOCATION, value);
    }
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    add_no_store_headers(&mut response);
    response
}

fn callback_failure(reason: &str) -> Response {
    let location = format!("/identity?github_evidence_error={reason}");
    redirect_with_cookie(&location, clear_cookie(EVIDENCE_TRANSACTION_COOKIE))
}

fn no_store_json<T: Serialize>(status: StatusCode, body: T) -> Response {
    let mut response = (status, Json(body)).into_response();
    add_no_store_headers(&mut response);
    response
}

fn no_store_error(status: StatusCode, error: &str, message: &str) -> Response {
    no_store_json(status, serde_json::json!({"error": error, "message": message}))
}

fn service_unavailable() -> Response {
    no_store_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "github_evidence_unavailable",
        "GitHub evidence access is temporarily unavailable.",
    )
}

fn add_no_store_headers(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response.headers_mut().insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
}

fn now_unix_seconds() -> Option<u64> {
    SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|value| value.as_secs())
}

fn i64_from_u64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn u64_from_i64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{EvidenceTransaction, EvidenceTransactionSigner, GithubEvidenceConnectOutcome, GithubEvidenceRepository, GithubUser};
    use crate::{IdentityRepository, NativeAuthConfig, ProviderIdentity, ProviderLinkRepository, PubDress};

    fn auth() -> NativeAuthConfig {
        NativeAuthConfig::new("a".repeat(32), "b".repeat(32)).expect("native auth")
    }

    async fn register_bond(identities: &IdentityRepository, pub_dress: &str, seed: &str) -> PubDress {
        let bond = PubDress::from_str(pub_dress).expect("Bond");
        identities.register_native(
            &bond,
            "hash",
            1,
            format!("recovery-{seed}").as_bytes(),
            format!("challenge-{seed}").as_bytes(),
            format!("idempotency-{seed}").as_bytes(),
            100,
            200,
        ).await.expect("registration");
        bond
    }

    fn user(id: u64, login: &str) -> GithubUser {
        GithubUser {
            id,
            login: login.to_owned(),
            html_url: format!("https://github.com/{login}"),
            avatar_url: format!("https://avatars.example/{id}"),
        }
    }

    #[test]
    fn transaction_signature_is_bound_to_payload() {
        let signer = EvidenceTransactionSigner::new(auth().secret_digester());
        let transaction = EvidenceTransaction {
            pub_dress: "0x0sky".to_owned(),
            state: "state".to_owned(),
            verifier: "verifier".to_owned(),
            expires_at: 100,
        };
        let signed = signer.issue(&transaction).expect("signed transaction");
        let verified: EvidenceTransaction = signer.verify(&signed).expect("verified");
        assert_eq!(verified.pub_dress, "0x0sky");
        let mut tampered = signed.into_bytes();
        tampered[0] = if tampered[0] == b'a' { b'b' } else { b'a' };
        assert!(signer.verify::<EvidenceTransaction>(std::str::from_utf8(&tampered).expect("utf8")).is_none());
    }

    #[tokio::test]
    async fn evidence_account_cannot_drift_from_the_bonds_github_provider() {
        let directory = tempfile::tempdir().expect("directory");
        let database_url = format!("sqlite://{}", directory.path().join("identity.sqlite").display());
        let identities = IdentityRepository::connect(&database_url).await.expect("identities");
        let links = ProviderLinkRepository::connect(&database_url).await.expect("links");
        let evidence = GithubEvidenceRepository::connect(&database_url).await.expect("evidence");
        let bond = register_bond(&identities, "0x0sky", "one").await;
        links.link(&bond, &ProviderIdentity::github(42)).await.expect("provider link");

        assert_eq!(
            evidence.connect_account(&bond, &user(43, "other"), b"sealed", 10).await.expect("connect"),
            GithubEvidenceConnectOutcome::ProviderIdentityMismatch
        );
        assert_eq!(
            evidence.connect_account(&bond, &user(42, "same"), b"sealed", 10).await.expect("connect"),
            GithubEvidenceConnectOutcome::Connected
        );
    }

    #[tokio::test]
    async fn one_github_evidence_account_cannot_span_bonds() {
        let directory = tempfile::tempdir().expect("directory");
        let database_url = format!("sqlite://{}", directory.path().join("identity.sqlite").display());
        let identities = IdentityRepository::connect(&database_url).await.expect("identities");
        let evidence = GithubEvidenceRepository::connect(&database_url).await.expect("evidence");
        let first = register_bond(&identities, "0x0sky", "first").await;
        let second = register_bond(&identities, "0x1sky", "second").await;
        let github = user(42, "same");
        assert_eq!(
            evidence.connect_account(&first, &github, b"sealed", 10).await.expect("first"),
            GithubEvidenceConnectOutcome::Connected
        );
        assert_eq!(
            evidence.connect_account(&second, &github, b"sealed", 11).await.expect("second"),
            GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected
        );
    }
}
