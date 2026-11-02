// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use base64::engine::general_purpose::STANDARD;
use sha2::Sha256;
use tower::ServiceExt as _;

use super::*;
use crate::{
    BrowserOAuthConfig, ProviderLinkRepository,
    aiaiaiai_sign_in::{SignInClient, SignInClientConfig, SignInError, SignInFlow},
};

const ORIGIN: &str = "https://auth.aiaiaiai.org";
const HOST_NAME: &str = "auth.aiaiaiai.org";
const CALLBACK: &str = "https://nilx.one/api/v1/auth/aiaiaiai/callback";
const SECRET: &str = "a-client-secret-of-thirty-two-bytes!";
const PASSWORD: &str = "correct horse battery";

fn native_auth() -> NativeAuthConfig {
    NativeAuthConfig::new([7_u8; 32], [8_u8; 32]).expect("native auth config")
}

fn clients() -> String {
    let digest: String = Sha256::digest(SECRET.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    serde_json::json!([{
        "client_id": "nilx-one",
        "name": "0x1",
        "redirect_uris": [CALLBACK],
        "secret_sha256": digest,
        "pub_dress": true,
    }])
    .to_string()
}

fn issuer_config() -> IssuerConfig {
    IssuerConfig::new(ORIGIN, &URL_SAFE_NO_PAD.encode([3_u8; 32]), &clients())
        .expect("issuer config")
}

struct Fixture {
    _database: tempfile::NamedTempFile,
    url: String,
    repository: IdentityRepository,
    issuer: Router,
    client: SignInClient,
}

/// An issuer with one Bond (`0x0sky`) and a Core client that reaches it over
/// real HTTP on loopback, as the deployment's back channel does.
async fn fixture() -> Fixture {
    let database = tempfile::NamedTempFile::new().expect("database");
    let url = format!("sqlite://{}", database.path().display());
    let repository = IdentityRepository::connect(&url).await.expect("repository");
    let engine = native_auth().password_engine();
    let hash = engine.hash(&engine.validate(PASSWORD).unwrap()).unwrap();
    let outcome = repository
        .register_native_password(
            &PubDress::from_str("0x0sky").unwrap(),
            &hash,
            engine.hash_version(),
            b"fixture-registration",
            1,
        )
        .await
        .expect("register");
    assert!(matches!(outcome, NativeRegistrationOutcome::Registered(_)));
    let issuer = router(issuer_config(), repository.clone(), native_auth());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let served = issuer.clone();
    tokio::spawn(async move { axum::serve(listener, served).await });
    let client = SignInClient::new(
        SignInClientConfig::new(
            ORIGIN,
            Some(&format!("http://{address}")),
            "nilx-one",
            SECRET,
            CALLBACK,
        )
        .unwrap(),
    );
    Fixture {
        _database: database,
        url,
        repository,
        issuer,
        client,
    }
}

async fn send(
    router: &Router,
    request: Request<Body>,
) -> (StatusCode, axum::http::HeaderMap, String) {
    let response = router.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, headers, String::from_utf8_lossy(&body).into_owned())
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri)
        .header(header::HOST, HOST_NAME)
        .body(Body::empty())
        .unwrap()
}

fn post_form(uri: &str, cookie: &str, fields: &[(&str, &str)]) -> Request<Body> {
    let body: String = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish();
    Request::post(uri)
        .header(header::HOST, HOST_NAME)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(header::COOKIE, cookie)
        .body(Body::from(body))
        .unwrap()
}

fn hidden_request(html: &str) -> String {
    let marker = "name=\"request\" value=\"";
    let start = html.find(marker).expect("request field") + marker.len();
    html[start..].split('"').next().unwrap().to_owned()
}

fn cookie_pair(headers: &axum::http::HeaderMap, name: &str) -> String {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with(&format!("{name}=")))
        .and_then(|value| value.split(';').next())
        .unwrap_or_else(|| panic!("{name} cookie"))
        .to_owned()
}

fn location(headers: &axum::http::HeaderMap) -> Url {
    Url::parse(
        headers
            .get(header::LOCATION)
            .expect("location")
            .to_str()
            .unwrap(),
    )
    .unwrap()
}

