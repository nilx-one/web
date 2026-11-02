// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! The aiaiaiai Identity issuer at `auth.aiaiaiai.org` (`docs/unified-auth.md`).
//!
//! Every product signs people in here, on one origin, so a password manager
//! keeps one credential for all of them. The protocol is OpenID Connect,
//! authorization code with PKCE (S256), with a pairwise `sub` per client and
//! EdDSA-signed `id_token`s. The page is rendered on the server and needs no
//! JavaScript. Products are clients: 0x1 reaches this only through
//! `nilx-one/core`'s `aiaiaiai_sign_in`, never by reading issuer state.

use std::{
    collections::HashMap,
    str::FromStr,
    sync::{Arc, Mutex},
};

use axum::{
    Form, Json, Router,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{ACCEPT_LANGUAGE, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, HOST, LOCATION},
    },
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{
    Engine as _, engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD,
};
use ed25519_dalek::{Signer as _, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use url::Url;

use crate::{
    IdentityRepository, NativeAuthConfig, PasswordEngine, PubDress, SecretDigester,
    browser_web_auth::{
        SignedCookie, append_cookie, clear_cookie, now_unix_seconds, random_urlsafe, read_cookie,
        secure_cookie,
    },
    credentials::{PasswordPolicyError, RememberedBondSigner},
    rate_limit::AttemptLimiter,
    repository::NativeRegistrationOutcome,
};

/// Binds an authorization request to the browser that started it, so a form
/// posted from another site cannot finish someone else's request.
const BROWSER_COOKIE: &str = "__Host-aiaiaiai_authz";
/// Hint only, never authentication: "You already have an account: …".
const REMEMBERED_COOKIE: &str = "__Host-aiaiaiai_bond";
const REQUEST_TTL_SECONDS: u64 = 15 * 60;
const CODE_TTL_SECONDS: u64 = 60;
const ID_TOKEN_TTL_SECONDS: u64 = 5 * 60;
const MAX_PARAMETER_BYTES: usize = 512;
const MAX_PENDING_CODES: usize = 10_000;

#[derive(Debug, thiserror::Error, Eq, PartialEq)]
pub enum IssuerConfigError {
    #[error("AIAIAIAI_ISSUER must be an https origin")]
    Origin,
    #[error("AIAIAIAI_ISSUER_SIGNING_KEY must be a base64url 32-byte Ed25519 seed")]
    SigningKey,
    #[error("AIAIAIAI_ISSUER_CLIENTS must be a JSON array of valid clients: {0}")]
    Clients(String),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClientRecord {
    client_id: String,
    name: String,
    redirect_uris: Vec<String>,
    /// Lowercase hex SHA-256 of the client secret; the secret itself is never
    /// configured here.
    secret_sha256: String,
    #[serde(default)]
    pub_dress: bool,
}

/// A server-registered client. Presentation (`name`) never changes the
/// security rules or the redirects.
#[derive(Clone, Debug)]
struct Client {
    client_id: String,
    name: String,
    redirect_uris: Vec<String>,
    secret_sha256: [u8; 32],
    pub_dress: bool,
}

#[derive(Clone)]
pub struct IssuerConfig {
    origin: Url,
    signing_key: Arc<SigningKey>,
    key_id: String,
    clients: Arc<HashMap<String, Client>>,
}

impl IssuerConfig {
    pub fn new(origin: &str, signing_key: &str, clients: &str) -> Result<Self, IssuerConfigError> {
        let origin = Url::parse(origin).map_err(|_| IssuerConfigError::Origin)?;
        if origin.scheme() != "https"
            || origin.host_str().is_none()
            || origin.path() != "/"
            || origin.query().is_some()
        {
            return Err(IssuerConfigError::Origin);
        }
        let seed = URL_SAFE_NO_PAD
            .decode(signing_key.trim())
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
            .ok_or(IssuerConfigError::SigningKey)?;
        let signing_key = SigningKey::from_bytes(&seed);
        let key_id = URL_SAFE_NO_PAD.encode(Sha256::digest(signing_key.verifying_key().as_bytes()))
            [..16]
            .to_owned();
        let records: Vec<ClientRecord> = serde_json::from_str(clients)
            .map_err(|error| IssuerConfigError::Clients(error.to_string()))?;
        let mut map = HashMap::new();
        for record in records {
            let client = Client::try_from(record).map_err(IssuerConfigError::Clients)?;
            if map.insert(client.client_id.clone(), client).is_some() {
                return Err(IssuerConfigError::Clients("duplicate client_id".into()));
            }
        }
        Ok(Self {
            origin,
            signing_key: Arc::new(signing_key),
            key_id,
            clients: Arc::new(map),
        })
    }

    /// `iss`: the origin without its trailing slash.
    fn issuer(&self) -> &str {
        self.origin.as_str().trim_end_matches('/')
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/{path}", self.issuer())
    }

    fn host(&self) -> String {
        let host = self.origin.host_str().unwrap_or_default();
        match self.origin.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_owned(),
        }
    }
}

impl TryFrom<ClientRecord> for Client {
    type Error = String;

    fn try_from(record: ClientRecord) -> Result<Self, String> {
        let id = &record.client_id;
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(format!("invalid client_id {id:?}"));
        }
        if record.name.trim().is_empty() || record.name.len() > 64 {
            return Err(format!("{id}: name must be 1-64 bytes"));
        }
        if record.redirect_uris.is_empty() {
            return Err(format!("{id}: at least one redirect URI is required"));
        }
        for uri in &record.redirect_uris {
            let parsed = Url::parse(uri).map_err(|_| format!("{id}: invalid redirect URI"))?;
            if parsed.scheme() != "https" || parsed.fragment().is_some() || parsed.as_str() != uri {
                return Err(format!("{id}: redirect URIs must be normalized https URLs"));
            }
        }
        let secret_sha256 = decode_hex32(&record.secret_sha256)
            .ok_or_else(|| format!("{id}: secret_sha256 must be 64 lowercase hex digits"))?;
        Ok(Self {
            client_id: record.client_id,
            name: record.name,
            redirect_uris: record.redirect_uris,
            secret_sha256,
            pub_dress: record.pub_dress,
        })
    }
}

