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
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL},
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

use crate::{IdentityRepository, TelegramInitDataVerifier};

const TELEGRAM_AUTH_SCHEME: &str = "tma ";
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
struct LocationControlApiState {
    identities: IdentityRepository,
    locations: BondLocationRepository,
    telegram_verifier: TelegramInitDataVerifier,
}

pub fn location_control_router(
    identities: IdentityRepository,
    locations: BondLocationRepository,
    telegram_verifier: TelegramInitDataVerifier,
) -> Router {
    Router::new()
        .route("/api/v1/location-control", get(read_location_control))
        .route("/api/v1/location-control", post(write_live_location))
        .layer(DefaultBodyLimit::max(MAX_LOCATION_REQUEST_BYTES))
        .with_state(LocationControlApiState {
            identities,
            locations,
            telegram_verifier,
        })
}

/// Authenticated operational projection consumed by the Telegram-hosted Web
/// client. `location: null` means no Bond location has been submitted yet; the
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
            tracing::error!(%error, "Bond location identity lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
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
    match state.locations.read(pub_dress.as_str()).await {
        Ok(location) => no_store_json(StatusCode::OK, LocationControlProjection { role, location }),
        Err(error) => {
            tracing::error!(%error, "Bond location read failed");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
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
    use std::time::Duration;

    use nilxone_contracts::{BondLocation, BondLocationMode, DecimalU64, GeoCoordinate, PubDress};

    use super::{
        BondAccessRole, BondLocationRepository, PendingLocationIntent, TelegramLocationIntents,
    };
    use crate::{IdentityRepository, ProviderIdentity, RegistrationOutcome};

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
        let identities = registered(&database_url, "0x0alice", 7).await;
        let alice: PubDress = "0x0alice".parse().expect("valid pub_dress");

        assert_eq!(
            identities.role_for("0x0alice").await.expect("role"),
            BondAccessRole::User
        );
        assert!(
            identities
                .set_role(&alice, BondAccessRole::Business)
                .await
                .expect("assign business")
        );
        assert_eq!(
            identities.role_for("0x0alice").await.expect("role"),
            BondAccessRole::Business
        );

        let unknown: PubDress = "0x0nobody".parse().expect("valid pub_dress");
        assert!(
            !identities
                .set_role(&unknown, BondAccessRole::Admin)
                .await
                .expect("unknown Bond")
        );
    }

    #[tokio::test]
    async fn existing_name_derived_admins_are_carried_over_once() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let identities = registered(&database_url, "0x0sky", 7).await;
        // A fresh database has no pre-existing admins to carry over.
        assert_eq!(
            identities.role_for("0x0sky").await.expect("role"),
            BondAccessRole::User
        );

        // Simulate a deployment that predates `bond_roles`.
        let pool = sqlx::SqlitePool::connect(&database_url)
            .await
            .expect("raw pool");
        sqlx::query("DROP TABLE bond_roles")
            .execute(&pool)
            .await
            .expect("drop roles");
        pool.close().await;

        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("upgraded repository");
        assert_eq!(
            identities.role_for("0x0sky").await.expect("role"),
            BondAccessRole::Admin
        );

        // After the upgrade, the name itself grants nothing.
        let nebo: PubDress = "0x0небо".parse().expect("valid pub_dress");
        identities
            .register(&nebo, &ProviderIdentity::telegram(8), 20)
            .await
            .expect("registration");
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("reopened repository");
        assert_eq!(
            identities.role_for("0x0небо").await.expect("role"),
            BondAccessRole::User
        );
        assert_eq!(
            identities.role_for("0x0sky").await.expect("role"),
            BondAccessRole::Admin
        );
    }

    #[tokio::test]
    async fn background_live_refresh_never_leaves_manual() {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let _identities = registered(&database_url, "0x0sky", 7).await;
        let locations = BondLocationRepository::connect(&database_url)
            .await
            .expect("Bond location repository");

        let first = GeoCoordinate::from_degrees(30.5234, 50.4501).expect("first point");
        assert!(
            locations
                .refresh_live("0x0sky", first, DecimalU64::new(10))
                .await
                .expect("first live")
        );
        let manual = GeoCoordinate::from_degrees(2.3522, 48.8566).expect("manual point");
        locations
            .write(
                "0x0sky",
                BondLocation::new(manual, BondLocationMode::Manual, DecimalU64::new(20)),
            )
            .await
            .expect("set manual");

        let device = GeoCoordinate::from_degrees(30.5240, 50.4510).expect("device point");
        assert!(
            !locations
                .refresh_live("0x0sky", device, DecimalU64::new(30))
                .await
                .expect("refused refresh")
        );
        let kept = locations
            .read("0x0sky")
            .await
            .expect("read")
            .expect("location");
        assert_eq!(kept.mode, BondLocationMode::Manual);
        assert_eq!(kept.coordinate, manual);
        assert_eq!(kept.updated_at.get(), 20);

        locations
            .write(
                "0x0sky",
                BondLocation::new(device, BondLocationMode::Live, DecimalU64::new(40)),
            )
            .await
            .expect("explicit return to live");
        assert!(
            locations
                .refresh_live("0x0sky", first, DecimalU64::new(50))
                .await
                .expect("live refresh")
        );
        let refreshed = locations
            .read("0x0sky")
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
        let pub_dress: PubDress = "0x0sky".parse().expect("valid pub_dress");
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
