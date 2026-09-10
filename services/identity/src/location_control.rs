// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header::{AUTHORIZATION, CACHE_CONTROL}},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::{IdentityRepository, TelegramInitDataVerifier};

const TELEGRAM_AUTH_SCHEME: &str = "tma ";
const DEFAULT_INTENT_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TelegramAccessRole {
    User,
    Admin,
}

#[derive(Clone, Debug, Default)]
pub struct TelegramAdminPolicy {
    admin_user_ids: Arc<HashSet<i64>>,
}

impl TelegramAdminPolicy {
    pub fn from_csv(value: &str) -> Result<Self, TelegramAdminPolicyError> {
        let mut admin_user_ids = HashSet::new();
        for raw in value.split(',').map(str::trim).filter(|part| !part.is_empty()) {
            let user_id = raw
                .parse::<i64>()
                .map_err(|_| TelegramAdminPolicyError::InvalidUserId(raw.to_owned()))?;
            admin_user_ids.insert(user_id);
        }
        Ok(Self {
            admin_user_ids: Arc::new(admin_user_ids),
        })
    }

    pub fn role_for(&self, telegram_user_id: i64) -> TelegramAccessRole {
        if self.admin_user_ids.contains(&telegram_user_id) {
            TelegramAccessRole::Admin
        } else {
            TelegramAccessRole::User
        }
    }

