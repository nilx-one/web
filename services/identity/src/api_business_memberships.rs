// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

#[derive(Serialize)]
struct OrganizationsResponse {
    organizations: Vec<OrganizationItem>,
}

#[derive(Serialize)]
struct OrganizationItem {
    pub_dress: String,
    role: String,
    created_at: i64,
}

/// The list is a server-derived projection, not a writable Bond property.
async fn read_my_organizations(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    let now = match now(&state) {
        Ok(now) => now,
        Err(_) => return unavailable(),
    };
    let (identity, _active, _token_hash, cookie) =
        match authenticated_bond(&state, &headers, now).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    let member = match PubDress::from_str(&identity.pub_dress) {
        Ok(member) => member,
        Err(_) => return unavailable(),
    };
    let mut response = match state.repository.business_memberships_for(&member).await {
        Ok(memberships) => no_store_json(
            StatusCode::OK,
            OrganizationsResponse {
                organizations: memberships
                    .into_iter()
                    .map(|item| OrganizationItem {
                        pub_dress: item.business_pub_dress,
                        role: item.role,
                        created_at: item.created_at,
                    })
                    .collect(),
            },
        ),
        Err(error) => {
            tracing::error!(%error, "own organizations read failed");
            unavailable()
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}
