// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/// Owner-authenticated Avaia profile routes. This is intentionally separate
/// from the legacy identity router so the new capability can evolve without
/// duplicating provider/session authentication semantics.
pub fn avaia_router(
    repository: IdentityRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
) -> Router {
    avaia_router_with_clock(
        repository,
        telegram_verifier,
        discord_oauth,
        native_auth,
        Arc::new(SystemClock),
    )
}

fn avaia_router_with_clock(
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
        .route(
            "/api/v1/identity/avaia",
            get(read_owned_avaia).post(update_owned_avaia),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn read_owned_avaia(State(state): State<ApiState>, headers: HeaderMap) -> Response {
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

    match state.repository.reconcile_owned_avaia(&owner, now).await {
        Ok(Some(_)) => {}
        Ok(None) => return unauthorized(),
        Err(error) => {
            tracing::error!(%error, "owned Avaia reconciliation failed");
            return unavailable();
        }
    }

    match state.repository.owned_avaia_identity(&owner).await {
        Ok(Some(profile)) => no_store_json(StatusCode::OK, AvaiaIdentityProjection::from(profile)),
        Ok(None) => unavailable(),
        Err(error) => {
            tracing::error!(%error, "owned Avaia profile lookup failed");
            unavailable()
        }
    }
}

async fn update_owned_avaia(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AvaiaProfileUpdateRequest>,
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
        .consume(format!("avaia-profile:{}", owner.as_str()), now, 8, 3600)
        .and_then(|_| state.limiter.consume("avaia-profile:global", now, 500, 3600))
    {
        return rate_limited(retry_after);
    }

    let next = match AvaiaPubDress::from_str(&request.pub_dress) {
        Ok(value) => value,
        Err(error) => return invalid_avaia_pub_dress(error),
    };
    if next.owner_discriminator() != owner.discriminator() {
        return no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "avaia_owner_discriminator_mismatch",
            "The Avaia address must keep its owner's discriminator.",
        );
    }

    match state.repository.configure_owned_avaia(&owner, &next, now).await {
        Ok(crate::AvaiaUpdateOutcome::Updated(profile)) => {
            no_store_json(StatusCode::OK, AvaiaIdentityProjection::from(profile))
        }
        Ok(crate::AvaiaUpdateOutcome::AvaiaUnavailable) => no_store_error(
            StatusCode::CONFLICT,
            "avaia_unavailable",
            "That Avaia address belongs to another identity.",
        ),
        Ok(crate::AvaiaUpdateOutcome::OwnerDiscriminatorMismatch) => no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "avaia_owner_discriminator_mismatch",
            "The Avaia address must keep its owner's discriminator.",
        ),
        Ok(crate::AvaiaUpdateOutcome::Unknown) => unauthorized(),
        Err(error) => {
            tracing::error!(%error, "owned Avaia profile update failed");
            unavailable()
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AvaiaProfileUpdateRequest {
    pub_dress: String,
}

#[derive(Debug, Serialize)]
struct AvaiaIdentityProjection {
    pub_dress: String,
    owner_pub_dress: String,
    configuration_state: &'static str,
    model_ref: Option<String>,
}

impl From<crate::AvaiaIdentityRecord> for AvaiaIdentityProjection {
    fn from(profile: crate::AvaiaIdentityRecord) -> Self {
        Self {
            pub_dress: profile.pub_dress,
            owner_pub_dress: profile.owner_pub_dress,
            configuration_state: profile.configuration_state.as_str(),
            model_ref: None,
        }
    }
}

#[cfg(test)]
mod avaia_api_tests {
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

    use super::{Clock, avaia_router_with_clock};
    use crate::{
        IdentityRepository, NativeAuthConfig, ProviderIdentity, PubDress, TelegramInitDataVerifier,
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
            ("query_id", "avaia-profile-query".to_owned()),
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
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let owner: PubDress = owner.parse().expect("owner pub_dress");
        repository
            .register(&owner, &ProviderIdentity::telegram(user_id), NOW)
            .await
            .expect("registration");
        let app = avaia_router_with_clock(
            repository,
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

    async fn json(response: axum::response::Response) -> Value {
        let body = to_bytes(response.into_body(), 8192).await.expect("body");
        serde_json::from_slice(&body).expect("json")
    }

    #[tokio::test]
    async fn profile_read_is_owner_authenticated_and_projects_unconfigured_state() {
        let (app, auth) = app(8801, "0x0sky").await;
        let anonymous = app
            .clone()
            .oneshot(
                Request::get("/api/v1/identity/avaia")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

        let response = app
            .oneshot(
                Request::get("/api/v1/identity/avaia")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json(response).await;
        assert_eq!(body["pub_dress"], "0skai");
        assert_eq!(body["owner_pub_dress"], "0x0sky");
        assert_eq!(body["configuration_state"], "unconfigured");
        assert!(body["model_ref"].is_null());
    }

    #[tokio::test]
    async fn profile_save_requires_csrf_and_canonical_owned_address() {
        let (app, auth) = app(8802, "0x0sky").await;
        let missing_csrf = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/avaia")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"pub_dress":"0newai"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

        let invalid = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/avaia")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"pub_dress":"0new"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let wrong_owner = app
            .oneshot(
                Request::post("/api/v1/identity/avaia")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"pub_dress":"1newai"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(wrong_owner.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn successful_save_persists_configured_projection() {
        let (app, auth) = app(8803, "0x0sky").await;
        let saved = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/avaia")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"pub_dress":"0newai"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(saved.status(), StatusCode::OK);
        let body = json(saved).await;
        assert_eq!(body["pub_dress"], "0newai");
        assert_eq!(body["configuration_state"], "configured");

        let reread = app
            .oneshot(
                Request::get("/api/v1/identity/avaia")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(reread.status(), StatusCode::OK);
        let body = json(reread).await;
        assert_eq!(body["pub_dress"], "0newai");
        assert_eq!(body["configuration_state"], "configured");
    }
}