    pub fn is_admin(&self, telegram_user_id: i64) -> bool {
        self.role_for(telegram_user_id) == TelegramAccessRole::Admin
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum TelegramAdminPolicyError {
    #[error("invalid Telegram admin user id: {0}")]
    InvalidUserId(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct LocationPoint {
    pub longitude: f64,
    pub latitude: f64,
}

impl LocationPoint {
    pub fn new(longitude: f64, latitude: f64) -> Result<Self, LocationControlError> {
        if !longitude.is_finite()
            || !latitude.is_finite()
            || !(-180.0..=180.0).contains(&longitude)
            || !(-90.0..=90.0).contains(&latitude)
        {
            return Err(LocationControlError::InvalidPoint);
        }
        Ok(Self {
            longitude,
            latitude,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BondLocationMode {
    Live,
    Manual,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BondLocationControl {
    pub mode: BondLocationMode,
    /// Last factual coordinate received through the explicit current-position flow.
    pub observed_position: Option<LocationPoint>,
    pub observed_at: Option<u64>,
    /// Presentation-only point. It never replaces `observed_position`.
    pub manual_position: Option<LocationPoint>,
    pub manual_set_at: Option<u64>,
}

impl Default for BondLocationControl {
    fn default() -> Self {
        Self {
            mode: BondLocationMode::Live,
            observed_position: None,
            observed_at: None,
            manual_position: None,
            manual_set_at: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct LocationControlRepository {
    pool: SqlitePool,
}

impl LocationControlRepository {
    pub async fn connect(database_url: &str) -> Result<Self, LocationControlError> {
        let max_connections = if database_url.contains(":memory:") { 1 } else { 5 };
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

    pub async fn read(&self, pub_dress: &str) -> Result<BondLocationControl, LocationControlError> {
        let row = sqlx::query(
            "SELECT mode, observed_longitude, observed_latitude, observed_at, \
                    manual_longitude, manual_latitude, manual_set_at \
             FROM bond_location_control WHERE pub_dress = ?",
        )
        .bind(pub_dress)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(BondLocationControl::default());
        };

        let mode = match row.get::<String, _>("mode").as_str() {
            "live" => BondLocationMode::Live,
            "manual" => BondLocationMode::Manual,
            _ => return Err(LocationControlError::CorruptState),
        };
        let observed_position = optional_point(
            row.get::<Option<f64>, _>("observed_longitude"),
            row.get::<Option<f64>, _>("observed_latitude"),
        )?;
        let observed_at = optional_u64(row.get::<Option<i64>, _>("observed_at"))?;
        let manual_position = optional_point(
            row.get::<Option<f64>, _>("manual_longitude"),
            row.get::<Option<f64>, _>("manual_latitude"),
        )?;
        let manual_set_at = optional_u64(row.get::<Option<i64>, _>("manual_set_at"))?;

        if observed_position.is_some() != observed_at.is_some()
            || manual_position.is_some() != manual_set_at.is_some()
            || (mode == BondLocationMode::Live && manual_position.is_some())
            || (mode == BondLocationMode::Manual && manual_position.is_none())
        {
            return Err(LocationControlError::CorruptState);
        }

        Ok(BondLocationControl {
            mode,
            observed_position,
            observed_at,
            manual_position,
            manual_set_at,
        })
    }

    /// Stores factual location received from the explicit current-position flow
    /// and returns the Bond to ordinary live/device mode. Any old manual point is
    /// removed so it cannot silently become active again later.
    pub async fn record_live(
        &self,
        pub_dress: &str,
        point: LocationPoint,
        observed_at: u64,
    ) -> Result<(), LocationControlError> {
        sqlx::query(
            "INSERT INTO bond_location_control \
             (pub_dress, mode, observed_longitude, observed_latitude, observed_at) \
             VALUES (?, 'live', ?, ?, ?) \
             ON CONFLICT(pub_dress) DO UPDATE SET \
               mode = 'live', \
               observed_longitude = excluded.observed_longitude, \
               observed_latitude = excluded.observed_latitude, \
               observed_at = excluded.observed_at, \
               manual_longitude = NULL, \
               manual_latitude = NULL, \
               manual_set_at = NULL",
        )
        .bind(pub_dress)
        .bind(point.longitude)
        .bind(point.latitude)
        .bind(to_i64(observed_at)?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Selects presentation location while preserving the last factual
    /// observation, if one exists. Manual location is not observation evidence.
    pub async fn set_manual(
        &self,
        pub_dress: &str,
        point: LocationPoint,
        set_at: u64,
    ) -> Result<(), LocationControlError> {
        sqlx::query(
            "INSERT INTO bond_location_control \
             (pub_dress, mode, manual_longitude, manual_latitude, manual_set_at) \
             VALUES (?, 'manual', ?, ?, ?) \
             ON CONFLICT(pub_dress) DO UPDATE SET \
               mode = 'manual', \
               manual_longitude = excluded.manual_longitude, \
               manual_latitude = excluded.manual_latitude, \
               manual_set_at = excluded.manual_set_at",
        )
        .bind(pub_dress)
        .bind(point.longitude)
        .bind(point.latitude)
        .bind(to_i64(set_at)?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn optional_point(
    longitude: Option<f64>,
    latitude: Option<f64>,
) -> Result<Option<LocationPoint>, LocationControlError> {
    match (longitude, latitude) {
        (None, None) => Ok(None),
        (Some(longitude), Some(latitude)) => LocationPoint::new(longitude, latitude).map(Some),
        _ => Err(LocationControlError::CorruptState),
    }
}

fn optional_u64(value: Option<i64>) -> Result<Option<u64>, LocationControlError> {
    value
        .map(|value| u64::try_from(value).map_err(|_| LocationControlError::CorruptState))
        .transpose()
}

fn to_i64(value: u64) -> Result<i64, LocationControlError> {
    i64::try_from(value).map_err(|_| LocationControlError::TimestampOutOfRange)
}

#[derive(Debug, Error)]
pub enum LocationControlError {
    #[error("location control database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid geographic point")]
    InvalidPoint,
    #[error("location control timestamp is outside the supported range")]
    TimestampOutOfRange,
    #[error("stored location control state violates its contract")]
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
        let Some((intent, started)) = self.pending.lock().await.remove(&telegram_user_id) else {
            return None;
        };
        (started.elapsed() <= self.ttl).then_some(intent)
    }
}

#[derive(Clone)]
struct LocationControlApiState {
    identities: IdentityRepository,
    location: LocationControlRepository,
    telegram_verifier: TelegramInitDataVerifier,
}

pub fn location_control_router(
    identities: IdentityRepository,
    location: LocationControlRepository,
    telegram_verifier: TelegramInitDataVerifier,
) -> Router {
    Router::new()
        .route("/api/v1/location-control", get(read_location_control))
        .with_state(LocationControlApiState {
            identities,
            location,
            telegram_verifier,
        })
}

#[derive(Serialize)]
struct LocationControlProjection {
    mode: BondLocationMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<LocationPoint>,
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
            tracing::error!(%error, "location-control identity lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    match state.location.read(&identity.pub_dress).await {
        Ok(control) => no_store_json(
            StatusCode::OK,
            LocationControlProjection {
                mode: control.mode,
                position: if control.mode == BondLocationMode::Manual {
                    control.manual_position
                } else {
                    None
                },
            },
        ),
        Err(error) => {
            tracing::error!(%error, "location-control read failed");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

fn status(code: StatusCode) -> Response {
    let mut response = code.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, "no-store".parse().expect("valid Cache-Control"));
    response
}

fn no_store_json<T: Serialize>(code: StatusCode, value: T) -> Response {
    let mut response = (code, Json(value)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, "no-store".parse().expect("valid Cache-Control"));
    response
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        BondLocationMode, LocationControlRepository, LocationPoint, PendingLocationIntent,
        TelegramAccessRole, TelegramAdminPolicy, TelegramLocationIntents,
    };
    use crate::{IdentityRepository, ProviderIdentity, PubDress, RegistrationOutcome};

    #[test]
    fn admin_policy_defaults_to_user_and_promotes_only_configured_ids() {
        let policy = TelegramAdminPolicy::from_csv("7, 13").expect("policy must parse");
        assert_eq!(policy.role_for(6), TelegramAccessRole::User);
        assert_eq!(policy.role_for(7), TelegramAccessRole::Admin);
        assert!(policy.is_admin(13));
    }

    #[tokio::test]
    async fn location_intent_is_explicit_and_single_use() {
        let intents = TelegramLocationIntents::new(Duration::from_secs(60));
        intents.begin(7, PendingLocationIntent::Manual).await;
        assert_eq!(intents.consume(7).await, Some(PendingLocationIntent::Manual));
        assert_eq!(intents.consume(7).await, None);
    }

    #[tokio::test]
    async fn manual_position_preserves_observation_and_current_returns_to_live() {
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

        let location = LocationControlRepository::connect(&database_url)
            .await
            .expect("location repository");
        let observed = LocationPoint::new(30.5234, 50.4501).expect("observed point");
        location
            .record_live(pub_dress.as_str(), observed, 20)
            .await
            .expect("record live");
        let manual = LocationPoint::new(2.3522, 48.8566).expect("manual point");
        location
            .set_manual(pub_dress.as_str(), manual, 30)
            .await
            .expect("set manual");

        let controlled = location.read(pub_dress.as_str()).await.expect("read manual");
        assert_eq!(controlled.mode, BondLocationMode::Manual);
        assert_eq!(controlled.observed_position, Some(observed));
        assert_eq!(controlled.observed_at, Some(20));
        assert_eq!(controlled.manual_position, Some(manual));

        let current = LocationPoint::new(30.5240, 50.4510).expect("current point");
        location
            .record_live(pub_dress.as_str(), current, 40)
            .await
            .expect("return live");
        let live = location.read(pub_dress.as_str()).await.expect("read live");
        assert_eq!(live.mode, BondLocationMode::Live);
        assert_eq!(live.observed_position, Some(current));
        assert_eq!(live.observed_at, Some(40));
        assert_eq!(live.manual_position, None);
        assert_eq!(live.manual_set_at, None);
    }
}
