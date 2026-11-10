// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// The bodies, error codes and shape rules of the visit and return routes are
// nilx-one/core's `nilxone-api`; this adapter authenticates, talks to Market
// and answers with the contract's types.
use nilxone_api::market::{
    HandoffCode, ReturnAnswer, ReturnQuery, ReturnRefusal, VisitAnswer, VisitRefusal, VisitRequest,
};

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

async fn create_market_visit(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<VisitRequest>,
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
    let return_path = match request.validate() {
        Ok(path) => path.to_owned(),
        Err(refusal) => return visit_refused(refusal, "Invalid market visit context."),
    };
    if state.limiter.consume(format!("market-visit:{}", identity.pub_dress), now, 10, 60).is_err() {
        return visit_refused(VisitRefusal::MarketVisitLimit, "Please retry later.");
    }
    let owner = match PubDress::from_str(&identity.pub_dress) {
        Ok(owner) => owner,
        Err(_) => return unavailable(),
    };
    if let Some(id) = &request.pickup_order_id {
        let items = match state.repository.special_items(&owner).await {
            Ok(items) => items, Err(_) => return unavailable(),
        };
        if !items.iter().any(|item| item.order_id == *id && item.state == "paid") {
            return visit_refused(VisitRefusal::ItemNotAvailable, "Paid item is not available for pickup.");
        }
    }
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
    if let Some(id) = request.pickup_order_id {
        handoff["pickup_order_id"] = serde_json::Value::String(id);
    }
    // A purchase needs the session that confirms it. A provider login whose
    // session could not be minted still browses, but cannot buy on this visit.
    let mut bound_visit = None;
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
        handoff["visit_id"] = serde_json::Value::String(visit_id.clone());
        bound_visit = Some(visit_id);
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
    // A code Market answered with that is not shaped as the contract says is a
    // fault upstream, not something to hand to a browser.
    let Some(Ok(code)) = body
        .get("code")
        .and_then(|v| v.as_str())
        .map(|code| HandoffCode::try_from(code.to_owned()))
    else {
        return unavailable();
    };
    with_session_cookie(
        no_store_json(
            StatusCode::CREATED,
            VisitAnswer {
                code,
                visit_id: bound_visit,
                owner: owner.as_str().to_owned(),
                action: "https://0xda-market.nilx.one/nilx-browser/exchange".to_owned(),
            },
        ),
        cookie,
    )
}

/// A navigation hint is never payment proof. Check both the committed Identity
/// receipt and the authenticated Market fulfilment, tied to this owner's visit.
async fn read_market_return(State(state): State<ApiState>, headers: HeaderMap,
    Query(query): Query<ReturnQuery>) -> Response {
    use crate::market_issuer::{HttpMarketIssuer, MarketIssuerConfig};
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
    let Some(Ok(config)) = MarketIssuerConfig::from_environment() else { return unavailable(); };
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
    Activate,
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
        SpecialItemCommand::Activate => state.repository.activate_special_item(&owner, &order_id, &session_hash, now_ms).await,
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
