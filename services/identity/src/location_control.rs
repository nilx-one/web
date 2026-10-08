// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    collections::HashMap,
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    extract::State,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL, COOKIE, SET_COOKIE},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use nilxone_contracts::{BondLocation, BondLocationMode, DecimalU64, GeoCoordinate, PubDress};
use serde::{Deserialize, Serialize};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::{
    DiscordOAuthClient, DiscordOAuthError, IdentityRecord, IdentityRepository, NativeAuthConfig,
    ProviderIdentity, TelegramInitDataVerifier, TokenFactory,
};

const TELEGRAM_AUTH_SCHEME: &str = "tma ";
const DISCORD_AUTH_SCHEME: &str = "discord ";
const SESSION_COOKIE: &str = "__Host-0x1_session";
const DEFAULT_INTENT_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_LOCATION_REQUEST_BYTES: usize = 8 * 1024;

/// Application role of a human Bond, persisted in `bond_roles`.
///
/// This is not a Bond kind or protocol authority class. The role only gates
/// application capabilities. A Bond without a stored role is [`Self::User`],
/// the only role public registration creates.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BondAccessRole {
    #[default]
    User,
    Admin,
    Business,
}

impl BondAccessRole {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
            Self::Business => "business",
        }
    }

    #[must_use]
    pub fn from_stored(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "admin" => Some(Self::Admin),
            "business" => Some(Self::Business),
            _ => None,
        }
    }

    /// Admin holds every user capability plus declaring a manual Bond
    /// location. Every role may submit a live location.
    #[must_use]
    pub const fn can_set_manual_location(self) -> bool {
        matches!(self, Self::Admin)
    }
}

#[derive(Clone, Debug)]
pub struct BondLocationRepository {
    pool: SqlitePool,
}

impl BondLocationRepository {
    pub async fn connect(database_url: &str) -> Result<Self, BondLocationRepositoryError> {
        let max_connections = if database_url.contains(":memory:") {
            1
        } else {
            5
        };
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0009_bond_location_control.sql"))
            .execute(&pool)
            .await?;
        Ok(Self { pool })
    }

    /// Reads the active owner-submitted location. No row means this Bond has
    /// never submitted application location state.
    pub async fn read(
        &self,
        pub_dress: &str,
    ) -> Result<Option<BondLocation>, BondLocationRepositoryError> {
        let row = sqlx::query(
            "SELECT mode, longitude_e7, latitude_e7, updated_at \
             FROM bond_locations WHERE pub_dress = ?",
        )
        .bind(pub_dress)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };

        let mode = match row.get::<String, _>("mode").as_str() {
            "live" => BondLocationMode::Live,
            "manual" => BondLocationMode::Manual,
            _ => return Err(BondLocationRepositoryError::CorruptState),
        };
        let longitude_e7 = i32::try_from(row.get::<i64, _>("longitude_e7"))
            .map_err(|_| BondLocationRepositoryError::CorruptState)?;
        let latitude_e7 = i32::try_from(row.get::<i64, _>("latitude_e7"))
            .map_err(|_| BondLocationRepositoryError::CorruptState)?;
        let coordinate = GeoCoordinate::new(longitude_e7, latitude_e7)
            .map_err(|_| BondLocationRepositoryError::CorruptState)?;
        let updated_at = u64::try_from(row.get::<i64, _>("updated_at"))
            .map_err(|_| BondLocationRepositoryError::CorruptState)?;

