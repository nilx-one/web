// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! What a partner channel, such as 0xda-market's Telegram bot, needs to offer
//! Special for seeds to the person behind one of its provider accounts:
//!
//! - whether the account is bound to a Bond (and the Bond's public `pub_dress`);
//! - when it is not, whether the person's last attempt to connect it was
//!   refused because their Bond already holds another account of that provider;
//! - the Bond's authoritative seeds balance;
//! - whether the Bond holds Special, and whether Core opens a new Special
//!   purchase for it (`SubscriptionClock::special_purchase_open`).
//!
//! It is read-only: it grants nothing and debits nothing. The issuer worker
//! checks the same rules again, under the wallet lock, before any debit. It
//! uses the partner lookup token and exists only when `PARTNER_LOOKUP_TOKEN` is
//! configured.

use std::time::{SystemTime, UNIX_EPOCH};

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
use nilxone_contracts::{ProviderAccount, ProviderSubject, ProviderType};
use serde::{Deserialize, Serialize};

use crate::{IdentityRepository, PartnerLookupConfig, ProviderLinkRepository, PubDress};

/// A refusal older than this is no longer shown; the person may have fixed it.
const LINK_REFUSAL_WINDOW_SECONDS: u32 = 24 * 60 * 60;

#[derive(Clone)]
struct PartnerAccountState {
    config: PartnerLookupConfig,
    identities: IdentityRepository,
    provider_links: ProviderLinkRepository,
}

