// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    str::FromStr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL, COOKIE, RETRY_AFTER, SET_COOKIE},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{
    AvaiaPubDress, DiscordOAuthClient, DiscordOAuthError, IdentityRecord, IdentityRepository,
    NativeAuthConfig, NativeCredentialRecord, NativeRegistrationOutcome, PasswordEngine,
    PasswordPolicyError, ProviderIdentity, PubDress, PubDressRenameOutcome, RegistrationOutcome,
    RememberedBondSigner, SecretDigester, TelegramInitDataVerifier, TokenFactory,
    rate_limit::AttemptLimiter,
};
use subtle::ConstantTimeEq as _;

const TELEGRAM_AUTH_SCHEME: &str = "tma ";
const DISCORD_AUTH_SCHEME: &str = "discord ";
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const SESSION_COOKIE: &str = "__Host-ox1_session";
const REMEMBERED_BOND_COOKIE: &str = "__Host-ox1_bond";
const CSRF_HEADER: &str = "x-0x1-csrf";

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
    native_auth: NativeAuthConfig,
    password_engine: PasswordEngine,
    secret_digester: SecretDigester,
    remembered_bond_signer: RememberedBondSigner,
    limiter: AttemptLimiter,
    dummy_password_hash: String,
}

pub fn router(
    repository: IdentityRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
) -> Router {
    router_with_clock(
        repository,
        telegram_verifier,
        discord_oauth,
        native_auth,
        Arc::new(SystemClock),
    )
}

fn router_with_clock(
    repository: IdentityRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
    clock: Arc<dyn Clock>,
) -> Router {
    let password_engine = native_auth.password_engine();
    let dummy_password_hash = password_engine
        .hash("0x1 constant-shape dummy password")
        .expect("native password hashing must initialize");
    let state = ApiState {
        repository,
        telegram_verifier,
        discord_oauth,
        clock,
        password_engine,
        secret_digester: native_auth.secret_digester(),
        remembered_bond_signer: native_auth.remembered_bond_signer(),
        native_auth,
        limiter: AttemptLimiter::default(),
        dummy_password_hash,
    };

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/discord/config", get(discord_config))
        .route("/api/v1/auth/discord/token", post(exchange_discord_code))
        .route("/api/v1/auth/native/context", get(read_native_context))
        .route(
            "/api/v1/auth/native/registration",
            post(register_native_identity),
        )
        .route(
            "/api/v1/auth/native/recovery/acknowledgement",
            post(acknowledge_native_recovery_key),
        )
        .route(
            "/api/v1/auth/native/session",
            post(authenticate_native_identity),
        )
        .route("/api/v1/auth/native/logout", post(logout_native_identity))
        .route(
            "/api/v1/auth/native/remembered/forget",
            post(forget_remembered_bond),
        )
        .route(
            "/api/v1/auth/native/recovery",
            post(recover_native_identity),
        )
        .route("/api/v1/identity/resolve", post(resolve_pub_dress))
        .route("/api/v1/identity", get(read_identity))
        .route(
            "/api/v1/identity/availability",
            get(check_pub_dress_availability),
        )
        .route("/api/v1/identity/registration", post(register_identity))
        .route("/api/v1/identity/pub_dress", post(rename_pub_dress))
        .route("/api/v1/identity/avaia/pub_dress", post(rename_owned_avaia))
        .route(
            "/api/v1/auth/telegram/password",
            post(set_telegram_password),
        )
        .route("/api/v1/auth/discord/password", post(set_discord_password))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn resolve_pub_dress(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ResolvePubDressRequest>,
) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let source = request_source(&headers);
    if let Err(retry_after) = state
        .limiter
        .consume(format!("resolve:source:{source}"), now, 60, 60)
        .and_then(|_| state.limiter.consume("resolve:global", now, 2_000, 60))
    {
        return rate_limited(retry_after);
    }
    let pub_dress = match PubDress::from_str(&request.pub_dress) {
        Ok(value) => value,
        Err(error) => return invalid_pub_dress(error),
    };

    match state.repository.is_pub_dress_available(&pub_dress).await {
        Ok(available) => no_store_json(
            StatusCode::OK,
            PubDressResolutionResponse {
                pub_dress: pub_dress.to_string(),
                state: if available {
                    PubDressResolutionKind::Available
                } else {
                    PubDressResolutionKind::Registered
                },
            },
        ),
        Err(error) => {
            tracing::error!(%error, "public pub_dress resolution failed");
            unavailable()
        }
    }
}

async fn read_native_context(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };

    if let Some(token) = read_cookie(&headers, SESSION_COOKIE) {
        let token_hash = state.secret_digester.digest("native-session", &token);
        match state.repository.find_native_session(&token_hash, now).await {
            Ok(Some(identity)) => {
                let identity = match reconcile_authenticated_identity(&state, identity, now).await {
                    Some(value) => value,
                    None => return unavailable(),
                };
                return no_store_json(
                    StatusCode::OK,
                    NativeContextResponse::authenticated(identity),
                );
            }
            Ok(None) => {}
            Err(error) => {
                tracing::error!(%error, "native session lookup failed");
                return unavailable();
            }
        }
    }

    if let Some(hint) = read_cookie(&headers, REMEMBERED_BOND_COOKIE)
        && let Some(pub_dress) = state
            .remembered_bond_signer
            .verify(&hint, now)
            .and_then(|candidate| PubDress::from_str(&candidate).ok())
    {
        return no_store_json(
            StatusCode::OK,
            NativeContextResponse::remembered(pub_dress.to_string()),
        );
    }

    let mut response = no_store_json(StatusCode::OK, NativeContextResponse::anonymous());
    if read_cookie(&headers, SESSION_COOKIE).is_some() {
        append_cookie(&mut response, clear_cookie(SESSION_COOKIE));
    }
    if read_cookie(&headers, REMEMBERED_BOND_COOKIE).is_some() {
        append_cookie(&mut response, clear_cookie(REMEMBERED_BOND_COOKIE));
    }
    response
}

async fn register_native_identity(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<NativeCredentialRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let source = request_source(&headers);
    if let Err(retry_after) = state
        .limiter
        .consume(format!("register:source:{source}"), now, 8, 60 * 60)
        .and_then(|_| state.limiter.consume("register:global", now, 500, 60 * 60))
    {
        return rate_limited(retry_after);
    }
    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| (16..=128).contains(&value.len()) && value.is_ascii())
    else {
        return no_store_error(
            StatusCode::BAD_REQUEST,
            "idempotency_key_required",
            "Registration requires a valid Idempotency-Key header.",
        );
    };
    let pub_dress = match PubDress::from_str(&request.pub_dress) {
        Ok(value) => value,
        Err(error) => return invalid_pub_dress(error),
    };
    let normalized_password = match state.password_engine.validate(&request.password) {
        Ok(value) => value,
        Err(error) => return password_policy_error(error),
    };
    let password_engine = state.password_engine.clone();
    let password_hash =
        match tokio::task::spawn_blocking(move || password_engine.hash(&normalized_password)).await
        {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                tracing::error!(%error, "native password hashing failed");
                return unavailable();
            }
            Err(error) => {
                tracing::error!(%error, "native password hashing task failed");
                return unavailable();
            }
        };
    let recovery_key = match TokenFactory::recovery_key() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "native recovery key generation failed");
            return unavailable();
        }
    };
    let challenge = match TokenFactory::registration_challenge() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "native registration challenge generation failed");
            return unavailable();
        }
    };
    let recovery_key_hash = state
        .secret_digester
        .digest("native-recovery-key", &recovery_key);
    let challenge_hash = state
        .secret_digester
        .digest("native-registration-challenge", &challenge);
    let idempotency_key_hash = state
        .secret_digester
        .digest("native-registration-idempotency", idempotency_key);
    let challenge_expires_at =
        now.saturating_add(state.native_auth.registration_challenge_ttl_seconds);

    match state
        .repository
        .register_native(
            &pub_dress,
            &password_hash,
            state.password_engine.hash_version(),
            &recovery_key_hash,
            &challenge_hash,
            &idempotency_key_hash,
            now,
            challenge_expires_at,
        )
        .await
    {
        Ok(NativeRegistrationOutcome::Registered(identity)) => no_store_json(
            StatusCode::CREATED,
            NativeRegistrationResponse {
                state: "recovery_key_required",
                identity: identity.into(),
                recovery_key,
                challenge,
            },
        ),
        Ok(NativeRegistrationOutcome::IdempotentReplay(_)) => no_store_error(
            StatusCode::CONFLICT,
            "native_registration_already_committed",
            "Registration committed and its recovery key was already issued.",
        ),
        Ok(NativeRegistrationOutcome::HandleUnavailable)
        | Ok(NativeRegistrationOutcome::AvaiaUnavailable) => no_store_error(
            StatusCode::CONFLICT,
            "pub_dress_unavailable",
            "That pub_dress is already registered or cannot own its required Avaia address.",
        ),
        Err(error) => {
            tracing::error!(%error, "native identity registration failed");
            unavailable()
        }
    }
}