        Ok(Some(BondLocation::new(
            coordinate,
            mode,
            DecimalU64::new(updated_at),
        )))
    }

    /// Refreshes a live coordinate without ever switching modes: a Bond in
    /// `manual` keeps its declared point. Returns whether the write applied.
    /// Leaving `manual` stays an explicit [`Self::write`].
    pub async fn refresh_live(
        &self,
        pub_dress: &str,
        coordinate: GeoCoordinate,
        updated_at: DecimalU64,
    ) -> Result<bool, BondLocationRepositoryError> {
        let updated_at = i64::try_from(updated_at.get())
            .map_err(|_| BondLocationRepositoryError::TimestampOutOfRange)?;
        let result = sqlx::query(
            "INSERT INTO bond_locations \
             (pub_dress, mode, longitude_e7, latitude_e7, updated_at) \
             VALUES (?, 'live', ?, ?, ?) \
             ON CONFLICT(pub_dress) DO UPDATE SET \
               longitude_e7 = excluded.longitude_e7, \
               latitude_e7 = excluded.latitude_e7, \
               updated_at = excluded.updated_at \
             WHERE bond_locations.mode = 'live'",
        )
        .bind(pub_dress)
        .bind(i64::from(coordinate.longitude_e7()))
        .bind(i64::from(coordinate.latitude_e7()))
        .bind(updated_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Replaces the one active location projection for this Bond.
    ///
    /// Replacing `manual` with `live` is therefore an explicit new observation,
    /// not a mode toggle that resurrects an older device coordinate.
    pub async fn write(
        &self,
        pub_dress: &str,
        location: BondLocation,
    ) -> Result<(), BondLocationRepositoryError> {
        let mode = match location.mode {
            BondLocationMode::Live => "live",
            BondLocationMode::Manual => "manual",
        };
        let updated_at = i64::try_from(location.updated_at.get())
            .map_err(|_| BondLocationRepositoryError::TimestampOutOfRange)?;
        sqlx::query(
            "INSERT INTO bond_locations \
             (pub_dress, mode, longitude_e7, latitude_e7, updated_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(pub_dress) DO UPDATE SET \
               mode = excluded.mode, \
               longitude_e7 = excluded.longitude_e7, \
               latitude_e7 = excluded.latitude_e7, \
               updated_at = excluded.updated_at",
        )
        .bind(pub_dress)
        .bind(mode)
        .bind(i64::from(location.coordinate.longitude_e7()))
        .bind(i64::from(location.coordinate.latitude_e7()))
        .bind(updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum BondLocationRepositoryError {
    #[error("Bond location database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Bond location timestamp is outside the supported range")]
    TimestampOutOfRange,
    #[error("stored Bond location violates its contract")]
    CorruptState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingLocationIntent {
    Current,
    Manual,
}

#[derive(Clone, Debug)]
pub struct TelegramLocationIntents {
    pending: Arc<Mutex<HashMap<i64, (PendingLocationIntent, Instant)>>>,
    ttl: Duration,
}

impl Default for TelegramLocationIntents {
    fn default() -> Self {
        Self::new(DEFAULT_INTENT_TTL)
    }
}

impl TelegramLocationIntents {
    #[must_use]
    pub fn new(ttl: Duration) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            ttl,
        }
    }

    pub async fn begin(&self, telegram_user_id: i64, intent: PendingLocationIntent) {
        self.pending
            .lock()
            .await
            .insert(telegram_user_id, (intent, Instant::now()));
    }

    pub async fn consume(&self, telegram_user_id: i64) -> Option<PendingLocationIntent> {
        let (intent, started) = self.pending.lock().await.remove(&telegram_user_id)?;
        (started.elapsed() <= self.ttl).then_some(intent)
    }
}

#[derive(Clone)]
pub(crate) struct LocationControlApiState {
    pub(crate) identities: IdentityRepository,
    pub(crate) locations: BondLocationRepository,
    pub(crate) telegram_verifier: TelegramInitDataVerifier,
    pub(crate) discord_oauth: Option<DiscordOAuthClient>,
    pub(crate) native_auth: NativeAuthConfig,
}

pub fn location_control_router(
    identities: IdentityRepository,
    locations: BondLocationRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
) -> Router {
    Router::new()
        .route("/api/v1/location-control", get(read_location_control))
        .route("/api/v1/location-control", post(write_live_location))
        .layer(DefaultBodyLimit::max(MAX_LOCATION_REQUEST_BYTES))
        .with_state(LocationControlApiState {
            identities,
            locations,
            telegram_verifier,
            discord_oauth,
            native_auth,
        })
}

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (candidate_name, value) = cookie.trim().split_once('=')?;
                (candidate_name == name && !value.is_empty()).then(|| value.to_owned())
            })
        })
}

