// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! 0x1 signs people in through AIS (`auth.aiaiaiai.org`) and keeps a product
//! session for the 0x1 profile Core attaches to that identity
//! (`nilx-one/core` `docs/ais-public-info.md`).
//!
//! This host owns HTTP only: the redirect, the cookies, CSRF and rate limits.
//! Core's `PublicInfoService` verifies the callback and owns the product
//! database and its sessions. Nothing here reads or writes the legacy
//! identity database, and a public address never opens a native session:
//! the product session names a profile by the pairwise subject AIS issued to
//! the `nilx-one` client, and by nothing else.

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode, header::COOKIE},
    response::Response,
    routing::{get, post},
};
use nilxone_identity::{
    NativeAuthConfig, SecretDigester, TokenFactory,
    aiaiaiai_sign_in::Callback,
    public_info::{AuthenticatedProfile, PublicInfoError, PublicInfoService, PublicProfile},
    rate_limit::AttemptLimiter,
};
use serde::{Deserialize, Serialize};

use crate::{
    api::request_source,
    browser_web_auth::{
        append_cookie, clear_cookie, no_store_error, no_store_json, now_unix_seconds, read_cookie,
        redirect_with_cookies, secure_cookie,
    },
};

/// The product session. Deliberately not the native `__Host-0x1_session`:
/// that cookie names a Bond in the legacy identity database, and an AIS
/// sign-in must never be mistaken for one.
pub const PRODUCT_SESSION_COOKIE: &str = "__Host-0x1_product";
const CSRF_HEADER: &str = "x-0x1-csrf";
const SESSION_DOMAIN: &str = "product-session";
const MAX_REQUEST_BYTES: usize = 1024;

/// Everything the routes need once AIS sign-in is configured.
#[derive(Clone)]
pub struct ProductSignIn {
    service: PublicInfoService,
    digester: SecretDigester,
    session_ttl_seconds: u64,
}

impl ProductSignIn {
    pub fn new(service: PublicInfoService, native_auth: &NativeAuthConfig) -> Self {
        Self {
            service,
            digester: native_auth.secret_digester(),
            session_ttl_seconds: native_auth.session_ttl_seconds,
        }
    }

    /// Only this digest reaches the database, never the token.
    fn token_hash(&self, token: &str) -> String {
        self.digester
            .digest(SESSION_DOMAIN, token)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

#[derive(Clone)]
struct ProductState {
    sign_in: Option<ProductSignIn>,
    limiter: AttemptLimiter,
}

/// The routes exist whether or not sign-in is configured, so the site can
/// ask `/config` and get an honest "not enabled" instead of a 404.
pub fn router(sign_in: Option<ProductSignIn>) -> Router {
    Router::new()
        .route("/api/v1/auth/aiaiaiai/config", get(config))
        .route("/api/v1/auth/aiaiaiai/start", get(start))
        .route("/api/v1/auth/aiaiaiai/callback", get(callback))
        .route("/api/v1/product/session", get(read_session))
        .route("/api/v1/product/session/sign-out", post(sign_out))
        .route("/api/v1/product/experience", post(publish_experience))
        .route("/api/v1/product/profiles/{profile_id}", get(read_profile))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(ProductState {
            sign_in,
            limiter: AttemptLimiter::default(),
        })
}

#[derive(Serialize)]
struct ProfileEnvelope<'a> {
    profile: &'a PublicProfile,
}

fn profile_response(profile: &PublicProfile) -> Response {
    no_store_json(StatusCode::OK, ProfileEnvelope { profile })
}

fn not_configured() -> Response {
    no_store_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "aiaiaiai_sign_in_not_configured",
        "Sign-in through aiaiaiai is not configured.",
    )
}

fn unavailable() -> Response {
    no_store_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "product_service_unavailable",
        "The 0x1 profile service is temporarily unavailable.",
    )
}

