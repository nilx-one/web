// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Committed awards and claims on rare finds (docs/avaia-outings.md, R3).
//
// An award arrives as its commitment and what the service prices it by: the
// kind, the earner and, for a pick-up, the tier. It never carries an amount;
// the service prices it. Only a pick-up of a claimed tier names a find, by
// its `artifactId`, which the service rolls itself before it claims it. The
// totals stay `authority: "client"`: a commitment proves the device kept a
// record, not that the play happened.

const MAX_AWARDS: usize = 64;
const MAX_CLAIM_BUCKETS: usize = 16;

async fn commit_awards(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CommitAwardsRequest>,
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
    let mut response = commit_awards_response(&state, &identity, &request, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn commit_awards_response(
    state: &ApiState,
    identity: &IdentityRecord,
    request: &CommitAwardsRequest,
    now: u64,
) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    let Some(now_ms) = now.checked_mul(1000).and_then(|ms| i64::try_from(ms).ok()) else {
        return unavailable();
    };
    let Some(awards) = validate_awards(request, now_ms) else {
        return no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_awards",
            "An award is a commitment, a kind its earner can earn, and nothing that names a place but a real rare find.",
        );
    };
    if let Err(retry_after) = state
        .limiter
        .consume(format!("pub-info:{}", owner.as_str()), now, 120, 3600)
        .and_then(|_| state.limiter.consume("pub-info:global", now, 5_000, 3600))
    {
        return rate_limited(retry_after);
    }
    match state
        .repository
        .commit_awards(&owner, &awards, crate::finds::epoch_of(now_ms), now)
        .await
    {
        Ok((experience, outcomes)) => no_store_json(
            StatusCode::OK,
            CommitAwardsResponse {
                experience: experience_response(experience).experience,
                results: awards
                    .iter()
                    .zip(outcomes)
                    .map(|(award, outcome)| AwardResult {
                        id: award.id.clone(),
                        outcome: outcome.as_str(),
                        head: match outcome {
                            crate::repository::AwardOutcome::Behind { head } => head,
                            _ => None,
                        },
                    })
                    .collect(),
            },
        ),
        Err(error) => {
            tracing::error!(%error, "committing awards failed");
            unavailable()
        }
    }
}

fn validate_awards(
    request: &CommitAwardsRequest,
    now_ms: i64,
) -> Option<Vec<crate::repository::CommittedAward>> {
    use crate::finds::{self, AwardKind};

    if request.awards.len() > MAX_AWARDS {
        return None;
    }
    let mut awards = Vec::with_capacity(request.awards.len());
    for body in &request.awards {
        if !valid_commitment(&body.id)
            || !body.parent.as_deref().is_none_or(valid_commitment)
            || !valid_chain(&body.chain)
        {
            return None;
        }
        let kind = AwardKind::parse(&body.kind)?;
        let earner = crate::repository::ExperienceEarner::parse(&body.earner)?;
        let finds_earner = match earner {
            crate::repository::ExperienceEarner::Bond => finds::Earner::Bond,
            crate::repository::ExperienceEarner::Avaia => finds::Earner::Avaia,
        };
        let amount = finds::award_amount(kind, finds_earner, body.tier)?;
        let claimed = body.tier.is_some_and(|tier| tier >= finds::CLAIMED_MIN_TIER);
        let claim = match (&body.artifact_id, claimed) {
            (Some(artifact_id), true) => {
                let roll = finds::roll_artifact(finds::FIND_PACK_ID, artifact_id).ok()?;
                if Some(roll.tier) != body.tier || !finds::claimable_epoch(roll.epoch, now_ms) {
                    return None;
                }
                Some(crate::repository::FindClaim {
                    artifact_sha: finds::artifact_sha(artifact_id),
                    epoch: roll.epoch,
                    tier: roll.tier,
                })
            }
            // A claimed pick-up has to name its find, and nothing else may
            // name one: a common find stays on the device.
            (None, true) | (Some(_), false) => return None,
            (None, false) => None,
        };
        // A claimed pick-up named its find: it pays what that item is worth,
        // not its tier. Everything else is the tier's price above.
        let amount = match (&claim, &body.artifact_id) {
            (Some(_), Some(artifact_id)) if kind == AwardKind::FindPickedUp => {
                finds::pick_up_amount(Some(artifact_id), body.tier?)?
            }
            _ => amount,
        };
        awards.push(crate::repository::CommittedAward {
            id: body.id.clone(),
            parent: body.parent.clone(),
            chain: body.chain.clone(),
            kind: kind.as_str(),
            tier: body.tier.unwrap_or(0),
            earner,
            amount,
            weekly_cap: finds::weekly_cap(kind, body.tier),
            claim,
        });
    }
    Some(awards)
}

