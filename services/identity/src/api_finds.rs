// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Attested finds, their sale and paid crafts (nilx-one/core
// docs/find-attestation.md). Core verifies the find, names the item and its
// prices, and keeps the ledger; this adapter authenticates the Bond, checks
// CSRF and the active client, and rate-limits. No request carries an amount.

use crate::repository::{AttestOutcome, CraftOutcome, SaleOutcome};
// The routes' bodies, their error codes and the shape rules are nilx-one/core's
// `nilxone-api`; this adapter only authenticates and answers with its types.
use nilxone_api::finds::{self as wire, AttestRequest, CraftRequest, SellRequest};

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

/// An answer in the contract's own type: the service never writes the JSON by hand.
fn wire_answer<T: Serialize>(answer: &T) -> Response {
    no_store_json(StatusCode::OK, answer)
}

/// An error body with the status and code the contract pins for `code`.
fn refused(status: u16, code: &'static str, message: &'static str) -> Response {
    no_store_error(
        StatusCode::from_u16(status).unwrap_or(StatusCode::UNPROCESSABLE_ENTITY),
        code,
        message,
    )
}

fn invalid_pickup() -> Response {
    let refusal = wire::AttestRefusal::InvalidPickup;
    refused(
        refusal.http_status(),
        refusal.code(),
        "A pick-up names a find, its finder, a time and a place.",
    )
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
    let Ok(pickup) = request.validate() else {
        return invalid_pickup();
    };
    let Some(finder) = crate::find_attestation::Finder::parse(pickup.finder.as_str()) else {
        return invalid_pickup();
    };
    let Some(now_ms) = now.checked_mul(1000) else {
        return unavailable();
    };
    let Ok(now_ms_signed) = i64::try_from(now_ms) else {
        return unavailable();
    };
    let reported = crate::find_attestation::ReportedPickup {
        artifact_id: pickup.artifact_id,
        finder,
        found_at_ms: pickup.found_at_ms,
        longitude_e7: pickup.longitude_e7,
        latitude_e7: pickup.latitude_e7,
    };
    let verified = match crate::find_attestation::verify_pickup(reported, now_ms_signed) {
        Ok(verified) => verified,
        Err(refusal) => {
            let status = wire::AttestRefusal::from_code(refusal.code())
                .map_or(422, wire::AttestRefusal::http_status);
            return refused(status, refusal.code(), "This pick-up is not one the service can attest.");
        }
    };
    match state.repository.attest_pickup(owner, &verified, now_ms).await {
        Ok(AttestOutcome::Attested { attestation_id, item_id, pickup_credit }) => {
            attest_answer(wire::AttestOutcome::Attested, attestation_id, item_id, pickup_credit)
        }
        Ok(AttestOutcome::AlreadyYours { attestation_id, item_id }) => {
            attest_answer(wire::AttestOutcome::AlreadyYours, attestation_id, item_id, 0)
        }
        Ok(AttestOutcome::Taken) => {
            let refusal = wire::AttestRefusal::Taken;
            refused(
                refusal.http_status(),
                refusal.code(),
                "Another Bond picked this find up first.",
            )
        }
        Err(error) => {
            tracing::error!(%error, "attesting a pick-up failed");
            unavailable()
        }
    }
}

