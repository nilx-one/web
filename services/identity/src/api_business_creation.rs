// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/// Creator is always the authenticated Bond, never supplied by a request.
#[derive(Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
enum NewOrganizationCreatorRole {
    #[default]
    Owner,
    Maintainer,
}
impl NewOrganizationCreatorRole {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Maintainer => "maintainer",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewOrganizationRequest {
    pub_dress: String,
    #[serde(default)]
    creator_role: NewOrganizationCreatorRole,
}

#[derive(Serialize)]
struct NewOrganizationResponse {
    pub_dress: String,
    role: &'static str,
    outcome: &'static str,
}

async fn create_business_organization(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<NewOrganizationRequest>,
) -> Response {
    if let Some(response) = reject_missing_csrf(&headers) {
        return response;
    }
    let now = match now(&state) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let (identity, active, _hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if !active {
        return with_session_cookie(session_inactive(), cookie);
    }
    if let Err(retry_after) = state.limiter
        .consume(format!("business-create:{}", identity.pub_dress), now, 8, 3600)
        .and_then(|_| state.limiter.consume("business-create:global", now, 500, 3600))
    {
        return with_session_cookie(rate_limited(retry_after), cookie);
    }
    let creator = match PubDress::from_str(&identity.pub_dress) {
        Ok(value) => value,
        Err(_) => return unavailable(),
    };
    let business = match PubDress::from_str(&request.pub_dress) {
        Ok(value) => value,
        Err(error) => return with_session_cookie(invalid_pub_dress(error), cookie),
    };
    let role = request.creator_role.as_str();
    let mut response = match state.repository
        .create_business_organization(&creator, &business, role, now).await
    {
        Ok(crate::repository::CreateBusinessOrganizationOutcome::Created) =>
            no_store_json(StatusCode::CREATED, NewOrganizationResponse {
                pub_dress: business.to_string(),
                role,
                outcome: "created",
            }),
        Ok(crate::repository::CreateBusinessOrganizationOutcome::IdempotentReplay) =>
            no_store_json(StatusCode::OK, NewOrganizationResponse {
                pub_dress: business.to_string(),
                role,
                outcome: "already_created",
            }),
        Ok(crate::repository::CreateBusinessOrganizationOutcome::CreatorNotHuman) =>
            no_store_error(StatusCode::FORBIDDEN, "human_creator_required", "A human Bond is required."),
        Ok(crate::repository::CreateBusinessOrganizationOutcome::AddressUnavailable) =>
            no_store_error(StatusCode::CONFLICT, "pub_dress_unavailable", "This Business Bond address is unavailable."),
        Ok(crate::repository::CreateBusinessOrganizationOutcome::PublicLabelUnavailable) =>
            no_store_error(StatusCode::CONFLICT, "public_label_unavailable", "This business public label is unavailable."),
        Err(error) => {
            tracing::error!(%error, "business organization creation failed");
            unavailable()
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}
