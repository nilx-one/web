// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! The client activation routes, end to end: two browsers sign in to the
//! same Bond through the in-process issuer, and every route runs against
//! Core's store. Core decides each state; these tests check that the host
//! carries the cookie, CSRF, bodies and answers through unchanged.

use nilxone_api::activation::{SYNC_PART_BYTES, sync_digest};
use serde_json::Value;

use super::*;
use crate::{
    product_sign_in::{PRODUCT_SESSION_COOKIE, ProductSignIn},
    public_info::{PublicInfoRepository, PublicInfoService},
};

const IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Telegram";
const MAC: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/18.0 Safari/605.1.15";

async fn product_site(fixture: &Fixture) -> Router {
    let product = PublicInfoRepository::connect(&fixture.url)
        .await
        .expect("product repository");
    let service = PublicInfoService::new(
        SignInFlow::new(fixture.client.clone(), native_auth().secret_digester()),
        product,
    )
    .expect("nilx-one client");
    crate::product_sign_in::router(Some(ProductSignIn::new(service, &native_auth())))
}

/// Signs `0x0sky` in on a browser with `user_agent`, presenting `previous`
/// as the product cookie it already holds; returns the new cookie pair.
async fn product_sign_in(
    fixture: &Fixture,
    site: &Router,
    user_agent: &str,
    previous: Option<&str>,
) -> String {
    let start = Request::get("/api/v1/auth/aiaiaiai/start?return=/")
        .body(Body::empty())
        .unwrap();
    let (_, headers, _) = send(site, start).await;
    let transaction_cookie = cookie_pair(&headers, "__Host-0x1_aiaiaiai");
    let to_issuer = location(&headers);
    let (_, page_headers, html) = send(&fixture.issuer, get(&path_and_query(&to_issuer))).await;
    let browser = cookie_pair(&page_headers, BROWSER_COOKIE);
    let (status, headers, _) = send(
        &fixture.issuer,
        post_form(
            "/authorize",
            &browser,
            &[
                ("request", &hidden_request(&html)),
                ("step", "sign_in"),
                ("pub_dress", "0x0sky"),
                ("password", PASSWORD),
            ],
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let cookies = match previous {
        Some(previous) => format!("{transaction_cookie}; {previous}"),
        None => transaction_cookie,
    };
    let callback = Request::get(path_and_query(&location(&headers)))
        .header(header::COOKIE, cookies)
        .header(header::USER_AGENT, user_agent)
        .body(Body::empty())
        .unwrap();
    let (status, headers, body) = send(site, callback).await;
    assert_eq!(status, StatusCode::SEE_OTHER, "{body}");
    cookie_pair(&headers, PRODUCT_SESSION_COOKIE)
}

fn activation(
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    csrf: bool,
    body: Body,
) -> Request<Body> {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    if csrf {
        request = request.header("x-0x1-csrf", "1");
    }
    request.body(body).unwrap()
}

async fn state_of(site: &Router, cookie: &str) -> Value {
    let (status, headers, body) = send(
        site,
        activation(
            "GET",
            "/api/v1/session/activation",
            Some(cookie),
            false,
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
    serde_json::from_str(&body).unwrap()
}

async fn step(site: &Router, cookie: &str, uri: &str) -> (StatusCode, Value) {
    let (status, _, body) = send(
        site,
        activation("POST", uri, Some(cookie), true, Body::empty()),
    )
    .await;
    (status, serde_json::from_str(&body).unwrap())
}

fn error_code(body: &str) -> String {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    value["error"]["code"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

async fn publish(site: &Router, cookie: &str) -> (StatusCode, String) {
    let request = Request::post("/api/v1/product/experience")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, cookie)
        .header("x-0x1-csrf", "1")
        .body(Body::from(r#"{"bond_xp":1,"avaia_xp":1}"#))
        .unwrap();
    let (status, _, body) = send(site, request).await;
    (status, error_code(&body))
}

#[tokio::test]
async fn signing_in_again_on_the_active_client_keeps_it_active() {
    let fixture = fixture().await;
    let site = product_site(&fixture).await;
    let first = product_sign_in(&fixture, &site, IPHONE, None).await;
    let state = state_of(&site, &first).await;
    assert_eq!(state["state"], "authenticated_active");
    assert_eq!(
        state["client_label"],
        crate::repository::session_client_label("Browser", Some(IPHONE))
    );

    let again = product_sign_in(&fixture, &site, IPHONE, Some(&first)).await;
    assert_ne!(again, first);
    let state = state_of(&site, &again).await;
    assert_eq!(state["state"], "authenticated_active", "{state}");
    assert_eq!(state["may_act"], true);

    let (status, _, body) = send(
        &site,
        activation(
            "GET",
            "/api/v1/session/activation",
            Some(&first),
            false,
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&body), "provider_authentication_required");
}

#[tokio::test]
async fn every_route_needs_the_session_and_every_write_needs_csrf() {
    let fixture = fixture().await;
    let site = product_site(&fixture).await;
    let session = product_sign_in(&fixture, &site, IPHONE, None).await;
    let id = "0".repeat(32);
    let writes = [
        ("POST", "/api/v1/session/activation/requests".to_owned()),
        (
            "POST",
            format!("/api/v1/session/activation/requests/{id}/cancel"),
        ),
        (
            "POST",
            format!("/api/v1/session/activation/requests/{id}/approve"),
        ),
        (
            "POST",
            format!("/api/v1/session/activation/requests/{id}/decline"),
        ),
        (
            "PUT",
            format!("/api/v1/session/activation/requests/{id}/sync?offset=0&total_bytes=0"),
        ),
    ];
    for (method, uri) in &writes {
        let (status, _, body) = send(
            &site,
            activation(method, uri, Some(&session), false, Body::empty()),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
        assert_eq!(error_code(&body), "csrf_protection_required");
        let (status, _, body) =
            send(&site, activation(method, uri, None, true, Body::empty())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(error_code(&body), "provider_authentication_required");
    }
    let complete = format!("/api/v1/session/activation/requests/{id}/complete");
    let digest = Body::from(format!(r#"{{"digest":"{}"}}"#, sync_digest(b"")));
    let request = Request::post(&complete)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, &session)
        .body(digest)
        .unwrap();
    let (status, _, _) = send(&site, request).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    for uri in [
        "/api/v1/session/activation".to_owned(),
        format!("/api/v1/session/activation/requests/{id}/sync?offset=0"),
    ] {
        let (status, _, body) =
            send(&site, activation("GET", &uri, None, false, Body::empty())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
        assert_eq!(error_code(&body), "provider_authentication_required");
    }

    // The active client has nothing to ask for; Core refuses, the host carries it.
    let (status, value) = step(&site, &session, "/api/v1/session/activation/requests").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(value["error"]["code"], "already_active");
    let (status, value) = step(
        &site,
        &session,
        &format!("/api/v1/session/activation/requests/{id}/approve"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value["error"]["code"], "activation_request_not_found");
}

#[tokio::test]
async fn the_active_client_moves_only_after_a_completed_sync() {
    let fixture = fixture().await;
    let site = product_site(&fixture).await;
    let phone = product_sign_in(&fixture, &site, IPHONE, None).await;
    let mac = product_sign_in(&fixture, &site, MAC, None).await;
    let phone_label = crate::repository::session_client_label("Browser", Some(IPHONE));

    let state = state_of(&site, &mac).await;
    assert_eq!(state["state"], "active_elsewhere");
    assert_eq!(state["may_act"], false);
    assert_eq!(state["active_client_label"], phone_label);
    assert_eq!(
        publish(&site, &mac).await,
        (StatusCode::FORBIDDEN, "session_inactive".to_owned())
    );

    let (status, value) = step(&site, &mac, "/api/v1/session/activation/requests").await;
    assert_eq!(status, StatusCode::CREATED, "{value}");
    assert_eq!(value["state"], "activation_pending");
    let id = value["request"]["id"].as_str().unwrap().to_owned();
    let requests = format!("/api/v1/session/activation/requests/{id}");

    assert_eq!(state_of(&site, &phone).await["state"], "approval_requested");
    let (status, value) = step(&site, &phone, &format!("{requests}/approve")).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["state"], "upload_required");
    assert_eq!(value["may_act"], false);

    // Two parts: the first is a whole SYNC_PART_BYTES, far over the 1 KiB the
    // other product routes accept.
    let part = usize::try_from(SYNC_PART_BYTES).unwrap();
    let payload: Vec<u8> = (0..part + 1000).map(|index| (index % 251) as u8).collect();
    let total = payload.len();
    let upload = |offset: usize, bytes: Vec<u8>| {
        Request::put(format!(
            "{requests}/sync?offset={offset}&total_bytes={total}"
        ))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::COOKIE, &phone)
        .header("x-0x1-csrf", "1")
        .body(Body::from(bytes))
        .unwrap()
    };
    let (status, _, body) = send(&site, upload(0, vec![0; part + 1])).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "{body}");
    let (status, _, body) = send(&site, upload(0, payload[..1000].to_vec())).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "sync_out_of_order");
    let (status, _, body) = send(&site, upload(0, payload[..part].to_vec())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _, body) = send(&site, upload(part, payload[part..].to_vec())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["state"], "handoff_syncing");

    let state = state_of(&site, &mac).await;
    assert_eq!(state["state"], "activation_syncing");
    assert_eq!(state["request"]["progress"]["total_bytes"], total);

    let mut fetched = Vec::new();
    for offset in [0, part] {
        let response = site
            .clone()
            .oneshot(activation(
                "GET",
                &format!("{requests}/sync?offset={offset}"),
                Some(&mac),
                false,
                Body::empty(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/octet-stream"
        );
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        fetched.extend_from_slice(&to_bytes(response.into_body(), part).await.unwrap());
    }
    assert_eq!(fetched, payload);

    let complete = |digest: &str| {
        Request::post(format!("{requests}/complete"))
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::COOKIE, &mac)
            .header("x-0x1-csrf", "1")
            .body(Body::from(format!(r#"{{"digest":"{digest}"}}"#)))
            .unwrap()
    };
    let (status, _, body) = send(&site, complete("not-a-digest")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error_code(&body), "invalid_sync_digest");
    assert_eq!(state_of(&site, &phone).await["state"], "handoff_syncing");

    let (status, _, body) = send(&site, complete(&sync_digest(&fetched))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["state"], "authenticated_active");
    assert_eq!(value["may_act"], true);

    assert_eq!(state_of(&site, &phone).await["state"], "active_elsewhere");
    assert_eq!(
        publish(&site, &phone).await,
        (StatusCode::FORBIDDEN, "session_inactive".to_owned())
    );
    assert_eq!(publish(&site, &mac).await.0, StatusCode::OK);
}
