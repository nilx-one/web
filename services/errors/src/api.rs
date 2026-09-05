// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL, RETRY_AFTER},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{IngestTokens, ReadToken, ScopeError},
    rate_limit::RequestLimiter,
    report::{ErrorReport, ReportError},
    repository::{DEFAULT_PAGE_SIZE, ErrorQuery, ErrorTrashRepository, MAX_PAGE_SIZE, StoredError},
    time::{Clock, SystemClock, Timestamp},
};

const BEARER_SCHEME: &str = "Bearer ";
const MAX_REQUEST_BYTES: usize = 512 * 1024;
const MAX_BATCH_REPORTS: usize = 50;
const INGEST_WINDOW_SECONDS: u64 = 60;
const INGEST_PER_SOURCE: u32 = 600;
const INGEST_PER_PROJECT: u32 = 3_000;
const READ_PER_SOURCE: u32 = 60;

#[derive(Clone)]
struct ApiState {
    repository: ErrorTrashRepository,
    ingest_tokens: IngestTokens,
    read_token: Option<ReadToken>,
    clock: Arc<dyn Clock>,
    limiter: RequestLimiter,
}

pub fn router(
    repository: ErrorTrashRepository,
    ingest_tokens: IngestTokens,
    read_token: Option<ReadToken>,
) -> Router {
    router_with_clock(repository, ingest_tokens, read_token, Arc::new(SystemClock))
}

fn router_with_clock(
    repository: ErrorTrashRepository,
    ingest_tokens: IngestTokens,
    read_token: Option<ReadToken>,
    clock: Arc<dyn Clock>,
) -> Router {
    let state = ApiState {
        repository,
        ingest_tokens,
        read_token,
        clock,
        limiter: RequestLimiter::default(),
    };

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/errors", post(dump_errors).get(read_errors))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::OK
}

/// Accepts one error object or an array of them.
///
/// The response reports how many rows were stored so that a reporter can log a
/// partial retry decision without reading the trash back.
async fn dump_errors(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Result<Json<DumpRequest>, JsonRejection>,
) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return unauthorized();
    };
    let Some(scope) = state.ingest_tokens.authorize(&token) else {
        return unauthorized();
    };
    let Ok(Json(request)) = body else {
        return error(
            StatusCode::BAD_REQUEST,
            "invalid_request_body",
            "Send one error object or an array of error objects.",
        );
    };

    let now = state.clock.now();
    let source = request_source(&headers);
    if let Err(retry_after) = state.limiter.consume(
        format!("ingest:source:{source}"),
        state.clock.now_unix_seconds(),
        INGEST_PER_SOURCE,
        INGEST_WINDOW_SECONDS,
    ) {
        return rate_limited(retry_after);
    }

    let payloads = request.into_payloads();
    if payloads.is_empty() {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "empty_batch",
            "Send at least one error.",
        );
    }
    if payloads.len() > MAX_BATCH_REPORTS {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "batch_too_large",
            "Send at most 50 errors per request.",
        );
    }

    let mut reports = Vec::with_capacity(payloads.len());
    let mut project = None;
    for payload in &payloads {
        let resolved = match scope.resolve(payload.project.as_deref()) {
            Ok(project) => project,
            Err(scope_error) => return scope_rejection(scope_error),
        };
        let observed_at = match payload.observed_at.as_deref() {
            None => now.clone(),
            Some(value) => match Timestamp::parse(value) {
                Ok(timestamp) => timestamp,
                Err(_) => {
                    return error(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "invalid_observed_at",
                        "observed_at must be RFC 3339 UTC, for example 2026-09-05T12:34:56Z.",
                    );
                }
            },
        };
        match ErrorReport::new(
            resolved,
            &payload.error_type,
            &payload.full_text,
            observed_at,
            now.clone(),
        ) {
            Ok(report) => {
                project = Some(report.project().to_owned());
                reports.push(report);
            }
            Err(report_error) => return report_rejection(report_error),
        }
    }

    let project = project.unwrap_or_default();
    if let Err(retry_after) = state.limiter.consume(
        format!("ingest:project:{project}"),
        state.clock.now_unix_seconds(),
        INGEST_PER_PROJECT,
        INGEST_WINDOW_SECONDS,
    ) {
        return rate_limited(retry_after);
    }

    match state.repository.record(&reports).await {
        Ok(identifiers) => no_store_json(
            StatusCode::CREATED,
            DumpResponse {
                stored: identifiers.len(),
                ids: identifiers,
            },
        ),
        Err(storage_error) => {
            tracing::error!(%storage_error, project, "error dump could not be stored");
            unavailable()
        }
    }
}

