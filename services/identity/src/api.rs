// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    str::FromStr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{
    DiscordOAuthClient, DiscordOAuthError, IdentityRecord, IdentityRepository, ProviderIdentity,
    PubDress, RegistrationOutcome, TelegramInitDataVerifier,
};

const TELEGRAM_AUTH_SCHEME: &str = "tma ";
const DISCORD_AUTH_SCHEME: &str = "discord ";
const MAX_REQUEST_BYTES: usize = 8 * 1024;

pub trait Clock: Send + Sync {
    fn now_unix_seconds(&self) -> Result<u64, ClockError>;
}

#[derive(Clone, Copy, Debug)]
pub struct ClockError;

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix_seconds(&self) -> Result<u64, ClockError> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .map_err(|_| ClockError)
    }
}

#[derive(Clone)]
struct ApiState {
    repository: IdentityRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    clock: Arc<dyn Clock>,
}

pub fn router(
    repository: IdentityRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
) -> Router {
    router_with_clock(
        repository,
        telegram_verifier,
        discord_oauth,
        Arc::new(SystemClock),
    )
}

fn router_with_clock(
    repository: IdentityRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    clock: Arc<dyn Clock>,
) -> Router {
    let state = ApiState {
        repository,
        telegram_verifier,
        discord_oauth,
        clock,
    };

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/discord/config", get(discord_config))
        .route("/api/v1/auth/discord/token", post(exchange_discord_code))
        .route("/api/v1/identity", get(read_identity))
        .route("/api/v1/identity/registration", post(register_identity))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn discord_config(State(state): State<ApiState>) -> Response {
    let Some(discord) = state.discord_oauth.as_ref() else {
        return unavailable();
    };

    (
        StatusCode::OK,
        Json(DiscordConfigResponse {
            client_id: discord.client_id(),
        }),
    )
        .into_response()
}

async fn exchange_discord_code(
    State(state): State<ApiState>,
    Json(request): Json<DiscordTokenRequest>,
) -> Response {
    let Some(discord) = state.discord_oauth.as_ref() else {
        return unavailable();
    };

    match discord.exchange_code(&request.code).await {
        Ok(token) => (StatusCode::OK, Json(token)).into_response(),
        Err(DiscordOAuthError::Rejected(status)) => {
            tracing::warn!(
                discord_status = status,
                "Discord authorization code rejected"
            );
            unauthorized()
        }
        Err(error) => {
            tracing::error!(%error, "Discord authorization code exchange failed");
            unavailable()
        }
    }
}

async fn read_identity(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let provider_identity = match authenticate(&state, &headers).await {
        Ok(identity) => identity,
        Err(error) => return error.into_response(),
    };

    match state.repository.find_by_provider(&provider_identity).await {
        Ok(Some(identity)) => identity_response(StatusCode::OK, identity),
        Ok(None) => api_error(
            StatusCode::NOT_FOUND,
            "identity_not_registered",
            "No pub_dress is registered for this provider account.",
        ),
        Err(error) => {
            tracing::error!(%error, "identity API lookup failed");
            unavailable()
        }
    }
}

async fn register_identity(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RegistrationRequest>,
) -> Response {
    let provider_identity = match authenticate(&state, &headers).await {
        Ok(identity) => identity,
        Err(error) => return error.into_response(),
    };
    let candidate = format!("0x{}{}", request.discriminator, request.slug);
    let pub_dress = match PubDress::from_str(&candidate) {
        Ok(value) => value,
        Err(error) => {
            return api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                error_code(error),
                "Choose one hexadecimal discriminator and a case-sensitive 2–32-character slug.",
            );
        }
    };

    match state
        .repository
        .register(&pub_dress, &provider_identity)
        .await
    {
        Ok(RegistrationOutcome::Registered(identity)) => registration_response(
            StatusCode::CREATED,
            RegistrationResponse {
                outcome: RegistrationResponseKind::Registered,
                identity: identity.into(),
            },
        ),
        Ok(RegistrationOutcome::AlreadyRegistered(identity)) => registration_response(
            StatusCode::OK,
            RegistrationResponse {
                outcome: RegistrationResponseKind::AlreadyRegistered,
                identity: identity.into(),
            },
        ),
        Ok(RegistrationOutcome::HandleUnavailable) => api_error(
            StatusCode::CONFLICT,
            "pub_dress_unavailable",
            "That pub_dress cannot be registered. Choose another one.",
        ),
        Err(error) => {
            tracing::error!(%error, "identity API registration failed");
            unavailable()
        }
    }
}

async fn authenticate(
    state: &ApiState,
    headers: &HeaderMap,
) -> Result<ProviderIdentity, AuthenticationFailure> {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(AuthenticationFailure::Unauthorized)?;

    if let Some(init_data) = authorization
        .strip_prefix(TELEGRAM_AUTH_SCHEME)
        .filter(|value| !value.is_empty())
    {
        let now = state
            .clock
            .now_unix_seconds()
            .map_err(|_| AuthenticationFailure::Unavailable)?;
        let user = state
            .telegram_verifier
            .verify(init_data, now)
            .map_err(|error| {
                tracing::warn!(%error, "Telegram Mini App authentication rejected");
                AuthenticationFailure::Unauthorized
            })?;
        return Ok(ProviderIdentity::telegram(user.id));
    }

    if let Some(access_token) = authorization
        .strip_prefix(DISCORD_AUTH_SCHEME)
        .filter(|value| !value.is_empty())
    {
        let discord = state
            .discord_oauth
            .as_ref()
            .ok_or(AuthenticationFailure::Unavailable)?;
        let user_id = discord.authenticate(access_token).await.map_err(|error| {
            tracing::warn!(%error, "Discord Activity authentication rejected");
            match error {
                DiscordOAuthError::Rejected(_) | DiscordOAuthError::InvalidResponse => {
                    AuthenticationFailure::Unauthorized
                }
                DiscordOAuthError::Transport(_) => AuthenticationFailure::Unavailable,
            }
        })?;
        return Ok(ProviderIdentity::discord(user_id));
    }

    Err(AuthenticationFailure::Unauthorized)
}

