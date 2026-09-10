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
    extract::State,
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL},
    },
    response::{IntoResponse, Response},
    routing::get,
};
use ox1_contracts::{BondLocation, BondLocationMode, DecimalU64, GeoCoordinate, PubDress};
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

/// Application authorization role for a human Bond.
///
/// This is not a Bond kind or protocol authority class. The role only gates
/// application capabilities such as choosing an explicit manual map position.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BondAccessRole {
    User,
    Admin,
}

/// Current deployment authorization policy.
///
/// Authority is resolved only after provider authentication has identified the
/// Bond. Provider usernames, Telegram display data, and Telegram numeric IDs do
/// not grant admin rights.
#[must_use]
pub fn role_for_pub_dress(pub_dress: &PubDress) -> BondAccessRole {
    match pub_dress.as_str() {
        "0x0небо" | "0x0sky" => BondAccessRole::Admin,
        _ => BondAccessRole::User,
    }
}

#[derive(Clone, Debug)]
pub struct BondLocationRepository {
    pool: SqlitePool,
}

impl BondLocationRepository {
    pub async fn connect(database_url: &str) -> Result<Self, BondLocationRepositoryError> {
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
        let Some((intent, started)) = self.pending.lock().await.remove(&telegram_user_id) else {
            return None;
        };
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
    match state.locations.read(pub_dress.as_str()).await {
        Ok(location) => no_store_json(
            StatusCode::OK,
            LocationControlProjection {
                role: role_for_pub_dress(&pub_dress),
                location,
            },
        ),
        Err(error) => {
            tracing::error!(%error, "Bond location read failed");
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

    use ox1_contracts::{BondLocation, BondLocationMode, DecimalU64, GeoCoordinate, PubDress};

    use super::{
        BondAccessRole, BondLocationRepository, PendingLocationIntent, TelegramLocationIntents,
        role_for_pub_dress,
    };
    use crate::{IdentityRepository, ProviderIdentity, RegistrationOutcome};

    #[test]
    fn only_current_admin_pub_dresses_have_admin_capability() {
        let sky: PubDress = "0x0sky".parse().expect("admin pub_dress");
        let nebo: PubDress = "0x0небо".parse().expect("admin pub_dress");
        let case_variant: PubDress = "0x0Sky".parse().expect("ordinary pub_dress");
        let other: PubDress = "0x0alice".parse().expect("ordinary pub_dress");

        assert_eq!(role_for_pub_dress(&sky), BondAccessRole::Admin);
        assert_eq!(role_for_pub_dress(&nebo), BondAccessRole::Admin);
        assert_eq!(role_for_pub_dress(&case_variant), BondAccessRole::User);
        assert_eq!(role_for_pub_dress(&other), BondAccessRole::User);
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
        assert!(matches!(
            registration,
            RegistrationOutcome::Registered(_)
        ));

        let locations = BondLocationRepository::connect(&database_url)
            .await
            .expect("Bond location repository");
        assert_eq!(
            locations.read(pub_dress.as_str()).await.expect("read empty"),
            None
        );

        let observed = GeoCoordinate::from_degrees(30.5234, 50.4501).expect("observed point");
        locations
            .write(
                pub_dress.as_str(),
                BondLocation::new(
                    observed,
                    BondLocationMode::Live,
                    DecimalU64::new(20),
                ),
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
                BondLocation::new(
                    manual,
                    BondLocationMode::Manual,
                    DecimalU64::new(30),
                ),
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
                BondLocation::new(
                    current,
                    BondLocationMode::Live,
                    DecimalU64::new(40),
                ),
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
