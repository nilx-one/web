// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, HOST, RETRY_AFTER},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{
    IdentityRepository, PubDressLabel,
    rate_limit::AttemptLimiter,
};

const MAX_REQUEST_BYTES: usize = 2 * 1024;
const PUBLIC_ZONE: &str = "nilx.one";

#[derive(Clone)]
struct PublicApiState {
    repository: IdentityRepository,
    limiter: AttemptLimiter,
}

pub fn router(repository: IdentityRepository) -> Router {
    Router::new()
        .route("/api/v1/identity/url/resolve", post(resolve_pub_dress_label))
        .route("/api/v1/identity/public", get(read_public_identity))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(PublicApiState {
            repository,
            limiter: AttemptLimiter::default(),
        })
}

async fn resolve_pub_dress_label(
    State(state): State<PublicApiState>,
    headers: HeaderMap,
    Json(request): Json<ResolvePubDressLabelRequest>,
) -> Response {
    let now = unix_seconds();
    let source = request_source(&headers);
    if let Err(retry_after) = state
        .limiter
        .consume(format!("pub-url-resolve:source:{source}"), now, 60, 60)
        .and_then(|_| {
            state
                .limiter
                .consume("pub-url-resolve:global", now, 2_000, 60)
        })
    {
        return rate_limited(retry_after);
    }

    let label = match PubDressLabel::from_str(&request.label) {
        Ok(value) => value,
        Err(_) => {
            return no_store_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_pub_dress_label",
                "Use the canonical DNS label returned by 0x1 Core.",
            );
        }
    };

    match state.repository.is_pub_dress_label_available(&label).await {
        Ok(available) => no_store_json(
            StatusCode::OK,
            PubDressLabelResolutionResponse {
                label: label.to_string(),
                state: if available {
                    PubDressLabelResolutionKind::Available
                } else {
                    PubDressLabelResolutionKind::Registered
                },
            },
        ),
        Err(error) => {
            tracing::error!(%error, "public Bond label resolution failed");
            unavailable()
        }
    }
}

async fn read_public_identity(
    State(state): State<PublicApiState>,
    headers: HeaderMap,
) -> Response {
    let Some(label) = public_label_from_host(&headers) else {
        return not_found();
    };

    match state.repository.find_by_pub_dress_label(&label).await {
        Ok(Some(record)) => {
            let avatar_model = match state.repository.avatar_model(&record.identity.pub_dress).await {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(%error, "public Bond avatar lookup failed");
                    return unavailable();
                }
            };
            no_store_json(
                StatusCode::OK,
                PublicIdentityProjection {
                    pub_dress_url: record.readable_url(PUBLIC_ZONE),
                    pub_dress: record.identity.pub_dress,
                    avaia_pub_dress: record.identity.avaia_pub_dress,
                    avatar_model,
                },
            )
        }
        Ok(None) => not_found(),
        Err(error) => {
            tracing::error!(%error, "public Bond lookup failed");
            unavailable()
        }
    }
}

fn public_label_from_host(headers: &HeaderMap) -> Option<PubDressLabel> {
    let host = headers.get(HOST)?.to_str().ok()?.trim_end_matches('.');
    let host = host.split_once(':').map_or(host, |(name, _)| name);
    let suffix = format!(".{PUBLIC_ZONE}");
    let label = host.strip_suffix(&suffix)?;
    if label.is_empty() || label.contains('.') {
        return None;
    }
    PubDressLabel::from_str(label).ok()
}

fn unix_seconds() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn request_source(headers: &HeaderMap) -> String {
    headers
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
        })
        .unwrap_or("unknown")
        .to_owned()
}

fn no_store_json<T: Serialize>(status: StatusCode, body: T) -> Response {
    let mut response = (status, Json(body)).into_response();
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

fn not_found() -> Response {
    no_store_error(
        StatusCode::NOT_FOUND,
        "public_bond_not_found",
        "No public Bond is allocated to this address.",
    )
}

fn unavailable() -> Response {
    no_store_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "identity_service_unavailable",
        "Identity lookup is temporarily unavailable.",
    )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResolvePubDressLabelRequest {
    label: String,
}

#[derive(Debug, Serialize)]
struct PubDressLabelResolutionResponse {
    label: String,
    state: PubDressLabelResolutionKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum PubDressLabelResolutionKind {
    Available,
    Registered,
}

#[derive(Debug, Serialize)]
struct PublicIdentityProjection {
    pub_dress: String,
    avaia_pub_dress: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_model: Option<String>,
    pub_dress_url: String,
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
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use serde_json::Value;
    use tower::ServiceExt as _;

    use super::router;
    use crate::{IdentityRepository, ProviderIdentity, PubDress};

    async fn app() -> axum::Router {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let address: PubDress = "0x0небо".parse().expect("pub_dress");
        repository
            .register(&address, &ProviderIdentity::telegram(42), 100)
            .await
            .expect("registration");
        router(repository)
    }

    async fn json(response: axum::response::Response) -> Value {
        let body = to_bytes(response.into_body(), 8192).await.expect("body");
        serde_json::from_slice(&body).expect("json")
    }

    #[tokio::test]
    async fn resolves_the_stored_a_label_without_reversing_it_to_an_identity() {
        let app = app().await;
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/identity/url/resolve")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"label":"xn--0x0-dddt1cj"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json(response).await;
        assert_eq!(body["state"], "registered");
        assert_eq!(body["label"], "xn--0x0-dddt1cj");
    }

    #[tokio::test]
    async fn host_lookup_returns_the_readable_unicode_address() {
        let app = app().await;
        let response = app
            .oneshot(
                Request::get("/api/v1/identity/public")
                    .header("host", "xn--0x0-dddt1cj.nilx.one")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json(response).await;
        assert_eq!(body["pub_dress"], "0x0небо");
        assert_eq!(body["pub_dress_url"], "https://0x0небо.nilx.one");
    }

    #[tokio::test]
    async fn an_unallocated_host_is_not_reverse_decoded_into_a_bond() {
        let app = app().await;
        let response = app
            .oneshot(
                Request::get("/api/v1/identity/public")
                    .header("host", "0x0other.nilx.one")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