fn secure_cookie(name: &str, value: &str, max_age_seconds: u64) -> String {
    format!("{name}={value}; Path=/; Max-Age={max_age_seconds}; Secure; HttpOnly; SameSite=Lax")
}

pub(crate) fn append_cookie(response: &mut Response, cookie: String) {
    let value = HeaderValue::from_str(&cookie).expect("generated cookie must be a valid header");
    response.headers_mut().append(SET_COOKIE, value);
}

/// Resolves the Bond behind a GET, trying the native session cookie first
/// and falling back to a fresh `initData` header. `initData` is signed once
/// per Mini App launch; requiring it fresh on every request would force its
/// own validity window to span a whole session, so a successful fresh check
/// mints a session cookie the *next* request can use instead. See
/// `nilx-one/0x1` `documents/15-devices-and-recovery.md`, Single Active
/// Client.
///
/// A Discord Activity has no cookie of its own, so it proves itself with its
/// access token on every read and is never minted a session here.
pub(crate) async fn authenticate_bond(
    state: &LocationControlApiState,
    headers: &HeaderMap,
    now: u64,
) -> Result<(IdentityRecord, Option<String>), StatusCode> {
    if let Some(token) = read_cookie(headers, SESSION_COOKIE) {
        let token_hash = state
            .native_auth
            .secret_digester()
            .digest("native-session", &token);
        match state.identities.find_native_session(&token_hash, now).await {
            Ok(Some(identity)) => return Ok((identity, None)),
            Ok(None) => {}
            Err(error) => {
                tracing::error!(%error, "native session lookup failed");
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        }
    }

    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());

    if let Some(access_token) = authorization
        .and_then(|value| value.strip_prefix(DISCORD_AUTH_SCHEME))
        .filter(|value| !value.is_empty())
    {
        let discord = state
            .discord_oauth
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        let user_id = discord
            .authenticate(access_token)
            .await
            .map_err(|error| match error {
                DiscordOAuthError::Rejected(_) | DiscordOAuthError::InvalidResponse => {
                    StatusCode::UNAUTHORIZED
                }
                DiscordOAuthError::Transport(_) => StatusCode::SERVICE_UNAVAILABLE,
            })?;
        let identity = state
            .identities
            .find_by_provider(&ProviderIdentity::discord(user_id))
            .await
            .map_err(|error| {
                tracing::error!(%error, "Bond identity lookup failed");
                StatusCode::SERVICE_UNAVAILABLE
            })?
            .ok_or(StatusCode::NOT_FOUND)?;
        return Ok((identity, None));
    }

    let init_data = authorization
        .and_then(|value| value.strip_prefix(TELEGRAM_AUTH_SCHEME))
        .filter(|value| !value.is_empty())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let user = state
        .telegram_verifier
        .verify(init_data, now)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    let identity = state
        .identities
        .find_by_telegram(user.id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "Bond identity lookup failed");
            StatusCode::SERVICE_UNAVAILABLE
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    let cookie = mint_session_cookie(state, &identity.pub_dress, now).await;
    Ok((identity, cookie))
}

async fn mint_session_cookie(
    state: &LocationControlApiState,
    pub_dress: &str,
    now: u64,
) -> Option<String> {
    let token = TokenFactory::session().ok()?;
    let token_hash = state
        .native_auth
        .secret_digester()
        .digest("native-session", &token);
    let ttl = state.native_auth.session_ttl_seconds;
    state
        .identities
        .create_native_session(
            &token_hash,
            pub_dress,
            now,
            now.saturating_add(ttl),
            "Telegram",
            false,
            None,
        )
        .await
        .ok()?;
    Some(secure_cookie(SESSION_COOKIE, &token, ttl))
}

/// Authenticated operational projection consumed by every Web host: Telegram,
/// the website, and Discord. `location: null` means no Bond location has been
/// submitted yet; the
/// ordinary device-location mode remains available.
#[derive(Serialize)]
struct LocationControlProjection {
    role: BondAccessRole,
    location: Option<BondLocation>,
}

#[derive(Deserialize)]
struct LiveLocationRequest {
    longitude: f64,
    latitude: f64,
}

