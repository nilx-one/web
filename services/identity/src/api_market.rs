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
    let (identity, active, _, cookie) = match authenticated_bond(&state, &headers, now).await {
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
    if state.limiter.consume(format!("market-visit:{}", identity.pub_dress), now, 10, 60).is_err() {
        return api_error(StatusCode::TOO_MANY_REQUESTS, "market_visit_limit", "Please retry later.");
    }
    let owner = match PubDress::from_str(&identity.pub_dress) {
        Ok(owner) => owner,
        Err(_) => return unavailable(),
    };
    // Read exactly the same server-owned wallet the issuer debits.
    // Do not forward the browser's legacy inventory number to the Market.
    let seeds = match state.repository.read_seeds_balance(&owner).await {
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
    let subject = match state.repository.market_pairwise_subject(&identity.pub_dress).await {
        Ok(value) => state.secret_digester.digest("market-pairwise-subject-v1", &value),
        Err(_) => return unavailable(),
    };
    let subject = subject.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none()).build() {
        Ok(client) => client,
        Err(_) => return unavailable(),
    };
    let result = client.post("https://0xda-market.nilx.one/nilx-browser/handoffs")
        .bearer_auth(token)
        .json(&serde_json::json!({"subject": subject, "point": request.point,
            "seeds": seeds, "seeds_authority": "identity_snapshot", "avaia": request.avaia}))
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
        "code": code, "action": "https://0xda-market.nilx.one/nilx-browser/exchange"
    })), cookie)
}