fn attest_answer(
    outcome: wire::AttestOutcome,
    attestation_id: String,
    item_id: String,
    credited: u64,
) -> Response {
    // Ids the repository mints always have the contract's shape; one that does
    // not is a fault here, not something to pass to a client.
    let (Ok(attestation_id), Ok(item_id)) =
        (wire::AttestationId::try_from(attestation_id), wire::ItemId::try_from(item_id))
    else {
        tracing::error!("the repository returned an id the contract does not allow");
        return unavailable();
    };
    wire_answer(&wire::AttestAnswer {
        outcome,
        attestation_id,
        item_id,
        seeds_credited: wire::Seeds(credited),
    })
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
    let response = if let Err(refusal) = request.validate() {
        sale_refused(refusal, "No attested find of this Bond has that id.")
    } else {
        match state.repository.sell_attested(&owner, &request.attestation_id, now_ms).await {
            Ok(SaleOutcome::Sold { credit }) => wire_answer(&wire::SellAnswer {
                outcome: wire::SaleOutcome::Sold,
                seeds_credited: wire::Seeds(credit),
            }),
            Ok(SaleOutcome::AlreadySold { credit }) => wire_answer(&wire::SellAnswer {
                outcome: wire::SaleOutcome::AlreadySold,
                seeds_credited: wire::Seeds(credit),
            }),
            Ok(SaleOutcome::Unknown) => sale_refused(
                wire::SaleRefusal::UnknownAttestation,
                "No attested find of this Bond has that id.",
            ),
            Ok(SaleOutcome::NotForSale) => {
                sale_refused(wire::SaleRefusal::NotForSale, "Nobody buys this.")
            }
            Ok(SaleOutcome::UsedUp) => sale_refused(
                wire::SaleRefusal::UsedUp,
                "This find was used up in a craft or repair.",
            ),
            Err(error) => {
                tracing::error!(%error, "selling an attested find failed");
                unavailable()
            }
        }
    };
    with_session_cookie(response, cookie)
}

fn sale_refused(refusal: wire::SaleRefusal, message: &'static str) -> Response {
    refused(refusal.http_status(), refusal.code(), message)
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
    if let Err(refusal) = request.validate() {
        return with_session_cookie(
            refused(
                refusal.http_status(),
                refusal.code(),
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
        Ok(CraftOutcome::Started { seeds }) => wire_answer(&wire::CraftAnswer {
            outcome: wire::CraftStart::Started,
            seeds_debited: wire::Seeds(seeds),
        }),
        Ok(CraftOutcome::AlreadyStarted { seeds }) => wire_answer(&wire::CraftAnswer {
            outcome: wire::CraftStart::AlreadyStarted,
            seeds_debited: wire::Seeds(seeds),
        }),
        Ok(CraftOutcome::SessionChanged) => session_inactive(),
        Ok(CraftOutcome::UnknownRecipe) => {
            let refusal = wire::CraftRefusal::UnknownRecipe;
            refused(refusal.http_status(), refusal.code(), "Core has no such recipe.")
        }
        Ok(refused_by_core) => {
            let status = wire::CraftRefusal::from_code(refused_by_core.code())
                .map_or(409, wire::CraftRefusal::http_status);
            refused(status, refused_by_core.code(), "Core refused this craft; nothing was debited.")
        }
        Err(error) => {
            tracing::error!(%error, "paying for a craft failed");
            unavailable()
        }
    };
    with_session_cookie(response, cookie)
}

/// The contract in `nilxone-api` and the codes Core's repository answers with
/// are written apart; these keep them equal until they share one definition.
#[cfg(test)]
mod wire_contract {
    use super::*;
    use crate::find_attestation::PickupRefusal;

    #[test]
    fn every_refusal_core_can_answer_is_in_the_contract() {
        for refusal in [
            PickupRefusal::UnknownFind,
            PickupRefusal::OutOfTime,
            PickupRefusal::TooFar,
            PickupRefusal::NotTheAvaias,
        ] {
            assert!(wire::AttestRefusal::from_code(refusal.code()).is_some(), "{}", refusal.code());
        }
        for outcome in [
            CraftOutcome::ConflictingReplay,
            CraftOutcome::UnknownRecipe,
            CraftOutcome::UnverifiableInputs,
            CraftOutcome::WrongInputs,
            CraftOutcome::InsufficientSeeds,
        ] {
            assert!(wire::CraftRefusal::from_code(outcome.code()).is_some(), "{}", outcome.code());
        }
    }

    #[test]
    fn the_routes_are_the_contracts_paths() {
        assert_eq!(wire::ATTEST_PATH, "/api/v1/identity/finds/attest");
        assert_eq!(wire::SELL_PATH, "/api/v1/identity/finds/sell");
        assert_eq!(wire::CRAFT_PATH, "/api/v1/identity/crafts");
    }
}