fn query(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

fn path_and_query(url: &Url) -> String {
    format!("{}?{}", url.path(), url.query().unwrap_or_default())
}

/// Opens the page for a fresh authorization request; returns the signed
/// request field and the browser-binding cookie.
async fn open_page(fixture: &Fixture) -> (SignInTransaction, String, String) {
    let (url, transaction) = fixture.client.begin().unwrap();
    let (status, headers, html) = send(&fixture.issuer, get(&path_and_query(&url))).await;
    assert_eq!(status, StatusCode::OK, "{html}");
    assert!(html.contains("autocomplete=\"username\""));
    (
        transaction,
        hidden_request(&html),
        cookie_pair(&headers, BROWSER_COOKIE),
    )
}

async fn sign_in_with(
    fixture: &Fixture,
    password: &str,
) -> (SignInTransaction, StatusCode, axum::http::HeaderMap, String) {
    let (transaction, request, cookie) = open_page(fixture).await;
    let (status, _, html) = send(
        &fixture.issuer,
        post_form(
            "/authorize",
            &cookie,
            &[
                ("request", &request),
                ("step", "identify"),
                ("pub_dress", "0x0sky"),
            ],
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("autocomplete=\"current-password\""), "{html}");
    let (status, headers, html) = send(
        &fixture.issuer,
        post_form(
            "/authorize",
            &cookie,
            &[
                ("request", &request),
                ("step", "sign_in"),
                ("pub_dress", "0x0sky"),
                ("password", password),
            ],
        ),
    )
    .await;
    (transaction, status, headers, html)
}

use crate::aiaiaiai_sign_in::SignInTransaction;

#[tokio::test]
async fn a_password_sign_in_reaches_the_client_as_a_verified_pairwise_subject() {
    let fixture = fixture().await;
    let (transaction, status, headers, _) = sign_in_with(&fixture, PASSWORD).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let back = location(&headers);
    assert_eq!(
        format!("{}{}", back.origin().ascii_serialization(), back.path()),
        CALLBACK
    );
    assert_eq!(
        query(&back, "state").as_deref(),
        Some(transaction.state.as_str())
    );
    cookie_pair(&headers, REMEMBERED_COOKIE);
    let code = query(&back, "code").expect("code");

    let now = now_unix_seconds().unwrap();
    let verified = fixture
        .client
        .complete(&code, &transaction, now)
        .await
        .expect("verified");
    assert_eq!(verified.issuer, ORIGIN);
    assert_eq!(verified.pub_dress.as_deref(), Some("0x0sky"));
    let expected = fixture
        .repository
        .client_pairwise_subject(
            &PubDress::from_str("0x0sky").unwrap(),
            "nilx-one",
            &native_auth().secret_digester(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(verified.subject, expected);

    // A code is spent by its first exchange.
    assert_eq!(
        fixture.client.complete(&code, &transaction, now).await,
        Err(SignInError::CodeRejected)
    );
}

#[tokio::test]
async fn a_wrong_password_issues_no_code() {
    let fixture = fixture().await;
    let (_, status, headers, html) = sign_in_with(&fixture, "not the password").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(headers.get(header::LOCATION).is_none());
    assert!(html.contains("incorrect"), "{html}");
}

#[tokio::test]
async fn registration_creates_the_account_with_its_password_and_signs_in() {
    let fixture = fixture().await;
    let (transaction, request, cookie) = open_page(&fixture).await;
    let (_, _, html) = send(
        &fixture.issuer,
        post_form(
            "/authorize",
            &cookie,
            &[
                ("request", &request),
                ("step", "identify"),
                ("pub_dress", "0x0new"),
            ],
        ),
    )
    .await;
    assert!(html.contains("autocomplete=\"new-password\""), "{html}");
    let register = |confirm: &'static str| {
        post_form(
            "/authorize",
            &cookie,
            &[
                ("request", &request),
                ("step", "register"),
                ("pub_dress", "0x0new"),
                ("password", "a new long password"),
                ("password_confirm", confirm),
            ],
        )
    };
    let (status, _, html) = send(&fixture.issuer, register("something else")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(html.contains("do not match"), "{html}");
    let (status, headers, _) = send(&fixture.issuer, register("a new long password")).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let code = query(&location(&headers), "code").expect("code");
    let verified = fixture
        .client
        .complete(&code, &transaction, now_unix_seconds().unwrap())
        .await
        .unwrap();
    assert_eq!(verified.pub_dress.as_deref(), Some("0x0new"));
    let credential = fixture
        .repository
        .find_native_credential(&PubDress::from_str("0x0new").unwrap())
        .await
        .unwrap()
        .expect("the new Bond has a password");
    assert!(credential.active);
}

#[tokio::test]
async fn an_unknown_client_or_redirect_never_redirects() {
    let fixture = fixture().await;
    let (url, _) = fixture.client.begin().unwrap();
    let mut other = url.clone();
    let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    for (field, value) in [
        ("client_id", "evil"),
        ("redirect_uri", "https://evil.example/cb"),
    ] {
        other.query_pairs_mut().clear();
        for (key, original) in &pairs {
            other
                .query_pairs_mut()
                .append_pair(key, if key == field { value } else { original });
        }
        let (status, headers, _) = send(&fixture.issuer, get(&path_and_query(&other))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}");
        assert!(headers.get(header::LOCATION).is_none(), "{field}");
    }
}

#[tokio::test]
async fn a_request_without_pkce_is_sent_back_with_an_error() {
    let fixture = fixture().await;
    let uri = format!(
        "/authorize?response_type=code&client_id=nilx-one&redirect_uri={}&scope=openid&state=s&nonce=n",
        url::form_urlencoded::byte_serialize(CALLBACK.as_bytes()).collect::<String>()
    );
    let (status, headers, _) = send(&fixture.issuer, get(&uri)).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let back = location(&headers);
    assert_eq!(query(&back, "error").as_deref(), Some("invalid_request"));
    assert_eq!(query(&back, "state").as_deref(), Some("s"));
}

#[tokio::test]
async fn the_page_is_served_only_on_the_issuer_host() {
    let fixture = fixture().await;
    let (url, _) = fixture.client.begin().unwrap();
    let request = Request::get(path_and_query(&url))
        .header(header::HOST, "nilx.one")
        .body(Body::empty())
        .unwrap();
    let (status, _, _) = send(&fixture.issuer, request).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_form_posted_without_the_browser_binding_is_refused() {
    let fixture = fixture().await;
    let (_, request, _) = open_page(&fixture).await;
    let (status, headers, _) = send(
        &fixture.issuer,
        post_form(
            "/authorize",
            &format!("{BROWSER_COOKIE}=someone-else"),
            &[
                ("request", &request),
                ("step", "sign_in"),
                ("pub_dress", "0x0sky"),
                ("password", PASSWORD),
            ],
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(headers.get(header::LOCATION).is_none());
}

#[tokio::test]
async fn the_token_endpoint_refuses_a_wrong_secret_or_verifier_and_spends_the_code() {
    let fixture = fixture().await;
    let (transaction, status, headers, _) = sign_in_with(&fixture, PASSWORD).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let code = query(&location(&headers), "code").unwrap();
    let exchange = |secret: &str, verifier: &str| {
        let body: String = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("grant_type", "authorization_code"),
                ("code", code.as_str()),
                ("redirect_uri", CALLBACK),
                ("code_verifier", verifier),
            ])
            .finish();
        Request::post("/token")
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(
                header::AUTHORIZATION,
                format!("Basic {}", STANDARD.encode(format!("nilx-one:{secret}"))),
            )
            .body(Body::from(body))
            .unwrap()
    };
    let (status, _, body) = send(
        &fixture.issuer,
        exchange("wrong-secret", &transaction.code_verifier),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    let wrong_verifier = "x".repeat(43);
    let (status, _, body) = send(&fixture.issuer, exchange(SECRET, &wrong_verifier)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("invalid_grant"));
    // The failed exchange spent the code; the right verifier is now too late.
    let (status, _, _) = send(
        &fixture.issuer,
        exchange(SECRET, &transaction.code_verifier),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn discovery_and_keys_describe_an_eddsa_pairwise_issuer() {
    let fixture = fixture().await;
    let (_, _, body) = send(&fixture.issuer, get("/.well-known/openid-configuration")).await;
    let discovery: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(discovery["issuer"], ORIGIN);
    assert_eq!(
        discovery["subject_types_supported"],
        serde_json::json!(["pairwise"])
    );
    assert_eq!(
        discovery["id_token_signing_alg_values_supported"],
        serde_json::json!(["EdDSA"])
    );
    let (_, _, body) = send(&fixture.issuer, get("/.well-known/jwks.json")).await;
    let keys: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(keys["keys"][0]["crv"], "Ed25519");
    assert!(
        keys["keys"][0].get("d").is_none(),
        "the private key never leaves"
    );
}

#[test]
fn configuration_refuses_unsafe_clients() {
    let key = URL_SAFE_NO_PAD.encode([3_u8; 32]);
    assert_eq!(
        IssuerConfig::new("http://auth.aiaiaiai.org", &key, &clients()).err(),
        Some(IssuerConfigError::Origin)
    );
    assert_eq!(
        IssuerConfig::new(ORIGIN, "short", &clients()).err(),
        Some(IssuerConfigError::SigningKey)
    );
    let http_redirect = clients().replace("https://nilx.one", "http://nilx.one");
    assert!(matches!(
        IssuerConfig::new(ORIGIN, &key, &http_redirect),
        Err(IssuerConfigError::Clients(_))
    ));
    let bad_hash = serde_json::json!([{ "client_id": "nilx-one", "name": "0x1", "redirect_uris": [CALLBACK], "secret_sha256": "00" }]);
    assert!(matches!(
        IssuerConfig::new(ORIGIN, &key, &bad_hash.to_string()),
        Err(IssuerConfigError::Clients(_))
    ));
}

/// The whole 0x1 path: the site's start route, the issuer page, and the
/// callback that resolves the Bond through Core and opens a 0x1 session.
#[tokio::test]
async fn the_0x1_site_signs_in_through_the_issuer_and_gets_its_own_session() {
    let fixture = fixture().await;
    let links = ProviderLinkRepository::connect(&fixture.url)
        .await
        .expect("links");
    let site = crate::browser_web_auth::router(
        fixture.repository.clone(),
        links,
        native_auth(),
        BrowserOAuthConfig::new(Url::parse("https://nilx.one").unwrap(), None, None, None)
            .with_aiaiaiai_sign_in(SignInFlow::new(
                fixture.client.clone(),
                native_auth().secret_digester(),
            )),
    );
    let (status, _, body) = send(
        &site,
        Request::get("/api/v1/auth/aiaiaiai/config")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("\"enabled\":true"), "{body}");

    let start = Request::get("/api/v1/auth/aiaiaiai/start?return=/map")
        .body(Body::empty())
        .unwrap();
    let (status, headers, _) = send(&site, start).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let transaction_cookie = cookie_pair(&headers, "__Host-0x1_aiaiaiai");
    let to_issuer = location(&headers);
    assert_eq!(to_issuer.origin().ascii_serialization(), ORIGIN);

    let (_, page_headers, html) = send(&fixture.issuer, get(&path_and_query(&to_issuer))).await;
    let request = hidden_request(&html);
    let browser = cookie_pair(&page_headers, BROWSER_COOKIE);
    let (status, headers, _) = send(
        &fixture.issuer,
        post_form(
            "/authorize",
            &browser,
            &[
                ("request", &request),
                ("step", "sign_in"),
                ("pub_dress", "0x0sky"),
                ("password", PASSWORD),
            ],
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let back = location(&headers);

    let callback = Request::get(path_and_query(&back))
        .header(header::COOKIE, &transaction_cookie)
        .body(Body::empty())
        .unwrap();
    let (status, headers, body) = send(&site, callback).await;
    assert_eq!(status, StatusCode::SEE_OTHER, "{body}");
    assert_eq!(headers.get(header::LOCATION).unwrap(), "/map");
    cookie_pair(&headers, "__Host-0x1_session");

    // A forged state never reaches the issuer's token endpoint.
    let mut forged = back.clone();
    forged
        .query_pairs_mut()
        .clear()
        .append_pair("code", "x")
        .append_pair("state", "forged");
    let callback = Request::get(path_and_query(&forged))
        .header(header::COOKIE, &transaction_cookie)
        .body(Body::empty())
        .unwrap();
    let (_, headers, _) = send(&site, callback).await;
    assert_eq!(
        headers.get(header::LOCATION).unwrap(),
        "/?auth_error=aiaiaiai_sign_in_invalid"
    );
}
