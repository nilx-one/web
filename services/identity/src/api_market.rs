// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// The bodies, error codes and shape rules of the visit and return routes are
// nilx-one/core's `nilxone-api`; this adapter authenticates, talks to Market
// and answers with the contract's types.
use nilxone_api::market::{
    HandoffCode, ReturnAnswer, ReturnQuery, ReturnRefusal, VisitAnswer, VisitRefusal, VisitRequest,
};

// The browser Market handoff is a server-controlled outbound authority, not
// an arbitrary redirect supplied by the game or Telegram. Development must
// choose its own HTTPS origin rather than silently reaching production.
const PRODUCTION_MARKET_BROWSER_ORIGIN: &str = "https://0xda-market.nilx.one";

#[derive(Debug, PartialEq, Eq)]
struct MarketBrowserEndpoints {
    handoffs: url::Url,
    exchange: url::Url,
}

fn market_browser_endpoints(
    deploy_env: Option<&str>,
    configured_origin: Option<&str>,
) -> Option<MarketBrowserEndpoints> {
    let origin = match (deploy_env, configured_origin) {
        (Some("development"), Some(value))
            if value != PRODUCTION_MARKET_BROWSER_ORIGIN => value,
        (Some("development"), _) => return None,
        (_, Some(_)) => return None,
        (_, None) => PRODUCTION_MARKET_BROWSER_ORIGIN,
    };
    let url = url::Url::parse(origin).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return None;
    }
    Some(MarketBrowserEndpoints {
        handoffs: url.join("/nilx-browser/handoffs").ok()?,
        exchange: url.join("/nilx-browser/exchange").ok()?,
    })
}

#[cfg(test)]
mod market_browser_endpoints_tests {
    use super::{market_browser_endpoints, PRODUCTION_MARKET_BROWSER_ORIGIN};

    #[test]
    fn production_is_fixed_and_disallows_override() {
        let prod = market_browser_endpoints(Some("production"), None).expect("prod");
        assert_eq!(
            prod.handoffs.as_str(),
            "https://0xda-market.nilx.one/nilx-browser/handoffs"
        );
        assert!(market_browser_endpoints(
            Some("production"), Some("https://other.example")
        ).is_none());
    }

    #[test]
    fn development_requires_distinct_https_origin() {
        assert!(market_browser_endpoints(Some("development"), None).is_none());
        assert!(market_browser_endpoints(
            Some("development"), Some(PRODUCTION_MARKET_BROWSER_ORIGIN)
        ).is_none());
        let dev = market_browser_endpoints(
            Some("development"), Some("https://market-test.onrender.com")
        ).expect("isolated test origin");
        assert_eq!(
            dev.exchange.as_str(),
            "https://market-test.onrender.com/nilx-browser/exchange"
        );
    }

    #[test]
    fn rejects_unsafe_origins() {
        for value in [
            "http://market-test.onrender.com",
            "https://user:pass@market-test.onrender.com",
            "https://market-test.onrender.com/path",
            "https://market-test.onrender.com/?token=1",
            "https://market-test.onrender.com/#secret",
            "https://0xda-market.nilx.one",
            "javascript:alert(1)",
        ] {
            assert!(market_browser_endpoints(Some("development"), Some(value)).is_none());
        }
    }
}

fn visit_refused(refusal: VisitRefusal, message: &'static str) -> Response {
    api_error(
        StatusCode::from_u16(refusal.http_status()).unwrap_or(StatusCode::UNPROCESSABLE_ENTITY),
        refusal.code(),
        message,
    )
}

fn return_refused(refusal: ReturnRefusal, message: &'static str) -> Response {
    api_error(
        StatusCode::from_u16(refusal.http_status()).unwrap_or(StatusCode::NOT_FOUND),
        refusal.code(),
        message,
    )
}

/// Every way a Market visit fails before the browser can leave answers 503,
/// as before, but now names the step in the log and in the error code, so a
/// broken handoff is read off one log line rather than guessed from the client.
fn visit_unavailable(stage: &'static str, market_status: Option<u16>) -> Response {
    tracing::warn!(stage, market_status, "market-visit unavailable");
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        match stage {
            "market_refused" => "market_handoff_refused",
            "market_unreachable" => "market_unreachable",
            "market_body" | "market_code" => "market_handoff_invalid",
            _ => "identity_service_unavailable",
        },
        "The Market is temporarily unavailable.",
    )
}