async fn acknowledge_native_recovery_key(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RecoveryAcknowledgementRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let challenge_hash = state
        .secret_digester
        .digest("native-registration-challenge", &request.challenge);
    match state
        .repository
        .activate_native_registration(&challenge_hash, now)
        .await
    {
        Ok(Some(identity)) => authenticated_response(&state, identity, now, None).await,
        Ok(None) => no_store_error(
            StatusCode::BAD_REQUEST,
            "invalid_registration_challenge",
            "The registration acknowledgement is invalid or expired.",
        ),
        Err(error) => {
            tracing::error!(%error, "native registration acknowledgement failed");
            unavailable()
        }
    }
}

async fn authenticate_native_identity(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<NativeCredentialRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let source_key = format!("auth:source:{}", request_source(&headers));
    let pub_dress_key = format!("auth:pub-dress:{}", request.pub_dress);
    if let Err(retry_after) = state
        .limiter
        .check(&source_key, now)
        .and_then(|_| state.limiter.check(&pub_dress_key, now))
        .and_then(|_| state.limiter.consume("auth:global", now, 2_000, 60))
    {
        return rate_limited(retry_after);
    }

    let pub_dress = PubDress::from_str(&request.pub_dress).ok();
    let credential = match pub_dress.as_ref() {
        Some(pub_dress) => match state.repository.find_native_credential(pub_dress).await {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(%error, "native credential lookup failed");
                return unavailable();
            }
        },
        None => None,
    };
    let encoded_hash = credential.as_ref().map_or_else(
        || state.dummy_password_hash.clone(),
        |value| value.password_hash.clone(),
    );
    let password = request.password;
    let password_for_rehash = password.clone();
    let password_engine = state.password_engine.clone();
    let password_matches =
        match tokio::task::spawn_blocking(move || password_engine.verify(&password, &encoded_hash))
            .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(%error, "native password verification task failed");
                return unavailable();
            }
        };

    let authenticated = password_matches
        && credential.as_ref().is_some_and(|value| value.active)
        && pub_dress.is_some();
    if !authenticated {
        state.limiter.record_authentication_failure(source_key, now);
        state
            .limiter
            .record_authentication_failure(pub_dress_key, now);
        return invalid_native_credentials();
    }

    state.limiter.clear(&source_key);
    state.limiter.clear(&pub_dress_key);
    let credential = credential.expect("authenticated credential exists");
    if credential.password_hash_version < state.password_engine.hash_version() {
        rehash_credential_after_success(&state, &credential, &password_for_rehash, now).await;
    }
    authenticated_response(
        &state,
        IdentityRecord {
            pub_dress: credential.pub_dress,
            avaia_pub_dress: None,
        },
        now,
        None,
    )
    .await
}

async fn logout_native_identity(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    if let Some(token) = read_cookie(&headers, SESSION_COOKIE) {
        let token_hash = state.secret_digester.digest("native-session", &token);
        if let Err(error) = state
            .repository
            .revoke_native_session(&token_hash, now)
            .await
        {
            tracing::error!(%error, "native session revocation failed");
            return unavailable();
        }
    }
    let mut response = no_store_empty(StatusCode::NO_CONTENT);
    append_cookie(&mut response, clear_cookie(SESSION_COOKIE));
    response
}

async fn forget_remembered_bond(headers: HeaderMap) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let mut response = no_store_empty(StatusCode::NO_CONTENT);
    append_cookie(&mut response, clear_cookie(REMEMBERED_BOND_COOKIE));
    response
}

async fn recover_native_identity(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<NativeRecoveryRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let source = request_source(&headers);
    if let Err(retry_after) =
        state
            .limiter
            .consume(format!("recovery:source:{source}"), now, 5, 60 * 60)
    {
        return rate_limited(retry_after);
    }
    let pub_dress = match PubDress::from_str(&request.pub_dress) {
        Ok(value) => value,
        Err(_) => return invalid_recovery_material(),
    };
    let normalized_password = match state.password_engine.validate(&request.new_password) {
        Ok(value) => value,
        Err(error) => return password_policy_error(error),
    };
    let credential = match state.repository.find_native_credential(&pub_dress).await {
        Ok(Some(value)) if value.active => value,
        Ok(_) => return invalid_recovery_material(),
        Err(error) => {
            tracing::error!(%error, "native recovery credential lookup failed");
            return unavailable();
        }
    };
    let submitted_recovery_hash = state
        .secret_digester
        .digest("native-recovery-key", &request.recovery_key);
    if !bool::from(
        credential
            .recovery_key_hash
            .as_slice()
            .ct_eq(submitted_recovery_hash.as_slice()),
    ) {
        return invalid_recovery_material();
    }
    let password_engine = state.password_engine.clone();
    let password_hash =
        match tokio::task::spawn_blocking(move || password_engine.hash(&normalized_password)).await
        {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                tracing::error!(%error, "recovery password hashing failed");
                return unavailable();
            }
            Err(error) => {
                tracing::error!(%error, "recovery password hashing task failed");
                return unavailable();
            }
        };
    let replacement_recovery_key = match TokenFactory::recovery_key() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "replacement recovery key generation failed");
            return unavailable();
        }
    };
    let replacement_recovery_hash = state
        .secret_digester
        .digest("native-recovery-key", &replacement_recovery_key);
    match state
        .repository
        .replace_native_credential_after_recovery(
            &pub_dress,
            &submitted_recovery_hash,
            &password_hash,
            state.password_engine.hash_version(),
            &replacement_recovery_hash,
            now,
        )
        .await
    {
        Ok(true) => {
            authenticated_response(
                &state,
                IdentityRecord {
                    pub_dress: pub_dress.to_string(),
                    avaia_pub_dress: None,
                },
                now,
                Some(replacement_recovery_key),
            )
            .await
        }
        Ok(false) => invalid_recovery_material(),
        Err(error) => {
            tracing::error!(%error, "native credential recovery failed");
            unavailable()
        }
    }
}

async fn reconcile_authenticated_identity(
    state: &ApiState,
    identity: IdentityRecord,
    now: u64,
) -> Option<IdentityRecord> {
    if identity.avaia_pub_dress.is_some() {
        return Some(identity);
    }
    let pub_dress = match PubDress::from_str(&identity.pub_dress) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "stored authenticated human pub_dress is invalid");
            return None;
        }
    };
    match state
        .repository
        .reconcile_owned_avaia(&pub_dress, now)
        .await
    {
        Ok(Some(record)) => Some(record),
        Ok(None) => {
            tracing::error!(pub_dress = %identity.pub_dress, "authenticated human identity disappeared during Avaia reconciliation");
            None
        }
        Err(error) => {
            tracing::error!(%error, "authenticated Avaia reconciliation failed");
            None
        }
    }
}

async fn authenticated_response(
    state: &ApiState,
    identity: IdentityRecord,
    now: u64,
    replacement_recovery_key: Option<String>,
) -> Response {
    let identity = match reconcile_authenticated_identity(state, identity, now).await {
        Some(value) => value,
        None => return unavailable(),
    };
    let session_token = match TokenFactory::session() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "native session token generation failed");
            return unavailable();
        }
    };
    let session_expires_at = now.saturating_add(state.native_auth.session_ttl_seconds);
    let token_hash = state
        .secret_digester
        .digest("native-session", &session_token);
    if let Err(error) = state
        .repository
        .create_native_session(&token_hash, &identity.pub_dress, now, session_expires_at)
        .await
    {
        tracing::error!(%error, "native session creation failed");
        return unavailable();
    }
    let remembered_expires_at = now.saturating_add(state.native_auth.remembered_bond_ttl_seconds);
    let remembered_hint = match state
        .remembered_bond_signer
        .issue(&identity.pub_dress, remembered_expires_at)
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "remembered Bond hint generation failed");
            return unavailable();
        }
    };

    let mut response = no_store_json(
        StatusCode::OK,
        NativeAuthenticationResponse {
            state: "authenticated",
            identity: identity.into(),
            replacement_recovery_key,
        },
    );
    append_cookie(
        &mut response,
        secure_cookie(
            SESSION_COOKIE,
            &session_token,
            state.native_auth.session_ttl_seconds,
        ),
    );
    append_cookie(
        &mut response,
        secure_cookie(
            REMEMBERED_BOND_COOKIE,
            &remembered_hint,
            state.native_auth.remembered_bond_ttl_seconds,
        ),
    );
    response
}

