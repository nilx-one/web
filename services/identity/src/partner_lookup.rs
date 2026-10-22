// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Lets a partner, such as a business in the 0x1 world, ask which Bond a
//! provider account belongs to. The answer is Core's
//! (`nilxone_contracts::provider_lookup_view`): the Bond's public `pub_dress`,
//! or that the person must sign in with that provider to connect it. No
//! internal identifier ever leaves through this endpoint.
//!
//! The partner authenticates with its own bearer token. The route exists only
//! when `PARTNER_LOOKUP_TOKEN` is configured.

use axum::{
    Json, Router,
    extract::{State, rejection::JsonRejection},
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL},
    },
    response::{IntoResponse, Response},
    routing::post,
};
use nilxone_contracts::{
    ProviderAccount, ProviderLookupView, ProviderSubject, ProviderType, provider_lookup_view,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq as _;

use crate::ProviderLinkRepository;

/// The shortest partner token accepted.
pub const MIN_PARTNER_TOKEN_LEN: usize = 32;

/// The partner credential, kept only as a digest.
#[derive(Clone)]
pub struct PartnerLookupConfig {
    token_digest: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PartnerLookupConfigError {
    #[error("the partner lookup token must be at least {MIN_PARTNER_TOKEN_LEN} bytes")]
    TokenTooShort,
}

impl PartnerLookupConfig {
    /// # Errors
    ///
    /// Returns [`PartnerLookupConfigError::TokenTooShort`] for a short token.
    pub fn new(token: &str) -> Result<Self, PartnerLookupConfigError> {
        if token.len() < MIN_PARTNER_TOKEN_LEN {
            return Err(PartnerLookupConfigError::TokenTooShort);
        }
        Ok(Self {
            token_digest: Sha256::digest(token.as_bytes()).into(),
        })
    }

    fn accepts(&self, presented: &str) -> bool {
        let presented: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
        bool::from(presented.ct_eq(&self.token_digest))
    }
}

#[derive(Clone)]
struct PartnerLookupState {
    config: PartnerLookupConfig,
    provider_links: ProviderLinkRepository,
}

pub fn partner_lookup_router(
    config: PartnerLookupConfig,
    provider_links: ProviderLinkRepository,
) -> Router {
    Router::new()
        .route("/api/v1/partner/provider-lookup", post(lookup))
        .with_state(PartnerLookupState {
            config,
            provider_links,
        })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LookupRequest {
    provider: String,
    subject: String,
}

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum LookupResponse {
    Linked { pub_dress: String },
    SignInRequired { provider: &'static str },
}

impl From<ProviderLookupView> for LookupResponse {
    fn from(view: ProviderLookupView) -> Self {
        match view {
            ProviderLookupView::Linked { pub_dress } => Self::Linked {
                pub_dress: pub_dress.as_str().to_owned(),
            },
            ProviderLookupView::SignInRequired { provider } => Self::SignInRequired {
                provider: provider.as_str(),
            },
        }
    }
}

async fn lookup(
    State(state): State<PartnerLookupState>,
    headers: HeaderMap,
    request: Result<Json<LookupRequest>, JsonRejection>,
) -> Response {
    let presented = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !state.config.accepts(presented) {
        return failure(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Ok(Json(request)) = request else {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "malformed_request");
    };
    let Ok(provider) = request.provider.parse::<ProviderType>() else {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "unknown_provider");
    };
    let subject = match request.subject.parse::<ProviderSubject>() {
        Ok(subject) => subject,
        Err(error) => return failure(StatusCode::UNPROCESSABLE_ENTITY, error.code()),
    };
    let account = ProviderAccount { provider, subject };

    // A store that cannot answer is not "not linked": the person must not be
    // sent to link an account that may already be linked.
    let owner = match state.provider_links.owner(&account).await {
        Ok(owner) => owner,
        Err(_) => return failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
    };
    no_store(
        StatusCode::OK,
        Json(LookupResponse::from(provider_lookup_view(&account, owner))),
    )
}

#[derive(Serialize)]
struct Failure {
    error: &'static str,
}

fn failure(status: StatusCode, error: &'static str) -> Response {
    no_store(status, Json(Failure { error }))
}

fn no_store(status: StatusCode, body: impl IntoResponse) -> Response {
    (status, [(CACHE_CONTROL, "no-store")], body).into_response()
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt as _;

    use super::{PartnerLookupConfig, PartnerLookupConfigError, partner_lookup_router};
    use crate::{IdentityRepository, ProviderIdentity, ProviderLinkRepository};

    const TOKEN: &str = "partner-lookup-token-at-least-32-bytes";

    async fn repositories() -> (
        tempfile::TempDir,
        IdentityRepository,
        ProviderLinkRepository,
    ) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database_url = format!(
            "sqlite://{}",
            directory.path().join("identity.sqlite").display()
        );
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        (directory, identities, links)
    }

    async fn ask(
        links: ProviderLinkRepository,
        token: Option<&str>,
        body: Value,
    ) -> (StatusCode, Value) {
        let app = partner_lookup_router(PartnerLookupConfig::new(TOKEN).expect("config"), links);
        let mut request = Request::post("/api/v1/partner/provider-lookup")
            .header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = app
            .oneshot(request.body(Body::from(body.to_string())).expect("request"))
            .await
            .expect("response");
        let status = response.status();
        assert_eq!(
            response
                .headers()
                .get("cache-control")
                .map(|value| value.to_str().ok()),
            Some(Some("no-store"))
        );
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        (status, serde_json::from_slice(&bytes).expect("json"))
    }

    #[tokio::test]
    async fn a_linked_telegram_account_answers_only_the_public_pub_dress() {
        let (_directory, identities, links) = repositories().await;
        let bond: crate::PubDress = "0x1sky".parse().expect("valid Bond");
        identities
            .register_native(
                &bond,
                "hash",
                1,
                b"recovery",
                b"challenge-partner-lookup",
                b"idempotency-partner-lookup",
                100,
                200,
            )
            .await
            .expect("native Bond registration");
        links
            .link(&bond, &ProviderIdentity::telegram(42))
            .await
            .expect("telegram link");

        let (status, body) = ask(
            links,
            Some(TOKEN),
            json!({"provider": "telegram", "subject": "42"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"state": "linked", "pub_dress": "0x1sky"}));
    }

    #[tokio::test]
    async fn an_unlinked_account_asks_the_person_to_sign_in() {
        let (_directory, _identities, links) = repositories().await;
        let (status, body) = ask(
            links,
            Some(TOKEN),
            json!({"provider": "telegram", "subject": "7"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"state": "sign_in_required", "provider": "telegram"})
        );
    }

    #[tokio::test]
    async fn only_the_partner_token_may_ask() {
        let (_directory, _identities, links) = repositories().await;
        let body = json!({"provider": "telegram", "subject": "7"});
        assert_eq!(
            ask(links.clone(), None, body.clone()).await,
            (StatusCode::UNAUTHORIZED, json!({"error": "unauthorized"}))
        );
        assert_eq!(
            ask(links, Some("another-token-that-is-also-long-enough"), body).await,
            (StatusCode::UNAUTHORIZED, json!({"error": "unauthorized"}))
        );
    }

    #[tokio::test]
    async fn malformed_questions_are_refused() {
        let (_directory, _identities, links) = repositories().await;
        assert_eq!(
            ask(
                links.clone(),
                Some(TOKEN),
                json!({"provider": "apple", "subject": "7"})
            )
            .await,
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error": "unknown_provider"})
            )
        );
        assert_eq!(
            ask(
                links.clone(),
                Some(TOKEN),
                json!({"provider": "telegram", "subject": "7 8"})
            )
            .await,
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error": "invalid_subject_character"})
            )
        );
        assert_eq!(
            ask(
                links,
                Some(TOKEN),
                json!({"provider": "telegram", "subject": "7", "pub_dress": "x"})
            )
            .await,
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error": "malformed_request"})
            )
        );
    }

    #[test]
    fn a_short_token_is_refused() {
        assert_eq!(
            PartnerLookupConfig::new("short").err(),
            Some(PartnerLookupConfigError::TokenTooShort)
        );
    }
}
