// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/// Owner-authenticated Avaia profile routes. Reading setup state is strictly
/// observational: when the Avaia does not exist, the service derives a
/// presentation-only suggestion and never inserts an identity.
pub fn avaia_router(
    repository: IdentityRepository,
    provider_links: ProviderLinkRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
) -> Router {
    avaia_router_with_clock(
        repository,
        provider_links,
        telegram_verifier,
        discord_oauth,
        native_auth,
        Arc::new(SystemClock),
    )
}

fn avaia_router_with_clock(
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
            "/api/v1/identity/avaia",
            get(read_owned_avaia).post(create_or_update_owned_avaia),
        )
        .route(
            "/api/v1/identity/avaia/location",
            post(write_owned_avaia_location),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn read_owned_avaia(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, _active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };

    let profile = match state.repository.owned_avaia_identity(&owner).await {
        Ok(Some(profile)) => profile,
        Ok(None) => crate::AvaiaIdentityRecord {
            pub_dress: AvaiaPubDress::derive_default(&owner).to_string(),
            owner_pub_dress: owner.to_string(),
            configuration_state: crate::AvaiaConfigurationState::Unconfigured,
        },
        Err(error) => {
            tracing::error!(%error, "owned Avaia profile lookup failed");
            return unavailable();
        }
    };
    let location = match state.repository.read_avaia_location(&owner).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "owned Avaia location lookup failed");
            return unavailable();
        }
    };
    let mut response = no_store_json(
        StatusCode::OK,
        avaia_identity_projection(profile, location),
    );
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn create_or_update_owned_avaia(
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
    let (identity, active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if !active {
        return with_session_cookie(session_inactive(), cookie);
    }
    let mut response = create_or_update_owned_avaia_response(&state, identity, &request, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn create_or_update_owned_avaia_response(
    state: &ApiState,
    identity: IdentityRecord,
    request: &AvaiaProfileUpdateRequest,
    now: u64,
) -> Response {
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
            let location = match state.repository.read_avaia_location(&owner).await {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(%error, "owned Avaia location lookup failed");
                    return unavailable();
                }
            };
            no_store_json(StatusCode::OK, avaia_identity_projection(profile, location))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<AvaiaLocationProjection>,
}

#[derive(Debug, Serialize)]
struct AvaiaLocationProjection {
    coordinate: GeoCoordinate,
}

fn avaia_identity_projection(
    profile: crate::AvaiaIdentityRecord,
    location: Option<crate::AvaiaLocation>,
) -> AvaiaIdentityProjection {
    AvaiaIdentityProjection {
        pub_dress: profile.pub_dress,
        owner_pub_dress: profile.owner_pub_dress,
        configuration_state: profile.configuration_state.as_str(),
        model_ref: None,
        location: location.map(|location| AvaiaLocationProjection {
            coordinate: location.coordinate,
        }),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AvaiaLocationUpdateRequest {
    longitude: f64,
    latitude: f64,
}

async fn write_owned_avaia_location(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AvaiaLocationUpdateRequest>,
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
    let mut response = write_owned_avaia_location_response(&state, identity, &request, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn write_owned_avaia_location_response(
    state: &ApiState,
    identity: IdentityRecord,
    request: &AvaiaLocationUpdateRequest,
    now: u64,
) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    if let Err(retry_after) = state
        .limiter
        .consume(format!("avaia-location:{}", owner.as_str()), now, 120, 3600)
        .and_then(|_| state.limiter.consume("avaia-location:global", now, 5_000, 3600))
    {
        return rate_limited(retry_after);
    }

    let coordinate = match GeoCoordinate::from_degrees(request.longitude, request.latitude) {
        Ok(value) => value,
        Err(_) => {
            return no_store_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_avaia_location",
                "Longitude and latitude must be finite WGS84 degrees.",
            );
        }
    };

    // Location publication is not an Avaia creation boundary.
    let exists = match state.repository.owned_avaia_identity(&owner).await {
        Ok(Some(_)) => true,
        Ok(None) => false,
        Err(error) => {
            tracing::error!(%error, "owned Avaia profile lookup failed");
            return unavailable();
        }
    };
    if !exists {
        return no_store_error(
            StatusCode::CONFLICT,
            "avaia_unavailable",
            "Create the Avaia before publishing its location.",
        );
    }

    let location = crate::AvaiaLocation::new(coordinate, crate::DecimalU64::new(now));
    if let Err(error) = state.repository.write_avaia_location(&owner, location).await {
        tracing::error!(%error, "owned Avaia location write failed");
        return unavailable();
    }

    match state.repository.owned_avaia_identity(&owner).await {
        Ok(Some(profile)) => no_store_json(
            StatusCode::OK,
            avaia_identity_projection(profile, Some(location)),
        ),
        Ok(None) => no_store_error(
            StatusCode::CONFLICT,
            "avaia_unavailable",
            "Create the Avaia before publishing its location.",
        ),
        Err(error) => {
            tracing::error!(%error, "owned Avaia profile lookup failed");
            unavailable()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{atomic::{AtomicU64, Ordering}, Arc};

    use axum::{body::{Body, to_bytes}, http::{Request, StatusCode, header::AUTHORIZATION}};
    use hmac::{Hmac, Mac};
    use serde_json::Value;
    use sha2::Sha256;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::{Clock, avaia_router_with_clock};
    use crate::{IdentityRepository, NativeAuthConfig, ProviderIdentity, PubDress, TelegramInitDataVerifier};

    const TOKEN: &str = "123456:development-token";
    const NOW: u64 = 1_800_000_000;
    static TEST_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

    fn test_database_url() -> String {
        let id = TEST_DATABASE_ID.fetch_add(1, Ordering::Relaxed);
        format!("sqlite:file:avaia-api-lifecycle-{id}?mode=memory&cache=shared")
    }

    #[derive(Debug)]
    struct StaticClock;

    impl Clock for StaticClock {
        fn now_unix_seconds(&self) -> Result<u64, super::ClockError> {
            Ok(NOW)
        }
    }

    fn signed_init_data(user_id: i64) -> String {
        let mut fields = std::collections::BTreeMap::from([
            ("auth_date", NOW.to_string()),
            ("query_id", "avaia-lifecycle-query".to_owned()),
            ("user", format!(r#"{{"id":{user_id},"first_name":"Sasha"}}"#)),
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
        let hash = signature
            .finalize()
            .into_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        fields.insert("hash", hash);
        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields)
            .finish()
    }

    async fn app(user_id: i64, owner: &str) -> (axum::Router, String) {
        let database_url = test_database_url();
        let repository = IdentityRepository::connect(&database_url).await.expect("repository");
        let owner: PubDress = owner.parse().expect("owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(user_id), NOW)
            .await
            .expect("registration");
        let provider_links = crate::ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider links");
        let app = avaia_router_with_clock(
            repository,
            provider_links,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
            None,
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("native auth configuration"),
            Arc::new(StaticClock),
        );
        (app, signed_init_data(user_id))
    }

    async fn json(response: axum::response::Response) -> Value {
        let body = to_bytes(response.into_body(), 8192).await.expect("body");
        serde_json::from_slice(&body).expect("json")
    }

    #[tokio::test]
    async fn read_is_observational_and_returns_derived_suggestion() {
        let (app, auth) = app(8901, "0x0sky").await;
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
        assert_eq!(body["pub_dress"], "x0skai");
        assert_eq!(body["owner_pub_dress"], "0x0sky");
        assert_eq!(body["configuration_state"], "unconfigured");
    }

    #[tokio::test]
    async fn location_requires_existing_avaia() {
        let (app, auth) = app(8902, "0x0sky").await;
        let response = app
            .oneshot(
                Request::post("/api/v1/identity/avaia/location")
                    .header(AUTHORIZATION, format!("tma {auth}"))
                    .header("x-0x1-csrf", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"longitude":30.5234,"latitude":50.4501}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(json(response).await["error"]["code"], "avaia_unavailable");
    }

    #[tokio::test]
    async fn explicit_create_is_idempotent() {
        let (app, auth) = app(8903, "0x0sky").await;
        for _ in 0..2 {
            let response = app
                .clone()
                .oneshot(
                    Request::post("/api/v1/identity/avaia")
                        .header(AUTHORIZATION, format!("tma {auth}"))
                        .header("x-0x1-csrf", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(r#"{"pub_dress":"x0newai"}"#))
                        .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(json(response).await["configuration_state"], "configured");
        }
    }
}
