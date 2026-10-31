// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MarketVisitRequest {
    point: String,
    // Legacy client inventory hint; ignored for all economy authority.
    #[serde(default, rename = "seeds")]
    _untrusted_seeds: Option<String>,
    avaia: MarketVisitPosition,
    /// The host page the buyer returns to, e.g. `/telegram/`. Never a URL.
    #[serde(default)]
    return_path: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct MarketVisitPosition {
    longitude: f64,
    latitude: f64,
}

async fn create_market_visit(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<MarketVisitRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, session_hash, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    if !active {
        return with_session_cookie(session_inactive(), cookie);
    }
    if request.point.is_empty() || request.point.chars().count() > 64
        || !request.point.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        || !(-180.0..=180.0).contains(&request.avaia.longitude)
        || !(-90.0..=90.0).contains(&request.avaia.latitude)
    {
        return api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_market_context", "Invalid market visit context.");
    }
    let return_path = request.return_path.unwrap_or_else(|| "/".to_owned());
    if !crate::market_visit::is_market_return_path(&return_path) {
        return api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_market_context", "Invalid market visit context.");
    }
    if state.limiter.consume(format!("market-visit:{}", identity.pub_dress), now, 10, 60).is_err() {
        return api_error(StatusCode::TOO_MANY_REQUESTS, "market_visit_limit", "Please retry later.");
    }
    let owner = match PubDress::from_str(&identity.pub_dress) {
        Ok(owner) => owner,
        Err(_) => return unavailable(),
    };
    // Read exactly the same server-owned wallet the issuer debits.
    // Do not forward the browser's legacy inventory number to the Market.
    let seeds = match state.repository.read_seeds_balance_with_starter(&owner, now.saturating_mul(1000)).await {
        Ok(balance) => balance.to_string(),
        Err(error) => {
            tracing::error!(%error, "market-visit seeds lookup failed");
            return unavailable();
        }
    };
    let token = match std::env::var("NILX_BROWSER_HANDOFF_TOKEN") {
        Ok(value) if value.len() >= 32 => value,
        _ => return unavailable(),
    };
    // Derive a partner-specific identifier. Never disclose the private subject.
    let subject = match state.repository.market_pairwise_subject(&identity.pub_dress, &state.secret_digester).await {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let subject = subject.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let mut handoff = serde_json::json!({"subject": subject, "point": request.point,
        "seeds": seeds, "seeds_authority": "identity_snapshot", "avaia": request.avaia});
    // A purchase needs the session that confirms it. A provider login whose
    // session could not be minted still browses, but cannot buy on this visit.
    if session_hash.len() == 32 {
        let Ok(visit_id) = crate::market_visit::new_market_visit_id() else {
            return unavailable();
        };
        let created_ms = now.saturating_mul(1000);
        if let Err(error) = state.repository.create_market_visit(
            &visit_id, &owner, &session_hash, created_ms, created_ms + crate::market_visit::MARKET_VISIT_SPEND_WINDOW_MS,
        ).await {
            tracing::error!(%error, "market visit binding failed");
            return unavailable();
        }
        handoff["visit_id"] = serde_json::Value::String(visit_id);
        handoff["recipient"] = serde_json::Value::String(owner.as_str().to_owned());
        handoff["return_path"] = serde_json::Value::String(return_path);
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none()).build() {
        Ok(client) => client,
        Err(_) => return unavailable(),
    };
    let result = client.post("https://0xda-market.nilx.one/nilx-browser/handoffs")
        .bearer_auth(token)
        .json(&handoff)
        .send().await;
    let response = match result {
        Ok(response) if response.status().as_u16() == 201 => response,
        _ => return unavailable(),
    };
    let body: serde_json::Value = match response.json().await {
        Ok(body) => body,
        Err(_) => return unavailable(),
    };
    let Some(code) = body.get("code").and_then(|v| v.as_str()) else { return unavailable(); };
    if code.len() != 43 || !code.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return unavailable();
    }
    with_session_cookie(no_store_json(StatusCode::CREATED, serde_json::json!({
        "code": code, "visit_id": handoff.get("visit_id"), "owner": owner.as_str(), "action": "https://0xda-market.nilx.one/nilx-browser/exchange"
    })), cookie)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MarketReturnQuery { visit_id: String, order_id: String }

/// A navigation hint is never payment proof. Check both the committed Identity
/// receipt and the authenticated Market fulfilment, tied to this owner's visit.
async fn read_market_return(State(state): State<ApiState>, headers: HeaderMap,
    Query(query): Query<MarketReturnQuery>) -> Response {
    use crate::market_issuer::{HttpMarketIssuer, MarketIssuerConfig};
    let now = match now(&state) { Ok(now) => now, Err(_) => return unavailable() };
    let (identity, _, _, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else { return unavailable(); };
    let missing = || api_error(StatusCode::NOT_FOUND, "purchase_not_confirmed", "Purchase is not confirmed.");
    if !crate::market_visit::is_market_visit_id(&query.visit_id)
        || !crate::market_visit::is_market_order_id(&query.order_id) { return missing(); }
    let visit = match state.repository.find_market_visit(&query.visit_id).await {
        Ok(Some(visit)) if visit.owner == owner => visit,
        Ok(_) => return missing(), Err(_) => return unavailable(),
    };
    let receipt = match state.repository.find_special_seeds_receipt(&query.order_id).await {
        Ok(Some(receipt)) if receipt.owner_pub_dress == owner.as_str() => receipt,
        Ok(_) => return missing(), Err(_) => return unavailable(),
    };
    if state.limiter.consume(format!("market-return:{}", owner.as_str()), now, 30, 60).is_err() {
        return api_error(StatusCode::TOO_MANY_REQUESTS, "market_return_limit", "Please retry later.");
    }
    let Some(Ok(config)) = MarketIssuerConfig::from_environment() else { return unavailable(); };
    let market = match HttpMarketIssuer::new(config) { Ok(client) => client, Err(_) => return unavailable() };
    let order = match market.read_order(&query.order_id).await {
        Ok(order) => order, Err(_) => return unavailable(),
    };
    let claim = crate::market_visit::MarketReturn { visit_id: &query.visit_id, order_id: &query.order_id };
    if !crate::market_visit::market_return_confirmed(claim, &visit, &receipt, &order) { return missing(); }
    with_session_cookie(no_store_json(StatusCode::OK, serde_json::json!({
        "confirmed": true, "visit_id": query.visit_id, "order_id": query.order_id,
        "owner": owner.as_str()
    })), cookie)
}

async fn read_subscription(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) { Ok(now) => now, Err(_) => return unavailable() };
    let (identity, _, _, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else { return unavailable(); };
    let now_ms = now.saturating_mul(1000);
    let clock = match state.repository.read_subscription_clock(&owner, now_ms).await {
        Ok(clock) => clock, Err(_) => return unavailable(),
    };
    match clock.snapshot(now_ms, now_ms.saturating_add(30_000)) {
        Ok(snapshot) => with_session_cookie(no_store_json(StatusCode::OK, serde_json::json!(snapshot)), cookie),
        Err(_) => unavailable(),
    }
}
