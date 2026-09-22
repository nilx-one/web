// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json, Router,
    extract::State,
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL},
    },
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Serialize;

use crate::{
    IdentityProvider, IdentityRepository, ProviderIdentity, ProviderLinkRepository,
    SelfDisconnectOutcome, TelegramInitDataVerifier,
};

const TELEGRAM_AUTH_SCHEME: &str = "tma ";

#[derive(Clone)]
struct ProviderSelfServiceState {
    identities: IdentityRepository,
    provider_links: ProviderLinkRepository,
    telegram_verifier: TelegramInitDataVerifier,
}

/// Lets a host that just proved its own provider identity detach that
/// identity from whichever Bond it is linked to — the same self-service
/// disconnect the Telegram bot's `/unlink` command performs, reachable from
/// the Mini App's own Settings surface. The request carries no `provider`
/// field: the only identity this endpoint ever touches is the one that
/// authenticated it, so a Telegram host can never name another provider to
/// detach on someone else's behalf.
pub fn provider_self_service_router(
    identities: IdentityRepository,
    provider_links: ProviderLinkRepository,
    telegram_verifier: TelegramInitDataVerifier,
) -> Router {
    Router::new()
        .route(
            "/api/v1/auth/telegram/disconnect",
            post(self_disconnect_telegram),
        )
        .with_state(ProviderSelfServiceState {
            identities,
            provider_links,
            telegram_verifier,
        })
}

#[derive(Serialize)]
struct SelfDisconnectResponse {
    state: &'static str,
}

async fn self_disconnect_telegram(
    State(state): State<ProviderSelfServiceState>,
    headers: HeaderMap,
) -> Response {
    let Some(init_data) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix(TELEGRAM_AUTH_SCHEME))
        .filter(|value| !value.is_empty())
    else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(value) => value.as_secs(),
        Err(_) => return status(StatusCode::SERVICE_UNAVAILABLE),
    };
    let user = match state.telegram_verifier.verify(init_data, now) {
        Ok(user) => user,
        Err(_) => return status(StatusCode::UNAUTHORIZED),
    };
    let provider_identity = ProviderIdentity::telegram(user.id);

    let identity = match state.identities.find_by_provider(&provider_identity).await {
        Ok(Some(identity)) => identity,
        Ok(None) => return status(StatusCode::NOT_FOUND),
        Err(error) => {
            tracing::error!(%error, "self-disconnect identity lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let pub_dress = match identity.pub_dress.parse() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "stored Bond pub_dress is invalid");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };

    match state
        .provider_links
        .unlink_self_service(&pub_dress, IdentityProvider::Telegram)
        .await
    {
        Ok(SelfDisconnectOutcome::Disconnected) => no_store_json(
            StatusCode::OK,
            SelfDisconnectResponse {
                state: "disconnected",
            },
        ),
        Ok(SelfDisconnectOutcome::NotLinked) => status(StatusCode::NOT_FOUND),
        Ok(SelfDisconnectOutcome::SoleAccessPath) => no_store_error(
            StatusCode::CONFLICT,
            "sole_access_path",
            "Telegram is the only way back into this Bond. Set a password or link another provider before disconnecting it.",
        ),
        Err(error) => {
            tracing::error!(%error, "self-disconnect failed");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

fn status(code: StatusCode) -> Response {
    let mut response = code.into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        "no-store".parse().expect("valid Cache-Control"),
    );
    response
}

fn no_store_json<T: Serialize>(code: StatusCode, value: T) -> Response {
    let mut response = (code, Json(value)).into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        "no-store".parse().expect("valid Cache-Control"),
    );
    response
}

fn no_store_error(code: StatusCode, error_code: &'static str, message: &'static str) -> Response {
    no_store_json(
        code,
        serde_json::json!({ "error": { "code": error_code, "message": message } }),
    )
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        time::{SystemTime, UNIX_EPOCH},
    };

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
    };
    use hmac::{Hmac, Mac};
    use serde_json::Value;
    use sha2::Sha256;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::provider_self_service_router;
    use crate::{
        IdentityRepository, ProviderIdentity, ProviderLinkOutcome, ProviderLinkRepository,
        TelegramInitDataVerifier,
    };

    const TOKEN: &str = "test-bot-token";

    fn signed_init_data(user_id: u64) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("valid system time")
            .as_secs();
        let mut fields = BTreeMap::from([
            ("auth_date", now.to_string()),
            ("query_id", "self-service-disconnect-query".to_owned()),
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
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        provider_self_service_router(
            identities,
            links,
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
        )
    }

    #[tokio::test]
    async fn disconnects_the_telegram_identity_that_authenticated_the_request() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let bond: crate::PubDress = "0x0sky".parse().expect("valid Bond");
        identities
            .register_native(
                &bond,
                "hash",
                1,
                b"recovery",
                b"challenge-self-service-disconnect",
                b"idempotency-self-service-disconnect",
                100,
                200,
            )
            .await
            .expect("native Bond registration");
        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::telegram(42))
                .await
                .expect("telegram link"),
            ProviderLinkOutcome::Linked
        );
        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::github(1))
                .await
                .expect("github link"),
            ProviderLinkOutcome::Linked
        );
        let app = provider_self_service_router(
            identities,
            links.clone(),
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
        );

        let response = app
            .oneshot(
                Request::post("/api/v1/auth/telegram/disconnect")
                    .header(AUTHORIZATION, format!("tma {}", signed_init_data(42)))
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            links.list(&bond).await.expect("provider list"),
            vec!["github".to_owned()]
        );
    }

    #[tokio::test]
    async fn refuses_to_disconnect_the_only_way_back_into_the_bond() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let bond: crate::PubDress = "0x0sky".parse().expect("valid Bond");
        identities
            .register_native(
                &bond,
                "hash",
                1,
                b"recovery",
                b"challenge-self-service-sole-path",
                b"idempotency-self-service-sole-path",
                100,
                200,
            )
            .await
            .expect("native Bond registration");
        links
            .link(&bond, &ProviderIdentity::telegram(42))
            .await
            .expect("telegram link");
        let app = provider_self_service_router(
            identities,
            links.clone(),
            TelegramInitDataVerifier::new(TOKEN.to_owned(), 300),
        );

        let response = app
            .oneshot(
                Request::post("/api/v1/auth/telegram/disconnect")
                    .header(AUTHORIZATION, format!("tma {}", signed_init_data(42)))
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = to_bytes(response.into_body(), 4096).await.expect("body");
        let body: Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["error"]["code"], "sole_access_path");
        assert_eq!(
            links.list(&bond).await.expect("provider list"),
            vec!["telegram".to_owned()]
        );
    }

    #[tokio::test]
    async fn rejects_a_request_without_valid_telegram_proof() {
        let app = app().await;

        let response = app
            .oneshot(
                Request::post("/api/v1/auth/telegram/disconnect")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn reports_not_found_for_a_telegram_identity_with_no_bond() {
        let app = app().await;

        let response = app
            .oneshot(
                Request::post("/api/v1/auth/telegram/disconnect")
                    .header(AUTHORIZATION, format!("tma {}", signed_init_data(999)))
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