fn decode_hex32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return None;
    }
    let mut bytes = [0_u8; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(bytes)
}

/// A code waiting for its single exchange. The pairwise subject is fixed when
/// the person signs in, so a rename in between cannot change who it names.
#[derive(Clone)]
struct PendingCode {
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    nonce: String,
    subject: String,
    pub_dress: Option<String>,
    auth_time: u64,
    expires_at: u64,
}

#[derive(Clone)]
struct IssuerState {
    config: IssuerConfig,
    repository: IdentityRepository,
    password_engine: PasswordEngine,
    digester: SecretDigester,
    remembered: RememberedBondSigner,
    signer: SignedCookie,
    limiter: AttemptLimiter,
    dummy_password_hash: Arc<str>,
    // Codes live sixty seconds in this single process; a restart only makes
    // the person sign in again.
    codes: Arc<Mutex<HashMap<[u8; 32], PendingCode>>>,
}

pub fn router(
    config: IssuerConfig,
    repository: IdentityRepository,
    native_auth: NativeAuthConfig,
) -> Router {
    let password_engine = native_auth.password_engine();
    let dummy_password_hash = password_engine
        .hash("aiaiaiai issuer constant-shape dummy password")
        .expect("native password hashing must initialize");
    let state = IssuerState {
        config,
        repository,
        password_engine,
        digester: native_auth.secret_digester(),
        remembered: native_auth.remembered_bond_signer(),
        signer: SignedCookie::new(native_auth.secret_digester()),
        limiter: AttemptLimiter::default(),
        dummy_password_hash: Arc::from(dummy_password_hash),
        codes: Arc::default(),
    };
    Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/.well-known/jwks.json", get(jwks))
        .route("/authorize", get(authorize).post(submit))
        .route("/token", axum::routing::post(token))
        .with_state(state)
}

async fn discovery(State(state): State<IssuerState>) -> Response {
    let config = &state.config;
    public_json(serde_json::json!({
        "issuer": config.issuer(),
        "authorization_endpoint": config.endpoint("authorize"),
        "token_endpoint": config.endpoint("token"),
        "jwks_uri": config.endpoint(".well-known/jwks.json"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "subject_types_supported": ["pairwise"],
        "id_token_signing_alg_values_supported": ["EdDSA"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["openid", "pub_dress"],
        "claims_supported": ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "amr", "pub_dress"],
        "prompt_values_supported": ["login"],
    }))
}

async fn jwks(State(state): State<IssuerState>) -> Response {
    let key = state.config.signing_key.verifying_key();
    public_json(serde_json::json!({ "keys": [{
        "kty": "OKP",
        "crv": "Ed25519",
        "use": "sig",
        "alg": "EdDSA",
        "kid": state.config.key_id,
        "x": URL_SAFE_NO_PAD.encode(key.as_bytes()),
    }]}))
}

fn public_json(value: serde_json::Value) -> Response {
    let mut response = Json(value).into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );
    response
}

// ---------------------------------------------------------------------------
// The authorization request
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
struct AuthorizeQuery {
    response_type: Option<String>,
    client_id: Option<String>,
    redirect_uri: Option<String>,
    scope: Option<String>,
    state: Option<String>,
    nonce: Option<String>,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
}

/// A validated request, carried through the page as a signed form field.
#[derive(Clone, Debug, Deserialize, Serialize)]
struct AuthorizationRequest {
    client_id: String,
    redirect_uri: String,
    state: String,
    nonce: String,
    code_challenge: String,
    pub_dress: bool,
    browser: String,
    expires_at: u64,
}

const REQUEST_DOMAIN: &str = "aiaiaiai-issuer-authorization-request";