async fn create_market_visit(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<VisitRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        tracing::info!("market-visit refused: missing CSRF header");
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return visit_unavailable("clock", None),
    };
    let (identity, active, session_hash, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value,
        Err(error) => {
            tracing::info!("market-visit refused: the Bond could not be authenticated");
            return error.into_response();
        }
    };
    if !active {
        tracing::info!("market-visit refused: this client is not the Bond's active client");
        return with_session_cookie(session_inactive(), cookie);
    }
    let return_path = match request.validate() {
        Ok(path) => path.to_owned(),
        Err(refusal) => {
            tracing::info!(code = refusal.code(), "market-visit refused: invalid context");
            return visit_refused(refusal, "Invalid market visit context.");
        }
    };
    if state.limiter.consume(format!("market-visit:{}", identity.pub_dress), now, 10, 60).is_err() {
        tracing::info!("market-visit refused: rate limited");
        return visit_refused(VisitRefusal::MarketVisitLimit, "Please retry later.");
    }
    let owner = match PubDress::from_str(&identity.pub_dress) {
        Ok(owner) => owner,
        Err(_) => return visit_unavailable("owner", None),
    };
    if let Some(id) = &request.pickup_order_id {
        let items = match state.repository.special_items(&owner).await {
            Ok(items) => items, Err(_) => return visit_unavailable("pickup_items", None),
        };
        if !items.iter().any(|item| item.order_id == *id && item.state == "paid") {
            tracing::info!("market-visit refused: pickup item is not paid and waiting");
            return visit_refused(VisitRefusal::ItemNotAvailable, "Paid item is not available for pickup.");
        }
    }
    // Read exactly the same server-owned wallet the issuer debits.
    // Do not forward the browser's legacy inventory number to the Market.
    let seeds = match state.repository.read_seeds_balance_with_starter(&owner, now.saturating_mul(1000)).await {
        Ok(balance) => balance.to_string(),
        Err(error) => {
            tracing::error!(%error, "market-visit seeds lookup failed");
            return visit_unavailable("seeds", None);
        }
    };
    let token = match std::env::var("NILX_BROWSER_HANDOFF_TOKEN") {
        Ok(value) if value.len() >= 32 => value,
        _ => return visit_unavailable("handoff_token", None),
    };
    // Derive a partner-specific identifier. Never disclose the private subject.
    let subject = match state.repository.market_pairwise_subject(&identity.pub_dress, &state.secret_digester).await {
        Ok(value) => value,
        Err(_) => return visit_unavailable("pairwise_subject", None),
    };
    let subject = subject.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let mut handoff = serde_json::json!({"subject": subject, "point": request.point,
        "seeds": seeds, "seeds_authority": "identity_snapshot", "avaia": request.avaia});
    if let Some(id) = request.pickup_order_id {
        handoff["pickup_order_id"] = serde_json::Value::String(id);
    }
    // A purchase needs the session that confirms it. A provider login whose
    // session could not be minted still browses, but cannot buy on this visit.
    let mut bound_visit = None;
    if session_hash.len() == 32 {
        let Ok(visit_id) = crate::market_visit::new_market_visit_id() else {
            return visit_unavailable("visit_id", None);
        };
        let created_ms = now.saturating_mul(1000);
        if let Err(error) = state.repository.create_market_visit(
            &visit_id, &owner, &session_hash, created_ms, created_ms + crate::market_visit::MARKET_VISIT_SPEND_WINDOW_MS,
        ).await {
            tracing::error!(%error, "market visit binding failed");
            return visit_unavailable("visit_binding", None);
        }
        handoff["visit_id"] = serde_json::Value::String(visit_id.clone());
        bound_visit = Some(visit_id);
        handoff["recipient"] = serde_json::Value::String(owner.as_str().to_owned());
        handoff["return_path"] = serde_json::Value::String(return_path);
    }
    let deployment = std::env::var("DEPLOY_ENV").ok();
    let market_origin = std::env::var("NILX_MARKET_BROWSER_ORIGIN").ok();
    let Some(endpoints) =
        market_browser_endpoints(deployment.as_deref(), market_origin.as_deref())
    else {
        return visit_unavailable("market_origin", None);
    };
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none()).build() {
        Ok(client) => client,
        Err(_) => return visit_unavailable("http_client", None),
    };
    let result = client.post(endpoints.handoffs)
        .bearer_auth(token)
        .json(&handoff)
        .send().await;
    // Market's answer is the one thing Identity cannot see from its own state,
    // so a refused handoff names Market's status and error code in the log.
    let response = match result {
        Ok(response) if response.status().as_u16() == 201 => response,
        Ok(response) => {
            let status = response.status().as_u16();
            let error = response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|body| body.get("error").and_then(|v| v.as_str()).map(str::to_owned))
                .filter(|code| code.len() <= 64 && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'));
            tracing::warn!(status, error = error.as_deref().unwrap_or("-"), "market-visit: Market refused the handoff");
            return visit_unavailable("market_refused", Some(status));
        }
        Err(error) => {
            tracing::warn!(timeout = error.is_timeout(), connect = error.is_connect(), "market-visit: Market handoff request failed");
            return visit_unavailable("market_unreachable", None);
        }
    };
    let body: serde_json::Value = match response.json().await {
        Ok(body) => body,
        Err(_) => return visit_unavailable("market_body", None),
    };
    // A code Market answered with that is not shaped as the contract says is a
    // fault upstream, not something to hand to a browser.
    let Some(Ok(code)) = body
        .get("code")
        .and_then(|v| v.as_str())
        .map(|code| HandoffCode::try_from(code.to_owned()))
    else {
        return visit_unavailable("market_code", None);
    };
    with_session_cookie(
        no_store_json(
            StatusCode::CREATED,
            VisitAnswer {
                code,
                visit_id: bound_visit,
                owner: owner.as_str().to_owned(),
                action: endpoints.exchange.to_string(),
            },
        ),
        cookie,
    )
}

