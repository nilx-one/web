// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Moving the active client between an owner's product sessions
//! (`nilx-one/core` `docs/client-activation.md`). Each route hashes the
//! product-session cookie and calls one `PublicInfoRepository` method; Core
//! decides every state, step, percentage, deadline and part. The legacy
//! `/api/v1/session/activation-requests…` routes for native sessions stay in
//! `session_activation.rs`.

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse as _, Response},
    routing::{get, post, put},
};
use nilxone_api::activation::{
    APPROVE_PATH, ActivationRefusal, ActivationState, CANCEL_PATH, COMPLETE_PATH, CompleteRequest,
    DECLINE_PATH, DownloadPartQuery, REQUESTS_PATH, STATE_PATH, SYNC_PART_BYTES, SYNC_PATH,
    UploadPartQuery,
};
use nilxone_identity::public_info::ActivationError;

use super::{
    PRODUCT_SESSION_COOKIE, ProductSignIn, ProductState, csrf_required, not_configured,
    unavailable, valid_csrf,
};
use crate::browser_web_auth::{no_store_error, no_store_json, now_unix_seconds, read_cookie};

/// A raw upload part, which Core bounds at `SYNC_PART_BYTES`.
const SYNC_BODY_BYTES: usize = SYNC_PART_BYTES as usize;

pub(super) fn routes() -> Router<ProductState> {
    Router::new()
        .route(STATE_PATH, get(state))
        .route(REQUESTS_PATH, post(request))
        .route(CANCEL_PATH, post(cancel))
        .route(APPROVE_PATH, post(approve))
        .route(DECLINE_PATH, post(decline))
        .route(
            SYNC_PATH,
            put(upload)
                .layer(DefaultBodyLimit::max(SYNC_BODY_BYTES))
                .get(download),
        )
        .route(COMPLETE_PATH, post(complete))
}

fn refused(refusal: ActivationRefusal) -> Response {
    no_store_error(
        StatusCode::from_u16(refusal.http_status()).unwrap_or(StatusCode::CONFLICT),
        refusal.code(),
        "The activation step was refused.",
    )
}

fn answer<T>(result: Result<T, ActivationError>, ok: impl FnOnce(T) -> Response) -> Response {
    match result {
        Ok(value) => ok(value),
        Err(ActivationError::Refused(refusal)) => refused(refusal),
        Err(ActivationError::Storage(_)) => unavailable(),
    }
}

fn state_answer(status: StatusCode, result: Result<ActivationState, ActivationError>) -> Response {
    answer(result, |state| no_store_json(status, state))
}

/// What every route starts from: the configured service, the clock and the
/// digest of this browser's product-session token. Core answers a digest it
/// cannot find with `provider_authentication_required`; a missing cookie is
/// answered the same way here.
struct Caller<'a> {
    sign_in: &'a ProductSignIn,
    token_hash: String,
    now: u64,
}

fn caller<'a>(
    state: &'a ProductState,
    headers: &HeaderMap,
    writes: bool,
) -> Result<Caller<'a>, Box<Response>> {
    let Some(sign_in) = state.sign_in.as_ref() else {
        return Err(Box::new(not_configured()));
    };
    if writes && !valid_csrf(headers) {
        return Err(Box::new(csrf_required()));
    }
    let Some(now) = now_unix_seconds() else {
        return Err(Box::new(unavailable()));
    };
    let Some(token) = read_cookie(headers, PRODUCT_SESSION_COOKIE) else {
        return Err(Box::new(refused(ActivationRefusal::AuthenticationRequired)));
    };
    Ok(Caller {
        token_hash: sign_in.token_hash(&token),
        sign_in,
        now,
    })
}

macro_rules! caller {
    ($state:expr, $headers:expr, $writes:expr) => {
        match caller(&$state, &$headers, $writes) {
            Ok(caller) => caller,
            Err(response) => return *response,
        }
    };
}

async fn state(State(state): State<ProductState>, headers: HeaderMap) -> Response {
    let caller = caller!(state, headers, false);
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::OK,
        repository
            .activation_state(&caller.token_hash, caller.now)
            .await,
    )
}

async fn request(State(state): State<ProductState>, headers: HeaderMap) -> Response {
    let caller = caller!(state, headers, true);
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::CREATED,
        repository
            .request_activation(&caller.token_hash, caller.now)
            .await,
    )
}

async fn cancel(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let caller = caller!(state, headers, true);
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::OK,
        repository
            .cancel_activation(&caller.token_hash, &id, caller.now)
            .await,
    )
}

async fn approve(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let caller = caller!(state, headers, true);
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::OK,
        repository
            .approve_activation(&caller.token_hash, &id, caller.now)
            .await,
    )
}

async fn decline(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let caller = caller!(state, headers, true);
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::OK,
        repository
            .decline_activation(&caller.token_hash, &id, caller.now)
            .await,
    )
}

async fn upload(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(part): Query<UploadPartQuery>,
    body: Bytes,
) -> Response {
    let caller = caller!(state, headers, true);
    if let Err(refusal) = part.validate(body.len()) {
        return refused(refusal);
    }
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::OK,
        repository
            .upload_activation_sync_part(&caller.token_hash, &id, part, &body, caller.now)
            .await,
    )
}

async fn download(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(part): Query<DownloadPartQuery>,
) -> Response {
    let caller = caller!(state, headers, false);
    let repository = caller.sign_in.service.repository();
    answer(
        repository
            .download_activation_sync_part(&caller.token_hash, &id, part.offset, caller.now)
            .await,
        |bytes| {
            let mut response = (StatusCode::OK, bytes).into_response();
            let headers = response.headers_mut();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        },
    )
}

async fn complete(
    State(state): State<ProductState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<CompleteRequest>,
) -> Response {
    let caller = caller!(state, headers, true);
    let digest = match request.validate() {
        Ok(digest) => digest,
        Err(refusal) => return refused(refusal),
    };
    let repository = caller.sign_in.service.repository();
    state_answer(
        StatusCode::OK,
        repository
            .complete_activation(&caller.token_hash, &id, digest, caller.now)
            .await,
    )
}