async fn read_errors(
    State(state): State<ApiState>,
    headers: HeaderMap,
    query: Result<Query<ReadQuery>, QueryRejection>,
) -> Response {
    let Ok(Query(query)) = query else {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_query",
            "Supported filters are project, type, since, until, and limit.",
        );
    };
    let Some(read_token) = state.read_token.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "read_disabled",
            "This error trash is configured for ingest only.",
        );
    };
    let authorized = bearer_token(&headers).is_some_and(|token| read_token.verify(&token));
    if !authorized {
        return unauthorized();
    }
    if let Err(retry_after) = state.limiter.consume(
        format!("read:source:{}", request_source(&headers)),
        state.clock.now_unix_seconds(),
        READ_PER_SOURCE,
        INGEST_WINDOW_SECONDS,
    ) {
        return rate_limited(retry_after);
    }

    let (since, until) = match (
        optional_timestamp(query.since.as_deref()),
        optional_timestamp(query.until.as_deref()),
    ) {
        (Ok(since), Ok(until)) => (since, until),
        _ => {
            return error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_window",
                "since and until must be RFC 3339 UTC, for example 2026-09-05T12:34:56Z.",
            );
        }
    };

    let listing = state
        .repository
        .list(&ErrorQuery {
            project: query.project,
            error_type: query.error_type,
            since,
            until,
            limit: query.limit.unwrap_or(DEFAULT_PAGE_SIZE).min(MAX_PAGE_SIZE),
        })
        .await;

    match listing {
        Ok(errors) => no_store_json(
            StatusCode::OK,
            ReadResponse {
                errors: errors.iter().map(ErrorView::from).collect(),
            },
        ),
        Err(storage_error) => {
            tracing::error!(%storage_error, "error trash listing failed");
            unavailable()
        }
    }
}

fn optional_timestamp(value: Option<&str>) -> Result<Option<Timestamp>, ()> {
    match value {
        None => Ok(None),
        Some(value) => Timestamp::parse(value).map(Some).map_err(|_| ()),
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix(BEARER_SCHEME))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
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

fn error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    no_store_json(
        status,
        ErrorEnvelope {
            error: ApiError { code, message },
        },
    )
}

fn unauthorized() -> Response {
    error(
        StatusCode::UNAUTHORIZED,
        "invalid_token",
        "Present a configured token as Authorization: Bearer <token>.",
    )
}

fn unavailable() -> Response {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "error_trash_unavailable",
        "The error trash is temporarily unavailable.",
    )
}

