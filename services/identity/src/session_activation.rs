// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Single Active Client activation (`nilx-one/0x1`
// `documents/15-devices-and-recovery.md`). A Bond may hold several
// authenticated sessions at once, but only the active one may act for it.
// This module is the explicit, three-route path by which activation moves
// from one session to another: confirmation on the active client, a
// credential-authenticated request that still needs that confirmation, and
// - only once the active client stays silent past the activation request
// TTL - the live-device objection window.
//
// `ApiState` and `authenticated_bond` are shared with `api.rs` via the
// `include!` that assembles `mod api`; this file does not redefine them.

pub fn session_activation_router(
    repository: IdentityRepository,
    provider_links: ProviderLinkRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
) -> Router {
    session_activation_router_with_clock(
        repository,
        provider_links,
        telegram_verifier,
        discord_oauth,
        native_auth,
        Arc::new(SystemClock),
    )
}

fn session_activation_router_with_clock(
    repository: IdentityRepository,
    provider_links: ProviderLinkRepository,
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
        provider_links,
        dummy_password_hash,
    };

    Router::new()
        .route(
            "/api/v1/session/activation-requests",
            post(create_activation_request),
        )
        .route(
            "/api/v1/session/activation-requests/pending",
            get(read_pending_activation_request),
        )
        .route(
            "/api/v1/session/activation-requests/{id}",
            get(read_activation_request_status),
        )
        .route(
            "/api/v1/session/activation-requests/{id}/accept",
            post(accept_activation_request),
        )
        .route(
            "/api/v1/session/activation-requests/{id}/decline",
            post(decline_activation_request),
        )
        .route(
            "/api/v1/session/activation-requests/{id}/object",
            post(object_to_activation_request),
        )
        .with_state(state)
}

#[derive(Debug, Serialize)]
struct ActivationRequestCreated {
    id: String,
    responds_by: u64,
}

#[derive(Debug, Serialize)]
struct ActivationRequestView {
    id: String,
    client_label: String,
    status: &'static str,
    responds_by: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    objection_deadline: Option<u64>,
}

fn status_str(status: ActivationRequestStatus) -> &'static str {
    match status {
        ActivationRequestStatus::Pending => "pending",
        ActivationRequestStatus::Objectable => "objectable",
        ActivationRequestStatus::Accepted => "accepted",
        ActivationRequestStatus::Declined => "declined",
        ActivationRequestStatus::Objected => "objected",
    }
}

fn activation_view(request: &ActivationRequest) -> ActivationRequestView {
    ActivationRequestView {
        id: encode_hex(&request.id),
        client_label: request.client_label.clone(),
        status: status_str(request.status),
        responds_by: request.responds_by,
        objection_deadline: request.objection_deadline,
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

fn activation_request_not_found() -> Response {
    api_error(
        StatusCode::NOT_FOUND,
        "activation_request_not_found",
        "That activation request does not exist, was already resolved, or is not yours.",
    )
}

fn not_the_active_client() -> Response {
    api_error(
        StatusCode::FORBIDDEN,
        "not_active_client",
        "Only the active client may act on an activation request.",
    )
}

/// A session with no session-of-its-own to name (a fresh but already-active
/// mint, or the repository could not resolve the label) falls back to this
/// rather than exposing nothing.
const UNKNOWN_CLIENT_LABEL: &str = "This client";

async fn create_activation_request(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if active {
        return no_store_error(
            StatusCode::CONFLICT,
            "already_active",
            "This client is already the active session for this Bond.",
        );
    }
    let client_label = state
        .repository
        .native_session_client_label(&token_hash)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| UNKNOWN_CLIENT_LABEL.to_owned());
    let Some(id) = generate_activation_id() else {
        return unavailable();
    };
    let responds_by = now.saturating_add(state.native_auth.activation_request_ttl_seconds);
    if let Err(error) = state
        .repository
        .create_activation_request(&id, &identity.pub_dress, &token_hash, &client_label, now, responds_by)
        .await
    {
        tracing::error!(%error, "activation request creation failed");
        return unavailable();
    }
    let mut response = no_store_json(
        StatusCode::CREATED,
        ActivationRequestCreated {
            id: encode_hex(&id),
            responds_by,
        },
    );
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

fn generate_activation_id() -> Option<[u8; 16]> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes)
}

