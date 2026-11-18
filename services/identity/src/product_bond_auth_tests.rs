// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! The Special routes accept the product session of an attached legacy Bond;
//! nothing else does. The Bond comes only from Core's durable binding.

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use nilxone_identity::{
    IdentityRepository, NativeAuthConfig,
    provider_link::ProviderLinkRepository,
    public_info::{LegacyBondMigrationRepository, PublicInfoRepository},
};
use tower::ServiceExt as _;

use super::*;
use crate::{TelegramInitDataVerifier, product_sign_in::PRODUCT_SESSION_COOKIE};

const TOKEN: &str = "0x1s_product_session_token_for_tests";

fn native_auth() -> NativeAuthConfig {
    NativeAuthConfig::new(
        "test-auth-secret-that-is-at-least-thirty-two-bytes",
        "test-password-pepper-that-is-at-least-thirty-two-bytes",
    )
    .expect("native auth configuration")
}

struct Fixture {
    url: String,
    _dir: tempfile::TempDir,
    pool: sqlx::SqlitePool,
    repository: IdentityRepository,
    links: ProviderLinkRepository,
    store: LegacyBondMigrationRepository,
}

/// One database holding the legacy Bond `0x0sky` and an AIS profile with a
/// live product session; `bound` attaches the profile to the Bond, `active`
/// makes the session the profile's active client.
async fn fixture(bound: bool, active: bool) -> Fixture {
    let dir = tempfile::tempdir().expect("directory");
    let url = format!("sqlite://{}", dir.path().join("bonds.sqlite").display());
    let repository = IdentityRepository::connect(&url).await.expect("identity");
    let links = ProviderLinkRepository::connect(&url).await.expect("links");
    let product = PublicInfoRepository::connect(&url).await.expect("product");
    let store = LegacyBondMigrationRepository::prepare(product)
        .await
        .expect("migration store");
    let pool = sqlx::SqlitePool::connect(&url).await.expect("pool");
    let digest = native_auth()
        .secret_digester()
        .digest(PRODUCT_SESSION_DOMAIN, TOKEN);
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    for statement in [
        "INSERT INTO identities (pub_dress, identity_kind, created_at) VALUES ('0x0sky', 'human', 1)",
        "INSERT INTO public_profiles (issuer, subject, last_auth_time) VALUES ('https://auth.aiaiaiai.org', 'subject-a', 1)",
    ] {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect(statement);
    }
    sqlx::query(
        "INSERT INTO product_sessions (token_hash, issuer, subject, profile_id, created_at, expires_at, active) \
         SELECT ?, issuer, subject, profile_id, 1, 10000000000, ? FROM public_profiles",
    )
    .bind(&hex)
    .bind(i64::from(active))
    .execute(&pool)
    .await
    .expect("product session");
    if bound {
        sqlx::query("INSERT INTO legacy_bond_keys (legacy_pub_dress) VALUES ('0x0sky')")
            .execute(&pool)
            .await
            .expect("bond key");
        sqlx::query(
            "INSERT INTO legacy_bond_bindings (bond_id, profile_id, linked_at) \
             SELECT k.bond_id, p.profile_id, 2 FROM legacy_bond_keys k CROSS JOIN public_profiles p",
        )
        .execute(&pool)
        .await
        .expect("binding");
    }
    Fixture {
        url,
        _dir: dir,
        pool,
        repository,
        links,
        store,
    }
}

impl Fixture {
    /// The router that serves xPing and the finds and crafts routes.
    fn pub_info(&self, enabled: bool) -> Router {
        let product = enabled
            .then(|| ProductBondAuth::new(self.store.clone(), native_auth().secret_digester()));
        crate::api::pub_info_router_with_product_bonds(
            self.repository.clone(),
            self.links.clone(),
            TelegramInitDataVerifier::new("123:test-token".to_owned(), 300),
            None,
            native_auth(),
            product,
        )
    }

    fn router(&self, enabled: bool) -> Router {
        let product = enabled
            .then(|| ProductBondAuth::new(self.store.clone(), native_auth().secret_digester()));
        crate::api::router_with_product_bonds(
            self.repository.clone(),
            self.links.clone(),
            TelegramInitDataVerifier::new("123:test-token".to_owned(), 300),
            None,
            native_auth(),
            product,
        )
    }
}

async fn send(app: &Router, request: Request<Body>) -> (StatusCode, String) {
    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let body = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

fn product_cookie() -> String {
    format!("{PRODUCT_SESSION_COOKIE}={TOKEN}")
}

fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut request = Request::get(uri);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    request.body(Body::empty()).unwrap()
}

