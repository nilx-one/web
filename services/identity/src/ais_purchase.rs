// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! `POST /api/v1/identity/ais-purchase`: the buyer's confirmed Telegram Special
//! checkout, authorized by an AIS permit (`aiaiaiai-org/4x-ais`
//! `docs/hub-protocol.md`). The permit is the only credential: it is signed by the
//! pinned AIS for audience `0x1`, names the requesting product, the buyer and the
//! exact order terms, and lives two minutes. Core verifies it, claims the Market
//! order it names and settles the order; nothing here reads a price or a balance.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header::CACHE_CONTROL},
    response::{IntoResponse, Response},
    routing::post,
};
use nilxone_identity::{
    aiaiaiai_sign_in::{JsonWebKeySet, purchase::PurchaseAuthority},
    market_issuer::{AisSettleError, MarketIssuerApi, MarketIssuerWorker, Settlement},
};
use serde::Deserialize;

/// The only product that may request a permit for this checkout.
const PRODUCT: &str = "0xda-market";
/// The one AIS: the permit's issuer, and where its signing keys are read. Not a setting.
pub const AIS_ISSUER: &str = "https://auth.aiaiaiai.org";
const KEY_TTL: Duration = Duration::from_secs(300);
const KEY_REFRESH_AFTER_REFUSAL: Duration = Duration::from_secs(60);
const KEY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_KEY_BYTES: usize = 65_536;

/// AIS's public signing keys, cached. A permit refused under an older cache is tried
/// once more under fresh keys, at most once a minute, so a rotated key is picked up
/// without letting a stream of bad permits turn the service into a client hammering AIS.
struct AisKeys {
    uri: url::Url,
    http: reqwest::Client,
    cached: Mutex<Option<(Instant, Arc<JsonWebKeySet>)>>,
}

impl AisKeys {
    fn new(base: &url::Url) -> Option<Self> {
        let http = reqwest::Client::builder()
            .timeout(KEY_TIMEOUT)
            .build()
            .ok()?;
        Some(Self {
            uri: base.join("/.well-known/jwks.json").ok()?,
            http,
            cached: Mutex::new(None),
        })
    }

    fn cached(&self, max_age: Duration) -> Option<Arc<JsonWebKeySet>> {
        let guard = self
            .cached
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard
            .as_ref()
            .filter(|(at, _)| at.elapsed() < max_age)
            .map(|(_, keys)| Arc::clone(keys))
    }

    async fn fetch(&self) -> Option<Arc<JsonWebKeySet>> {
        let response = self.http.get(self.uri.clone()).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let body = response
            .bytes()
            .await
            .ok()
            .filter(|body| body.len() <= MAX_KEY_BYTES)?;
        let keys = Arc::new(serde_json::from_slice::<JsonWebKeySet>(&body).ok()?);
        *self
            .cached
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some((Instant::now(), Arc::clone(&keys)));
        Some(keys)
    }

    async fn current(&self) -> Option<Arc<JsonWebKeySet>> {
        match self.cached(KEY_TTL) {
            Some(keys) => Some(keys),
            None => self.fetch().await,
        }
    }

    /// Fresh keys after a refusal, unless the cache is already younger than a minute.
    async fn refreshed(&self) -> Option<Arc<JsonWebKeySet>> {
        match self.cached(KEY_REFRESH_AFTER_REFUSAL) {
            Some(_) => None,
            None => self.fetch().await,
        }
    }
}

pub struct AisPurchase<M> {
    worker: MarketIssuerWorker<M>,
    issuer: String,
    keys: AisKeys,
}

impl<M> AisPurchase<M> {
    pub fn new(worker: MarketIssuerWorker<M>) -> Arc<Self> {
        Self::with_origin(worker, AIS_ISSUER).expect("the pinned AIS origin is a URL")
    }

    fn with_origin(worker: MarketIssuerWorker<M>, issuer: &str) -> Option<Arc<Self>> {
        let origin = url::Url::parse(issuer).ok()?;
        Some(Arc::new(Self {
            worker,
            issuer: issuer.trim_end_matches('/').to_owned(),
            keys: AisKeys::new(&origin)?,
        }))
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
    let Some(keys) = state.keys.current().await else {
        return answer(StatusCode::SERVICE_UNAVAILABLE, "ais_unavailable");
    };
    let mut result = settle(&state, &keys, &request.permit).await;
    if matches!(result, Err(AisSettleError::Permit(_)))
        && let Some(fresh) = state.keys.refreshed().await
    {
        result = settle(&state, &fresh, &request.permit).await;
    }
    match result {
        Ok(Settlement::Fulfilled) => answer(StatusCode::OK, "fulfilled"),
        // The wallet kept nothing: the order was refused with a code Market holds.
        Ok(Settlement::Rejected(code)) => answer(StatusCode::CONFLICT, code),
        Ok(Settlement::Skipped) => answer(StatusCode::CONFLICT, "order_not_available"),
        Ok(Settlement::Held) => answer(StatusCode::SERVICE_UNAVAILABLE, "held_for_operator"),
        Err(AisSettleError::Permit(_)) => answer(StatusCode::UNAUTHORIZED, "invalid_permit"),
        Err(AisSettleError::Worker(error)) => {
            tracing::error!(%error, "AIS purchase could not be settled");
            answer(StatusCode::SERVICE_UNAVAILABLE, "temporarily_unavailable")
        }
    }
}

async fn settle<M: MarketIssuerApi + 'static>(
    state: &AisPurchase<M>,
    keys: &JsonWebKeySet,
    permit: &str,
) -> Result<Settlement, AisSettleError> {
    let authority = PurchaseAuthority {
        issuer: &state.issuer,
        product: PRODUCT,
        keys,
    };
    state.worker.settle_ais_permit(&authority, permit).await
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
        ais: &str,
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
        (
            AisPurchase::with_origin(worker, ais).expect("AIS origin"),
            calls,
        )
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
        let (state, market) = state("https://ais.invalid").await;
        // Keys AIS served a moment ago, none of which signed this permit.
        *state.keys.cached.lock().unwrap() = Some((
            Instant::now(),
            Arc::new(serde_json::from_str::<JsonWebKeySet>(r#"{"keys":[]}"#).unwrap()),
        ));
        let (status, body) = post(state, r#"{"permit":"a.b.c"}"#).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(body.contains("invalid_permit"), "{body}");
        assert_eq!(market.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_unreachable_ais_answers_unavailable_not_unauthorized() {
        let (state, market) = state("http://127.0.0.1:9").await;
        let (status, body) = post(state, r#"{"permit":"a.b.c"}"#).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(body.contains("ais_unavailable"), "{body}");
        assert_eq!(market.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn the_body_is_exactly_the_permit() {
        let (state, _) = state("https://ais.invalid").await;
        let (status, _) = post(Arc::clone(&state), r#"{"permit":"a.b.c","order_id":"x"}"#).await;
        assert!(status.is_client_error(), "{status}");
        let (status, _) = post(state, r#"{}"#).await;
        assert!(status.is_client_error(), "{status}");
    }
}
