// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! `POST /api/v1/identity/ais-purchase`: the buyer's confirmed Telegram Special
//! checkout, authorized by an AIS permit (`aiaiaiai-org/4x-ais`
//! `docs/hub-protocol.md`). The permit is the only credential. Core holds what it is checked
//! against (AIS's origin, the permitted product, AIS's keys), claims the Market order the
//! permit names and settles it; this route only passes the permit on and maps the outcome to
//! an HTTP status.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header::CACHE_CONTROL},
    response::{IntoResponse, Response},
    routing::post,
};
use nilxone_identity::{
    aiaiaiai_sign_in::purchase::AisAuthority,
    market_issuer::{AisSettleError, MarketIssuerApi, MarketIssuerWorker, Settlement},
};
use serde::Deserialize;

pub struct AisPurchase<M> {
    worker: MarketIssuerWorker<M>,
    authority: AisAuthority,
}

impl<M> AisPurchase<M> {
    pub fn new(worker: MarketIssuerWorker<M>) -> Arc<Self> {
        Self::with_authority(worker, AisAuthority::production())
    }

    pub fn with_authority(worker: MarketIssuerWorker<M>, authority: AisAuthority) -> Arc<Self> {
        Arc::new(Self { worker, authority })
    }
}

pub fn router<M: MarketIssuerApi + 'static>(state: Arc<AisPurchase<M>>) -> Router {
    Router::new()
        .route("/api/v1/identity/ais-purchase", post(purchase::<M>))
        .with_state(state)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    permit: String,
}

fn answer(status: StatusCode, code: &'static str) -> Response {
    let mut response = (status, Json(serde_json::json!({"status": code}))).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn purchase<M: MarketIssuerApi + 'static>(
    State(state): State<Arc<AisPurchase<M>>>,
    Json(request): Json<Request>,
) -> Response {
    match state
        .worker
        .settle_ais_permit(&state.authority, &request.permit)
        .await
    {
        Ok(Settlement::Fulfilled) => answer(StatusCode::OK, "fulfilled"),
        // The wallet kept nothing: the order was refused with a code Market holds.
        Ok(Settlement::Rejected(code)) => answer(StatusCode::CONFLICT, code),
        Ok(Settlement::Skipped) => answer(StatusCode::CONFLICT, "order_not_available"),
        Ok(Settlement::Held) => answer(StatusCode::SERVICE_UNAVAILABLE, "held_for_operator"),
        Err(AisSettleError::Permit(_)) => answer(StatusCode::UNAUTHORIZED, "invalid_permit"),
        Err(AisSettleError::KeysUnavailable) => {
            answer(StatusCode::SERVICE_UNAVAILABLE, "ais_unavailable")
        }
        Err(AisSettleError::Worker(error)) => {
            tracing::error!(%error, "AIS purchase could not be settled");
            answer(StatusCode::SERVICE_UNAVAILABLE, "temporarily_unavailable")
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, header},
    };
    use nilxone_identity::{
        IdentityRepository,
        market_issuer::{IssuerConfirmation, IssuerOrder, IssuerOrderPage, MarketIssuerError},
    };
    use tower::ServiceExt as _;

    use nilxone_identity::aiaiaiai_sign_in::JsonWebKeySet;

    use super::*;

    /// A Market that must never be reached: every call fails and is counted.
    #[derive(Clone, Default)]
    struct UnreachableMarket {
        calls: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl UnreachableMarket {
        fn refuse<T>(&self) -> Result<T, MarketIssuerError> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err(MarketIssuerError::Unavailable)
        }
    }

    impl MarketIssuerApi for UnreachableMarket {
        async fn orders(
            &self,
            _status: &str,
            _cursor: Option<&str>,
        ) -> Result<IssuerOrderPage, MarketIssuerError> {
            self.refuse()
        }
        async fn claim(&self, _id: &str) -> Result<IssuerOrder, MarketIssuerError> {
            self.refuse()
        }
        async fn fulfil(
            &self,
            _id: &str,
            _confirmation: &IssuerConfirmation,
        ) -> Result<IssuerOrder, MarketIssuerError> {
            self.refuse()
        }
        async fn reject(&self, _id: &str, _code: &str) -> Result<IssuerOrder, MarketIssuerError> {
            self.refuse()
        }
    }

    async fn state(
        authority: AisAuthority,
    ) -> (
        Arc<AisPurchase<UnreachableMarket>>,
        Arc<std::sync::atomic::AtomicUsize>,
    ) {
        let directory = tempfile::tempdir().expect("directory");
        let url = format!(
            "sqlite://{}",
            directory.path().join("identity.db").display()
        );
        let repository = IdentityRepository::connect(&url).await.expect("repository");
        // The database stays valid for the test's length.
        std::mem::forget(directory);
        let market = UnreachableMarket::default();
        let calls = Arc::clone(&market.calls);
        let worker = MarketIssuerWorker::new(
            repository,
            market,
            Arc::new(nilxone_identity::market_issuer::system_now_ms),
        );
        (AisPurchase::with_authority(worker, authority), calls)
    }

    fn authority(origin: &str) -> AisAuthority {
        AisAuthority::for_origin(origin, "0xda-market").expect("authority")
    }

    async fn post(state: Arc<AisPurchase<UnreachableMarket>>, body: &str) -> (StatusCode, String) {
        let response = router(state)
            .oneshot(
                Request::post("/api/v1/identity/ais-purchase")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_owned()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn a_permit_ais_did_not_sign_is_refused_before_market_is_touched() {
        // Keys AIS served a moment ago, none of which signed this permit.
        let keys = serde_json::from_str::<JsonWebKeySet>(r#"{"keys":[]}"#).unwrap();
        let (state, market) = state(authority("https://ais.invalid").with_keys(keys)).await;
        let (status, body) = post(state, r#"{"permit":"a.b.c"}"#).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(body.contains("invalid_permit"), "{body}");
        assert_eq!(market.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_unreachable_ais_answers_unavailable_not_unauthorized() {
        let (state, market) = state(authority("http://127.0.0.1:9")).await;
        let (status, body) = post(state, r#"{"permit":"a.b.c"}"#).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(body.contains("ais_unavailable"), "{body}");
        assert_eq!(market.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn the_body_is_exactly_the_permit() {
        let (state, _) = state(authority("https://ais.invalid")).await;
        let (status, _) = post(Arc::clone(&state), r#"{"permit":"a.b.c","order_id":"x"}"#).await;
        assert!(status.is_client_error(), "{status}");
        let (status, _) = post(state, r#"{}"#).await;
        assert!(status.is_client_error(), "{status}");
    }
}
