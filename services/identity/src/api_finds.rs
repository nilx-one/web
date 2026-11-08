// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Attested finds, their sale and paid crafts (nilx-one/core
// docs/find-attestation.md). Core verifies the find, names the item and its
// prices, and keeps the ledger; this adapter authenticates the Bond, checks
// CSRF and the active client, and rate-limits. No request carries an amount.

use crate::repository::{AttestOutcome, CraftOutcome, SaleOutcome};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttestRequest {
    artifact_id: String,
    finder: String,
    found_at_ms: i64,
    longitude: f64,
    latitude: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SellRequest {
    attestation_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CraftRequest {
    craft_id: String,
    recipe: String,
    #[serde(default)]
    inputs: Vec<String>,
}

/// Every route here: CSRF, an authenticated and active Bond, a rate limit.
async fn finds_caller(
    state: &ApiState,
    headers: &HeaderMap,
    bucket: &str,
) -> Result<(PubDress, Vec<u8>, u64, Option<String>), Box<Response>> {
    if let Some(response) = reject_missing_csrf(headers) {
        return Err(Box::new(response));
    }
    let now = now(state).map_err(|_| Box::new(unavailable()))?;
    let (identity, active, token_hash, cookie) = authenticated_bond(state, headers, now)
        .await
        .map_err(|error| Box::new(error.into_response()))?;
    if !active {
        return Err(Box::new(with_session_cookie(session_inactive(), cookie)));
    }
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return Err(Box::new(unavailable()));
    };
    if let Err(retry_after) = state
        .limiter
        .consume(format!("{bucket}:{}", owner.as_str()), now, 1_200, 3_600)
        .and_then(|_| state.limiter.consume(format!("{bucket}:global"), now, 100_000, 3_600))
    {
        return Err(Box::new(with_session_cookie(rate_limited(retry_after), cookie)));
    }
    Ok((owner, token_hash, now, cookie))
}

fn degrees_e7(value: f64, limit: f64) -> Option<i32> {
    if !value.is_finite() || value.abs() > limit {
        return None;
    }
    #[allow(clippy::cast_possible_truncation)]
    Some((value * 1e7).round() as i32)
}

async fn attest_find(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AttestRequest>,
) -> Response {
    let (owner, _session, now, cookie) = match finds_caller(&state, &headers, "finds-attest").await {
        Ok(caller) => caller,
        Err(response) => return *response,
    };
    let response = attest_find_response(&state, &owner, request, now).await;
    with_session_cookie(response, cookie)
}

async fn attest_find_response(
    state: &ApiState,
    owner: &PubDress,
    request: AttestRequest,
    now: u64,
) -> Response {
    let invalid = || {
        no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_pickup",
            "A pick-up names a find, its finder, a time and a place.",
        )
    };
    let (Some(finder), Some(longitude_e7), Some(latitude_e7)) = (
        crate::find_attestation::Finder::parse(&request.finder),
        degrees_e7(request.longitude, 180.0),
        degrees_e7(request.latitude, 90.0),
    ) else {
        return invalid();
    };
    if request.artifact_id.len() > 96 {
        return invalid();
    }
    let Some(now_ms) = now.checked_mul(1000) else {
        return unavailable();
    };
    let Ok(now_ms_signed) = i64::try_from(now_ms) else {
        return unavailable();
    };
    let reported = crate::find_attestation::ReportedPickup {
        artifact_id: request.artifact_id,
        finder,
        found_at_ms: request.found_at_ms,
        longitude_e7,
        latitude_e7,
    };
    let verified = match crate::find_attestation::verify_pickup(reported, now_ms_signed) {
        Ok(verified) => verified,
        Err(refusal) => {
            return no_store_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                refusal.code(),
                "This pick-up is not one the service can attest.",
            );
        }
    };
    match state.repository.attest_pickup(owner, &verified, now_ms).await {
        Ok(AttestOutcome::Attested { attestation_id, item_id, pickup_credit }) => no_store_json(
            StatusCode::OK,
            serde_json::json!({
                "outcome": "attested",
                "attestation_id": attestation_id,
                "item_id": item_id,
                "seeds_credited": pickup_credit.to_string(),
            }),
        ),
        Ok(AttestOutcome::AlreadyYours { attestation_id, item_id }) => no_store_json(
            StatusCode::OK,
            serde_json::json!({
                "outcome": "already_yours",
                "attestation_id": attestation_id,
                "item_id": item_id,
                "seeds_credited": "0",
            }),
        ),
        Ok(AttestOutcome::Taken) => no_store_error(
            StatusCode::CONFLICT,
            "taken",
            "Another Bond picked this find up first.",
        ),
        Err(error) => {
            tracing::error!(%error, "attesting a pick-up failed");
            unavailable()
        }
    }
}

