// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! HTTP adapter for the Telegram text client's one-use AIS login start.
//! Mount behind workload authentication. Only that middleware can insert
//! the authenticated, login-scoped bot principal into request extensions.

use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::Response,
    routing::post,
};
use nilxone_api::bot_login::{LoginStartRefusal, LoginStartRequest, START_PATH};
use nilxone_identity::{
    aiaiaiai_sign_in::SignInClient, public_info::PublicInfoRepository, rate_limit::AttemptLimiter,
};

use crate::browser_web_auth::{no_store_error, no_store_json, now_unix_seconds};

/// Trusted middleware supplies the verified bot workload subject after checking
/// its login-start permission. Never deserialize this value from the wire.
#[derive(Clone)]
pub struct AuthorizedLoginBot(pub String);

#[derive(Clone)]
struct LoginHost {
    repository: PublicInfoRepository,
    client: SignInClient,
    attempts: AttemptLimiter,
}

pub fn router(repository: PublicInfoRepository, client: SignInClient) -> Router {
    Router::new()
        .route(START_PATH, post(start))
        .with_state(LoginHost {
            repository,
            client,
            attempts: AttemptLimiter::default(),
        })
}

fn refusal(reason: LoginStartRefusal) -> Response {
    no_store_error(
        StatusCode::from_u16(reason.http_status()).expect("Core HTTP status"),
        reason.code(),
        "Telegram login could not be started.",
    )
}

async fn start(
    State(host): State<LoginHost>,
    principal: Option<Extension<AuthorizedLoginBot>>,
    Json(request): Json<LoginStartRequest>,
) -> Response {
    let Some(Extension(AuthorizedLoginBot(subject))) = principal else {
        return refusal(LoginStartRefusal::ServiceAuthenticationRequired);
    };
    if let Err(reason) = request.validate() {
        return refusal(reason);
    }
    if i64::try_from(request.provider_actor_id).ok() != Some(request.chat_id) {
        return refusal(LoginStartRefusal::InvalidProviderEvidence);
    }
    let Some(now) = now_unix_seconds() else {
        return refusal(LoginStartRefusal::LoginServiceUnavailable);
    };
    if let Err(retry) = host.attempts.consume(subject.clone(), now, 30, 60) {
        let mut response = refusal(LoginStartRefusal::LoginRateLimited);
        response
            .headers_mut()
            .insert(RETRY_AFTER, HeaderValue::from(retry));
        return response;
    }
    match host
        .repository
        .start_telegram_login(&host.client, &subject, &request, now)
        .await
    {
        Ok(Some(started)) => no_store_json(StatusCode::OK, started),
        Ok(None) => refusal(LoginStartRefusal::InvalidProviderEvidence),
        Err(_) => refusal(LoginStartRefusal::LoginServiceUnavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::{Request, header},
    };
    use nilxone_identity::aiaiaiai_sign_in::SignInClientConfig;
    use tower::ServiceExt;

    #[tokio::test]
    async fn private_update_requires_a_verified_caller_and_recovers_the_same_link() {
        let callback = "https://nilx.one/api/v1/telegram/login/callback";
        let client =
            SignInClientConfig::public("https://auth.aiaiaiai.org", None, "0x1", callback).unwrap();
        let app = router(
            PublicInfoRepository::connect("sqlite::memory:")
                .await
                .unwrap(),
            SignInClient::new(client),
        );
        let send = |trusted, chat| {
            let mut request = Request::post(START_PATH)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-workload-subject", "test-bot")
                .body(Body::from(
                    serde_json::json!({
                        "version": 1, "provider": "telegram", "provider_actor_id": 42,
                        "chat_id": chat, "message_id": 7
                    })
                    .to_string(),
                ))
                .unwrap();
            if trusted {
                request
                    .extensions_mut()
                    .insert(AuthorizedLoginBot("test-bot".into()));
            }
            app.clone().oneshot(request)
        };
        assert_eq!(
            send(false, 42).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(true, 41).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut links = Vec::new();
        for _ in 0..2 {
            let response = send(true, 42).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            assert!(!response.headers().contains_key(header::SET_COOKIE));
            let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
            let started: nilxone_api::bot_login::LoginStartResponse =
                serde_json::from_slice(&bytes).unwrap();
            assert!(started.has_valid_ttl());
            let url = url::Url::parse(&started.authorization_url).unwrap();
            assert_eq!(url.path(), "/0x1");
            assert!(
                url.query_pairs()
                    .any(|(k, v)| k == "redirect_uri" && v == callback)
            );
            links.push(url);
        }
        assert_eq!(links[0], links[1]);
    }
}
