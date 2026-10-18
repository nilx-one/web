// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

#[derive(Serialize)]
struct AdminRoleInbox {
    requests: Vec<AdminRoleInboxItem>,
}

#[derive(Serialize)]
struct AdminRoleInboxItem {
    pub_dress: String,
    requested_at: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AdminRoleDecisionInput {
    approve: bool,
}

#[derive(Serialize)]
struct AdminRoleDecisionOutput {
    status: &'static str,
    pub_dress: String,
}

async fn read_admin_role_requests(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) { Ok(value) => value, Err(_) => return unavailable() };
    let (identity, active, _, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    if !active { return with_session_cookie(session_inactive(), cookie); }
    let mut response = match state.repository.role_for(&identity.pub_dress).await {
        Ok(crate::BondAccessRole::Admin) => match state.repository.pending_admin_role_requests().await {
            Ok(requests) => no_store_json(StatusCode::OK, AdminRoleInbox {
                requests: requests.into_iter().map(|item| AdminRoleInboxItem {
                    pub_dress: item.pub_dress,
                    requested_at: item.requested_at,
                }).collect(),
            }),
            Err(error) => { tracing::error!(%error, "admin inbox failed"); unavailable() },
        },
        Ok(_) => no_store_error(StatusCode::FORBIDDEN, "admin_required", "Admin role required."),
        Err(error) => { tracing::error!(%error, "admin role check failed"); unavailable() },
    };
    if let Some(cookie) = cookie { append_cookie(&mut response, cookie); }
    response
}

async fn decide_admin_role_request(
    State(state): State<ApiState>,
    Path(pub_dress): Path<String>,
    headers: HeaderMap,
    Json(request): Json<AdminRoleDecisionInput>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) { return response; }
    let now = match now(&state) { Ok(value) => value, Err(_) => return unavailable() };
    let (identity, active, _, cookie) = match authenticated_bond(&state, &headers, now).await {
        Ok(value) => value, Err(error) => return error.into_response(),
    };
    if !active { return with_session_cookie(session_inactive(), cookie); }
    let candidate = match PubDress::from_str(&pub_dress) {
        Ok(value) if value.discriminator() == '0' => value,
        _ => return no_store_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_candidate", "Only existing 0x0 Bonds can request admin approval."),
    };
    let mut response = match state.repository
        .decide_admin_role_request(&identity.pub_dress, &candidate, request.approve, now).await
    {
        Ok(AdminRoleDecision::Approved) => no_store_json(StatusCode::OK, AdminRoleDecisionOutput { status: "approved", pub_dress: candidate.to_string() }),
        Ok(AdminRoleDecision::Denied) => no_store_json(StatusCode::OK, AdminRoleDecisionOutput { status: "denied", pub_dress: candidate.to_string() }),
        Ok(AdminRoleDecision::Forbidden) => no_store_error(StatusCode::FORBIDDEN, "admin_required", "Admin role required."),
        Ok(AdminRoleDecision::AlreadyDecided) => no_store_error(StatusCode::CONFLICT, "request_not_pending", "This request has already been decided."),
        Err(error) => { tracing::error!(%error, "admin decision failed"); unavailable() },
    };
    if let Some(cookie) = cookie { append_cookie(&mut response, cookie); }
    response
}