async fn rehash_credential_after_success(
    state: &ApiState,
    credential: &NativeCredentialRecord,
    password: &str,
    now: u64,
) {
    let Ok(normalized_password) = state.password_engine.validate(password) else {
        return;
    };
    let password_engine = state.password_engine.clone();
    let Ok(Ok(password_hash)) =
        tokio::task::spawn_blocking(move || password_engine.hash(&normalized_password)).await
    else {
        tracing::warn!("native credential rehash could not complete");
        return;
    };
    if let Err(error) = state
        .repository
        .update_password_hash_if_version_advances(
            &credential.pub_dress,
            credential.password_hash_version,
            &password_hash,
            state.password_engine.hash_version(),
            now,
        )
        .await
    {
        tracing::warn!(%error, "native credential rehash persistence failed");
    }
}

fn now(state: &ApiState) -> Result<u64, ClockError> {
    state.clock.now_unix_seconds().inspect_err(|error| {
        tracing::error!(?error, "system clock is before unix epoch");
    })
}

fn request_source(headers: &HeaderMap) -> String {
    let candidate = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'-'))
        });
    candidate.unwrap_or("unknown").to_owned()
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

fn valid_csrf(headers: &HeaderMap) -> bool {
    headers
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        == Some("1")
}

fn reject_missing_csrf(headers: &HeaderMap) -> Option<Response> {
    (!valid_csrf(headers)).then(|| {
        no_store_error(
            StatusCode::FORBIDDEN,
            "csrf_protection_required",
            "This state-changing request requires the 0x1 CSRF header.",
        )
    })
}