async fn authorize(
    State(state): State<IssuerState>,
    headers: HeaderMap,
    Query(query): Query<AuthorizeQuery>,
) -> Response {
    let language = Language::from(&headers);
    if !on_issuer_host(&state, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Until client and redirect are known, nothing may redirect anywhere.
    let Some(client) = query
        .client_id
        .as_deref()
        .and_then(|id| state.config.clients.get(id))
        .cloned()
    else {
        return error_page(language, StatusCode::BAD_REQUEST, Message::UnknownClient);
    };
    let Some(redirect_uri) = query
        .redirect_uri
        .as_deref()
        .filter(|uri| client.redirect_uris.iter().any(|allowed| allowed == uri))
        .map(str::to_owned)
    else {
        return error_page(language, StatusCode::BAD_REQUEST, Message::UnknownClient);
    };
    let client_state = query.state.clone().unwrap_or_default();
    let fail = |error: &str| redirect_error(&redirect_uri, error, &client_state);
    if client_state.is_empty() || client_state.len() > MAX_PARAMETER_BYTES {
        return fail("invalid_request");
    }
    if query.response_type.as_deref() != Some("code") {
        return fail("unsupported_response_type");
    }
    let scopes: Vec<&str> = query
        .scope
        .as_deref()
        .unwrap_or("")
        .split(' ')
        .filter(|s| !s.is_empty())
        .collect();
    if !scopes.contains(&"openid")
        || scopes
            .iter()
            .any(|scope| !matches!(*scope, "openid" | "pub_dress"))
        || (scopes.contains(&"pub_dress") && !client.pub_dress)
    {
        return fail("invalid_scope");
    }
    let Some(nonce) = query
        .nonce
        .clone()
        .filter(|value| !value.is_empty() && value.len() <= MAX_PARAMETER_BYTES)
    else {
        return fail("invalid_request");
    };
    let Some(code_challenge) = query.code_challenge.clone().filter(|value| {
        value.len() == 43
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    }) else {
        return fail("invalid_request");
    };
    if query.code_challenge_method.as_deref() != Some("S256") {
        return fail("invalid_request");
    }
    let (Some(now), Some(browser)) = (now_unix_seconds(), random_urlsafe(24)) else {
        return error_page(
            language,
            StatusCode::SERVICE_UNAVAILABLE,
            Message::Unavailable,
        );
    };
    let request = AuthorizationRequest {
        client_id: client.client_id.clone(),
        redirect_uri,
        state: client_state,
        nonce,
        code_challenge,
        pub_dress: scopes.contains(&"pub_dress"),
        browser: browser.clone(),
        expires_at: now.saturating_add(REQUEST_TTL_SECONDS),
    };
    let Some(signed) = state.signer.issue(REQUEST_DOMAIN, &request) else {
        return error_page(
            language,
            StatusCode::SERVICE_UNAVAILABLE,
            Message::Unavailable,
        );
    };
    let remembered = read_cookie(&headers, REMEMBERED_COOKIE)
        .and_then(|value| state.remembered.verify(&value, now));
    let mut response = page(
        language,
        StatusCode::OK,
        &client,
        &request.redirect_uri,
        Step::Identify {
            signed: &signed,
            pub_dress: remembered.as_deref().unwrap_or(""),
            remembered: remembered.is_some(),
            message: None,
        },
    );
    append_cookie(
        &mut response,
        secure_cookie(BROWSER_COOKIE, &browser, REQUEST_TTL_SECONDS),
    );
    response
}

fn on_issuer_host(state: &IssuerState, headers: &HeaderMap) -> bool {
    headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| host.eq_ignore_ascii_case(&state.config.host()))
}

fn redirect_error(redirect_uri: &str, error: &str, client_state: &str) -> Response {
    let mut location = Url::parse(redirect_uri).expect("registered redirect URIs are valid");
    {
        let mut query = location.query_pairs_mut();
        query.append_pair("error", error);
        if !client_state.is_empty() && client_state.len() <= MAX_PARAMETER_BYTES {
            query.append_pair("state", client_state);
        }
    }
    redirect(location.as_str())
}

