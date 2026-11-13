// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Without configuration every route answers honestly instead of vanishing.
//! The configured path runs end to end against an issuer in
//! `issuer_tests.rs`.

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use tower::ServiceExt as _;

use super::*;

async fn send(request: Request<Body>) -> (StatusCode, String) {
    let response = router(None).oneshot(request).await.expect("response");
    let status = response.status();
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    let body = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

#[tokio::test]
async fn an_unconfigured_site_says_so_on_every_route() {
    let (status, body) = send(
        Request::get("/api/v1/auth/aiaiaiai/config")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains("\"enabled\":false") && body.contains("\"issuer\":null"),
        "{body}"
    );

    for uri in [
        "/api/v1/auth/aiaiaiai/start",
        "/api/v1/auth/aiaiaiai/callback?code=x&state=y",
        "/api/v1/product/session",
        "/api/v1/product/profiles/00000000000000000000000000000000",
        "/api/v1/session/activation",
        "/api/v1/session/activation/requests/00000000000000000000000000000000/sync?offset=0",
    ] {
        let (status, body) = send(Request::get(uri).body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        assert!(body.contains("aiaiaiai_sign_in_not_configured"), "{body}");
    }
    for uri in [
        "/api/v1/product/session/sign-out",
        "/api/v1/product/experience",
        "/api/v1/session/activation/requests",
    ] {
        let request = Request::post(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-0x1-csrf", "1")
            .body(Body::from(r#"{"bond_xp":1,"avaia_xp":1}"#))
            .unwrap();
        let (status, _) = send(request).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
    }
}