fn rate_limited(retry_after: u64) -> Response {
    let mut response = error(
        StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
        "Too many error dumps. Batch them and retry later.",
    );
    if let Ok(value) = HeaderValue::from_str(&retry_after.max(1).to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

fn scope_rejection(scope_error: ScopeError) -> Response {
    match scope_error {
        ScopeError::ForeignProject => error(
            StatusCode::FORBIDDEN,
            "foreign_project",
            "This token may dump errors only for its own project.",
        ),
        ScopeError::MissingProject => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "project_required",
            "A shared token must name the reporting project.",
        ),
    }
}

fn report_rejection(report_error: ReportError) -> Response {
    match report_error {
        ReportError::InvalidProject => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_project",
            "project must be 1–64 characters of [A-Za-z0-9._/@-].",
        ),
        ReportError::InvalidType => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_type",
            "type must be 1–128 characters without control characters.",
        ),
        ReportError::EmptyFullText => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "empty_full_text",
            "full_text must contain the error text.",
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum DumpRequest {
    One(ReportPayload),
    Many(Vec<ReportPayload>),
}

impl DumpRequest {
    fn into_payloads(self) -> Vec<ReportPayload> {
        match self {
            Self::One(payload) => vec![payload],
            Self::Many(payloads) => payloads,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportPayload {
    #[serde(rename = "type")]
    error_type: String,
    full_text: String,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    observed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadQuery {
    #[serde(default)]
    project: Option<String>,
    #[serde(default, rename = "type")]
    error_type: Option<String>,
    #[serde(default)]
    since: Option<String>,
    #[serde(default)]
    until: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Debug, Serialize)]
struct DumpResponse {
    stored: usize,
    ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
struct ReadResponse<'a> {
    errors: Vec<ErrorView<'a>>,
}

#[derive(Debug, Serialize)]
struct ErrorView<'a> {
    id: i64,
    project: &'a str,
    #[serde(rename = "type")]
    error_type: &'a str,
    full_text: &'a str,
    observed_at: &'a str,
    received_at: &'a str,
}

impl<'a> From<&'a StoredError> for ErrorView<'a> {
    fn from(stored: &'a StoredError) -> Self {
        Self {
            id: stored.id,
            project: &stored.project,
            error_type: &stored.error_type,
            full_text: &stored.full_text,
            observed_at: &stored.observed_at,
            received_at: &stored.received_at,
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
    use std::sync::Arc;

    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt as _;

    use super::router_with_clock;
    use crate::{
        auth::{IngestTokens, ReadToken},
        repository::ErrorTrashRepository,
        time::Clock,
    };

    const WEB_TOKEN: &str = "web-ingest-token-that-is-long-enough";
    const SHARED_TOKEN: &str = "shared-ingest-token-that-is-long-enough";
    const READ_TOKEN: &str = "read-token-that-is-also-long-enough-here";
    const NOW: u64 = 1_800_000_000;

    #[derive(Debug)]
    struct StaticClock;

    impl Clock for StaticClock {
        fn now_unix_seconds(&self) -> u64 {
            NOW
        }
    }

    async fn app() -> Router {
        app_with_read_token(Some(
            ReadToken::parse(READ_TOKEN).expect("valid read token"),
        ))
        .await
    }

    async fn app_with_read_token(read_token: Option<ReadToken>) -> Router {
        let repository = ErrorTrashRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        router_with_clock(
            repository,
            IngestTokens::parse(&format!("nilx-one/web:{WEB_TOKEN}, *:{SHARED_TOKEN}"))
                .expect("valid ingest configuration"),
            read_token,
            Arc::new(StaticClock),
        )
    }

    fn dump(token: &str, body: Value) -> Request<Body> {
        Request::post("/api/v1/errors")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .expect("valid request")
    }

    fn read(path: &str, token: &str) -> Request<Body> {
        Request::get(path)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .expect("valid request")
    }

    async fn body_of(response: axum::response::Response) -> Value {
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("body");
        serde_json::from_slice(&bytes).expect("JSON body")
    }

    #[tokio::test]
    async fn a_project_dumps_one_error_and_reads_it_back() {
        let app = app().await;

        let stored = app
            .clone()
            .oneshot(dump(
                WEB_TOKEN,
                json!({
                    "type": "unhandled_rejection",
                    "full_text": "TypeError: x is not a function",
                    "observed_at": "2027-01-15T07:59:00Z"
                }),
            ))
            .await
            .expect("response");
        assert_eq!(stored.status(), StatusCode::CREATED);
        assert_eq!(body_of(stored).await["stored"], json!(1));

        let listed = app
            .oneshot(read("/api/v1/errors", READ_TOKEN))
            .await
            .expect("response");
        assert_eq!(listed.status(), StatusCode::OK);
        let body = body_of(listed).await;
        assert_eq!(body["errors"][0]["project"], "nilx-one/web");
        assert_eq!(body["errors"][0]["type"], "unhandled_rejection");
        assert_eq!(
            body["errors"][0]["full_text"],
            "TypeError: x is not a function"
        );
        assert_eq!(body["errors"][0]["observed_at"], "2027-01-15T07:59:00Z");
        assert_eq!(body["errors"][0]["received_at"], "2027-01-15T08:00:00Z");
    }

    #[tokio::test]
    async fn a_missing_observation_instant_falls_back_to_the_trash_clock() {
        let app = app().await;

        app.clone()
            .oneshot(dump(
                WEB_TOKEN,
                json!({ "type": "panic", "full_text": "boom" }),
            ))
            .await
            .expect("response");

        let body = body_of(
            app.oneshot(read("/api/v1/errors", READ_TOKEN))
                .await
                .expect("response"),
        )
        .await;
        assert_eq!(body["errors"][0]["observed_at"], "2027-01-15T08:00:00Z");
    }

    #[tokio::test]
    async fn a_batch_is_stored_in_one_request() {
        let app = app().await;

        let response = app
            .clone()
            .oneshot(dump(
                SHARED_TOKEN,
                json!([
                    { "project": "aiaiaiai-tech/core", "type": "panic", "full_text": "first" },
                    { "project": "aiaiaiai-tech/core", "type": "panic", "full_text": "second" }
                ]),
            ))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::CREATED);
        let body = body_of(response).await;
        assert_eq!(body["stored"], json!(2));
        assert_eq!(body["ids"].as_array().expect("ids").len(), 2);
    }

    #[tokio::test]
    async fn filters_select_one_project_type_and_window() {
        let app = app().await;
        app.clone()
            .oneshot(dump(
                SHARED_TOKEN,
                json!([
                    {
                        "project": "aiaiaiai-tech/core",
                        "type": "panic",
                        "full_text": "old",
                        "observed_at": "2026-01-01T00:00:00Z"
                    },
                    { "project": "nilx-one/web", "type": "http_500", "full_text": "new" }
                ]),
            ))
            .await
            .expect("response");

        for (path, expected) in [
            ("/api/v1/errors?project=nilx-one/web", 1),
            ("/api/v1/errors?type=panic", 1),
            ("/api/v1/errors?since=2027-01-01T00:00:00Z", 1),
            ("/api/v1/errors?until=2026-06-01T00:00:00Z", 1),
            ("/api/v1/errors?limit=1", 1),
            ("/api/v1/errors", 2),
        ] {
            let body = body_of(
                app.clone()
                    .oneshot(read(path, READ_TOKEN))
                    .await
                    .expect("response"),
            )
            .await;
            assert_eq!(
                body["errors"].as_array().expect("errors").len(),
                expected,
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn a_bound_token_cannot_dump_under_another_project() {
        let app = app().await;

        let response = app
            .oneshot(dump(
                WEB_TOKEN,
                json!({
                    "project": "aiaiaiai-tech/core",
                    "type": "panic",
                    "full_text": "boom"
                }),
            ))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(body_of(response).await["error"]["code"], "foreign_project");
    }

    #[tokio::test]
    async fn a_shared_token_must_name_the_reporting_project() {
        let app = app().await;

        let response = app
            .oneshot(dump(
                SHARED_TOKEN,
                json!({ "type": "panic", "full_text": "boom" }),
            ))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_of(response).await["error"]["code"], "project_required");
    }

    #[tokio::test]
    async fn ingest_and_reads_are_closed_without_a_configured_token() {
        let app = app().await;

        for request in [
            dump(
                "unknown-token-that-is-long-enough-here",
                json!({ "type": "panic", "full_text": "boom" }),
            ),
            Request::post("/api/v1/errors")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"type":"panic","full_text":"boom"}"#))
                .expect("valid request"),
            read("/api/v1/errors", "unknown-token-that-is-long-enough-here"),
        ] {
            let response = app.clone().oneshot(request).await.expect("response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[tokio::test]
    async fn reading_stays_disabled_until_a_read_token_is_configured() {
        let app = app_with_read_token(None).await;

        let response = app
            .oneshot(read("/api/v1/errors", READ_TOKEN))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body_of(response).await["error"]["code"], "read_disabled");
    }

    #[tokio::test]
    async fn malformed_dumps_are_named_instead_of_silently_dropped() {
        let app = app().await;
        let cases = [
            (
                json!({ "type": "panic" }),
                StatusCode::BAD_REQUEST,
                "invalid_request_body",
            ),
            (
                json!({ "type": "panic", "full_text": "boom", "extra": 1 }),
                StatusCode::BAD_REQUEST,
                "invalid_request_body",
            ),
            (
                json!({ "type": "  ", "full_text": "boom" }),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_type",
            ),
            (
                json!({ "type": "panic", "full_text": "   " }),
                StatusCode::UNPROCESSABLE_ENTITY,
                "empty_full_text",
            ),
            (
                json!({
                    "type": "panic",
                    "full_text": "boom",
                    "observed_at": "2027-01-15 08:00:00"
                }),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_observed_at",
            ),
            (json!([]), StatusCode::UNPROCESSABLE_ENTITY, "empty_batch"),
        ];

        for (payload, status, code) in cases {
            let response = app
                .clone()
                .oneshot(dump(WEB_TOKEN, payload))
                .await
                .expect("response");
            assert_eq!(response.status(), status);
            assert_eq!(body_of(response).await["error"]["code"], code);
        }
    }

    #[tokio::test]
    async fn an_oversized_batch_is_rejected_whole() {
        let app = app().await;
        let batch = (0..51)
            .map(|index| json!({ "type": "panic", "full_text": format!("boom {index}") }))
            .collect::<Vec<_>>();

        let response = app
            .clone()
            .oneshot(dump(WEB_TOKEN, Value::Array(batch)))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_of(response).await["error"]["code"], "batch_too_large");
        let listed = body_of(
            app.oneshot(read("/api/v1/errors", READ_TOKEN))
                .await
                .expect("response"),
        )
        .await;
        assert_eq!(listed["errors"].as_array().expect("errors").len(), 0);
    }

    #[tokio::test]
    async fn unknown_read_filters_are_rejected() {
        let app = app().await;

        let response = app
            .oneshot(read("/api/v1/errors?severity=fatal", READ_TOKEN))
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_of(response).await["error"]["code"], "invalid_query");
    }

    #[tokio::test]
    async fn health_reports_process_health_without_a_token() {
        let app = app().await;

        let response = app
            .oneshot(
                Request::get("/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
    }
}