fn redirect(location: &str) -> Response {
    let mut response = StatusCode::SEE_OTHER.into_response();
    response.headers_mut().insert(
        LOCATION,
        HeaderValue::from_str(location).expect("redirect URL must be a valid header"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

// ---------------------------------------------------------------------------
// The page: identify, then sign in or create
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SubmitForm {
    request: String,
    step: String,
    #[serde(default)]
    pub_dress: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    password_confirm: String,
}

async fn submit(
    State(state): State<IssuerState>,
    headers: HeaderMap,
    Form(form): Form<SubmitForm>,
) -> Response {
    let language = Language::from(&headers);
    if !on_issuer_host(&state, &headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(now) = now_unix_seconds() else {
        return error_page(
            language,
            StatusCode::SERVICE_UNAVAILABLE,
            Message::Unavailable,
        );
    };
    let Some(request) = state
        .signer
        .verify::<AuthorizationRequest>(REQUEST_DOMAIN, &form.request)
        .filter(|request| request.expires_at > now)
        .filter(|request| {
            read_cookie(&headers, BROWSER_COOKIE)
                .is_some_and(|browser| browser.as_bytes().ct_eq(request.browser.as_bytes()).into())
        })
    else {
        return error_page(language, StatusCode::BAD_REQUEST, Message::Expired);
    };
    let Some(client) = state.config.clients.get(&request.client_id).cloned() else {
        return error_page(language, StatusCode::BAD_REQUEST, Message::UnknownClient);
    };
    let render = |status, step| page(language, status, &client, &request.redirect_uri, step);
    let source = crate::api::request_source(&headers);

    let pub_dress = match PubDress::from_str(form.pub_dress.trim()) {
        Ok(value) => value,
        Err(_) => {
            return render(
                StatusCode::UNPROCESSABLE_ENTITY,
                Step::Identify {
                    signed: &form.request,
                    pub_dress: &form.pub_dress,
                    remembered: false,
                    message: Some(Message::InvalidPubDress),
                },
            );
        }
    };

    match form.step.as_str() {
        "identify" => {
            if let Err(_retry) = state
                .limiter
                .consume(format!("issuer:resolve:{source}"), now, 60, 60)
                .and_then(|_| {
                    state
                        .limiter
                        .consume("issuer:resolve:global", now, 2_000, 60)
                })
            {
                return render(
                    StatusCode::TOO_MANY_REQUESTS,
                    Step::Identify {
                        signed: &form.request,
                        pub_dress: pub_dress.as_str(),
                        remembered: false,
                        message: Some(Message::RateLimited),
                    },
                );
            }
            match state.repository.is_pub_dress_available(&pub_dress).await {
                Ok(false) => render(
                    StatusCode::OK,
                    Step::SignIn {
                        signed: &form.request,
                        pub_dress: pub_dress.as_str(),
                        message: None,
                    },
                ),
                Ok(true) => render(
                    StatusCode::OK,
                    Step::Register {
                        signed: &form.request,
                        pub_dress: pub_dress.as_str(),
                        message: None,
                    },
                ),
                Err(error) => {
                    tracing::error!(%error, "issuer pub_dress resolution failed");
                    error_page(
                        language,
                        StatusCode::SERVICE_UNAVAILABLE,
                        Message::Unavailable,
                    )
                }
            }
        }
        "sign_in" => {
            sign_in(
                &state, &headers, &request, &form, &pub_dress, now, &source, render,
            )
            .await
        }
        "register" => register(&state, &request, &form, &pub_dress, now, &source, render).await,
        _ => error_page(language, StatusCode::BAD_REQUEST, Message::Expired),
    }
}

#[allow(clippy::too_many_arguments)]
async fn sign_in<'a>(
    state: &IssuerState,
    headers: &HeaderMap,
    request: &AuthorizationRequest,
    form: &'a SubmitForm,
    pub_dress: &'a PubDress,
    now: u64,
    source: &str,
    render: impl Fn(StatusCode, Step<'a>) -> Response,
) -> Response {
    let retry = |message| {
        render(
            StatusCode::UNAUTHORIZED,
            Step::SignIn {
                signed: &form.request,
                pub_dress: pub_dress.as_str(),
                message: Some(message),
            },
        )
    };
    let source_key = format!("issuer:auth:source:{source}");
    let pub_dress_key = format!("issuer:auth:pub-dress:{}", pub_dress.as_str());
    if state
        .limiter
        .check(&source_key, now)
        .and_then(|_| state.limiter.check(&pub_dress_key, now))
        .and_then(|_| state.limiter.consume("issuer:auth:global", now, 2_000, 60))
        .is_err()
    {
        return retry(Message::RateLimited);
    }
    let credential = match state.repository.find_native_credential(pub_dress).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "issuer credential lookup failed");
            return error_page(
                Language::from(headers),
                StatusCode::SERVICE_UNAVAILABLE,
                Message::Unavailable,
            );
        }
    };
    // The same Argon2 work whether or not the Bond exists.
    let encoded_hash = credential.as_ref().map_or_else(
        || state.dummy_password_hash.to_string(),
        |value| value.password_hash.clone(),
    );
    let password = form.password.clone();
    let engine = state.password_engine.clone();
    let matches = tokio::task::spawn_blocking(move || engine.verify(&password, &encoded_hash))
        .await
        .unwrap_or(false);
    // An unfinished Bond (no active password) cannot sign in here: it
    // finishes its password setup in 0x1 first (docs/unified-auth.md).
    let Some(credential) = credential.filter(|credential| matches && credential.active) else {
        state.limiter.record_authentication_failure(source_key, now);
        state
            .limiter
            .record_authentication_failure(pub_dress_key, now);
        return retry(Message::InvalidCredentials);
    };
    state.limiter.clear(&source_key);
    state.limiter.clear(&pub_dress_key);
    rehash_if_outdated(state, &credential, &form.password, now).await;
    let Ok(current) = PubDress::from_str(&credential.pub_dress) else {
        return error_page(
            Language::from(headers),
            StatusCode::SERVICE_UNAVAILABLE,
            Message::Unavailable,
        );
    };
    complete(state, request, &current, now).await
}

/// Moves a credential to the current hash parameters after a successful
/// sign-in, the only moment the password is at hand. A failure keeps the old
/// hash, which still verifies.
async fn rehash_if_outdated(
    state: &IssuerState,
    credential: &crate::NativeCredentialRecord,
    password: &str,
    now: u64,
) {
    if credential.password_hash_version >= state.password_engine.hash_version() {
        return;
    }
    let Ok(normalized) = state.password_engine.validate(password) else {
        return;
    };
    let engine = state.password_engine.clone();
    let Ok(Ok(hash)) = tokio::task::spawn_blocking(move || engine.hash(&normalized)).await else {
        return;
    };
    if let Err(error) = state
        .repository
        .update_password_hash_if_version_advances(
            &credential.pub_dress,
            credential.password_hash_version,
            &hash,
            state.password_engine.hash_version(),
            now,
        )
        .await
    {
        tracing::warn!(%error, "issuer credential rehash failed");
    }
}

async fn register<'a>(
    state: &IssuerState,
    request: &AuthorizationRequest,
    form: &'a SubmitForm,
    pub_dress: &'a PubDress,
    now: u64,
    source: &str,
    render: impl Fn(StatusCode, Step<'a>) -> Response,
) -> Response {
    let retry = |status, message| {
        render(
            status,
            Step::Register {
                signed: &form.request,
                pub_dress: pub_dress.as_str(),
                message: Some(message),
            },
        )
    };
    if state
        .limiter
        .consume(format!("issuer:register:{source}"), now, 8, 60 * 60)
        .and_then(|_| {
            state
                .limiter
                .consume("issuer:register:global", now, 500, 60 * 60)
        })
        .is_err()
    {
        return retry(StatusCode::TOO_MANY_REQUESTS, Message::RateLimited);
    }
    if form.password != form.password_confirm {
        return retry(StatusCode::UNPROCESSABLE_ENTITY, Message::PasswordsDiffer);
    }
    let normalized = match state.password_engine.validate(&form.password) {
        Ok(value) => value,
        Err(PasswordPolicyError::InvalidLength) => {
            return retry(StatusCode::UNPROCESSABLE_ENTITY, Message::PasswordLength);
        }
        Err(PasswordPolicyError::Compromised) => {
            return retry(
                StatusCode::UNPROCESSABLE_ENTITY,
                Message::PasswordCompromised,
            );
        }
    };
    let engine = state.password_engine.clone();
    let Ok(Ok(hash)) = tokio::task::spawn_blocking(move || engine.hash(&normalized)).await else {
        return retry(StatusCode::SERVICE_UNAVAILABLE, Message::Unavailable);
    };
    // One registration per page and address: a double submit replays it
    // instead of creating anything twice.
    let idempotency = state.digester.digest(
        "aiaiaiai-issuer-registration",
        &format!("{}:{}", request.browser, pub_dress.as_str()),
    );
    match state
        .repository
        .register_native_password(
            pub_dress,
            &hash,
            state.password_engine.hash_version(),
            &idempotency,
            now,
        )
        .await
    {
        Ok(NativeRegistrationOutcome::Registered(_)) => {
            complete(state, request, pub_dress, now).await
        }
        Ok(NativeRegistrationOutcome::IdempotentReplay(_)) => render(
            StatusCode::CONFLICT,
            Step::SignIn {
                signed: &form.request,
                pub_dress: pub_dress.as_str(),
                message: Some(Message::AlreadyCreated),
            },
        ),
        Ok(
            NativeRegistrationOutcome::HandleUnavailable
            | NativeRegistrationOutcome::PublicLabelUnavailable,
        ) => render(
            StatusCode::CONFLICT,
            Step::Identify {
                signed: &form.request,
                pub_dress: pub_dress.as_str(),
                remembered: false,
                message: Some(Message::Taken),
            },
        ),
        Err(error) => {
            tracing::error!(%error, "issuer registration failed");
            retry(StatusCode::SERVICE_UNAVAILABLE, Message::Unavailable)
        }
    }
}

/// The person is authenticated: hand the client a single-use code.
async fn complete(
    state: &IssuerState,
    request: &AuthorizationRequest,
    pub_dress: &PubDress,
    now: u64,
) -> Response {
    let subject = match state
        .repository
        .client_pairwise_subject(pub_dress, &request.client_id, &state.digester)
        .await
    {
        Ok(Some(subject)) => subject,
        Ok(None) | Err(_) => {
            tracing::error!("issuer could not derive a pairwise subject");
            return redirect_error(&request.redirect_uri, "server_error", &request.state);
        }
    };
    let Some(code) = random_urlsafe(32) else {
        return redirect_error(&request.redirect_uri, "server_error", &request.state);
    };
    {
        let mut codes = state.codes.lock().expect("issuer code store lock poisoned");
        codes.retain(|_, pending| pending.expires_at > now);
        if codes.len() >= MAX_PENDING_CODES {
            return redirect_error(
                &request.redirect_uri,
                "temporarily_unavailable",
                &request.state,
            );
        }
        codes.insert(
            code_key(&code),
            PendingCode {
                client_id: request.client_id.clone(),
                redirect_uri: request.redirect_uri.clone(),
                code_challenge: request.code_challenge.clone(),
                nonce: request.nonce.clone(),
                subject,
                pub_dress: request.pub_dress.then(|| pub_dress.as_str().to_owned()),
                auth_time: now,
                expires_at: now.saturating_add(CODE_TTL_SECONDS),
            },
        );
    }
    let mut location =
        Url::parse(&request.redirect_uri).expect("registered redirect URIs are valid");
    location
        .query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", &request.state);
    let mut response = redirect(location.as_str());
    append_cookie(&mut response, clear_cookie(BROWSER_COOKIE));
    if let Ok(hint) = state
        .remembered
        .issue(pub_dress.as_str(), now.saturating_add(180 * 24 * 60 * 60))
    {
        append_cookie(
            &mut response,
            secure_cookie(REMEMBERED_COOKIE, &hint, 180 * 24 * 60 * 60),
        );
    }
    response
}

fn code_key(code: &str) -> [u8; 32] {
    Sha256::digest(code.as_bytes()).into()
}

// ---------------------------------------------------------------------------
// The token endpoint
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct TokenForm {
    grant_type: Option<String>,
    code: Option<String>,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
}

async fn token(
    State(state): State<IssuerState>,
    headers: HeaderMap,
    Form(form): Form<TokenForm>,
) -> Response {
    let Some(now) = now_unix_seconds() else {
        return token_error(StatusCode::SERVICE_UNAVAILABLE, "temporarily_unavailable");
    };
    let Some(client) = authenticate_client(&state, &headers, &form) else {
        let mut response = token_error(StatusCode::UNAUTHORIZED, "invalid_client");
        response.headers_mut().insert(
            "www-authenticate",
            HeaderValue::from_static("Basic realm=\"aiaiaiai\""),
        );
        return response;
    };
    if form.grant_type.as_deref() != Some("authorization_code") {
        return token_error(StatusCode::BAD_REQUEST, "unsupported_grant_type");
    }
    let (Some(code), Some(redirect_uri), Some(verifier)) = (
        form.code.as_deref(),
        form.redirect_uri.as_deref(),
        form.code_verifier.as_deref(),
    ) else {
        return token_error(StatusCode::BAD_REQUEST, "invalid_request");
    };
    // Taken out before any check: a code is spent by its first exchange,
    // right or wrong.
    let pending = state
        .codes
        .lock()
        .expect("issuer code store lock poisoned")
        .remove(&code_key(code));
    let verifier_ok = (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'));
    let Some(pending) = pending.filter(|pending| {
        pending.expires_at > now
            && pending.client_id == client.client_id
            && pending.redirect_uri == redirect_uri
            && verifier_ok
            && bool::from(
                URL_SAFE_NO_PAD
                    .encode(Sha256::digest(verifier.as_bytes()))
                    .as_bytes()
                    .ct_eq(pending.code_challenge.as_bytes()),
            )
    }) else {
        return token_error(StatusCode::BAD_REQUEST, "invalid_grant");
    };
    let mut claims = serde_json::json!({
        "iss": state.config.issuer(),
        "sub": pending.subject,
        "aud": client.client_id,
        "exp": now + ID_TOKEN_TTL_SECONDS,
        "iat": now,
        "auth_time": pending.auth_time,
        "nonce": pending.nonce,
        "amr": ["pwd"],
    });
    if let Some(pub_dress) = pending.pub_dress {
        claims["pub_dress"] = serde_json::Value::String(pub_dress);
    }
    let id_token = sign_jwt(&state.config, &claims);
    // OIDC requires an access token in the response. No resource accepts it
    // yet: there is no userinfo endpoint.
    let Some(access_token) = random_urlsafe(32) else {
        return token_error(StatusCode::SERVICE_UNAVAILABLE, "temporarily_unavailable");
    };
    no_store(
        StatusCode::OK,
        serde_json::json!({
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": ID_TOKEN_TTL_SECONDS,
            "id_token": id_token,
        }),
    )
}

fn authenticate_client(
    state: &IssuerState,
    headers: &HeaderMap,
    form: &TokenForm,
) -> Option<Client> {
    let basic = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Basic "))
        .and_then(|encoded| STANDARD.decode(encoded.trim()).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|pair| {
            let (id, secret) = pair.split_once(':')?;
            Some((form_decode(id)?, form_decode(secret)?))
        });
    let (client_id, secret) = match (basic, &form.client_id, &form.client_secret) {
        (Some(pair), None, None) => pair,
        (None, Some(id), Some(secret)) => (id.clone(), secret.clone()),
        _ => return None,
    };
    let client = state.config.clients.get(&client_id)?;
    let supplied: [u8; 32] = Sha256::digest(secret.as_bytes()).into();
    bool::from(supplied.ct_eq(&client.secret_sha256)).then(|| client.clone())
}

fn form_decode(value: &str) -> Option<String> {
    let value = value.replace('+', " ");
    url::form_urlencoded::parse(format!("v={value}").as_bytes())
        .next()
        .map(|(_, decoded)| decoded.into_owned())
}

fn sign_jwt(config: &IssuerConfig, claims: &serde_json::Value) -> String {
    let header = serde_json::json!({ "alg": "EdDSA", "typ": "JWT", "kid": config.key_id });
    let signed = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let signature = config.signing_key.sign(signed.as_bytes());
    format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()))
}