async fn write_live_location(
    State(state): State<LocationControlApiState>,
    headers: HeaderMap,
    Json(request): Json<LiveLocationRequest>,
) -> Response {
    let Some(init_data) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix(TELEGRAM_AUTH_SCHEME))
        .filter(|value| !value.is_empty())
    else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(value) => value.as_secs(),
        Err(_) => return status(StatusCode::SERVICE_UNAVAILABLE),
    };
    let user = match state.telegram_verifier.verify(init_data, now) {
        Ok(user) => user,
        Err(_) => return status(StatusCode::UNAUTHORIZED),
    };
    let identity = match state.identities.find_by_telegram(user.id).await {
        Ok(Some(identity)) => identity,
        Ok(None) => return status(StatusCode::NOT_FOUND),
        Err(error) => {
            tracing::error!(%error, "Bond live location identity lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let coordinate = match GeoCoordinate::from_degrees(request.longitude, request.latitude) {
        Ok(value) => value,
        Err(_) => return status(StatusCode::UNPROCESSABLE_ENTITY),
    };
    let updated_at = DecimalU64::new(now);
    let pub_dress = match identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "stored Bond pub_dress is invalid");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let role = match state.identities.role_for(pub_dress.as_str()).await {
        Ok(role) => role,
        Err(error) => {
            tracing::error!(%error, "Bond role lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    // This is the Mini App's background sink. It only keeps an already-live
    // location fresh; a declared manual point is never replaced from here.
    match state
        .locations
        .refresh_live(pub_dress.as_str(), coordinate, updated_at)
        .await
    {
        Ok(true) => no_store_json(
            StatusCode::OK,
            LocationControlProjection {
                role,
                location: Some(BondLocation::new(
                    coordinate,
                    BondLocationMode::Live,
                    updated_at,
                )),
            },
        ),
        Ok(false) => status(StatusCode::CONFLICT),
        Err(error) => {
            tracing::error!(%error, "Bond live location write failed");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

async fn read_location_control(
    State(state): State<LocationControlApiState>,
    headers: HeaderMap,
) -> Response {
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(value) => value.as_secs(),
        Err(_) => return status(StatusCode::SERVICE_UNAVAILABLE),
    };
    let (identity, cookie) = match authenticate_bond(&state, &headers, now).await {
        Ok(value) => value,
        Err(code) => return status(code),
    };
    let pub_dress = match identity.pub_dress.parse::<PubDress>() {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "stored Bond pub_dress is invalid");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let role = match state.identities.role_for(pub_dress.as_str()).await {
        Ok(role) => role,
        Err(error) => {
            tracing::error!(%error, "Bond role lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let mut response = match state.locations.read(pub_dress.as_str()).await {
        Ok(location) => no_store_json(StatusCode::OK, LocationControlProjection { role, location }),
        Err(error) => {
            tracing::error!(%error, "Bond location read failed");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

fn status(code: StatusCode) -> Response {
    let mut response = code.into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        "no-store".parse().expect("valid Cache-Control"),
    );
    response
}

fn no_store_json<T: Serialize>(code: StatusCode, value: T) -> Response {
    let mut response = (code, Json(value)).into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        "no-store".parse().expect("valid Cache-Control"),
    );
    response
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use axum::{
        body::{Body, to_bytes},
        http::{
            Request, StatusCode,
            header::{AUTHORIZATION, COOKIE, SET_COOKIE},
        },
    };
    use hmac::{Hmac, Mac};
    use nilxone_contracts::{BondLocation, BondLocationMode, DecimalU64, GeoCoordinate, PubDress};
    use sha2::Sha256;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::{
        BondAccessRole, BondLocationRepository, PendingLocationIntent, TelegramLocationIntents,
        location_control_router,
    };
    use crate::{
        DiscordOAuthClient, IdentityRepository, NativeAuthConfig, ProviderIdentity,
        RegistrationOutcome,
    };
    use axum::response::IntoResponse as _;

    const SESSION_TOKEN: &str = "123456:development-token";

    // `read_location_control` reads the real wall clock, unlike api.rs's
    // `StaticClock`-injected tests, so a fixed `auth_date` here would drift
    // out of the verifier's TTL depending on when the suite happens to run.
    fn session_now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after the Unix epoch")
            .as_secs()
    }

    fn session_signed_init_data(user_id: i64) -> String {
        let mut fields = BTreeMap::from([
            ("auth_date", session_now().to_string()),
            ("query_id", "query-1".to_owned()),
            (
                "user",
                format!(r#"{{"id":{user_id},"first_name":"Sasha"}}"#),
            ),
        ]);
        let check = fields
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut secret = Hmac::<Sha256>::new_from_slice(b"WebAppData").expect("valid key");
        secret.update(SESSION_TOKEN.as_bytes());
        let secret = secret.finalize().into_bytes();
        let mut signature = Hmac::<Sha256>::new_from_slice(&secret).expect("valid key");
        signature.update(check.as_bytes());
        fields.insert(
            "hash",
            signature
                .finalize()
                .into_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        );
        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields)
            .finish()
    }

    async fn session_test_app(database_url: &str) -> axum::Router {
        test_app(database_url, None).await
    }

    // A stand-in for Discord's user endpoint: `access-<id>` names the account.
    async fn discord_oauth() -> DiscordOAuthClient {
        let api = axum::Router::new().route(
            "/v10/users/@me",
            axum::routing::get(|headers: axum::http::HeaderMap| async move {
                match headers
                    .get(AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.strip_prefix("Bearer "))
                    .and_then(|token| token.strip_prefix("access-"))
                {
                    Some(user_id) => (
                        StatusCode::OK,
                        axum::Json(serde_json::json!({ "id": user_id })),
                    )
                        .into_response(),
                    None => StatusCode::UNAUTHORIZED.into_response(),
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let origin = format!("http://{}", listener.local_addr().expect("address"));
        tokio::spawn(async move {
            axum::serve(listener, api)
                .await
                .expect("Discord API stand-in");
        });
        DiscordOAuthClient::with_api_origin("client-1", "client-secret", origin)
    }

    async fn test_app(database_url: &str, discord: Option<DiscordOAuthClient>) -> axum::Router {
        let identities = IdentityRepository::connect(database_url)
            .await
            .expect("identity repository");
        let locations = BondLocationRepository::connect(database_url)
            .await
            .expect("bond location repository");
        location_control_router(
            identities,
            locations,
            super::TelegramInitDataVerifier::new(SESSION_TOKEN.to_owned(), 300),
            discord,
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("valid native auth configuration"),
        )
    }

    fn session_cookie_from(response: &axum::response::Response) -> String {
        response
            .headers()
            .get(SET_COOKIE)
            .expect("a session cookie is set on first authentication")
            .to_str()
            .expect("cookie header is valid UTF-8")
            .split(';')
            .next()
            .expect("cookie has a name=value pair")
            .to_owned()
    }

    #[tokio::test]
    async fn a_fresh_init_data_read_mints_a_session_the_next_read_can_reuse() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let app = session_test_app(&database_url).await;
        let pub_dress: PubDress = "0x1alice".parse().expect("valid pub_dress");
        IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository")
            .register(&pub_dress, &ProviderIdentity::telegram(7), session_now())
            .await
            .expect("registration");

        let first = app
            .clone()
            .oneshot(
                Request::get("/api/v1/location-control")
                    .header(
                        AUTHORIZATION,
                        format!("tma {}", session_signed_init_data(7)),
                    )
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(first.status(), StatusCode::OK);
        let cookie = session_cookie_from(&first);

        // No Authorization header at all: only the cookie minted above proves
        // who is asking. `initData`'s own signature could have gone stale
        // between these two requests and this would still succeed, which is
        // the point - see documents/15-devices-and-recovery.md, Single Active
        // Client, in nilx-one/0x1.
        let second = app
            .oneshot(
                Request::get("/api/v1/location-control")
                    .header(COOKIE, cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(second.status(), StatusCode::OK);
        let body = to_bytes(second.into_body(), 4096).await.expect("body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["role"], "user");
    }

    #[tokio::test]
    async fn a_discord_activity_reads_the_same_manual_location_telegram_declared() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let app = test_app(&database_url, Some(discord_oauth().await)).await;
        let pub_dress: PubDress = "0x1sky".parse().expect("valid pub_dress");
        IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository")
            .register(&pub_dress, &ProviderIdentity::discord("42"), 10)
            .await
            .expect("registration");
        let manual = GeoCoordinate::from_degrees(2.3522, 48.8566).expect("manual point");
        BondLocationRepository::connect(&database_url)
            .await
            .expect("Bond location repository")
            .write(
                "0x1sky",
                BondLocation::new(manual, BondLocationMode::Manual, DecimalU64::new(30)),
            )
            .await
            .expect("set manual");

        let response = app
            .clone()
            .oneshot(
                Request::get("/api/v1/location-control")
                    .header(AUTHORIZATION, "discord access-42")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get(SET_COOKIE).is_none());
        let body = to_bytes(response.into_body(), 4096).await.expect("body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["location"]["mode"], "manual");
        assert_eq!(
            body["location"]["coordinate"]["longitude_e7"],
            manual.longitude_e7().to_string()
        );

        let unbound = app
            .oneshot(
                Request::get("/api/v1/location-control")
                    .header(AUTHORIZATION, "discord access-99")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(unbound.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn an_unregistered_telegram_account_is_not_found_and_gets_no_session() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let app = session_test_app(&database_url).await;

        let response = app
            .oneshot(
                Request::get("/api/v1/location-control")
                    .header(
                        AUTHORIZATION,
                        format!("tma {}", session_signed_init_data(99)),
                    )
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(response.headers().get(SET_COOKIE).is_none());
    }

    #[tokio::test]
    async fn a_stale_or_missing_cookie_still_requires_a_fresh_init_data_header() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let app = session_test_app(&database_url).await;

        let response = app
            .oneshot(
                Request::get("/api/v1/location-control")
                    .header(COOKIE, "__Host-0x1_session=not-a-real-session-token")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    async fn registered(database_url: &str, pub_dress: &str, telegram: i64) -> IdentityRepository {
        let identities = IdentityRepository::connect(database_url)
            .await
            .expect("identity repository");
        let pub_dress: PubDress = pub_dress.parse().expect("valid pub_dress");
        let registration = identities
            .register(&pub_dress, &ProviderIdentity::telegram(telegram), 10)
            .await
            .expect("registration");
        assert!(matches!(registration, RegistrationOutcome::Registered(_)));
        identities
    }

    #[test]
    fn admin_is_user_plus_manual_location() {
        assert!(!BondAccessRole::User.can_set_manual_location());
        assert!(!BondAccessRole::Business.can_set_manual_location());
        assert!(BondAccessRole::Admin.can_set_manual_location());
        assert_eq!(BondAccessRole::default(), BondAccessRole::User);
    }

    #[tokio::test]
    async fn registration_creates_a_user_and_only_a_stored_role_changes_it() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let identities = registered(&database_url, "0x1alice", 7).await;
        let alice: PubDress = "0x1alice".parse().expect("valid pub_dress");

        assert_eq!(
            identities.role_for("0x1alice").await.expect("role"),
            BondAccessRole::User
        );
        assert!(
            identities
                .set_role(&alice, BondAccessRole::Business)
                .await
                .expect("assign business")
        );
        assert_eq!(
            identities.role_for("0x1alice").await.expect("role"),
            BondAccessRole::Business
        );

        let unknown: PubDress = "0x1nobody".parse().expect("valid pub_dress");
        assert!(
            !identities
                .set_role(&unknown, BondAccessRole::Admin)
                .await
                .expect("unknown Bond")
        );
    }

    #[tokio::test]
    async fn background_live_refresh_never_leaves_manual() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let _identities = registered(&database_url, "0x1sky", 7).await;
        let locations = BondLocationRepository::connect(&database_url)
            .await
            .expect("Bond location repository");

        let first = GeoCoordinate::from_degrees(30.5234, 50.4501).expect("first point");
        assert!(
            locations
                .refresh_live("0x1sky", first, DecimalU64::new(10))
                .await
                .expect("first live")
        );
        let manual = GeoCoordinate::from_degrees(2.3522, 48.8566).expect("manual point");
        locations
            .write(
                "0x1sky",
                BondLocation::new(manual, BondLocationMode::Manual, DecimalU64::new(20)),
            )
            .await
            .expect("set manual");

        let device = GeoCoordinate::from_degrees(30.5240, 50.4510).expect("device point");
        assert!(
            !locations
                .refresh_live("0x1sky", device, DecimalU64::new(30))
                .await
                .expect("refused refresh")
        );
        let kept = locations
            .read("0x1sky")
            .await
            .expect("read")
            .expect("location");
        assert_eq!(kept.mode, BondLocationMode::Manual);
        assert_eq!(kept.coordinate, manual);
        assert_eq!(kept.updated_at.get(), 20);

        locations
            .write(
                "0x1sky",
                BondLocation::new(device, BondLocationMode::Live, DecimalU64::new(40)),
            )
            .await
            .expect("explicit return to live");
        assert!(
            locations
                .refresh_live("0x1sky", first, DecimalU64::new(50))
                .await
                .expect("live refresh")
        );
        let refreshed = locations
            .read("0x1sky")
            .await
            .expect("read")
            .expect("location");
        assert_eq!(refreshed.mode, BondLocationMode::Live);
        assert_eq!(refreshed.coordinate, first);
    }

    #[tokio::test]
    async fn location_intent_is_explicit_and_single_use() {
        let intents = TelegramLocationIntents::new(Duration::from_secs(60));
        intents.begin(7, PendingLocationIntent::Manual).await;
        assert_eq!(
            intents.consume(7).await,
            Some(PendingLocationIntent::Manual)
        );
        assert_eq!(intents.consume(7).await, None);
    }

    #[tokio::test]
    async fn one_active_location_preserves_live_vs_manual_provenance() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let pub_dress: PubDress = "0x1sky".parse().expect("valid pub_dress");
        let registration = identities
            .register(&pub_dress, &ProviderIdentity::telegram(7), 10)
            .await
            .expect("registration");
        assert!(matches!(registration, RegistrationOutcome::Registered(_)));

        let locations = BondLocationRepository::connect(&database_url)
            .await
            .expect("Bond location repository");
        assert_eq!(
            locations
                .read(pub_dress.as_str())
                .await
                .expect("read empty"),
            None
        );

        let observed = GeoCoordinate::from_degrees(30.5234, 50.4501).expect("observed point");
        locations
            .write(
                pub_dress.as_str(),
                BondLocation::new(observed, BondLocationMode::Live, DecimalU64::new(20)),
            )
            .await
            .expect("record live");
        let live = locations
            .read(pub_dress.as_str())
            .await
            .expect("read live")
            .expect("live location");
        assert_eq!(live.coordinate, observed);
        assert_eq!(live.mode, BondLocationMode::Live);
        assert_eq!(live.updated_at.get(), 20);

        let manual = GeoCoordinate::from_degrees(2.3522, 48.8566).expect("manual point");
        locations
            .write(
                pub_dress.as_str(),
                BondLocation::new(manual, BondLocationMode::Manual, DecimalU64::new(30)),
            )
            .await
            .expect("set manual");
        let controlled = locations
            .read(pub_dress.as_str())
            .await
            .expect("read manual")
            .expect("manual location");
        assert_eq!(controlled.coordinate, manual);
        assert_eq!(controlled.mode, BondLocationMode::Manual);
        assert_eq!(controlled.updated_at.get(), 30);

        let current = GeoCoordinate::from_degrees(30.5240, 50.4510).expect("current point");
        locations
            .write(
                pub_dress.as_str(),
                BondLocation::new(current, BondLocationMode::Live, DecimalU64::new(40)),
            )
            .await
            .expect("return live");
        let returned = locations
            .read(pub_dress.as_str())
            .await
            .expect("read returned live")
            .expect("returned location");
        assert_eq!(returned.coordinate, current);
        assert_eq!(returned.mode, BondLocationMode::Live);
        assert_eq!(returned.updated_at.get(), 40);
    }
}
