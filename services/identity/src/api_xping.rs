// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// xPing's engine (nilx-one/core docs/xping-engine.md). Core owns the rules,
// including the breakdown after two seconds of forcing on empty and the
// repair's price; the service stores the engine and is its clock. A paid
// repair is paid in Seeds from the device-side inventory, which the service
// never sees, so the answer carries `authority: "client"` the way experience
// totals do. The service checks the price against the engine and applies a
// repair only to the exact engine state it was priced from.

/// The most forcing one report may spend: two full engines.
const MAX_FORCED_MS: u64 = 2 * nilxone_contracts::XPING_FORCE_FULL_MS;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum XpingEngineCommand {
    Force {
        forced_ms: u64,
    },
    Repaired {
        paid_seeds: u64,
        /// The engine state the payment was priced from.
        expected: nilxone_contracts::XpingEngine,
    },
}

/// The stored engine changed since the payment was priced.
#[derive(Debug)]
enum XpingEngineRefusal {
    Engine(nilxone_contracts::XpingEngineError),
    Stale,
}

#[derive(Serialize)]
struct XpingEngineBody {
    /// The stored engine: what a repair is priced from and sent back as
    /// `expected`.
    state: nilxone_contracts::XpingEngine,
    engine: nilxone_contracts::XpingEngineView,
    now_ms: u64,
    authority: &'static str,
}

fn xping_engine_body(engine: &nilxone_contracts::XpingEngine, now_ms: u64) -> XpingEngineBody {
    XpingEngineBody {
        state: *engine,
        engine: nilxone_contracts::xping_engine_view(engine, now_ms),
        now_ms,
        authority: "client",
    }
}

async fn read_xping_engine(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, _active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    let mut response = read_xping_engine_response(&state, &identity, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn read_xping_engine_response(
    state: &ApiState,
    identity: &IdentityRecord,
    now: u64,
) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    let Some(now_ms) = now.checked_mul(1000) else {
        return unavailable();
    };
    match state.repository.read_xping_engine(&owner, now_ms).await {
        Ok(engine) => no_store_json(StatusCode::OK, xping_engine_body(&engine, now_ms)),
        Err(error) => {
            tracing::error!(%error, "reading the xPing engine failed");
            unavailable()
        }
    }
}

async fn command_xping_engine(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(command): Json<XpingEngineCommand>,
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
    let mut response = command_xping_engine_response(&state, &identity, command, now).await;
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

async fn command_xping_engine_response(
    state: &ApiState,
    identity: &IdentityRecord,
    command: XpingEngineCommand,
    now: u64,
) -> Response {
    let Ok(owner) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored human pub_dress is invalid");
        return unavailable();
    };
    let Some(now_ms) = now.checked_mul(1000) else {
        return unavailable();
    };
    if matches!(command, XpingEngineCommand::Force { forced_ms } if forced_ms == 0 || forced_ms > MAX_FORCED_MS)
    {
        return no_store_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_forcing",
            "A forcing report spends between 1 ms and two full engines.",
        );
    }
    if let Err(retry_after) = state
        .limiter
        .consume(format!("xping-engine:{}", owner.as_str()), now, 600, 3600)
        .and_then(|_| state.limiter.consume("xping-engine:global", now, 50_000, 3600))
    {
        return rate_limited(retry_after);
    }
    let changed = state
        .repository
        .change_xping_engine(&owner, now_ms, |engine| match command {
            XpingEngineCommand::Force { forced_ms } => engine
                .force(forced_ms, now_ms)
                .map_err(XpingEngineRefusal::Engine),
            XpingEngineCommand::Repaired {
                paid_seeds,
                expected,
            } => {
                if engine != expected {
                    return Err(XpingEngineRefusal::Stale);
                }
                engine
                    .repaired(paid_seeds, now_ms)
                    .map_err(XpingEngineRefusal::Engine)
            }
        })
        .await;
    match changed {
        Ok(Ok(engine)) => no_store_json(StatusCode::OK, xping_engine_body(&engine, now_ms)),
        Ok(Err(XpingEngineRefusal::Stale)) => no_store_error(
            StatusCode::CONFLICT,
            "stale_engine",
            "The engine changed since this repair was priced; price it again.",
        ),
        Ok(Err(XpingEngineRefusal::Engine(refused))) => no_store_error(
            StatusCode::CONFLICT,
            refused.code(),
            match refused {
                nilxone_contracts::XpingEngineError::Broken => "The engine is broken.",
                nilxone_contracts::XpingEngineError::Full => "Nothing is missing to repair.",
                nilxone_contracts::XpingEngineError::Underpaid => {
                    "Less was paid than the repair costs."
                }
            },
        ),
        Err(error) => {
            tracing::error!(%error, "changing the xPing engine failed");
            unavailable()
        }
    }
}
