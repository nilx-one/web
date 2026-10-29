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

/// How long a visit may start a new debit: Market's handoff (1 minute),
/// its session (30 minutes) and an order's authorization (15 minutes) fit.
const MARKET_VISIT_SPEND_WINDOW_MS: u64 = 60 * 60 * 1000;

fn valid_market_return_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix('/') else { return false };
    rest.is_empty()
        || rest.strip_suffix('/').is_some_and(|segment| {
            !segment.is_empty()
                && segment.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
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
    if !valid_market_return_path(&return_path) {
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
    let mut handoff = serde_json::json!({"subject": subject, "point": request.point,
        "seeds": seeds, "seeds_authority": "identity_snapshot", "avaia": request.avaia});
    // A purchase needs the session that confirms it. A provider login whose
    // session could not be minted still browses, but cannot buy on this visit.
    if session_hash.len() == 32 {
        let mut bytes = [0_u8; 32];
        if getrandom::fill(&mut bytes).is_err() {
            return unavailable();
        }
        let visit_id = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes);
        let created_ms = now.saturating_mul(1000);
        if let Err(error) = state.repository.create_market_visit(
            &visit_id, &owner, &session_hash, created_ms, created_ms + MARKET_VISIT_SPEND_WINDOW_MS,
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
    if query.visit_id.len() != 43 || query.order_id.len() > 128 { return missing(); }
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
    if !market_return_matches(&query, &visit, &receipt, &order) { return missing(); }
    with_session_cookie(no_store_json(StatusCode::OK, serde_json::json!({
        "confirmed": true, "visit_id": query.visit_id, "order_id": query.order_id,
        "owner": owner.as_str()
    })), cookie)
}

fn market_return_matches(query: &MarketReturnQuery, visit: &crate::repository::MarketVisit,
    receipt: &crate::repository::SpecialSeedsReceipt, order: &crate::market_issuer::IssuerOrder) -> bool {
    let a = &order.attributes;
    order.id == query.order_id && a.status == "fulfilled" && a.issuer == "0x1"
        && a.denomination == "seeds" && a.link_provider == "nilx_visit"
        && a.link_provider_user_id == query.visit_id && a.recipient_subject == visit.recipient_pub_dress
        && receipt.owner_pub_dress == visit.owner.as_str() && receipt.sku == a.sku
        && receipt.price_id == a.price_id && receipt.amount_minor == a.amount_minor
        // The SKU fixes the term. The receipt's duration is what Core's
        // calendar months came to on the clock at the grant, so it is not
        // recomputed from the order: a stacked purchase starts later.
        && a.term.as_ref().is_some_and(|term| term.policy == crate::market_issuer::TERM_POLICY
            && matches!(term.months, 1 | 3 | 6 | 12)
            && a.sku == format!("0x1_special_{}m", term.months))
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

#[cfg(test)]
mod market_visit_tests {
    use super::*;

    #[test]
    fn completion_requires_matching_owner_visit_receipt_and_fulfilment() {
        use crate::repository::{MarketVisit, SpecialSeedsReceipt};
        use crate::market_issuer::{IssuerOrder, IssuerOrderAttributes, IssuerOrderTerm};
        let query = MarketReturnQuery {visit_id: "v".repeat(43), order_id: "order-1234".into()};
        let visit = MarketVisit {owner: "0x0sky".parse().unwrap(), recipient_pub_dress: "0x0old".into(),
            session_token_hash: vec![1;32], spend_until_ms: 1};
        let receipt = SpecialSeedsReceipt {owner_pub_dress: "0x0sky".into(), sku: "0x1_special_1m".into(),
            price_id: 7, amount_minor: 640, duration_ms: 31 * 86_400_000};
        let order = IssuerOrder {id: query.order_id.clone(), attributes: IssuerOrderAttributes {
            sku: receipt.sku.clone(), denomination: "seeds".into(), issuer: "0x1".into(),
            amount_minor: 640, price_id: 7, recipient_subject: "0x0old".into(), link_provider: "nilx_visit".into(),
            link_provider_user_id: query.visit_id.clone(), status: "fulfilled".into(), created_at: "2026-10-29T12:00:00Z".into(),
            term: Some(IssuerOrderTerm {months: 1, policy: "calendar_months_utc".into()}),
        }};
        // Completed purchases survive rename and visit/session expiry.
        assert!(market_return_matches(&query, &visit, &receipt, &order));
        let mutations: [fn(&mut IssuerOrder); 10] = [
            |o| o.attributes.status = "processing".into(), |o| o.attributes.status = "cancelled".into(),
            |o| o.id = "other-order".into(), |o| o.attributes.link_provider_user_id = "w".repeat(43),
            |o| o.attributes.recipient_subject = "0x0other".into(), |o| o.attributes.amount_minor = 1,
            |o| o.attributes.price_id = 8, |o| o.attributes.term = None,
            |o| o.attributes.term.as_mut().unwrap().months = 3, |o| o.attributes.sku = "0x1_special_3m".into(),
        ];
        for mutate in mutations { let mut bad = order.clone(); mutate(&mut bad);
            assert!(!market_return_matches(&query, &visit, &receipt, &bad)); }
        let mut other = receipt.clone(); other.owner_pub_dress = "0x0other".into();
        assert!(!market_return_matches(&query, &visit, &other, &order));
    }


    #[test]
    fn return_path_is_a_host_page_never_a_url() {
        for path in ["/", "/telegram/", "/discord-activity/", "/x1/"] {
            assert!(valid_market_return_path(path), "{path}");
        }
        for path in ["", "telegram/", "/telegram", "//evil.example/", "/a/b/", "/Telegram/", "/te_st/",
            "https://evil.example/", "/%2e%2e/"] {
            assert!(!valid_market_return_path(path), "{path}");
        }
    }
}