pub fn partner_account_router(
    config: PartnerLookupConfig,
    identities: IdentityRepository,
    provider_links: ProviderLinkRepository,
) -> Router {
    Router::new()
        .route("/api/v1/partner/provider-account", post(account))
        .with_state(PartnerAccountState {
            config,
            identities,
            provider_links,
        })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountRequest {
    provider: String,
    subject: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum AccountResponse {
    Linked {
        pub_dress: String,
        seeds: u64,
        special: SpecialView,
        special_purchase_open: bool,
    },
    SignInRequired {
        provider: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        link_refusal: Option<String>,
    },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct SpecialView {
    /// The Bond holds Special time, running or paused behind Exclusive.
    held: bool,
    /// When that Special time runs out, after any Exclusive ahead of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    ends_at_ms: Option<u64>,
}

async fn account(
    State(state): State<PartnerAccountState>,
    headers: HeaderMap,
    request: Result<Json<AccountRequest>, JsonRejection>,
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
    let Ok(now_ms) = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
    else {
        return unavailable();
    };
    match read(&state, ProviderAccount { provider, subject }, now_ms).await {
        Some(view) => no_store(StatusCode::OK, Json(view)),
        // A store that cannot answer is never "not linked".
        None => unavailable(),
    }
}

async fn read(
    state: &PartnerAccountState,
    account: ProviderAccount,
    now_ms: u64,
) -> Option<AccountResponse> {
    let Some(owner) = state.provider_links.owner(&account).await.ok()? else {
        let link_refusal = state
            .provider_links
            .recent_link_refusal(&account, LINK_REFUSAL_WINDOW_SECONDS)
            .await
            .ok()?;
        return Some(AccountResponse::SignInRequired {
            provider: account.provider.as_str(),
            link_refusal,
        });
    };
    linked(state, &owner, now_ms).await
}

async fn linked(
    state: &PartnerAccountState,
    owner: &PubDress,
    now_ms: u64,
) -> Option<AccountResponse> {
    let seeds = state
        .identities
        .read_seeds_balance_with_starter(owner, now_ms)
        .await
        .ok()?;
    let clock = state
        .identities
        .read_subscription_clock(owner, now_ms)
        .await
        .ok()?
        .advance(now_ms)
        .ok()?;
    let special_purchase_open = clock.special_purchase_open(now_ms).ok()?;
    let held = !special_purchase_open;
    let ends_at_ms = held
        .then(|| {
            now_ms
                .checked_add(clock.exclusive_remaining_ms.get())?
                .checked_add(clock.special_remaining_ms.get())
        })
        .flatten();
    Some(AccountResponse::Linked {
        pub_dress: owner.as_str().to_owned(),
        seeds,
        special: SpecialView { held, ends_at_ms },
        special_purchase_open,
    })
}

#[derive(Serialize)]
struct Failure {
    error: &'static str,
}

fn failure(status: StatusCode, error: &'static str) -> Response {
    no_store(status, Json(Failure { error }))
}

fn unavailable() -> Response {
    failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable")
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

    use super::partner_account_router;
    use crate::{
        IdentityRepository, PartnerLookupConfig, ProviderIdentity, ProviderLinkRepository, PubDress,
    };

    const TOKEN: &str = "partner-lookup-token-at-least-32-bytes";

    struct Fixture {
        _directory: tempfile::TempDir,
        url: String,
        identities: IdentityRepository,
        links: ProviderLinkRepository,
    }

    async fn fixture() -> Fixture {
        let directory = tempfile::tempdir().expect("temporary directory");
        let url = format!(
            "sqlite://{}",
            directory.path().join("identity.sqlite").display()
        );
        let identities = IdentityRepository::connect(&url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&url)
            .await
            .expect("provider link repository");
        Fixture {
            _directory: directory,
            url,
            identities,
            links,
        }
    }

    async fn bond(fixture: &Fixture, name: &str) -> PubDress {
        let bond: PubDress = name.parse().expect("valid Bond");
        fixture
            .identities
            .register_native(
                &bond,
                "hash",
                1,
                format!("recovery-{name}").as_bytes(),
                format!("challenge-{name}").as_bytes(),
                format!("idempotency-{name}").as_bytes(),
                100,
                200,
            )
            .await
            .expect("native Bond registration");
        bond
    }

    async fn ask(fixture: &Fixture, token: Option<&str>, body: Value) -> (StatusCode, Value) {
        let app = partner_account_router(
            PartnerLookupConfig::new(TOKEN).expect("config"),
            fixture.identities.clone(),
            fixture.links.clone(),
        );
        let mut request = Request::post("/api/v1/partner/provider-account")
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
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        (status, serde_json::from_slice(&bytes).expect("json"))
    }

    fn telegram(subject: &str) -> Value {
        json!({"provider": "telegram", "subject": subject})
    }

    #[tokio::test]
    async fn a_linked_account_shows_its_wallet_and_an_open_special_purchase() {
        let fixture = fixture().await;
        let owner = bond(&fixture, "0x1sky").await;
        fixture
            .links
            .link(&owner, &ProviderIdentity::telegram(42))
            .await
            .expect("link");
        let (status, body) = ask(&fixture, Some(TOKEN), telegram("42")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({
                "state": "linked",
                "pub_dress": "0x1sky",
                "seeds": nilxone_contracts::STARTER_SEEDS,
                "special": {"held": false},
                "special_purchase_open": true
            })
        );
    }

    #[tokio::test]
    async fn a_bond_that_holds_special_is_not_offered_another() {
        let fixture = fixture().await;
        let owner = bond(&fixture, "0x1sky").await;
        fixture
            .links
            .link(&owner, &ProviderIdentity::telegram(42))
            .await
            .expect("link");
        let now_ms = u64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        )
        .unwrap();
        let held = nilxone_contracts::SubscriptionClock::new("0x1sky", now_ms)
            .unwrap()
            .grant_special_months(1, now_ms)
            .unwrap();
        // Test-only: a Bond that already bought Special.
        let pool = sqlx::SqlitePool::connect(&fixture.url).await.expect("pool");
        sqlx::query(
            "INSERT INTO bond_subscription_clocks(owner_pub_dress, clock_json) VALUES (?, ?)",
        )
        .bind(owner.as_str())
        .bind(serde_json::to_string(&held).expect("clock json"))
        .execute(&pool)
        .await
        .expect("clock");

        let (status, body) = ask(&fixture, Some(TOKEN), telegram("42")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["special"]["held"], json!(true));
        assert_eq!(body["special_purchase_open"], json!(false));
        let ends = body["special"]["ends_at_ms"].as_u64().expect("end");
        assert!(ends >= now_ms + 28 * 24 * 60 * 60 * 1000);
    }

    #[tokio::test]
    async fn an_unlinked_account_asks_to_sign_in_and_says_when_its_bond_has_another() {
        let fixture = fixture().await;
        let (status, body) = ask(&fixture, Some(TOKEN), telegram("43")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"state": "sign_in_required", "provider": "telegram"})
        );

        let owner = bond(&fixture, "0x1sky").await;
        fixture
            .links
            .link(&owner, &ProviderIdentity::telegram(42))
            .await
            .expect("first Telegram");
        fixture
            .links
            .link(&owner, &ProviderIdentity::telegram(43))
            .await
            .expect("refused second Telegram");
        let (_, body) = ask(&fixture, Some(TOKEN), telegram("43")).await;
        assert_eq!(
            body,
            json!({
                "state": "sign_in_required",
                "provider": "telegram",
                "link_refusal": "provider_type_already_linked"
            })
        );
    }

    #[tokio::test]
    async fn only_the_partner_token_may_ask_and_malformed_questions_are_refused() {
        let fixture = fixture().await;
        assert_eq!(
            ask(&fixture, None, telegram("7")).await,
            (StatusCode::UNAUTHORIZED, json!({"error": "unauthorized"}))
        );
        assert_eq!(
            ask(
                &fixture,
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
                &fixture,
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
}