async fn read_pending_activation_request(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if !active {
        return not_the_active_client();
    }
    let pending = match state
        .repository
        .pending_activation_request_for(&identity.pub_dress, now, state.native_auth.objection_window_seconds)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "pending activation request lookup failed");
            return unavailable();
        }
    };
    let mut response = no_store_json(StatusCode::OK, pending.as_ref().map(activation_view));
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn read_activation_request_status(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(id) = decode_hex(&id) else {
        return activation_request_not_found();
    };
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (_identity, _active, token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    let request = match state
        .repository
        .activation_request_status(&id, &token_hash, now, state.native_auth.objection_window_seconds)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "activation request status lookup failed");
            return unavailable();
        }
    };
    let Some(request) = request else {
        return activation_request_not_found();
    };
    let mut response = no_store_json(StatusCode::OK, activation_view(&request));
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn accept_activation_request(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let Some(id) = decode_hex(&id) else {
        return activation_request_not_found();
    };
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if !active {
        return not_the_active_client();
    }
    let mut response = match state
        .repository
        .accept_activation_request(&id, &identity.pub_dress, now, state.native_auth.objection_window_seconds)
        .await
    {
        Ok(true) => no_store_empty(StatusCode::NO_CONTENT),
        Ok(false) => activation_request_not_found(),
        Err(error) => {
            tracing::error!(%error, "activation request accept failed");
            unavailable()
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn decline_activation_request(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let Some(id) = decode_hex(&id) else {
        return activation_request_not_found();
    };
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if !active {
        return not_the_active_client();
    }
    let mut response = match state
        .repository
        .decline_activation_request(&id, &identity.pub_dress, now, state.native_auth.objection_window_seconds)
        .await
    {
        Ok(true) => no_store_empty(StatusCode::NO_CONTENT),
        Ok(false) => activation_request_not_found(),
        Err(error) => {
            tracing::error!(%error, "activation request decline failed");
            unavailable()
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn object_to_activation_request(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let Some(id) = decode_hex(&id) else {
        return activation_request_not_found();
    };
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if !active {
        return not_the_active_client();
    }
    let mut response = match state
        .repository
        .object_to_activation_request(&id, &identity.pub_dress, now, state.native_auth.objection_window_seconds)
        .await
    {
        Ok(true) => no_store_empty(StatusCode::NO_CONTENT),
        Ok(false) => activation_request_not_found(),
        Err(error) => {
            tracing::error!(%error, "activation request objection failed");
            unavailable()
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

#[cfg(test)]
mod session_activation_tests {
    use std::{collections::BTreeMap, sync::Arc};

    use axum::{
        body::{Body, to_bytes},
        http::{
            Request, StatusCode,
            header::{AUTHORIZATION, COOKIE, SET_COOKIE},
        },
    };
    use hmac::{Hmac, Mac};
    use serde_json::Value;
    use sha2::Sha256;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::{Clock, session_activation_router_with_clock};
    use crate::{
        IdentityRepository, NativeAuthConfig, ProviderIdentity, ProviderLinkRepository, PubDress,
        TelegramInitDataVerifier,
    };

    const TOKEN: &str = "123456:development-token";
    const NOW: u64 = 1_800_000_000;

    // A real temp file, not a named in-memory shared cache: several of these
    // tests open more than one pool against the same database at once (a
    // separate `app_at` per simulated point in time), and shared-cache mode
    // is flaky under that pattern when the suite runs its tests in parallel.
    fn test_database() -> (tempfile::NamedTempFile, String) {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        (database, database_url)
    }

    #[derive(Debug)]
    struct FixedClock(u64);

    impl Clock for FixedClock {
        fn now_unix_seconds(&self) -> Result<u64, super::ClockError> {
            Ok(self.0)
        }
    }

    fn signed_init_data(user_id: i64) -> String {
        let mut fields = BTreeMap::from([
            ("auth_date", NOW.to_string()),
            ("query_id", "activation-query".to_owned()),
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

    async fn register(database_url: &str, pub_dress: &str, telegram_user_id: i64) {
        let repository = IdentityRepository::connect(database_url)
            .await
            .expect("repository");
        let pub_dress: PubDress = pub_dress.parse().expect("valid pub_dress");
        repository
            .register(&pub_dress, &ProviderIdentity::telegram(telegram_user_id), NOW)
            .await
            .expect("registration");
    }

    async fn app_at(database_url: &str, now: u64) -> axum::Router {
        let repository = IdentityRepository::connect(database_url)
            .await
            .expect("repository");
        let provider_links = ProviderLinkRepository::connect(database_url)
            .await
            .expect("provider links");
        session_activation_router_with_clock(
            repository,
            provider_links,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
            None,
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("valid native auth configuration"),
            Arc::new(FixedClock(now)),
        )
    }

    fn cookie_from(response: &axum::response::Response) -> String {
        response
            .headers()
            .get(SET_COOKIE)
            .expect("a session cookie is set on first authentication")
            .to_str()
            .expect("cookie header is valid UTF-8")
            .split(';')
            .next()
            .expect("cookie has a name=value pair")
            .to_owned()
    }

    async fn json(response: axum::response::Response) -> Value {
        let body = to_bytes(response.into_body(), 8192).await.expect("body");
        serde_json::from_slice(&body).expect("json")
    }

    #[tokio::test]
    async fn accepted_activation_swaps_which_session_is_active() {
        let (_database, database_url) = test_database();
        register(&database_url, "0x0alice", 7).await;
        let app = app_at(&database_url, NOW).await;
        let auth = signed_init_data(7);

        // Device A: first-ever session for this Bond, so it comes up active
        // with nothing to confirm against.
        let a_first = app
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(a_first.status(), StatusCode::OK);
        let a_cookie = cookie_from(&a_first);
        assert_eq!(json(a_first).await, Value::Null);

        // Device B: same Bond, no cookie of its own yet. An active session
        // already exists, so this one starts inactive and may ask to
        // activate.
        let created = app
            .clone()
            .oneshot(
                Request::post("/api/v1/session/activation-requests")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(created.status(), StatusCode::CREATED);
        let b_cookie = cookie_from(&created);
        let created_body = json(created).await;
        let id = created_body["id"].as_str().expect("id").to_owned();

        // A sees B's request pending.
        let pending = app
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(COOKIE, &a_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(pending.status(), StatusCode::OK);
        let pending_body = json(pending).await;
        assert_eq!(pending_body["id"], id);
        assert_eq!(pending_body["status"], "pending");

        // A accepts.
        let accept = app
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/session/activation-requests/{id}/accept"))
                    .header(COOKIE, &a_cookie)
                    .header("x-0x1-csrf", "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(accept.status(), StatusCode::NO_CONTENT);

        // B observes the outcome.
        let status = app
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/session/activation-requests/{id}"))
                    .header(COOKIE, &b_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(json(status).await["status"], "accepted");

        // B is now active...
        let b_now_active = app
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(COOKIE, &b_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(b_now_active.status(), StatusCode::OK);

        // ...and A is not, but stays signed in rather than being revoked.
        let a_now_inactive = app
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(COOKIE, &a_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(a_now_inactive.status(), StatusCode::FORBIDDEN);
        assert_eq!(json(a_now_inactive).await["error"]["code"], "not_active_client");
    }

    #[tokio::test]
    async fn only_the_active_client_may_see_or_resolve_a_pending_request() {
        let (_database, database_url) = test_database();
        register(&database_url, "0x0bob", 9).await;
        let app = app_at(&database_url, NOW).await;
        let auth = signed_init_data(9);

        let a_first = app
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        cookie_from(&a_first); // establishes A as active; unused hereafter

        let created = app
            .clone()
            .oneshot(
                Request::post("/api/v1/session/activation-requests")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let b_cookie = cookie_from(&created);
        let id = json(created).await["id"].as_str().expect("id").to_owned();

        // B (inactive) may not see the pending-request inbox...
        let denied_pending = app
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(COOKIE, &b_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(denied_pending.status(), StatusCode::FORBIDDEN);

        // ...nor accept its own request, even though it is the requester.
        let denied_accept = app
            .oneshot(
                Request::post(format!("/api/v1/session/activation-requests/{id}/accept"))
                    .header(COOKIE, &b_cookie)
                    .header("x-0x1-csrf", "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(denied_accept.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn creating_a_request_while_already_active_is_a_conflict() {
        let (_database, database_url) = test_database();
        register(&database_url, "0x0carl", 11).await;
        let app = app_at(&database_url, NOW).await;
        let auth = signed_init_data(11);

        let first = app
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        // Reusing the same active session's cookie, not a fresh provider
        // header: this is what "already active" actually means. Fresh
        // headers with no cookie would just mint yet another (inactive)
        // session, per Single Active Client.
        let cookie = cookie_from(&first);

        let conflict = app
            .oneshot(
                Request::post("/api/v1/session/activation-requests")
                    .header(COOKIE, cookie)
                    .header("x-0x1-csrf", "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        assert_eq!(json(conflict).await["error"]["code"], "already_active");
    }

    #[tokio::test]
    async fn an_unanswered_request_activates_after_the_objection_window_elapses() {
        let (_database, database_url) = test_database();
        register(&database_url, "0x0dana", 13).await;
        let auth = signed_init_data(13);

        let app_now = app_at(&database_url, NOW).await;
        let a_first = app_now
            .clone()
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let a_cookie = cookie_from(&a_first);
        let created = app_now
            .oneshot(
                Request::post("/api/v1/session/activation-requests")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let b_cookie = cookie_from(&created);
        let id = json(created).await["id"].as_str().expect("id").to_owned();

        // Past the activation request TTL (120s), A never answered: the
        // request is now in its live-device objection window.
        let app_ttl_elapsed = app_at(&database_url, NOW + 121).await;
        let objectable = app_ttl_elapsed
            .oneshot(
                Request::get(format!("/api/v1/session/activation-requests/{id}"))
                    .header(COOKIE, &b_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let objectable_body = json(objectable).await;
        assert_eq!(objectable_body["status"], "objectable");
        assert!(objectable_body["objection_deadline"].is_u64());

        // Past the objection window (1 day) too, with no objection: B
        // activates on its own, and A - still silent - loses activity
        // without being revoked.
        let app_window_elapsed = app_at(&database_url, NOW + 121 + 60 * 60 * 24 + 1).await;
        let accepted = app_window_elapsed
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/session/activation-requests/{id}"))
                    .header(COOKIE, &b_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(json(accepted).await["status"], "accepted");

        let a_now_inactive = app_window_elapsed
            .oneshot(
                Request::get("/api/v1/session/activation-requests/pending")
                    .header(COOKIE, &a_cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(a_now_inactive.status(), StatusCode::FORBIDDEN);
    }
}