fn no_store_json<T: Serialize>(status: StatusCode, body: T) -> Response {
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn no_store_empty(status: StatusCode) -> Response {
    let mut response = status.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn no_store_error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    no_store_json(
        status,
        ErrorEnvelope {
            error: ApiError { code, message },
        },
    )
}

fn rate_limited(retry_after: u64) -> Response {
    let mut response = no_store_error(
        StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
        "Too many identity requests. Wait before trying again.",
    );
    if let Ok(value) = HeaderValue::from_str(&retry_after.max(1).to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

fn password_policy_error(error: PasswordPolicyError) -> Response {
    match error {
        PasswordPolicyError::InvalidLength => no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_password_length",
            "Use a password containing 8–128 Unicode code points.",
        ),
        PasswordPolicyError::Compromised => no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "compromised_password",
            "Choose a password that is not present in the compromised-password blocklist.",
        ),
    }
}

fn invalid_native_credentials() -> Response {
    no_store_error(
        StatusCode::UNAUTHORIZED,
        "invalid_native_credentials",
        "The pub_dress or password is invalid.",
    )
}

fn invalid_recovery_material() -> Response {
    no_store_error(
        StatusCode::UNAUTHORIZED,
        "invalid_recovery_material",
        "The pub_dress or recovery key is invalid.",
    )
}

async fn check_pub_dress_availability(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(request): Query<PubDressSelectionRequest>,
) -> Response {
    if let Err(error) = authenticate(&state, &headers).await {
        return error.into_response();
    }
    let pub_dress = match parse_pub_dress(&request) {
        Ok(value) => value,
        Err(error) => return invalid_pub_dress(error),
    };

    match state.repository.is_pub_dress_available(&pub_dress).await {
        Ok(available) => (
            StatusCode::OK,
            [(CACHE_CONTROL, "no-store")],
            Json(AvailabilityResponse {
                pub_dress: pub_dress.to_string(),
                available,
            }),
        )
            .into_response(),
        Err(error) => {
            tracing::error!(%error, "pub_dress availability lookup failed");
            unavailable()
        }
    }
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
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };

    match state.repository.find_by_provider(&provider_identity).await {
        Ok(Some(identity)) => {
            let identity = match reconcile_authenticated_identity(&state, identity, now).await {
                Some(value) => value,
                None => return unavailable(),
            };
            let password_required = match state
                .repository
                .password_required(&identity.pub_dress)
                .await
            {
                Ok(value) => value,
                Err(_) => return unavailable(),
            };
            no_store_json(
                StatusCode::OK,
                ProviderIdentityProjection {
                    identity: identity.into(),
                    password_required,
                },
            )
        }
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

async fn set_telegram_password(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ProviderPasswordRequest>,
) -> Response {
    set_provider_password(state, headers, request, crate::IdentityProvider::Telegram).await
}

async fn set_discord_password(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ProviderPasswordRequest>,
) -> Response {
    set_provider_password(state, headers, request, crate::IdentityProvider::Discord).await
}

// One operation per verified provider. The route only says which provider proof
// is presented; the binding, and therefore the owner, is resolved here.
// Deliberately excludes a client-selected pub_dress and never resets an active password.
async fn set_provider_password(
    state: ApiState,
    headers: HeaderMap,
    request: ProviderPasswordRequest,
    expected: crate::IdentityProvider,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let provider = match authenticate(&state, &headers).await {
        Ok(identity) if identity.provider == expected => identity,
        Ok(_) => return unauthorized(),
        Err(error) => return error.into_response(),
    };
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    if let Err(retry_after) = state
        .limiter
        .consume(
            format!("password-setup:{}:{}", expected.as_str(), provider.subject),
            now,
            8,
            3600,
        )
        .and_then(|_| {
            state
                .limiter
                .consume("password-setup:global", now, 500, 3600)
        })
    {
        return rate_limited(retry_after);
    }
    match state.repository.find_by_provider(&provider).await {
        Ok(Some(_)) => {}
        Ok(None) => return unauthorized(),
        Err(_) => return unavailable(),
    }
    let password = match state.password_engine.validate(&request.password) {
        Ok(value) => value,
        Err(error) => return password_policy_error(error),
    };
    let engine = state.password_engine.clone();
    let password_hash = match tokio::task::spawn_blocking(move || engine.hash(&password)).await {
        Ok(Ok(value)) => value,
        _ => return unavailable(),
    };
    let (Ok(recovery_key), Ok(challenge)) = (
        TokenFactory::recovery_key(),
        TokenFactory::registration_challenge(),
    ) else {
        return unavailable();
    };
    let recovery_hash = state
        .secret_digester
        .digest("native-recovery-key", &recovery_key);
    let challenge_hash = state
        .secret_digester
        .digest("native-registration-challenge", &challenge);
    match state
        .repository
        .prepare_provider_password(
            &provider,
            &password_hash,
            state.password_engine.hash_version(),
            &recovery_hash,
            &challenge_hash,
            now,
            now.saturating_add(state.native_auth.registration_challenge_ttl_seconds),
        )
        .await
    {
        Ok(Some(identity)) => no_store_json(
            StatusCode::CREATED,
            NativeRegistrationResponse {
                state: "recovery_key_required",
                identity: identity.into(),
                recovery_key,
                challenge,
            },
        ),
        Ok(None) => no_store_error(
            StatusCode::CONFLICT,
            "password_already_set",
            "A password is already active. Sign in or use recovery to change it.",
        ),
        Err(_) => unavailable(),
    }
}

// A Bond keeps its identity across a rename: the same provider bindings,
// credentials and sessions, under the address its owner chose. Only the slug is
// accepted, so the discriminator the Bond registered under is never rewritten by
// a request.
async fn rename_pub_dress(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<PubDressRenameRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let identity = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(current) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    if let Err(retry_after) = state
        .limiter
        .consume(
            format!("pub-dress-rename:{}", current.as_str()),
            now,
            8,
            3600,
        )
        .and_then(|_| {
            state
                .limiter
                .consume("pub-dress-rename:global", now, 500, 3600)
        })
    {
        return rate_limited(retry_after);
    }
    let next = match PubDress::from_str(&format!("0x{}{}", current.discriminator(), request.slug)) {
        Ok(value) => value,
        Err(error) => return invalid_pub_dress(error),
    };
    // Asking for the address the Bond already holds is not a conflict with
    // itself, and it writes nothing.
    if next == current {
        return renamed_response(&state, &headers, identity, now);
    }

    match state
        .repository
        .rename_pub_dress(&current, &next, now)
        .await
    {
        Ok(PubDressRenameOutcome::Renamed(identity)) => {
            renamed_response(&state, &headers, identity, now)
        }
        Ok(PubDressRenameOutcome::Unavailable) => no_store_error(
            StatusCode::CONFLICT,
            "pub_dress_unavailable",
            "That address belongs to another identity.",
        ),
        Ok(PubDressRenameOutcome::AvaiaUnavailable) => no_store_error(
            StatusCode::CONFLICT,
            "avaia_unavailable",
            "The Avaia address this name derives belongs to another identity.",
        ),
        Ok(PubDressRenameOutcome::Unknown) => unauthorized(),
        Err(error) => {
            tracing::error!(%error, "pub_dress rename failed");
            unavailable()
        }
    }
}

// An Avaia address carries its owner's discriminator and the canonical `ai`
// suffix. Both are the contract's, not a request's, so only the name in between
// is accepted here.
async fn rename_owned_avaia(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<PubDressRenameRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let identity = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    if let Err(retry_after) = state
        .limiter
        .consume(format!("avaia-rename:{}", owner.as_str()), now, 8, 3600)
        .and_then(|_| state.limiter.consume("avaia-rename:global", now, 500, 3600))
    {
        return rate_limited(retry_after);
    }
    let next = match AvaiaPubDress::from_str(&format!("{}{}", owner.discriminator(), request.slug))
    {
        Ok(value) => value,
        Err(error) => return invalid_avaia_pub_dress(error),
    };
    if identity.avaia_pub_dress.as_deref() == Some(next.as_str()) {
        return no_store_json(StatusCode::OK, IdentityProjection::from(identity));
    }

    match state
        .repository
        .rename_owned_avaia(&owner, &next, now)
        .await
    {
        Ok(PubDressRenameOutcome::Renamed(identity)) => {
            no_store_json(StatusCode::OK, IdentityProjection::from(identity))
        }
        Ok(PubDressRenameOutcome::AvaiaUnavailable) | Ok(PubDressRenameOutcome::Unavailable) => {
            no_store_error(
                StatusCode::CONFLICT,
                "avaia_unavailable",
                "That Avaia address belongs to another identity.",
            )
        }
        Ok(PubDressRenameOutcome::Unknown) => unauthorized(),
        Err(error) => {
            tracing::error!(%error, "Avaia rename failed");
            unavailable()
        }
    }
}

fn invalid_avaia_pub_dress(error: crate::AvaiaPubDressError) -> Response {
    let code = match error {
        crate::AvaiaPubDressError::InvalidDiscriminator => "invalid_avaia_discriminator",
        crate::AvaiaPubDressError::InvalidLength => "invalid_avaia_length",
        crate::AvaiaPubDressError::InvalidCharacter => "invalid_avaia_character",
        crate::AvaiaPubDressError::MissingAiSuffix => "invalid_avaia_suffix",
    };
    api_error(
        StatusCode::UNPROCESSABLE_ENTITY,
        code,
        "Use a 2–34-character name that ends in ai.",
    )
}

// The remembered-Bond hint names an address. A Bond that just moved would
// otherwise be offered its previous name on the next visit.
fn renamed_response(
    state: &ApiState,
    headers: &HeaderMap,
    identity: IdentityRecord,
    now: u64,
) -> Response {
    let refreshed = read_cookie(headers, REMEMBERED_BOND_COOKIE).and_then(|_| {
        state
            .remembered_bond_signer
            .issue(
                &identity.pub_dress,
                now.saturating_add(state.native_auth.remembered_bond_ttl_seconds),
            )
            .ok()
    });
    let mut response = no_store_json(StatusCode::OK, IdentityProjection::from(identity));
    if let Some(hint) = refreshed {
        append_cookie(
            &mut response,
            secure_cookie(
                REMEMBERED_BOND_COOKIE,
                &hint,
                state.native_auth.remembered_bond_ttl_seconds,
            ),
        );
    }
    response
}

/// The Bond behind a request, however this host proves it: a native session
/// cookie, or a verified provider account bound to exactly one Bond.
async fn authenticated_bond(
    state: &ApiState,
    headers: &HeaderMap,
    now: u64,
) -> Result<IdentityRecord, AuthenticationFailure> {
    if let Some(token) = read_cookie(headers, SESSION_COOKIE) {
        let token_hash = state.secret_digester.digest("native-session", &token);
        match state.repository.find_native_session(&token_hash, now).await {
            Ok(Some(identity)) => return Ok(identity),
            Ok(None) => {}
            Err(error) => {
                tracing::error!(%error, "native session lookup failed");
                return Err(AuthenticationFailure::Unavailable);
            }
        }
    }

    let provider = authenticate(state, headers).await?;
    match state.repository.find_by_provider(&provider).await {
        Ok(Some(identity)) => Ok(identity),
        Ok(None) => Err(AuthenticationFailure::Unauthorized),
        Err(error) => {
            tracing::error!(%error, "provider identity lookup failed");
            Err(AuthenticationFailure::Unavailable)
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
    let pub_dress = match parse_pub_dress(&request) {
        Ok(value) => value,
        Err(error) => return invalid_pub_dress(error),
    };
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };

    match state
        .repository
        .register(&pub_dress, &provider_identity, now)
        .await
    {
        Ok(RegistrationOutcome::Registered(identity)) => {
            provider_registration_response(
                &state,
                StatusCode::CREATED,
                RegistrationResponseKind::Registered,
                identity,
            )
            .await
        }
        Ok(RegistrationOutcome::AlreadyRegistered(identity)) => {
            provider_registration_response(
                &state,
                StatusCode::OK,
                RegistrationResponseKind::AlreadyRegistered,
                identity,
            )
            .await
        }
        Ok(RegistrationOutcome::HandleUnavailable) | Ok(RegistrationOutcome::AvaiaUnavailable) => {
            api_error(
                StatusCode::CONFLICT,
                "pub_dress_unavailable",
                "That pub_dress cannot be registered with its required owned Avaia. Choose another one.",
            )
        }
        Err(error) => {
            tracing::error!(%error, "identity API registration failed");
            unavailable()
        }
    }
}

fn parse_pub_dress(request: &PubDressSelectionRequest) -> Result<PubDress, crate::PubDressError> {
    let candidate = format!("0x{}{}", request.discriminator, request.slug);
    PubDress::from_str(&candidate)
}

fn invalid_pub_dress(error: crate::PubDressError) -> Response {
    api_error(
        StatusCode::UNPROCESSABLE_ENTITY,
        error_code(error),
        "Choose one hexadecimal discriminator and a case-sensitive 2–32-character slug.",
    )
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

async fn provider_registration_response(
    state: &ApiState,
    status: StatusCode,
    outcome: RegistrationResponseKind,
    identity: IdentityRecord,
) -> Response {
    let password_required = match state
        .repository
        .password_required(&identity.pub_dress)
        .await
    {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    no_store_json(
        status,
        RegistrationResponse {
            outcome,
            identity: identity.into(),
            password_required,
        },
    )
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
    no_store_error(status, code, message)
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
struct PubDressSelectionRequest {
    discriminator: String,
    slug: String,
}

type RegistrationRequest = PubDressSelectionRequest;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderPasswordRequest {
    password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PubDressRenameRequest {
    slug: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResolvePubDressRequest {
    pub_dress: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeCredentialRequest {
    pub_dress: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryAcknowledgementRequest {
    challenge: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeRecoveryRequest {
    pub_dress: String,
    recovery_key: String,
    new_password: String,
}

#[derive(Debug, Serialize)]
struct AvailabilityResponse {
    pub_dress: String,
    available: bool,
}

#[derive(Debug, Serialize)]
struct PubDressResolutionResponse {
    pub_dress: String,
    state: PubDressResolutionKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum PubDressResolutionKind {
    Available,
    Registered,
}

#[derive(Debug, Serialize)]
struct NativeContextResponse {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity: Option<IdentityProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remembered_pub_dress: Option<String>,
}

impl NativeContextResponse {
    fn anonymous() -> Self {
        Self {
            state: "anonymous",
            identity: None,
            remembered_pub_dress: None,
        }
    }

    fn remembered(pub_dress: String) -> Self {
        Self {
            state: "remembered",
            identity: None,
            remembered_pub_dress: Some(pub_dress),
        }
    }

    fn authenticated(identity: IdentityRecord) -> Self {
        Self {
            state: "authenticated",
            identity: Some(identity.into()),
            remembered_pub_dress: None,
        }
    }
}

#[derive(Debug, Serialize)]
struct NativeRegistrationResponse {
    state: &'static str,
    identity: IdentityProjection,
    recovery_key: String,
    challenge: String,
}

#[derive(Debug, Serialize)]
struct NativeAuthenticationResponse {
    state: &'static str,
    identity: IdentityProjection,
    #[serde(skip_serializing_if = "Option::is_none")]
    replacement_recovery_key: Option<String>,
}

#[derive(Debug, Serialize)]
struct RegistrationResponse {
    password_required: bool,
    outcome: RegistrationResponseKind,
    identity: IdentityProjection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum RegistrationResponseKind {
    Registered,
    AlreadyRegistered,
}

#[derive(Serialize)]
struct ProviderIdentityProjection {
    #[serde(flatten)]
    identity: IdentityProjection,
    password_required: bool,
}

#[derive(Debug, Serialize)]
struct IdentityProjection {
    pub_dress: String,
    avaia_pub_dress: Option<String>,
}

impl From<IdentityRecord> for IdentityProjection {
    fn from(identity: IdentityRecord) -> Self {
        Self {
            pub_dress: identity.pub_dress,
            avaia_pub_dress: identity.avaia_pub_dress,
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
        http::{
            Request, StatusCode,
            header::{AUTHORIZATION, CACHE_CONTROL, SET_COOKIE},
        },
        response::IntoResponse as _,
    };
    use hmac::{Hmac, Mac};
    use serde_json::Value;
    use sha2::Sha256;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::{Clock, router_with_clock};
    use crate::{
        DiscordOAuthClient, IdentityRepository, NativeAuthConfig, TelegramInitDataVerifier,
    };

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

    // A stand-in for Discord's user endpoint. The bearer token names the account
    // it belongs to, so a test can present a bound, an unbound, or a forged proof.
    async fn discord_oauth() -> DiscordOAuthClient {
        let api = axum::Router::new().route(
            "/v10/users/@me",
            axum::routing::get(|headers: axum::http::HeaderMap| async move {
                match headers
                    .get(AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.strip_prefix("Bearer "))
                    .and_then(|token| token.strip_prefix("access-"))
                {
                    Some(user_id) => (
                        StatusCode::OK,
                        axum::Json(serde_json::json!({ "id": user_id })),
                    )
                        .into_response(),
                    None => StatusCode::UNAUTHORIZED.into_response(),
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let origin = format!("http://{}", listener.local_addr().expect("address"));
        tokio::spawn(async move {
            axum::serve(listener, api)
                .await
                .expect("Discord API stand-in");
        });
        DiscordOAuthClient::with_api_origin("client-1", "client-secret", origin)
    }

    async fn discord_app() -> axum::Router {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        router_with_clock(
            repository,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
            Some(discord_oauth().await),
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("valid native auth configuration"),
            Arc::new(StaticClock),
        )
    }

    async fn app() -> axum::Router {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        router_with_clock(
            repository,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
            None,
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("valid native auth configuration"),
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
        assert_eq!(body["identity"]["avaia_pub_dress"], "0skai");
        assert!(body.to_string().find("provider_subject").is_none());
    }

    #[tokio::test]
    async fn availability_reports_exact_candidates_without_reserving_them() {
        let app = app().await;
        let authorization = format!("tma {}", signed_init_data(42));
        let availability = || {
            Request::get("/api/v1/identity/availability?discriminator=0&slug=Sky")
                .header(AUTHORIZATION, &authorization)
                .body(Body::empty())
                .expect("valid request")
        };

        let first = app.clone().oneshot(availability()).await.expect("response");
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(
            first
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        let body = to_bytes(first.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["pub_dress"], "0x0Sky");
        assert_eq!(body["available"], true);

        let registration = Request::post("/api/v1/identity/registration")
            .header(AUTHORIZATION, &authorization)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"discriminator":"0","slug":"Sky"}"#))
            .expect("valid request");
        assert_eq!(
            app.clone()
                .oneshot(registration)
                .await
                .expect("response")
                .status(),
            StatusCode::CREATED
        );

        let second = app.oneshot(availability()).await.expect("response");
        let body = to_bytes(second.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["available"], false);
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

    #[tokio::test]
    async fn native_registration_stays_unauthenticated_until_recovery_key_acknowledgement() {
        let app = app().await;
        let resolve = Request::post("/api/v1/identity/resolve")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"pub_dress":"0x0Sky"}"#))
            .expect("resolve request");
        let response = app.clone().oneshot(resolve).await.expect("resolve");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["state"], "available");

        let registration = Request::post("/api/v1/auth/native/registration")
            .header("content-type", "application/json")
            .header("idempotency-key", "native-registration-test-0001")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                r#"{"pub_dress":"0x0Sky","password":"a deliberately long password"}"#,
            ))
            .expect("registration request");
        let response = app
            .clone()
            .oneshot(registration)
            .await
            .expect("registration");
        assert_eq!(response.status(), StatusCode::CREATED);
        assert!(response.headers().get(SET_COOKIE).is_none());
        let body = to_bytes(response.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["state"], "recovery_key_required");
        assert_eq!(body["identity"]["avaia_pub_dress"], "0Skai");
        assert!(
            body["recovery_key"]
                .as_str()
                .expect("recovery key")
                .starts_with("0x1-rk-")
        );

        let context = Request::get("/api/v1/auth/native/context")
            .body(Body::empty())
            .expect("context request");
        let context = app.clone().oneshot(context).await.expect("context");
        let context = to_bytes(context.into_body(), 4096).await.expect("body");
        let context: Value = serde_json::from_slice(&context).expect("JSON body");
        assert_eq!(context["state"], "anonymous");

        let acknowledgement = Request::post("/api/v1/auth/native/recovery/acknowledgement")
            .header("content-type", "application/json")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                serde_json::json!({ "challenge": body["challenge"] }).to_string(),
            ))
            .expect("acknowledgement request");
        let acknowledgement = app
            .clone()
            .oneshot(acknowledgement)
            .await
            .expect("acknowledgement");
        assert_eq!(acknowledgement.status(), StatusCode::OK);
        let cookies = acknowledgement
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(|value| value.split(';').next())
            .collect::<Vec<_>>();
        assert_eq!(cookies.len(), 2);

        let authenticated_context = Request::get("/api/v1/auth/native/context")
            .header("cookie", cookies.join("; "))
            .body(Body::empty())
            .expect("authenticated context request");
        let authenticated_context = app
            .oneshot(authenticated_context)
            .await
            .expect("authenticated context");
        let authenticated_context = to_bytes(authenticated_context.into_body(), 4096)
            .await
            .expect("body");
        let authenticated_context: Value =
            serde_json::from_slice(&authenticated_context).expect("JSON body");
        assert_eq!(authenticated_context["state"], "authenticated");
        assert_eq!(authenticated_context["identity"]["pub_dress"], "0x0Sky");
        assert_eq!(
            authenticated_context["identity"]["avaia_pub_dress"],
            "0Skai"
        );
    }

    #[tokio::test]
    async fn native_login_is_generic_and_remembered_hint_never_authenticates() {
        let app = app().await;
        let registration = Request::post("/api/v1/auth/native/registration")
            .header("content-type", "application/json")
            .header("idempotency-key", "native-registration-test-0002")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                r#"{"pub_dress":"0x0sky","password":"another deliberate password"}"#,
            ))
            .expect("registration request");
        let response = app
            .clone()
            .oneshot(registration)
            .await
            .expect("registration");
        let body = to_bytes(response.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        let acknowledgement = Request::post("/api/v1/auth/native/recovery/acknowledgement")
            .header("content-type", "application/json")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                serde_json::json!({ "challenge": body["challenge"] }).to_string(),
            ))
            .expect("acknowledgement request");
        let acknowledgement = app
            .clone()
            .oneshot(acknowledgement)
            .await
            .expect("acknowledgement");
        let cookies = acknowledgement
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(|value| value.split(';').next())
            .collect::<Vec<_>>();
        let remembered = cookies
            .iter()
            .find(|cookie| cookie.starts_with(super::REMEMBERED_BOND_COOKIE))
            .expect("remembered cookie");
        let session = cookies
            .iter()
            .find(|cookie| cookie.starts_with(super::SESSION_COOKIE))
            .expect("session cookie");

        let logout = Request::post("/api/v1/auth/native/logout")
            .header("cookie", *session)
            .header(super::CSRF_HEADER, "1")
            .body(Body::empty())
            .expect("logout request");
        assert_eq!(
            app.clone().oneshot(logout).await.expect("logout").status(),
            StatusCode::NO_CONTENT
        );
        let remembered_context = Request::get("/api/v1/auth/native/context")
            .header("cookie", *remembered)
            .body(Body::empty())
            .expect("remembered context request");
        let remembered_context = app
            .clone()
            .oneshot(remembered_context)
            .await
            .expect("remembered context");
        let remembered_context = to_bytes(remembered_context.into_body(), 4096)
            .await
            .expect("body");
        let remembered_context: Value =
            serde_json::from_slice(&remembered_context).expect("JSON body");
        assert_eq!(remembered_context["state"], "remembered");
        assert_eq!(remembered_context["remembered_pub_dress"], "0x0sky");

        let wrong_password = Request::post("/api/v1/auth/native/session")
            .header("content-type", "application/json")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                r#"{"pub_dress":"0x0sky","password":"this password is incorrect"}"#,
            ))
            .expect("login request");
        let wrong_password = app
            .oneshot(wrong_password)
            .await
            .expect("wrong password response");
        assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
        let wrong_password = to_bytes(wrong_password.into_body(), 4096)
            .await
            .expect("body");
        let wrong_password: Value = serde_json::from_slice(&wrong_password).expect("JSON body");
        assert_eq!(
            wrong_password["error"]["code"],
            "invalid_native_credentials"
        );
    }
    fn telegram_password_request(user_id: i64, body: &str) -> Request<Body> {
        Request::post("/api/v1/auth/telegram/password")
            .header(AUTHORIZATION, format!("tma {}", signed_init_data(user_id)))
            .header("content-type", "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(body.to_owned()))
            .expect("request")
    }

    async fn register_telegram_fixture(app: &axum::Router) {
        let request = Request::post("/api/v1/identity/registration")
            .header(AUTHORIZATION, format!("tma {}", signed_init_data(42)))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"discriminator":"0","slug":"sky"}"#))
            .expect("request");
        assert_eq!(
            app.clone()
                .oneshot(request)
                .await
                .expect("response")
                .status(),
            StatusCode::CREATED
        );
    }

    async fn json_body(response: axum::response::Response) -> Value {
        serde_json::from_slice(&to_bytes(response.into_body(), 8192).await.expect("body"))
            .expect("JSON")
    }

    #[tokio::test]
    async fn telegram_password_requires_recovery_then_supports_native_sign_in_without_reset() {
        let app = app().await;
        register_telegram_fixture(&app).await;
        let setup = app
            .clone()
            .oneshot(telegram_password_request(
                42,
                r#"{"password":"a deliberately long password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(setup.status(), StatusCode::CREATED);
        assert_eq!(setup.headers()[CACHE_CONTROL], "no-store");
        let setup = json_body(setup).await;
        assert_eq!(setup["identity"]["pub_dress"], "0x0sky");
        assert_eq!(setup["state"], "recovery_key_required");
        assert!(setup.get("password_hash").is_none());
        let sign_in = || {
            Request::post("/api/v1/auth/native/session")
                .header("content-type", "application/json")
                .header("x-0x1-csrf", "1")
                .body(Body::from(
                    r#"{"pub_dress":"0x0sky","password":"a deliberately long password"}"#,
                ))
                .expect("request")
        };
        let acknowledgement = Request::post("/api/v1/auth/native/recovery/acknowledgement")
            .header("content-type", "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(
                serde_json::json!({"challenge":setup["challenge"]}).to_string(),
            ))
            .expect("request");
        assert_eq!(
            app.clone()
                .oneshot(acknowledgement)
                .await
                .expect("response")
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.clone()
                .oneshot(sign_in())
                .await
                .expect("response")
                .status(),
            StatusCode::OK
        );
        let reset = app
            .clone()
            .oneshot(telegram_password_request(
                42,
                r#"{"password":"a different long password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(reset.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(reset).await["error"]["code"],
            "password_already_set"
        );
        assert_eq!(
            app.clone()
                .oneshot(sign_in())
                .await
                .expect("response")
                .status(),
            StatusCode::OK
        );
        let read = Request::get("/api/v1/identity")
            .header(AUTHORIZATION, format!("tma {}", signed_init_data(42)))
            .body(Body::empty())
            .expect("request");
        let identity = json_body(app.oneshot(read).await.expect("response")).await;
        assert_eq!(identity["password_required"], false);
        assert_eq!(identity["pub_dress"], "0x0sky");
    }

    #[tokio::test]
    async fn telegram_password_rejects_unbound_forged_and_client_selected_owners() {
        let app = app().await;
        register_telegram_fixture(&app).await;
        let body = r#"{"password":"a deliberately long password"}"#;
        let unbound = app
            .clone()
            .oneshot(telegram_password_request(99, body))
            .await
            .expect("response");
        assert_eq!(unbound.status(), StatusCode::UNAUTHORIZED);
        let mut forged = telegram_password_request(42, body);
        forged
            .headers_mut()
            .insert(AUTHORIZATION, "tma forged".parse().expect("header"));
        assert_eq!(
            app.clone()
                .oneshot(forged)
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut no_csrf = telegram_password_request(42, body);
        no_csrf.headers_mut().remove("x-0x1-csrf");
        assert_eq!(
            app.clone()
                .oneshot(no_csrf)
                .await
                .expect("response")
                .status(),
            StatusCode::FORBIDDEN
        );
        let selected_owner = telegram_password_request(
            42,
            r#"{"password":"a deliberately long password","pub_dress":"0x0other"}"#,
        );
        assert_eq!(
            app.clone()
                .oneshot(selected_owner)
                .await
                .expect("response")
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let weak = telegram_password_request(42, r#"{"password":"password"}"#);
        let weak = app.oneshot(weak).await.expect("response");
        assert_eq!(weak.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(weak).await["error"]["code"],
            "compromised_password"
        );
    }

    #[tokio::test]
    async fn telegram_password_can_resume_pending_setup_and_invalidates_old_challenge() {
        let app = app().await;
        register_telegram_fixture(&app).await;
        let body = r#"{"password":"a deliberately long password"}"#;
        let first = json_body(
            app.clone()
                .oneshot(telegram_password_request(42, body))
                .await
                .expect("response"),
        )
        .await;
        let second = json_body(
            app.clone()
                .oneshot(telegram_password_request(42, body))
                .await
                .expect("response"),
        )
        .await;
        assert_ne!(first["challenge"], second["challenge"]);
        for (setup, expected) in [(first, StatusCode::BAD_REQUEST), (second, StatusCode::OK)] {
            let request = Request::post("/api/v1/auth/native/recovery/acknowledgement")
                .header("content-type", "application/json")
                .header("x-0x1-csrf", "1")
                .body(Body::from(
                    serde_json::json!({"challenge":setup["challenge"]}).to_string(),
                ))
                .expect("request");
            assert_eq!(
                app.clone()
                    .oneshot(request)
                    .await
                    .expect("response")
                    .status(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn telegram_password_setup_is_rate_limited_before_hashing() {
        let app = app().await;
        register_telegram_fixture(&app).await;
        for _ in 0..8 {
            assert_eq!(
                app.clone()
                    .oneshot(telegram_password_request(42, r#"{"password":"short"}"#))
                    .await
                    .expect("response")
                    .status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            app.oneshot(telegram_password_request(42, r#"{"password":"short"}"#))
                .await
                .expect("response")
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    #[tokio::test]
    async fn telegram_password_does_not_enable_native_sign_in_before_recovery_acknowledgement() {
        let app = app().await;
        register_telegram_fixture(&app).await;
        let setup = app
            .clone()
            .oneshot(telegram_password_request(
                42,
                r#"{"password":"a deliberately long password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(setup.status(), StatusCode::CREATED);
        let sign_in = Request::post("/api/v1/auth/native/session")
            .header("content-type", "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(
                r#"{"pub_dress":"0x0sky","password":"a deliberately long password"}"#,
            ))
            .expect("request");
        assert_eq!(
            app.oneshot(sign_in).await.expect("response").status(),
            StatusCode::UNAUTHORIZED
        );
    }
    fn discord_password_request(user_id: &str, body: &str) -> Request<Body> {
        Request::post("/api/v1/auth/discord/password")
            .header(AUTHORIZATION, format!("discord access-{user_id}"))
            .header("content-type", "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(body.to_owned()))
            .expect("request")
    }

    async fn register_discord_fixture(app: &axum::Router) {
        let request = Request::post("/api/v1/identity/registration")
            .header(AUTHORIZATION, "discord access-42")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"discriminator":"0","slug":"sky"}"#))
            .expect("request");
        assert_eq!(
            app.clone()
                .oneshot(request)
                .await
                .expect("response")
                .status(),
            StatusCode::CREATED
        );
    }

    #[tokio::test]
    async fn discord_password_requires_recovery_then_supports_native_sign_in_without_reset() {
        let app = discord_app().await;
        register_discord_fixture(&app).await;
        let setup = app
            .clone()
            .oneshot(discord_password_request(
                "42",
                r#"{"password":"a deliberately long password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(setup.status(), StatusCode::CREATED);
        assert_eq!(setup.headers()[CACHE_CONTROL], "no-store");
        let setup = json_body(setup).await;
        assert_eq!(setup["identity"]["pub_dress"], "0x0sky");
        assert_eq!(setup["state"], "recovery_key_required");
        assert!(setup.get("password_hash").is_none());
        let sign_in = || {
            Request::post("/api/v1/auth/native/session")
                .header("content-type", "application/json")
                .header("x-0x1-csrf", "1")
                .body(Body::from(
                    r#"{"pub_dress":"0x0sky","password":"a deliberately long password"}"#,
                ))
                .expect("request")
        };
        let acknowledgement = Request::post("/api/v1/auth/native/recovery/acknowledgement")
            .header("content-type", "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(
                serde_json::json!({"challenge":setup["challenge"]}).to_string(),
            ))
            .expect("request");
        assert_eq!(
            app.clone()
                .oneshot(acknowledgement)
                .await
                .expect("response")
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.clone()
                .oneshot(sign_in())
                .await
                .expect("response")
                .status(),
            StatusCode::OK
        );
        let reset = app
            .clone()
            .oneshot(discord_password_request(
                "42",
                r#"{"password":"a different long password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(reset.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(reset).await["error"]["code"],
            "password_already_set"
        );
        let read = Request::get("/api/v1/identity")
            .header(AUTHORIZATION, "discord access-42")
            .body(Body::empty())
            .expect("request");
        let identity = json_body(app.oneshot(read).await.expect("response")).await;
        assert_eq!(identity["password_required"], false);
        assert_eq!(identity["pub_dress"], "0x0sky");
    }

    #[tokio::test]
    async fn discord_password_rejects_other_proofs_unbound_accounts_and_selected_owners() {
        let app = discord_app().await;
        register_discord_fixture(&app).await;
        let body = r#"{"password":"a deliberately long password"}"#;
        let unbound = app
            .clone()
            .oneshot(discord_password_request("99", body))
            .await
            .expect("response");
        assert_eq!(unbound.status(), StatusCode::UNAUTHORIZED);
        let mut forged = discord_password_request("42", body);
        forged
            .headers_mut()
            .insert(AUTHORIZATION, "discord forged".parse().expect("header"));
        assert_eq!(
            app.clone()
                .oneshot(forged)
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        // A Telegram proof never sets a Discord-authorized password, and the
        // Telegram endpoint stays closed to a Discord proof.
        let mut telegram_proof = discord_password_request("42", body);
        telegram_proof.headers_mut().insert(
            AUTHORIZATION,
            format!("tma {}", signed_init_data(42))
                .parse()
                .expect("header"),
        );
        assert_eq!(
            app.clone()
                .oneshot(telegram_proof)
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut crossed = telegram_password_request(42, body);
        crossed
            .headers_mut()
            .insert(AUTHORIZATION, "discord access-42".parse().expect("header"));
        assert_eq!(
            app.clone()
                .oneshot(crossed)
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut no_csrf = discord_password_request("42", body);
        no_csrf.headers_mut().remove("x-0x1-csrf");
        assert_eq!(
            app.clone()
                .oneshot(no_csrf)
                .await
                .expect("response")
                .status(),
            StatusCode::FORBIDDEN
        );
        let selected_owner = discord_password_request(
            "42",
            r#"{"password":"a deliberately long password","pub_dress":"0x0other"}"#,
        );
        assert_eq!(
            app.clone()
                .oneshot(selected_owner)
                .await
                .expect("response")
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let weak = discord_password_request("42", r#"{"password":"password"}"#);
        let weak = app.oneshot(weak).await.expect("response");
        assert_eq!(weak.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(weak).await["error"]["code"],
            "compromised_password"
        );
    }

    #[tokio::test]
    async fn discord_password_does_not_enable_native_sign_in_before_recovery_acknowledgement() {
        let app = discord_app().await;
        register_discord_fixture(&app).await;
        let setup = app
            .clone()
            .oneshot(discord_password_request(
                "42",
                r#"{"password":"a deliberately long password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(setup.status(), StatusCode::CREATED);
        let sign_in = Request::post("/api/v1/auth/native/session")
            .header("content-type", "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(
                r#"{"pub_dress":"0x0sky","password":"a deliberately long password"}"#,
            ))
            .expect("request");
        assert_eq!(
            app.oneshot(sign_in).await.expect("response").status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn discord_password_setup_is_rate_limited_before_hashing() {
        let app = discord_app().await;
        register_discord_fixture(&app).await;
        for _ in 0..8 {
            assert_eq!(
                app.clone()
                    .oneshot(discord_password_request("42", r#"{"password":"short"}"#))
                    .await
                    .expect("response")
                    .status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            app.oneshot(discord_password_request("42", r#"{"password":"short"}"#))
                .await
                .expect("response")
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    // A signed-in Bond, with the cookies its session and remembered hint use.
    async fn native_session_cookies(app: &axum::Router, pub_dress: &str, key: &str) -> String {
        let registration = Request::post("/api/v1/auth/native/registration")
            .header("content-type", "application/json")
            .header("idempotency-key", key)
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                serde_json::json!({
                    "pub_dress": pub_dress,
                    "password": "a deliberately long password",
                })
                .to_string(),
            ))
            .expect("registration request");
        let registration = json_body(
            app.clone()
                .oneshot(registration)
                .await
                .expect("registration"),
        )
        .await;
        let acknowledgement = Request::post("/api/v1/auth/native/recovery/acknowledgement")
            .header("content-type", "application/json")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(
                serde_json::json!({ "challenge": registration["challenge"] }).to_string(),
            ))
            .expect("acknowledgement request");
        let acknowledgement = app
            .clone()
            .oneshot(acknowledgement)
            .await
            .expect("acknowledgement");
        assert_eq!(acknowledgement.status(), StatusCode::OK);
        acknowledgement
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(|value| value.split(';').next())
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn rename_request(slug: &str) -> Request<Body> {
        Request::post("/api/v1/identity/pub_dress")
            .header("content-type", "application/json")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(serde_json::json!({ "slug": slug }).to_string()))
            .expect("request")
    }

    #[tokio::test]
    async fn rename_moves_the_bond_its_avaia_and_its_session_to_the_new_address() {
        let app = app().await;
        let cookies = native_session_cookies(&app, "0x0Sky", "rename-test-0001").await;
        let mut rename = rename_request("Rain");
        rename
            .headers_mut()
            .insert("cookie", cookies.parse().expect("header"));
        let renamed = app.clone().oneshot(rename).await.expect("response");
        assert_eq!(renamed.status(), StatusCode::OK);
        assert_eq!(renamed.headers()[CACHE_CONTROL], "no-store");
        let renamed = json_body(renamed).await;
        assert_eq!(renamed["pub_dress"], "0x0Rain");
        // The owned Avaia is a derivation of its owner's address, so it moved too.
        assert_eq!(renamed["avaia_pub_dress"], "0Rainai");

        let context = Request::get("/api/v1/auth/native/context")
            .header("cookie", cookies.clone())
            .body(Body::empty())
            .expect("context request");
        let context = json_body(app.clone().oneshot(context).await.expect("context")).await;
        assert_eq!(context["state"], "authenticated");
        assert_eq!(context["identity"]["pub_dress"], "0x0Rain");

        // The credential followed the Bond: the same password signs in under the
        // new address and no longer resolves under the previous one.
        let sign_in = |pub_dress: &str| {
            Request::post("/api/v1/auth/native/session")
                .header("content-type", "application/json")
                .header(super::CSRF_HEADER, "1")
                .body(Body::from(
                    serde_json::json!({
                        "pub_dress": pub_dress,
                        "password": "a deliberately long password",
                    })
                    .to_string(),
                ))
                .expect("request")
        };
        assert_eq!(
            app.clone()
                .oneshot(sign_in("0x0Rain"))
                .await
                .expect("response")
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.clone()
                .oneshot(sign_in("0x0Sky"))
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );

        // The previous address is free again, and the new one is not.
        let availability = |pub_dress: &str| {
            Request::post("/api/v1/identity/resolve")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "pub_dress": pub_dress }).to_string(),
                ))
                .expect("request")
        };
        assert_eq!(
            json_body(
                app.clone()
                    .oneshot(availability("0x0Sky"))
                    .await
                    .expect("response")
            )
            .await["state"],
            "available"
        );
        assert_eq!(
            json_body(
                app.oneshot(availability("0x0Rain"))
                    .await
                    .expect("response")
            )
            .await["state"],
            "registered"
        );
    }

    #[tokio::test]
    async fn rename_answers_a_verified_provider_and_refuses_an_unauthenticated_request() {
        let app = app().await;
        register_telegram_fixture(&app).await;
        let mut provider_rename = rename_request("rain");
        provider_rename.headers_mut().insert(
            AUTHORIZATION,
            format!("tma {}", signed_init_data(42))
                .parse()
                .expect("header"),
        );
        let renamed = json_body(
            app.clone()
                .oneshot(provider_rename)
                .await
                .expect("response"),
        )
        .await;
        assert_eq!(renamed["pub_dress"], "0x0rain");

        let read = Request::get("/api/v1/identity")
            .header(AUTHORIZATION, format!("tma {}", signed_init_data(42)))
            .body(Body::empty())
            .expect("request");
        assert_eq!(
            json_body(app.clone().oneshot(read).await.expect("response")).await["pub_dress"],
            "0x0rain"
        );

        assert_eq!(
            app.clone()
                .oneshot(rename_request("stranger"))
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut no_csrf = rename_request("stranger");
        no_csrf.headers_mut().remove(super::CSRF_HEADER);
        no_csrf.headers_mut().insert(
            AUTHORIZATION,
            format!("tma {}", signed_init_data(42))
                .parse()
                .expect("header"),
        );
        assert_eq!(
            app.oneshot(no_csrf).await.expect("response").status(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn rename_refuses_an_occupied_address_an_invalid_slug_and_a_selected_discriminator() {
        let app = app().await;
        let taken = native_session_cookies(&app, "0x0Rain", "rename-test-0002").await;
        drop(taken);
        let cookies = native_session_cookies(&app, "0x0Sky", "rename-test-0003").await;
        let with_session = |slug: &str| {
            let mut request = rename_request(slug);
            request
                .headers_mut()
                .insert("cookie", cookies.parse().expect("header"));
            request
        };

        let occupied = app
            .clone()
            .oneshot(with_session("Rain"))
            .await
            .expect("response");
        assert_eq!(occupied.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(occupied).await["error"]["code"],
            "pub_dress_unavailable"
        );

        assert_eq!(
            app.clone()
                .oneshot(with_session("x"))
                .await
                .expect("response")
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        // A space is outside the canonical slug allowlist.
        assert_eq!(
            app.clone()
                .oneshot(with_session("Rainy sky"))
                .await
                .expect("response")
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let selected_owner = {
            let mut request = Request::post("/api/v1/identity/pub_dress")
                .header("content-type", "application/json")
                .header(super::CSRF_HEADER, "1")
                .body(Body::from(
                    r#"{"slug":"Rainy","pub_dress":"0x0other"}"#.to_owned(),
                ))
                .expect("request");
            request
                .headers_mut()
                .insert("cookie", cookies.parse().expect("header"));
            request
        };
        assert_eq!(
            app.clone()
                .oneshot(selected_owner)
                .await
                .expect("response")
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );

        // Asking for the address the Bond already holds writes nothing.
        let unchanged = app
            .clone()
            .oneshot(with_session("Sky"))
            .await
            .expect("response");
        assert_eq!(unchanged.status(), StatusCode::OK);
        assert_eq!(json_body(unchanged).await["pub_dress"], "0x0Sky");

        // A slug cannot smuggle a discriminator: whatever it starts with stays
        // part of the slug, and the Bond keeps the discriminator it registered.
        let smuggled = app.oneshot(with_session("1Rain")).await.expect("response");
        assert_eq!(smuggled.status(), StatusCode::OK);
        assert_eq!(json_body(smuggled).await["pub_dress"], "0x01Rain");
    }

    #[tokio::test]
    async fn rename_is_rate_limited_per_bond() {
        let app = app().await;
        let cookies = native_session_cookies(&app, "0x0Sky", "rename-test-0004").await;
        let with_session = |slug: &str| {
            let mut request = rename_request(slug);
            request
                .headers_mut()
                .insert("cookie", cookies.parse().expect("header"));
            request
        };
        for _ in 0..8 {
            assert_eq!(
                app.clone()
                    .oneshot(with_session("x"))
                    .await
                    .expect("response")
                    .status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            app.oneshot(with_session("Rain"))
                .await
                .expect("response")
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    fn avaia_rename_request(slug: &str) -> Request<Body> {
        Request::post("/api/v1/identity/avaia/pub_dress")
            .header("content-type", "application/json")
            .header(super::CSRF_HEADER, "1")
            .body(Body::from(serde_json::json!({ "slug": slug }).to_string()))
            .expect("request")
    }

    #[tokio::test]
    async fn avaia_rename_names_the_owned_avaia_and_survives_an_owner_rename() {
        let app = app().await;
        let cookies = native_session_cookies(&app, "0x0Sky", "avaia-rename-test-0001").await;
        let with_session = |mut request: Request<Body>| {
            request
                .headers_mut()
                .insert("cookie", cookies.parse().expect("header"));
            request
        };

        let named = app
            .clone()
            .oneshot(with_session(avaia_rename_request("Vesnai")))
            .await
            .expect("response");
        assert_eq!(named.status(), StatusCode::OK);
        let named = json_body(named).await;
        assert_eq!(named["pub_dress"], "0x0Sky");
        assert_eq!(named["avaia_pub_dress"], "0Vesnai");

        // A chosen Avaia name is not a derivation, so renaming its owner keeps
        // it: only the owner's own address changes.
        let renamed = json_body(
            app.clone()
                .oneshot(with_session(rename_request("Rain")))
                .await
                .expect("response"),
        )
        .await;
        assert_eq!(renamed["pub_dress"], "0x0Rain");
        assert_eq!(renamed["avaia_pub_dress"], "0Vesnai");

        let context = Request::get("/api/v1/auth/native/context")
            .header("cookie", cookies.clone())
            .body(Body::empty())
            .expect("request");
        let context = json_body(app.oneshot(context).await.expect("response")).await;
        assert_eq!(context["identity"]["avaia_pub_dress"], "0Vesnai");
    }

    #[tokio::test]
    async fn avaia_rename_requires_the_canonical_suffix_and_a_free_address() {
        let app = app().await;
        let neighbour = native_session_cookies(&app, "0x0Rain", "avaia-rename-test-0002").await;
        drop(neighbour);
        let cookies = native_session_cookies(&app, "0x0Sky", "avaia-rename-test-0003").await;
        let with_session = |slug: &str| {
            let mut request = avaia_rename_request(slug);
            request
                .headers_mut()
                .insert("cookie", cookies.parse().expect("header"));
            request
        };

        // The `ai` suffix and the owner discriminator belong to the contract.
        let without_suffix = app
            .clone()
            .oneshot(with_session("Vesna"))
            .await
            .expect("response");
        assert_eq!(without_suffix.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(without_suffix).await["error"]["code"],
            "invalid_avaia_suffix"
        );

        // Another Bond's derived Avaia is another identity's address.
        let taken = app
            .clone()
            .oneshot(with_session("Rainai"))
            .await
            .expect("response");
        assert_eq!(taken.status(), StatusCode::CONFLICT);
        assert_eq!(json_body(taken).await["error"]["code"], "avaia_unavailable");

        assert_eq!(
            app.clone()
                .oneshot(avaia_rename_request("Vesnai"))
                .await
                .expect("response")
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut no_csrf = with_session("Vesnai");
        no_csrf.headers_mut().remove(super::CSRF_HEADER);
        assert_eq!(
            app.oneshot(no_csrf).await.expect("response").status(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn owner_rename_still_moves_an_avaia_it_derived() {
        let app = app().await;
        let cookies = native_session_cookies(&app, "0x0Sky", "avaia-rename-test-0004").await;
        let mut rename = rename_request("Rain");
        rename
            .headers_mut()
            .insert("cookie", cookies.parse().expect("header"));
        let renamed = json_body(app.oneshot(rename).await.expect("response")).await;
        assert_eq!(renamed["pub_dress"], "0x0Rain");
        assert_eq!(renamed["avaia_pub_dress"], "0Rainai");
    }
}