/// `xp:` and 43 base64url characters: an HMAC-SHA-256, as `commitAward`
/// writes it. It names nothing the service can read back.
fn valid_commitment(id: &str) -> bool {
    id.strip_prefix("xp:").is_some_and(|mac| {
        mac.len() == 43
            && mac
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

/// `ch:` and 8 to 43 base64url characters: a device chain's random name.
fn valid_chain(chain: &str) -> bool {
    chain.strip_prefix("ch:").is_some_and(|name| {
        (8..=43).contains(&name.len())
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

async fn read_claims(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ClaimsQuery>,
) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, _active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    let mut response = read_claims_response(&state, &identity, &query, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn read_claims_response(
    state: &ApiState,
    identity: &IdentityRecord,
    query: &ClaimsQuery,
    now: u64,
) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    let Some(buckets) = parse_buckets(&query.buckets) else {
        return no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_buckets",
            "Ask for up to sixteen sha buckets, two lowercase hex digits each.",
        );
    };
    if let Err(retry_after) = state
        .limiter
        .consume(format!("find-claims:{}", owner.as_str()), now, 60, 3600)
        .and_then(|_| state.limiter.consume("find-claims:global", now, 5_000, 3600))
    {
        return rate_limited(retry_after);
    }
    let Some(now_ms) = now.checked_mul(1000).and_then(|ms| i64::try_from(ms).ok()) else {
        return unavailable();
    };
    let epoch = crate::finds::epoch_of(now_ms);
    match state.repository.read_claims(&owner, epoch, &buckets).await {
        Ok(claims) => no_store_json(
            StatusCode::OK,
            ClaimsResponse {
                epoch,
                claims: claims
                    .into_iter()
                    .map(|claim| ClaimBody {
                        sha: claim.artifact_sha,
                        yours: claim.yours,
                    })
                    .collect(),
            },
        ),
        Err(error) => {
            tracing::error!(%error, "reading claims failed");
            unavailable()
        }
    }
}

/// Comma-separated buckets, each two lowercase hex digits, each once.
fn parse_buckets(text: &str) -> Option<Vec<u8>> {
    let mut buckets = std::collections::BTreeSet::new();
    for part in text.split(',') {
        let bytes = part.as_bytes();
        if bytes.len() != 2 || !bytes.iter().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
            return None;
        }
        buckets.insert(u8::from_str_radix(part, 16).ok()?);
    }
    (buckets.len() <= MAX_CLAIM_BUCKETS).then(|| buckets.into_iter().collect())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CommitAwardsRequest {
    awards: Vec<AwardBody>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AwardBody {
    id: String,
    #[serde(default)]
    parent: Option<String>,
    chain: String,
    kind: String,
    earner: String,
    #[serde(default)]
    tier: Option<u8>,
    #[serde(default)]
    artifact_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct CommitAwardsResponse {
    experience: ExperienceBody,
    results: Vec<AwardResult>,
}

#[derive(Debug, Serialize)]
struct AwardResult {
    id: String,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    head: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClaimsQuery {
    buckets: String,
}

#[derive(Debug, Serialize)]
struct ClaimsResponse {
    epoch: i64,
    claims: Vec<ClaimBody>,
}

#[derive(Debug, Serialize)]
struct ClaimBody {
    sha: String,
    yours: bool,
}