fn token_error(status: StatusCode, error: &'static str) -> Response {
    no_store(status, serde_json::json!({ "error": error }))
}

fn no_store(status: StatusCode, value: serde_json::Value) -> Response {
    let mut response = (status, Json(value)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert("pragma", HeaderValue::from_static("no-cache"));
    response
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Language {
    English,
    Ukrainian,
}

impl From<&HeaderMap> for Language {
    fn from(headers: &HeaderMap) -> Self {
        let preferred = headers
            .get(ACCEPT_LANGUAGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if preferred.starts_with("uk") {
            Self::Ukrainian
        } else {
            Self::English
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Message {
    UnknownClient,
    Expired,
    Unavailable,
    InvalidPubDress,
    InvalidCredentials,
    RateLimited,
    PasswordsDiffer,
    PasswordLength,
    PasswordCompromised,
    Taken,
    AlreadyCreated,
}

impl Message {
    fn text(self, language: Language) -> &'static str {
        use Language::{English as En, Ukrainian as Uk};
        match (self, language) {
            (Self::UnknownClient, En) => "This sign-in request did not come from a known product.",
            (Self::UnknownClient, Uk) => "Цей запит на вхід надійшов не від відомого продукту.",
            (Self::Expired, En) => {
                "This sign-in has expired. Go back to the product and start again."
            }
            (Self::Expired, Uk) => "Час на вхід минув. Поверніться до продукту й почніть знову.",
            (Self::Unavailable, En) => "Sign-in is unavailable right now. Try again shortly.",
            (Self::Unavailable, Uk) => "Вхід зараз недоступний. Спробуйте трохи згодом.",
            (Self::InvalidPubDress, En) => {
                "That is not a valid pub_dress. It starts with 0x, one hex digit, then your name."
            }
            (Self::InvalidPubDress, Uk) => {
                "Це не схоже на pub_dress: 0x, одна шістнадцяткова цифра, далі ім'я."
            }
            (Self::InvalidCredentials, En) => "The pub_dress or password is incorrect.",
            (Self::InvalidCredentials, Uk) => "Неправильний pub_dress або пароль.",
            (Self::RateLimited, En) => "Too many attempts. Wait a little and try again.",
            (Self::RateLimited, Uk) => "Забагато спроб. Зачекайте трохи й спробуйте знову.",
            (Self::PasswordsDiffer, En) => "The passwords do not match.",
            (Self::PasswordsDiffer, Uk) => "Паролі не збігаються.",
            (Self::PasswordLength, En) => "Use a password of 8 to 128 characters.",
            (Self::PasswordLength, Uk) => "Пароль має містити від 8 до 128 символів.",
            (Self::PasswordCompromised, En) => {
                "That password is known from leaks. Choose another one."
            }
            (Self::PasswordCompromised, Uk) => "Цей пароль відомий з витоків. Оберіть інший.",
            (Self::Taken, En) => "That pub_dress was just taken. Choose another one.",
            (Self::Taken, Uk) => "Цей pub_dress щойно зайняли. Оберіть інший.",
            (Self::AlreadyCreated, En) => {
                "The account is already created. Sign in with its password."
            }
            (Self::AlreadyCreated, Uk) => "Акаунт уже створено. Увійдіть з його паролем.",
        }
    }
}

enum Step<'a> {
    Identify {
        signed: &'a str,
        pub_dress: &'a str,
        remembered: bool,
        message: Option<Message>,
    },
    SignIn {
        signed: &'a str,
        pub_dress: &'a str,
        message: Option<Message>,
    },
    Register {
        signed: &'a str,
        pub_dress: &'a str,
        message: Option<Message>,
    },
}

fn page(
    language: Language,
    status: StatusCode,
    client: &Client,
    redirect_uri: &str,
    step: Step<'_>,
) -> Response {
    let uk = language == Language::Ukrainian;
    let t = |en: &'static str, ukr: &'static str| if uk { ukr } else { en };
    let product = escape(&client.name);
    let (heading, body) = match step {
        Step::Identify {
            signed,
            pub_dress,
            remembered,
            message,
        } => (
            t("Sign in", "Вхід"),
            format!(
                "{remembered}{message}<form method=\"post\" action=\"/authorize\">{hidden}\
                 <input type=\"hidden\" name=\"step\" value=\"identify\">\
                 <label for=\"pub_dress\">pub_dress</label>\
                 <input id=\"pub_dress\" name=\"pub_dress\" value=\"{value}\" autocomplete=\"username\" \
                 autocapitalize=\"none\" spellcheck=\"false\" required autofocus placeholder=\"0x0name\">\
                 <button type=\"submit\">{next}</button></form>",
                remembered = if remembered {
                    format!(
                        "<p class=\"hint\">{} <strong>{}</strong></p>",
                        t("You already have an account:", "У вас уже є акаунт:"),
                        escape(pub_dress)
                    )
                } else {
                    String::new()
                },
                message = notice(message, language),
                hidden = hidden(signed),
                value = escape(pub_dress),
                next = t("Continue", "Далі"),
            ),
        ),
        Step::SignIn {
            signed,
            pub_dress,
            message,
        } => (
            t("Sign in", "Вхід"),
            format!(
                "{message}<form method=\"post\" action=\"/authorize\">{hidden}\
                 <input type=\"hidden\" name=\"step\" value=\"sign_in\">\
                 <label for=\"pub_dress\">pub_dress</label>\
                 <input id=\"pub_dress\" name=\"pub_dress\" value=\"{value}\" autocomplete=\"username\" readonly>\
                 <label for=\"password\">{password}</label>\
                 <input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" required autofocus>\
                 <button type=\"submit\">{submit}</button></form>",
                message = notice(message, language),
                hidden = hidden(signed),
                value = escape(pub_dress),
                password = t("Password", "Пароль"),
                submit = t("Sign in", "Увійти"),
            ),
        ),
        Step::Register {
            signed,
            pub_dress,
            message,
        } => (
            t("Create an account", "Створення акаунта"),
            format!(
                "<p class=\"hint\">{free} <strong>{value}</strong></p>{message}\
                 <form method=\"post\" action=\"/authorize\">{hidden}\
                 <input type=\"hidden\" name=\"step\" value=\"register\">\
                 <input type=\"hidden\" name=\"pub_dress\" value=\"{value}\" autocomplete=\"username\">\
                 <label for=\"password\">{password}</label>\
                 <input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" maxlength=\"128\" required autofocus>\
                 <label for=\"password_confirm\">{confirm}</label>\
                 <input id=\"password_confirm\" name=\"password_confirm\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" maxlength=\"128\" required>\
                 <p class=\"fine\">{warning}</p>\
                 <button type=\"submit\">{submit}</button></form>",
                free = t("This pub_dress is free:", "Цей pub_dress вільний:"),
                value = escape(pub_dress),
                message = notice(message, language),
                hidden = hidden(signed),
                password = t("Password", "Пароль"),
                confirm = t("Repeat the password", "Повторіть пароль"),
                warning = t(
                    "The password is the key to your account in every product. Keep it in a password manager: there is no recovery without another linked method.",
                    "Пароль — ключ до вашого акаунта в усіх продуктах. Збережіть його в менеджері паролів: без іншого підключеного способу відновлення немає."
                ),
                submit = t("Create the account", "Створити акаунт"),
            ),
        ),
    };
    let form_action = Url::parse(redirect_uri)
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_default();
    render_document(language, status, heading, &product, &body, &form_action)
}

fn error_page(language: Language, status: StatusCode, message: Message) -> Response {
    let body = format!(
        "<p class=\"error\" role=\"alert\">{}</p>",
        message.text(language)
    );
    let heading = if language == Language::Ukrainian {
        "Вхід"
    } else {
        "Sign in"
    };
    render_document(language, status, heading, "aiaiaiai", &body, "")
}

fn hidden(signed: &str) -> String {
    format!(
        "<input type=\"hidden\" name=\"request\" value=\"{}\">",
        escape(signed)
    )
}

fn notice(message: Option<Message>, language: Language) -> String {
    message
        .map(|message| {
            format!(
                "<p class=\"error\" role=\"alert\">{}</p>",
                message.text(language)
            )
        })
        .unwrap_or_default()
}

fn render_document(
    language: Language,
    status: StatusCode,
    heading: &str,
    product: &str,
    body: &str,
    redirect_origin: &str,
) -> Response {
    let lang = if language == Language::Ukrainian {
        "uk"
    } else {
        "en"
    };
    let html = format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <meta name=\"referrer\" content=\"no-referrer\">\
         <title>{heading} · {product}</title><style>{STYLE}</style></head>\
         <body><main><p class=\"product\">{product}</p><h1>{heading}</h1>{body}</main></body></html>"
    );
    let mut response = (status, html).into_response();
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    // Browsers apply form-action to the redirect that follows the post, so
    // the client's own origin is allowed as its destination.
    let csp = format!(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' {redirect_origin}; \
         frame-ancestors 'none'; base-uri 'none'"
    );
    if let Ok(value) = HeaderValue::from_str(csp.trim()) {
        headers.insert("content-security-policy", value);
    }
    response
}

fn escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            other => escaped.push(other),
        }
    }
    escaped
}

const STYLE: &str = ":root{color-scheme:light dark;--bg:#f6f5f2;--fg:#17171a;--muted:#5d5d66;--line:#d4d2cc;--accent:#2f5bea;--error:#b3261e}\
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ecebe8;--muted:#a3a3ad;--line:#33333a;--accent:#8aa4ff;--error:#ffb4ab}}\
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}\
main{width:100%;max-width:360px}.product{margin:0 0 4px;color:var(--muted);font-size:14px;letter-spacing:.02em}h1{margin:0 0 24px;font-size:24px}\
label{display:block;margin:16px 0 6px;font-size:14px;color:var(--muted)}input{width:100%;padding:10px 12px;font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px}\
input:focus{outline:2px solid var(--accent);outline-offset:1px}input[readonly]{color:var(--muted)}\
button{width:100%;margin-top:24px;padding:11px;font:inherit;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:8px;cursor:pointer}\
.hint{margin:0 0 8px}.fine{margin:12px 0 0;font-size:13px;color:var(--muted)}.error{margin:0 0 8px;color:var(--error)}";

#[cfg(test)]
#[path = "issuer_tests.rs"]
mod tests;