fn inventory_change(cookie: &str) -> Request<Body> {
    Request::post("/api/v1/identity/special-inventory")
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-0x1-csrf", "1")
        .body(Body::from(r#"{"state":"{}","command":{}}"#))
        .unwrap()
}

#[tokio::test]
async fn an_attached_bonds_product_session_reads_its_special_state() {
    let fixture = fixture(true, true).await;
    let app = fixture.router(true);
    for uri in [
        "/api/v1/identity/special-items",
        "/api/v1/identity/subscription",
    ] {
        let (status, body) = send(&app, get(uri, Some(&product_cookie()))).await;
        assert_eq!(status, StatusCode::OK, "{uri}: {body}");
    }
    // The route names no Bond: another address in the path or query changes nothing.
    let (status, _) = send(
        &app,
        get(
            "/api/v1/identity/special-items?pub_dress=0x1other",
            Some(&product_cookie()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // A product session never mints a native session or cookie.
    let response = app
        .clone()
        .oneshot(get(
            "/api/v1/identity/special-items",
            Some(&product_cookie()),
        ))
        .await
        .unwrap();
    assert!(response.headers().get(header::SET_COOKIE).is_none());
}

#[tokio::test]
async fn an_inactive_product_session_reads_but_cannot_change_inventory() {
    let fixture = fixture(true, false).await;
    let app = fixture.router(true);
    let (status, _) = send(
        &app,
        get("/api/v1/identity/special-items", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "an inactive session still reads");
    let (status, body) = send(&app, inventory_change(&product_cookie())).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(body.contains("session_inactive"), "{body}");
}

#[tokio::test]
async fn nothing_else_resolves_to_a_bond() {
    // Not attached: a valid AIS session with no binding is not an existing Bond.
    let unbound = fixture(false, true).await;
    let (status, _) = send(
        &unbound.router(true),
        get("/api/v1/identity/special-items", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let attached = fixture(true, true).await;
    // Migration off: the route does not consult product sessions at all.
    let (status, _) = send(
        &attached.router(false),
        get("/api/v1/identity/special-items", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // A cookie that is not a session of this store.
    let (status, _) = send(
        &attached.router(true),
        get(
            "/api/v1/identity/special-items",
            Some("__Host-0x1_product=0x1s_forged"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // Signed out / expired.
    sqlx::query("UPDATE product_sessions SET expires_at = 5")
        .execute(&attached.pool)
        .await
        .unwrap();
    let (status, _) = send(
        &attached.router(true),
        get("/api/v1/identity/special-items", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_attached_bonds_product_session_works_across_the_game_routes() {
    let fixture = fixture(true, true).await;
    let app = fixture.router(true);
    for uri in ["/api/v1/identity/organizations", "/api/v1/identity"] {
        let (status, body) = send(&app, get(uri, Some(&product_cookie()))).await;
        assert_eq!(status, StatusCode::OK, "{uri}: {body}");
    }
    // It reads the Bond the binding names and nothing a request supplies.
    let (_, body) = send(&app, get("/api/v1/identity", Some(&product_cookie()))).await;
    assert!(body.contains("0x0sky"), "{body}");
    // The native context stays anonymous: it is the native session's own route.
    let (status, body) = send(
        &app,
        get("/api/v1/auth/native/context", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains("anonymous") && !body.contains("0x0sky"),
        "{body}"
    );
    // Not attached, or a cookie that is not a session of this store: still 401.
    let (status, _) = send(
        &app,
        get("/api/v1/identity", Some("__Host-0x1_product=0x1s_forged")),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

fn post_json(uri: &str, cookie: &str, body: &str) -> Request<Body> {
    Request::post(uri)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-0x1-csrf", "1")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

const CRAFT: &str = r#"{"craft_id":"craft-0001","recipe":"nonsense","inputs":[]}"#;
const ATTEST: &str = r#"{"artifact_id":"art:seg:1:2:e2961:1:0#a","finder":"bond","found_at_ms":1000,"longitude":30.5,"latitude":50.4}"#;
const SELL: &str = r#"{"attestation_id":"nope"}"#;

#[tokio::test]
async fn xping_and_craft_start_accept_an_attached_bonds_active_product_session() {
    let fixture = fixture(true, true).await;
    let app = fixture.pub_info(true);
    let (status, body) = send(
        &app,
        get("/api/v1/identity/xping/engine", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The craft reaches Core's recipe check; it is not turned away as unauthenticated.
    let (status, body) = send(
        &app,
        post_json("/api/v1/identity/crafts", &product_cookie(), CRAFT),
    )
    .await;
    assert!(
        status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
        "{status}: {body}"
    );
}

#[tokio::test]
async fn an_inactive_product_session_cannot_start_a_craft() {
    let fixture = fixture(true, false).await;
    let app = fixture.pub_info(true);
    let (status, body) = send(
        &app,
        post_json("/api/v1/identity/crafts", &product_cookie(), CRAFT),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(body.contains("session_inactive"), "{body}");
}

#[tokio::test]
async fn finds_seeds_and_the_rest_of_pub_info_accept_it_too_and_an_inactive_one_cannot_write() {
    let active = fixture(true, true).await;
    let app = active.pub_info(true);
    for (uri, body) in [
        ("/api/v1/identity/finds/attest", ATTEST),
        ("/api/v1/identity/finds/sell", SELL),
    ] {
        let (status, text) = send(&app, post_json(uri, &product_cookie(), body)).await;
        assert!(
            status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
            "{uri}: {status} {text}"
        );
    }
    let (status, _) = send(
        &app,
        get(nilxone_api::wallet::SEEDS_PATH, Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let inactive = fixture(true, false).await;
    let app = inactive.pub_info(true);
    let (status, text) = send(
        &app,
        post_json("/api/v1/identity/finds/sell", &product_cookie(), SELL),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{text}");
    assert!(text.contains("session_inactive"), "{text}");
}

#[tokio::test]
async fn the_map_and_location_control_accept_it_too() {
    let fixture = fixture(true, true).await;
    let url = fixture.url.clone();
    let locations = crate::BondLocationRepository::connect(&url)
        .await
        .expect("locations");
    let app = crate::location_control_router(
        fixture.repository.clone(),
        locations,
        TelegramInitDataVerifier::new("123:test-token".to_owned(), 300),
        None,
        native_auth(),
        Some(ProductBondAuth::new(
            fixture.store.clone(),
            native_auth().secret_digester(),
        )),
    );
    let (status, body) = send(
        &app,
        get("/api/v1/location-control", Some(&product_cookie())),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = send(
        &app,
        get(
            "/api/v1/location-control",
            Some("__Host-0x1_product=0x1s_forged"),
        ),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
}
