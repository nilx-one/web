// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/// Owner-authenticated `pub_info` for a Bond's `.bnd`.
///
/// Experience totals are the public, synced part of that file, and they are
/// an owner assertion. This router stores and redistributes them. It does
/// not price actions, decide levels, or attest that the play happened.
/// Every answer labels the totals `authority: "client"`; the request cannot
/// choose that label.
pub fn pub_info_router(
    repository: IdentityRepository,
    provider_links: ProviderLinkRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
) -> Router {
    pub_info_router_with_clock(
        repository,
        provider_links,
        telegram_verifier,
        discord_oauth,
        native_auth,
        Arc::new(SystemClock),
    )
}

fn pub_info_router_with_clock(
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
            "/api/v1/identity/pub-info",
            get(read_pub_info).post(publish_pub_info),
        )
        .layer(DefaultBodyLimit::max(PUB_INFO_MAX_BYTES))
        .with_state(state)
}

const PUB_INFO_MAX_BYTES: usize = 16 * 1024;
const MAX_EVENTS: usize = 64;
const MAX_EVENT_AMOUNT: u64 = 10_000;
const MAX_CARRY_XP: u64 = 1_000_000_000;

async fn read_pub_info(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, _active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    let mut response = read_pub_info_response(&state, &identity).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn read_pub_info_response(state: &ApiState, identity: &IdentityRecord) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    match state.repository.read_pub_info(&owner).await {
        Ok(experience) => no_store_json(StatusCode::OK, experience_response(experience)),
        Err(error) => {
            tracing::error!(%error, "pub_info read failed");
            unavailable()
        }
    }
}

async fn publish_pub_info(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<PublishExperienceRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
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
        return with_session_cookie(session_inactive(), cookie);
    }
    let mut response = publish_pub_info_response(&state, &identity, &request, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn publish_pub_info_response(
    state: &ApiState,
    identity: &IdentityRecord,
    request: &PublishExperienceRequest,
    now: u64,
) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    let Some(publication) = validate_publication(request) else {
        return no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_pub_info",
            "Experience events must be small, finite, and named by an opaque id.",
        );
    };
    if let Err(retry_after) = state
        .limiter
        .consume(format!("pub-info:{}", owner.as_str()), now, 120, 3600)
        .and_then(|_| state.limiter.consume("pub-info:global", now, 5_000, 3600))
    {
        return rate_limited(retry_after);
    }

    match state
        .repository
        .publish_experience(&owner, publication.carry, &publication.events, now)
        .await
    {
        Ok(experience) => no_store_json(StatusCode::OK, experience_response(experience)),
        Err(error) => {
            tracing::error!(%error, "pub_info publish failed");
            unavailable()
        }
    }
}

struct Publication {
    carry: Option<crate::repository::PubInfoExperience>,
    events: Vec<crate::repository::ExperienceAward>,
}

fn validate_publication(request: &PublishExperienceRequest) -> Option<Publication> {
    if request.events.len() > MAX_EVENTS {
        return None;
    }
    let carry = match &request.carry {
        None => None,
        // Carry is the owner's assertion of a pre-sync total. The cap is an
        // abuse bound on an untrusted number, not proof the experience was
        // earned. Idempotency does not prove it either. The service stores
        // the assertion and answers `authority: "client"`.
        Some(carry) if carry.bond_xp <= MAX_CARRY_XP && carry.avaia_xp <= MAX_CARRY_XP => {
            Some(crate::repository::PubInfoExperience {
                bond_xp: carry.bond_xp,
                avaia_xp: carry.avaia_xp,
            })
        }
        Some(_) => return None,
    };
    let mut events = Vec::with_capacity(request.events.len());
    let mut seen = std::collections::BTreeSet::new();
    for event in &request.events {
        if !seen.insert(event.id.as_str()) {
            continue;
        }
        let earner = crate::repository::ExperienceEarner::parse(&event.earner)?;
        // The amount is the same kind of assertion as carry. The cap bounds
        // how much one opaque id can add; it is not evidence the award was
        // earned, and neither is the rate limit.
        if event.amount == 0 || event.amount > MAX_EVENT_AMOUNT || !valid_event_id(&event.id) {
            return None;
        }
        events.push(crate::repository::ExperienceAward {
            id: event.id.clone(),
            earner,
            amount: event.amount,
        });
    }
    Some(Publication { carry, events })
}

