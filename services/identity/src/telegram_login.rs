// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! HTTP adapter for the Telegram text client's one-use AIS login start.
//! Mount behind workload authentication. Only that middleware can insert
//! the authenticated, login-scoped bot principal into request extensions.

#[path = "telegram_login_authority.rs"]
mod authority;
pub use authority::{Authority, ISSUER};

use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::Response,
    routing::post,
};
use nilxone_api::bot_login::{LoginStartRefusal, LoginStartRequest, START_PATH};
use nilxone_identity::{
    aiaiaiai_sign_in::SignInClient,
    public_info::{PublicInfoRepository, TelegramLoginError},
    rate_limit::AttemptLimiter,
};

use crate::browser_web_auth::{no_store_error, no_store_json, now_unix_seconds};

/// Trusted middleware supplies the verified bot workload subject after checking
/// its login-start permission. Never deserialize this value from the wire.
#[derive(Clone)]
struct AuthorizedLoginBot(String);

#[derive(Clone)]
struct LoginHost {
    repository: PublicInfoRepository,
    client: SignInClient,
    /// Per-process only; each replica has its own budget.
    attempts: AttemptLimiter,
}

pub fn authenticated_router(
    repository: PublicInfoRepository,
    client: SignInClient,
    authority: Authority,
) -> Router {
    router(repository, client).route_layer(axum::middleware::from_fn_with_state(
        authority,
        authority::authenticate,
    ))
}

fn router(repository: PublicInfoRepository, client: SignInClient) -> Router {
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

fn map_start_error(error: TelegramLoginError) -> Response {
    match &error {
        TelegramLoginError::InvalidInput => {
            tracing::error!(%error, "Telegram login start rejected invalid input");
            refusal(LoginStartRefusal::InvalidProviderEvidence)
        }
        TelegramLoginError::WrongClient
        | TelegramLoginError::SignIn(_)
        | TelegramLoginError::Storage(_)
        | TelegramLoginError::InvalidTransaction(_) => {
            tracing::error!(%error, "Telegram login start failed");
            refusal(LoginStartRefusal::LoginServiceUnavailable)
        }
    }
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
    // Bucket per Telegram actor so one chatter cannot exhaust the shared bot.
    let limit_key = format!("{subject}:{}", request.provider_actor_id);
    if let Err(retry) = host.attempts.consume(limit_key, now, 30, 60) {
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
        // Consumed or expired updates; Core has no distinct login_expired yet.
        Ok(None) => refusal(LoginStartRefusal::InvalidProviderEvidence),
        Err(error) => map_start_error(error),
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

    #[tokio::test]
    async fn rate_limit_is_isolated_per_telegram_actor() {
        let callback = "https://nilx.one/api/v1/telegram/login/callback";
        let client =
            SignInClientConfig::public("https://auth.aiaiaiai.org", None, "0x1", callback).unwrap();
        let app = router(
            PublicInfoRepository::connect("sqlite::memory:")
                .await
                .unwrap(),
            SignInClient::new(client),
        );
        let send = |actor: u64, message_id: i32| {
            let mut request = Request::post(START_PATH)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "version": 1, "provider": "telegram",
                        "provider_actor_id": actor, "chat_id": actor as i64,
                        "message_id": message_id
                    })
                    .to_string(),
                ))
                .unwrap();
            request
                .extensions_mut()
                .insert(AuthorizedLoginBot("test-bot".into()));
            app.clone().oneshot(request)
        };
        for message_id in 1..=30 {
            assert_eq!(
                send(42, message_id).await.unwrap().status(),
                StatusCode::OK,
                "actor 42 message {message_id}"
            );
        }
        let limited = send(42, 31).await.unwrap();
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(limited.headers().contains_key(RETRY_AFTER));
        assert_eq!(
            send(43, 1).await.unwrap().status(),
            StatusCode::OK,
            "a different actor keeps its own budget"
        );
    }
}