fn rate_limited(retry_after: u64) -> Response {
    let mut response = no_store_error(
        StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
        "Too many requests. Wait before trying again.",
    );
    if let Ok(value) = retry_after.max(1).to_string().parse() {
        response
            .headers_mut()
            .insert(axum::http::header::RETRY_AFTER, value);
    }
    response
}

/// No session, or one that no longer restores. The dead cookie is cleared so
/// the browser stops presenting it.
fn session_required(had_cookie: bool) -> Response {
    let mut response = no_store_error(
        StatusCode::UNAUTHORIZED,
        "product_session_required",
        "Sign in through aiaiaiai to use the 0x1 profile.",
    );
    if had_cookie {
        append_cookie(&mut response, clear_cookie(PRODUCT_SESSION_COOKIE));
    }
    response
}

fn csrf_required() -> Response {
    no_store_error(
        StatusCode::FORBIDDEN,
        "csrf_protection_required",
        "This state-changing request requires the 0x1 CSRF header.",
    )
}

fn valid_csrf(headers: &HeaderMap) -> bool {
    headers
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        == Some("1")
}

async fn config(State(state): State<ProductState>) -> Response {
    no_store_json(
        StatusCode::OK,
        serde_json::json!({
            "enabled": state.sign_in.is_some(),
            "issuer": state.sign_in.as_ref().map(|sign_in| sign_in.service.issuer()),
        }),
    )
}

#[derive(Debug, Deserialize)]
struct StartQuery {
    #[serde(rename = "return")]
    return_path: Option<String>,
}

async fn start(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Query(query): Query<StartQuery>,
) -> Response {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return not_configured();
    };
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    let source = request_source(&headers);
    if let Err(retry_after) = state
        .limiter
        .consume(format!("product:start:{source}"), now, 30, 60)
    {
        return rate_limited(retry_after);
    }
    match sign_in.service.start(query.return_path.as_deref(), now) {
        Ok(started) => redirect_with_cookies(started.location.as_str(), [started.set_cookie]),
        Err(_) => unavailable(),
    }
}

#[derive(Debug, Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn callback(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return not_configured();
    };
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    // Each callback costs a token exchange with AIS; bound it per source.
    let source = request_source(&headers);
    if let Err(retry_after) =
        state
            .limiter
            .consume(format!("product:callback:{source}"), now, 30, 60)
    {
        return rate_limited(retry_after);
    }
    let cookie_header = headers.get(COOKIE).and_then(|value| value.to_str().ok());
    let finished = sign_in
        .service
        .finish(
            cookie_header,
            Callback {
                code: query.code.as_deref(),
                state: query.state.as_deref(),
                error: query.error.as_deref(),
            },
            now,
        )
        .await;
    // The transaction cookie is cleared on success and on failure alike.
    let failed =
        |code: &str, clear: String| redirect_with_cookies(&format!("/?auth_error={code}"), [clear]);
    let signed_in = match finished.outcome {
        Ok(signed_in) => signed_in,
        Err(failure) => return failed(failure.as_str(), finished.clear_cookie),
    };
    let Ok(token) = TokenFactory::session() else {
        return failed("aiaiaiai_sign_in_unavailable", finished.clear_cookie);
    };
    let repository = sign_in.service.repository();
    if repository
        .open_session(
            &signed_in.owner,
            &sign_in.token_hash(&token),
            now,
            now.saturating_add(sign_in.session_ttl_seconds),
        )
        .await
        .is_err()
    {
        return failed("aiaiaiai_sign_in_unavailable", finished.clear_cookie);
    }
    // A session this browser already held is replaced, not left behind.
    if let Some(previous) = read_cookie(&headers, PRODUCT_SESSION_COOKIE) {
        let _ = repository
            .close_session(&sign_in.token_hash(&previous))
            .await;
    }
    redirect_with_cookies(
        &signed_in.return_path,
        [
            secure_cookie(PRODUCT_SESSION_COOKIE, &token, sign_in.session_ttl_seconds),
            finished.clear_cookie,
        ],
    )
}