/// `xp:` plus a nonce. A colon after the prefix is refused, so an id cannot
/// carry a cell, a landmark, or any other subject — only the fact that
/// something was earned.
fn valid_event_id(id: &str) -> bool {
    let Some(nonce) = id.strip_prefix("xp:") else {
        return false;
    };
    let bytes = nonce.as_bytes();
    (1..=76).contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn experience_response(experience: crate::repository::PubInfoExperience) -> PubInfoResponse {
    PubInfoResponse {
        experience: ExperienceBody {
            authority: crate::repository::EXPERIENCE_AUTHORITY,
            bond_xp: experience.bond_xp,
            avaia_xp: experience.avaia_xp,
        },
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PublishExperienceRequest {
    #[serde(default)]
    carry: Option<CarryBody>,
    #[serde(default)]
    events: Vec<EventBody>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CarryBody {
    bond_xp: u64,
    avaia_xp: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventBody {
    id: String,
    earner: String,
    amount: u64,
}

#[derive(Debug, Serialize)]
struct PubInfoResponse {
    experience: ExperienceBody,
}

#[derive(Debug, Serialize)]
struct ExperienceBody {
    authority: &'static str,
    bond_xp: u64,
    avaia_xp: u64,
}

#[cfg(test)]
mod pub_info_api_tests {
    use std::{
        collections::BTreeMap,
        sync::{
            Arc,
            atomic::{AtomicU64, Ordering},
        },
    };

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

    use super::{Clock, pub_info_router_with_clock};
    use crate::{
        IdentityRepository, NativeAuthConfig, ProviderIdentity, PubDress, TelegramInitDataVerifier,
    };

    const TOKEN: &str = "123456:development-token";
    const NOW: u64 = 1_800_000_000;
    static TEST_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

    fn test_database_url() -> String {
        let id = TEST_DATABASE_ID.fetch_add(1, Ordering::Relaxed);
        format!("sqlite:file:pub-info-api-test-{id}?mode=memory&cache=shared")
    }

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
            ("query_id", "pub-info-query".to_owned()),
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

    async fn app(user_id: i64, owner: &str) -> (axum::Router, String) {
        let database_url = test_database_url();
        let repository = IdentityRepository::connect(&database_url)
            .await
            .expect("repository");
        let owner: PubDress = owner.parse().expect("owner pub_dress");
        repository
            .register(&owner, &ProviderIdentity::telegram(user_id), NOW)
            .await
            .expect("registration");
        let provider_links = crate::ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider links");
        let app = pub_info_router_with_clock(
            repository,
            provider_links,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
            None,
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("valid native auth configuration"),
            Arc::new(StaticClock),
        );
        (app, signed_init_data(user_id))
    }

    fn session_cookie(response: &axum::response::Response) -> String {
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
    async fn publishing_requires_the_owner_and_csrf_and_is_idempotent() {
        let (app, auth) = app(8810, "0x0sky").await;
        let anonymous = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/pub-info")
                    .header("content-type", "application/json")
                    .header("x-0x1-csrf", "1")
                    .body(Body::from(r#"{"events":[]}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

        let missing_csrf = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/pub-info")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"carry":{"bond_xp":30,"avaia_xp":0},"events":[{"id":"xp:1","earner":"bond","amount":30}]}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

        let published = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/pub-info")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("content-type", "application/json")
                    .header("x-0x1-csrf", "1")
                    .body(Body::from(
                        r#"{"carry":{"bond_xp":30,"avaia_xp":0},"events":[{"id":"xp:1","earner":"bond","amount":30}]}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(published.status(), StatusCode::OK);
        let cookie = session_cookie(&published);
        let body = json(published).await;
        assert_eq!(body["experience"]["authority"], "client");
        assert_eq!(body["experience"]["bond_xp"], 60);
        assert_eq!(body["experience"]["avaia_xp"], 0);

        let replay = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/pub-info")
                    .header(COOKIE, &cookie)
                    .header("content-type", "application/json")
                    .header("x-0x1-csrf", "1")
                    .body(Body::from(
                        r#"{"events":[{"id":"xp:1","earner":"bond","amount":30}]}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(replay.status(), StatusCode::OK);
        let replayed = json(replay).await;
        assert_eq!(replayed["experience"]["authority"], "client");
        assert_eq!(replayed["experience"]["bond_xp"], 60);

        let read = app
            .oneshot(
                Request::get("/api/v1/identity/pub-info")
                    .header(COOKIE, &cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(read.status(), StatusCode::OK);
        let read_body = json(read).await;
        assert_eq!(read_body["experience"]["authority"], "client");
        assert_eq!(read_body["experience"]["bond_xp"], 60);
    }

    #[tokio::test]
    async fn a_located_event_id_or_an_unknown_earner_is_refused() {
        let (app, auth) = app(8811, "0x0sky").await;
        let mut session: Option<String> = None;
        for body in [
            r#"{"events":[{"id":"zone:8a2a1072b59ffff:avaia","earner":"avaia","amount":10}]}"#,
            r#"{"events":[{"id":"xp:1","earner":"owner","amount":10}]}"#,
            r#"{"events":[{"id":"xp:1","earner":"bond","amount":0}]}"#,
            r#"{"authority":"service","events":[]}"#,
            r#"{"carry":{"authority":"service","bond_xp":1,"avaia_xp":0},"events":[]}"#,
        ] {
            let mut request = Request::post("/api/v1/identity/pub-info");
            request = match &session {
                Some(cookie) => request.header(COOKIE, cookie),
                None => request.header(AUTHORIZATION, format!("tma {auth}")),
            };
            let response = app
                .clone()
                .oneshot(
                    request
                        .header("content-type", "application/json")
                        .header("x-0x1-csrf", "1")
                        .body(Body::from(body))
                        .expect("request"),
                )
                .await
                .expect("response");
            if session.is_none() {
                session = Some(session_cookie(&response));
            }
            assert_eq!(
                response.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{body}"
            );
        }
    }
}