async fn sell_find(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<SellRequest>,
) -> Response {
    let (owner, _session, now, cookie) = match finds_caller(&state, &headers, "finds-sell").await {
        Ok(caller) => caller,
        Err(response) => return *response,
    };
    let Some(now_ms) = now.checked_mul(1000) else {
        return unavailable();
    };
    let response = if request.attestation_id.len() == 36 {
        match state.repository.sell_attested(&owner, &request.attestation_id, now_ms).await {
            Ok(SaleOutcome::Sold { credit }) => no_store_json(
                StatusCode::OK,
                serde_json::json!({ "outcome": "sold", "seeds_credited": credit.to_string() }),
            ),
            Ok(SaleOutcome::AlreadySold { credit }) => no_store_json(
                StatusCode::OK,
                serde_json::json!({ "outcome": "already_sold", "seeds_credited": credit.to_string() }),
            ),
            Ok(SaleOutcome::Unknown) => no_store_error(
                StatusCode::NOT_FOUND,
                "unknown_attestation",
                "No attested find of this Bond has that id.",
            ),
            Ok(SaleOutcome::NotForSale) => no_store_error(
                StatusCode::CONFLICT,
                "not_for_sale",
                "Nobody buys this.",
            ),
            Ok(SaleOutcome::UsedUp) => no_store_error(
                StatusCode::CONFLICT,
                "used_up",
                "This find was used up in a craft or repair.",
            ),
            Err(error) => {
                tracing::error!(%error, "selling an attested find failed");
                unavailable()
            }
        }
    } else {
        no_store_error(
            StatusCode::NOT_FOUND,
            "unknown_attestation",
            "No attested find of this Bond has that id.",
        )
    };
    with_session_cookie(response, cookie)
}

async fn start_craft(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CraftRequest>,
) -> Response {
    let (owner, session, now, cookie) = match finds_caller(&state, &headers, "crafts").await {
        Ok(caller) => caller,
        Err(response) => return *response,
    };
    let Some(now_ms) = now.checked_mul(1000) else {
        return unavailable();
    };
    if !(8..=64).contains(&request.craft_id.len())
        || !request.craft_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || request.inputs.len() > 8
    {
        return with_session_cookie(
            no_store_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_craft",
                "A craft names its id, its recipe and the attested finds it uses up.",
            ),
            cookie,
        );
    }
    let response = match state
        .repository
        .start_craft_with_seeds(&owner, &session, &request.craft_id, &request.recipe, &request.inputs, now_ms)
        .await
    {
        Ok(CraftOutcome::Started { seeds }) => no_store_json(
            StatusCode::OK,
            serde_json::json!({ "outcome": "started", "seeds_debited": seeds.to_string() }),
        ),
        Ok(CraftOutcome::AlreadyStarted { seeds }) => no_store_json(
            StatusCode::OK,
            serde_json::json!({ "outcome": "already_started", "seeds_debited": seeds.to_string() }),
        ),
        Ok(CraftOutcome::SessionChanged) => session_inactive(),
        Ok(CraftOutcome::UnknownRecipe) => no_store_error(
            StatusCode::NOT_FOUND,
            "unknown_recipe",
            "Core has no such recipe.",
        ),
        Ok(refused) => no_store_error(
            StatusCode::CONFLICT,
            refused.code(),
            "Core refused this craft; nothing was debited.",
        ),
        Err(error) => {
            tracing::error!(%error, "paying for a craft failed");
            unavailable()
        }
    };
    with_session_cookie(response, cookie)
}