/// The owner of the request's product session, re-proved by Core in SQL.
/// `Err` is the response to send instead, boxed to keep the `Ok` path small.
async fn session_owner(
    sign_in: &ProductSignIn,
    headers: &HeaderMap,
    now: u64,
) -> Result<AuthenticatedProfile, Box<Response>> {
    let Some(token) = read_cookie(headers, PRODUCT_SESSION_COOKIE) else {
        return Err(Box::new(session_required(false)));
    };
    match sign_in
        .service
        .repository()
        .restore_session(&sign_in.token_hash(&token), now)
        .await
    {
        Ok(Some(owner)) => Ok(owner),
        Ok(None) => Err(Box::new(session_required(true))),
        Err(_) => Err(Box::new(unavailable())),
    }
}

async fn read_session(State(state): State<ProductState>, headers: HeaderMap) -> Response {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return not_configured();
    };
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    match session_owner(sign_in, &headers, now).await {
        Ok(owner) => profile_response(owner.public_profile()),
        Err(response) => *response,
    }
}

async fn sign_out(State(state): State<ProductState>, headers: HeaderMap) -> Response {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return not_configured();
    };
    if !valid_csrf(&headers) {
        return csrf_required();
    }
    if let Some(token) = read_cookie(&headers, PRODUCT_SESSION_COOKIE)
        && sign_in
            .service
            .repository()
            .close_session(&sign_in.token_hash(&token))
            .await
            .is_err()
    {
        // The cookie is kept: clearing it would hide a session that is
        // still live on the server.
        return unavailable();
    }
    let mut response = no_store_json(StatusCode::OK, serde_json::json!({ "signed_out": true }));
    append_cookie(&mut response, clear_cookie(PRODUCT_SESSION_COOKIE));
    response
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExperienceRequest {
    bond_xp: u64,
    avaia_xp: u64,
}

async fn publish_experience(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Json(request): Json<ExperienceRequest>,
) -> Response {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return not_configured();
    };
    if !valid_csrf(&headers) {
        return csrf_required();
    }
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    let owner = match session_owner(sign_in, &headers, now).await {
        Ok(owner) => owner,
        Err(response) => return *response,
    };
    let profile_id = &owner.public_profile().profile_id;
    if let Err(retry_after) =
        state
            .limiter
            .consume(format!("product:experience:{profile_id}"), now, 30, 60)
    {
        return rate_limited(retry_after);
    }
    match sign_in
        .service
        .repository()
        .publish_experience_carry(&owner, request.bond_xp, request.avaia_xp)
        .await
    {
        Ok(profile) => profile_response(&profile),
        Err(PublicInfoError::InvalidExperience) => no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "experience_out_of_range",
            "The experience totals exceed the publication limit.",
        ),
        Err(PublicInfoError::ProfileGone) => session_required(true),
        Err(_) => unavailable(),
    }
}

/// Public discovery by product id. Only Core's allowlisted DTO is returned.
async fn read_profile(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(profile_id): Path<String>,
) -> Response {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return not_configured();
    };
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    let source = request_source(&headers);
    if let Err(retry_after) =
        state
            .limiter
            .consume(format!("product:profile:{source}"), now, 120, 60)
    {
        return rate_limited(retry_after);
    }
    let not_found = || {
        no_store_error(
            StatusCode::NOT_FOUND,
            "profile_not_found",
            "No 0x1 profile has this id.",
        )
    };
    // Product ids are 32 lowercase hex characters; anything else cannot be
    // one, and is answered without a database read.
    if profile_id.len() != 32
        || !profile_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return not_found();
    }
    match sign_in.service.repository().read_public(&profile_id).await {
        Ok(Some(profile)) => profile_response(&profile),
        Ok(None) => not_found(),
        Err(_) => unavailable(),
    }
}

#[cfg(test)]
#[path = "product_sign_in_tests.rs"]
mod tests;