#[derive(Clone, Copy, Debug)]
enum AuthenticationFailure {
    Unauthorized,
    Unavailable,
}

impl AuthenticationFailure {
    fn into_response(self) -> Response {
        match self {
            Self::Unauthorized => unauthorized(),
            Self::Unavailable => unavailable(),
        }
    }
}

fn error_code(error: crate::PubDressError) -> &'static str {
    match error {
        crate::PubDressError::InvalidPrefix => "invalid_pub_dress_prefix",
        crate::PubDressError::InvalidDiscriminator => "invalid_pub_dress_discriminator",
        crate::PubDressError::InvalidLength => "invalid_pub_dress_length",
        crate::PubDressError::InvalidCharacter => "invalid_pub_dress_character",
    }
}

fn identity_response(status: StatusCode, identity: IdentityRecord) -> Response {
    (status, Json(IdentityProjection::from(identity))).into_response()
}

fn registration_response(status: StatusCode, response: RegistrationResponse) -> Response {
    (status, Json(response)).into_response()
}

fn unauthorized() -> Response {
    api_error(
        StatusCode::UNAUTHORIZED,
        "provider_authentication_required",
        "Open 0x1 from a supported provider to continue.",
    )
}

fn unavailable() -> Response {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "identity_service_unavailable",
        "Identity registration is temporarily unavailable.",
    )
}

fn api_error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (
        status,
        Json(ErrorEnvelope {
            error: ApiError { code, message },
        }),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DiscordTokenRequest {
    code: String,
}

#[derive(Debug, Serialize)]
struct DiscordConfigResponse<'a> {
    client_id: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistrationRequest {
    discriminator: String,
    slug: String,
}

#[derive(Debug, Serialize)]
struct RegistrationResponse {
    outcome: RegistrationResponseKind,
    identity: IdentityProjection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum RegistrationResponseKind {
    Registered,
    AlreadyRegistered,
}

#[derive(Debug, Serialize)]
struct IdentityProjection {
    pub_dress: String,
}

impl From<IdentityRecord> for IdentityProjection {
    fn from(identity: IdentityRecord) -> Self {
        Self {
            pub_dress: identity.pub_dress,
        }
    }
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

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, sync::Arc};

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
    };
    use hmac::{Hmac, Mac};
    use serde_json::Value;
    use sha2::Sha256;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::{Clock, router_with_clock};
    use crate::{IdentityRepository, TelegramInitDataVerifier};

    const TOKEN: &str = "123456:development-token";
    const NOW: u64 = 1_800_000_000;

    #[derive(Debug)]
    struct StaticClock;

    impl Clock for StaticClock {
        fn now_unix_seconds(&self) -> Result<u64, super::ClockError> {
            Ok(NOW)
        }
    }

    fn signed_init_data(user_id: i64) -> String {
        let mut fields = BTreeMap::from([
            ("auth_date", NOW.to_string()),
            ("query_id", "query-1".to_owned()),
            (
                "user",
                format!(r#"{{"id":{user_id},"first_name":"Sasha"}}"#),
            ),
        ]);
        let check = fields
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut secret = Hmac::<Sha256>::new_from_slice(b"WebAppData").expect("valid key");
        secret.update(TOKEN.as_bytes());
        let secret = secret.finalize().into_bytes();
        let mut signature = Hmac::<Sha256>::new_from_slice(&secret).expect("valid key");
        signature.update(check.as_bytes());
        fields.insert(
            "hash",
            signature
                .finalize()
                .into_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        );
        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields)
            .finish()
    }

    async fn app() -> axum::Router {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        router_with_clock(
            repository,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
            None,
            Arc::new(StaticClock),
        )
    }

    #[tokio::test]
    async fn registers_once_and_returns_existing_identity_idempotently() {
        let app = app().await;
        let authorization = format!("tma {}", signed_init_data(42));
        let request = || {
            Request::post("/api/v1/identity/registration")
                .header(AUTHORIZATION, &authorization)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"discriminator":"0","slug":"sky"}"#))
                .expect("valid request")
        };

        let first = app.clone().oneshot(request()).await.expect("response");
        assert_eq!(first.status(), StatusCode::CREATED);
        let second = app.oneshot(request()).await.expect("response");
        assert_eq!(second.status(), StatusCode::OK);
        let body = to_bytes(second.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["identity"]["pub_dress"], "0x0sky");
        assert!(body.to_string().find("provider_subject").is_none());
    }

    #[tokio::test]
    async fn rejects_unsigned_requests_and_noncanonical_slugs() {
        let app = app().await;
        let unsigned = Request::post("/api/v1/identity/registration")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"discriminator":"0","slug":"sky"}"#))
            .expect("request");
        let response = app.clone().oneshot(unsigned).await.expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = to_bytes(response.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["error"]["code"], "provider_authentication_required");

        let invalid = Request::post("/api/v1/identity/registration")
            .header(AUTHORIZATION, format!("tma {}", signed_init_data(42)))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"discriminator":"g","slug":"Sky"}"#))
            .expect("request");
        assert_eq!(
            app.oneshot(invalid).await.expect("response").status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn reports_discord_as_unconfigured_without_credentials() {
        let app = app().await;
        let response = app
            .oneshot(
                Request::get("/api/v1/auth/discord/config")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