/// A navigation hint is never payment proof. Check both the committed Identity
/// receipt and the authenticated Market fulfilment, tied to this owner's visit.
async fn read_market_return(State(state): State<ApiState>, headers: HeaderMap,
    Query(query): Query<ReturnQuery>) -> Response {
    use crate::market_issuer::HttpMarketIssuer;
    let now = match now(&state) { Ok(now) => now, Err(_) => return unavailable() };
    let (identity, _, _, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else { return unavailable(); };
    let missing = || return_refused(ReturnRefusal::PurchaseNotConfirmed, "Purchase is not confirmed.");
    if query.validate().is_err() { return missing(); }
    let visit = match state.repository.find_market_visit(&query.visit_id).await {
        Ok(Some(visit)) if visit.owner == owner => visit,
        Ok(_) => return missing(), Err(_) => return unavailable(),
    };
    let receipt = match state.repository.find_special_seeds_receipt(&query.order_id).await {
        Ok(Some(receipt)) if receipt.owner_pub_dress == owner.as_str() => receipt,
        Ok(_) => return missing(), Err(_) => return unavailable(),
    };
    if state.limiter.consume(format!("market-return:{}", owner.as_str()), now, 30, 60).is_err() {
        return return_refused(ReturnRefusal::MarketReturnLimit, "Please retry later.");
    }
    let Some(Ok(config)) = crate::market_issuer_config() else { return unavailable(); };
    let market = match HttpMarketIssuer::new(config) { Ok(client) => client, Err(_) => return unavailable() };
    let order = match market.read_order(&query.order_id).await {
        Ok(order) => order, Err(_) => return unavailable(),
    };
    let claim = crate::market_visit::MarketReturn { visit_id: &query.visit_id, order_id: &query.order_id };
    if !crate::market_visit::market_return_confirmed(claim, &visit, &receipt, &order) { return missing(); }
    with_session_cookie(no_store_json(StatusCode::OK, ReturnAnswer {
        confirmed: true,
        visit_id: query.visit_id,
        order_id: query.order_id,
        owner: owner.as_str().to_owned(),
        item_delivery: receipt.duration_ms == 0,
    }), cookie)
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


async fn read_special_items(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) { Ok(now) => now, Err(_) => return unavailable() };
    let (identity, _, _, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else { return unavailable(); };
    match state.repository.special_items(&owner).await {
        Ok(items) => with_session_cookie(no_store_json(StatusCode::OK, serde_json::json!({"items": items})), cookie),
        Err(_) => unavailable(),
    }
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum SpecialItemCommand {
    Collect { visit_id: String },
    /// `confirm` adds the item's term to a Special that still has an hour or
    /// more to run. Without it Core refuses and says how much is left.
    Activate { #[serde(default)] confirm: bool },
    Deliver { carry: String, things: Vec<DeliveryThing> },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeliveryThing { id: String, x: u8, y: u8 }

async fn change_special_item(
    State(state): State<ApiState>, axum::extract::Path(order_id): axum::extract::Path<String>,
    headers: HeaderMap, Json(command): Json<SpecialItemCommand>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) { return response; }
    let now = match now(&state) { Ok(now) => now, Err(_) => return unavailable() };
    let (identity, active, session_hash, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    if !active || session_hash.len() != 32 { return with_session_cookie(session_inactive(), cookie); }
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else { return unavailable(); };
    let invalid = || api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_item_command", "Invalid item command.");
    if !crate::market_visit::is_market_order_id(&order_id) { return invalid(); }
    if state.limiter.consume(format!("special-item:{}", owner.as_str()), now, 30, 60).is_err() {
        return api_error(StatusCode::TOO_MANY_REQUESTS, "special_item_limit", "Please retry later.");
    }
    let now_ms = now.saturating_mul(1000);
    let result = match command {
        SpecialItemCommand::Collect { visit_id } => {
            if !crate::market_visit::is_market_visit_id(&visit_id) { return invalid(); }
            state.repository.collect_special_item(&owner, &order_id, &visit_id, &session_hash, now_ms).await
        }
        SpecialItemCommand::Activate { confirm } => {
            use nilxone_identity::repository::SpecialActivation;
            match state.repository.activate_special_item_with(&owner, &order_id, &session_hash, now_ms, confirm).await {
                Ok(SpecialActivation::NeedsConfirmation { special_remaining_ms }) => {
                    // Nothing changed. The client asks before extending.
                    return with_session_cookie(no_store_json(StatusCode::CONFLICT, serde_json::json!({
                        "error": {
                            "code": "special_active",
                            "message": "Special is still running; confirm to add this term to its end.",
                        },
                        "special_remaining_ms": special_remaining_ms,
                    })), cookie);
                }
                Ok(outcome) => Ok(outcome == SpecialActivation::Activated),
                Err(error) => Err(error),
            }
        }
        SpecialItemCommand::Deliver { carry, things } => {
            use nilxone_contracts::{Backpack, Carry};
            let carry = match carry.as_str() {
                "pocket" => Carry::Pocket, "backpack" => Carry::Backpack, "bag" => Carry::Bag,
                _ => return invalid(),
            };
            if things.len() > 120 { return invalid(); }
            // Ordinary inventory is the host's committed journal. Core validates
            // its geometry and combines it with authority-owned paid items.
            let mut bag = Backpack::new(carry);
            for thing in things {
                if bag.put_at(&thing.id, thing.x, thing.y).is_err() { return invalid(); }
            }
            state.repository.deliver_special_item(&owner, &order_id, &session_hash, now_ms, &bag).await
        }
    };
    match result {
        Ok(true) => with_session_cookie(no_store_json(StatusCode::OK, serde_json::json!({"ok": true})), cookie),
        Ok(false) => api_error(StatusCode::CONFLICT, "item_not_available", "Item is not available for this action."),
        Err(error) => { tracing::error!(%error, "special item command failed"); unavailable() }
    }
}


#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SpecialInventoryCommand { state: String, command: serde_json::Value }

/// Ordinary inventory stays in the host journal. Paid-item reservations are
/// supplied by the authority independently of the browser command.
async fn change_special_inventory(
    State(state): State<ApiState>, headers: HeaderMap, Json(request): Json<SpecialInventoryCommand>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) { return response; }
    let now = match now(&state) { Ok(now) => now, Err(_) => return unavailable() };
    let (identity, active, session_hash, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    if !active || session_hash.len() != 32 { return with_session_cookie(session_inactive(), cookie); }
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else { return unavailable(); };
    let items = match state.repository.special_items(&owner).await {
        Ok(items) => items, Err(_) => return unavailable(),
    };
    let reserved: Vec<_> = items.iter().filter(|item| item.state == "stored")
        .filter_map(|item| item.slot_x.zip(item.slot_y)).collect();
    let answer = nilxone_contracts::apply_inventory_command_with_reserved(
        &request.state, &request.command.to_string(), now.saturating_mul(1000), &reserved,
    );
    let Ok(answer) = serde_json::from_str::<serde_json::Value>(&answer) else { return unavailable(); };
    let result = if answer["ok"] == true {
        let outcome = &answer["outcome"];
        let amount = |name: &str| outcome[name].as_str().and_then(|x| x.parse::<u64>().ok());
        let (Some(gained), Some(spent)) = (amount("seeds_gained"), amount("seeds_spent")) else { return unavailable(); };
        let mut result = serde_json::json!({"ok": true, "state": answer["state"].to_string(),
            "seedsGained": gained, "seedsSpent": spent, "experience": outcome["experience"]});
        if answer.get("item").is_some() { result["item"] = answer["item"].clone(); }
        if outcome["gifted"] == true { result["gifted"] = serde_json::json!(true); }
        if outcome["left_behind"].is_string() { result["leftBehind"] = outcome["left_behind"].clone(); }
        result
    } else { answer };
    with_session_cookie(no_store_json(StatusCode::OK, result), cookie)
}
