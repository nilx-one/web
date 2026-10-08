// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Spoken lines: a permitted Bond says a short text aloud on the map, and
//! the Bonds within earshot hear it.
//!
//! This is presentation delivery, not protocol truth. A line is not an
//! Interaction, creates no `BondChain` entry, and proves nothing about where
//! anyone was. Whether two Bonds are "near" is decided by Core's
//! `within_earshot` over the locations the service already holds; the line
//! carries no coordinate and no response exposes one.
//!
//! Lines arrive from a trusted producer (the hub), never from a browser: the
//! ingest route needs a service token and refuses any speaker without a
//! `bond_speakers` row.

use std::{
    future::Future,
    pin::Pin,
    str::FromStr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use nilxone_contracts::{
    BondLocation, BondLocationMode, DecimalU64, EarshotRadius, GeoCoordinate, PubDress, SpokenLine,
    SpokenLineId, SpokenText, distance_meters, within_earshot,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use subtle::ConstantTimeEq;
use thiserror::Error;

use crate::{
    DiscordOAuthClient, IdentityRepository, NativeAuthConfig, TelegramInitDataVerifier,
    location_control::{
        BondLocationRepository, LocationControlApiState, append_cookie, authenticate_bond,
    },
};

/// How long a line stays audible after it was spoken.
pub const SPEECH_TTL_SECONDS: u64 = 10 * 60;
/// Default reach of a spoken line.
pub const DEFAULT_EARSHOT_METERS: u32 = 500;
/// A `live` location older than this no longer places its Bond anywhere.
/// A declared `manual` point does not age.
pub const LOCATION_MAX_AGE_SECONDS: u64 = 30 * 60;
/// The shortest ingest token the service accepts.
pub const MIN_INGEST_TOKEN_LEN: usize = 32;

const MAX_INGEST_BYTES: usize = 8 * 1024;
const MAX_ORIGIN_LEN: usize = 200;
const MAX_LINES_SERVED: i64 = 50;
const MAX_RELAY_RECIPIENTS: usize = 100;
/// A producer clock may run slightly ahead of ours.
const MAX_CLOCK_SKEW_SECONDS: u64 = 60;
const METERS_TO_E7_LATITUDE: u64 = 91;

#[derive(Debug, Error)]
pub enum SpeechConfigError {
    #[error("the speech ingest token must be at least {MIN_INGEST_TOKEN_LEN} bytes")]
    TokenTooShort,
    #[error("the earshot radius must be between 1 and 5000 meters")]
    InvalidEarshot,
}

/// Runtime settings for spoken lines. Without them the routes are not mounted.
#[derive(Clone)]
pub struct SpeechConfig {
    ingest_token_digest: [u8; 32],
    earshot: EarshotRadius,
}

impl SpeechConfig {
    /// # Errors
    ///
    /// Returns [`SpeechConfigError`] for a short token or a radius Core refuses.
    pub fn new(ingest_token: &str, earshot_meters: u32) -> Result<Self, SpeechConfigError> {
        if ingest_token.len() < MIN_INGEST_TOKEN_LEN {
            return Err(SpeechConfigError::TokenTooShort);
        }
        Ok(Self {
            ingest_token_digest: Sha256::digest(ingest_token.as_bytes()).into(),
            earshot: EarshotRadius::new(earshot_meters)
                .map_err(|_| SpeechConfigError::InvalidEarshot)?,
        })
    }

    fn accepts(&self, presented: &str) -> bool {
        let presented: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
        bool::from(presented.ct_eq(&self.ingest_token_digest))
    }
}

/// Delivers a spoken line to Telegram users. The port keeps the Bot API out
/// of the router and out of the tests.
pub trait SpeechRelay: Send + Sync + 'static {
    fn deliver(
        &self,
        telegram_user_ids: Vec<i64>,
        text: String,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>>;
}

/// A relay for deployments and tests that have no Telegram bot.
pub struct NoRelay;

impl SpeechRelay for NoRelay {
    fn deliver(
        &self,
        _telegram_user_ids: Vec<i64>,
        _text: String,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
}

#[derive(Debug, Error)]
pub enum SpeechRepositoryError {
    #[error("speech database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("stored spoken line violates its contract")]
    CorruptState,
}

/// A Telegram-bound Bond that has a location.
#[derive(Clone, Copy, Debug)]
pub struct Listener {
    pub telegram_user_id: i64,
    pub coordinate: GeoCoordinate,
}

#[derive(Clone, Debug)]
pub struct SpeechRepository {
    pool: SqlitePool,
}

impl SpeechRepository {
    /// Opens the store. The identity repository must have initialised the
    /// same database first, because both tables reference `identities`.
    ///
    /// # Errors
    ///
    /// Returns [`SpeechRepositoryError`] when the database cannot be opened
    /// or migrated.
    pub async fn connect(database_url: &str) -> Result<Self, SpeechRepositoryError> {
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
        sqlx::raw_sql(include_str!("../migrations/0018_spoken_lines.sql"))
            .execute(&pool)
            .await?;
        let repository = Self { pool };
        repository.migrate_speakers().await?;
        Ok(repository)
    }

    /// Creates `bond_speakers` and carries the first two speakers over,
    /// exactly once: a Bond that registers one of those names later gets
    /// nothing from it.
    async fn migrate_speakers(&self) -> Result<(), SpeechRepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name = 'bond_speakers')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if !exists {
            sqlx::raw_sql(include_str!("../migrations/0019_bond_speakers.sql"))
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn is_speaker(&self, pub_dress: &PubDress) -> Result<bool, SpeechRepositoryError> {
        Ok(sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM bond_speakers WHERE pub_dress = ?)",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&self.pool)
        .await?)
    }

    /// Lets an existing human Bond speak. There is no public route to this;
    /// it is set out of band, like a role.
    pub async fn allow_speaker(&self, pub_dress: &PubDress) -> Result<bool, SpeechRepositoryError> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO bond_speakers (pub_dress) \
             SELECT pub_dress FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human'",
        )
        .bind(pub_dress.as_str())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Stores a line once. Returns whether this call created it.
    pub async fn record(
        &self,
        line: &SpokenLine,
        received_at: u64,
    ) -> Result<bool, SpeechRepositoryError> {
        let spoken_at = i64::try_from(line.spoken_at().get())
            .map_err(|_| SpeechRepositoryError::CorruptState)?;
        let received_at =
            i64::try_from(received_at).map_err(|_| SpeechRepositoryError::CorruptState)?;
        let result = sqlx::query(
            "INSERT OR IGNORE INTO spoken_lines (line_id, speaker, text, spoken_at, received_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(line.id().as_str())
        .bind(line.speaker().as_str())
        .bind(line.text().as_str())
        .bind(spoken_at)
        .bind(received_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Lines spoken at or after `since`, oldest first, capped.
    pub async fn recent(&self, since: u64) -> Result<Vec<SpokenLine>, SpeechRepositoryError> {
        let since = i64::try_from(since).map_err(|_| SpeechRepositoryError::CorruptState)?;
        let rows = sqlx::query(
            "SELECT line_id, speaker, text, spoken_at FROM ( \
               SELECT line_id, speaker, text, spoken_at FROM spoken_lines \
               WHERE spoken_at >= ? ORDER BY spoken_at DESC, line_id DESC LIMIT ? \
             ) ORDER BY spoken_at ASC, line_id ASC",
        )
        .bind(since)
        .bind(MAX_LINES_SERVED)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let id = SpokenLineId::try_from(row.get::<String, _>("line_id"))
                    .map_err(|_| SpeechRepositoryError::CorruptState)?;
                let speaker = PubDress::try_from(row.get::<String, _>("speaker"))
                    .map_err(|_| SpeechRepositoryError::CorruptState)?;
                let text = SpokenText::try_from(row.get::<String, _>("text"))
                    .map_err(|_| SpeechRepositoryError::CorruptState)?;
                let spoken_at = u64::try_from(row.get::<i64, _>("spoken_at"))
                    .map_err(|_| SpeechRepositoryError::CorruptState)?;
                Ok(SpokenLine::new(
                    id,
                    speaker,
                    text,
                    DecimalU64::new(spoken_at),
                ))
            })
            .collect()
    }

    /// Telegram-bound human Bonds whose location falls in the latitude band
    /// of `center` ± `radius`, and that still place them somewhere. This is
    /// only a prefilter; callers decide earshot exactly with Core.
    pub async fn telegram_listeners_near(
        &self,
        center: GeoCoordinate,
        radius: EarshotRadius,
        fresh_since: u64,
        excluding: &PubDress,
    ) -> Result<Vec<Listener>, SpeechRepositoryError> {
        let band = i64::try_from(u64::from(radius.meters()) * METERS_TO_E7_LATITUDE + 100)
            .map_err(|_| SpeechRepositoryError::CorruptState)?;
        let fresh_since =
            i64::try_from(fresh_since).map_err(|_| SpeechRepositoryError::CorruptState)?;
        let rows = sqlx::query(
            "SELECT provider.provider_subject AS telegram_subject, \
                    location.longitude_e7, location.latitude_e7 \
             FROM bond_locations AS location \
             JOIN identities ON identities.pub_dress = location.pub_dress \
             JOIN identity_providers AS provider \
               ON provider.pub_dress = location.pub_dress AND provider.provider = 'telegram' \
             WHERE identities.identity_kind = 'human' \
               AND location.pub_dress != ? \
               AND (location.mode = 'manual' OR location.updated_at >= ?) \
               AND location.latitude_e7 BETWEEN ? AND ?",
        )
        .bind(excluding.as_str())
        .bind(fresh_since)
        .bind(i64::from(center.latitude_e7()) - band)
        .bind(i64::from(center.latitude_e7()) + band)
        .fetch_all(&self.pool)
        .await?;
        let mut listeners = Vec::with_capacity(rows.len());
        for row in rows {
            let Ok(telegram_user_id) = row.get::<String, _>("telegram_subject").parse::<i64>()
            else {
                continue;
            };
            let longitude = i32::try_from(row.get::<i64, _>("longitude_e7"))
                .map_err(|_| SpeechRepositoryError::CorruptState)?;
            let latitude = i32::try_from(row.get::<i64, _>("latitude_e7"))
                .map_err(|_| SpeechRepositoryError::CorruptState)?;
            let coordinate = GeoCoordinate::new(longitude, latitude)
                .map_err(|_| SpeechRepositoryError::CorruptState)?;
            listeners.push(Listener {
                telegram_user_id,
                coordinate,
            });
        }
        Ok(listeners)
    }
}

#[derive(Clone)]
struct SpeechApiState {
    auth: LocationControlApiState,
    speech: SpeechRepository,
    relay: Arc<dyn SpeechRelay>,
    config: SpeechConfig,
}

#[allow(clippy::too_many_arguments)]
pub fn speech_router(
    identities: IdentityRepository,
    locations: BondLocationRepository,
    speech: SpeechRepository,
    telegram_verifier: TelegramInitDataVerifier,
    discord_oauth: Option<DiscordOAuthClient>,
    native_auth: NativeAuthConfig,
    relay: Arc<dyn SpeechRelay>,
    config: SpeechConfig,
) -> Router {
    Router::new()
        .route("/api/v1/speech", post(ingest_line))
        .route("/api/v1/speech/nearby", get(read_nearby))
        .layer(DefaultBodyLimit::max(MAX_INGEST_BYTES))
        .with_state(SpeechApiState {
            auth: LocationControlApiState {
                identities,
                locations,
                telegram_verifier,
                discord_oauth,
                native_auth,
            },
            speech,
            relay,
            config,
        })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IngestRequest {
    /// Where the utterance came from, such as `telegram.channel:name`.
    source: String,
    /// The utterance's id inside its source; `(source, external_id)` is the
    /// deduplication key.
    external_id: String,
    speaker: String,
    text: String,
    /// Unix epoch seconds.
    spoken_at: u64,
}

#[derive(Serialize)]
struct IngestResponse {
    line_id: String,
    status: IngestStatus,
    relayed_to: usize,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum IngestStatus {
    /// The line was new and is audible now.
    Recorded,
    /// The same utterance was already recorded; nothing more happened.
    Duplicate,
    /// The line is older than it can be heard; it was not stored.
    Expired,
}

async fn ingest_line(
    State(state): State<SpeechApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let presented = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !state.config.accepts(presented) {
        return failure(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Ok(request) = serde_json::from_slice::<IngestRequest>(&body) else {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request");
    };
    if !is_origin_part(&request.source) || !is_origin_part(&request.external_id) {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "invalid_origin");
    }
    let Ok(text) = SpokenText::try_from(request.text) else {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "invalid_text");
    };
    let Ok(speaker) = PubDress::try_from(request.speaker) else {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "invalid_speaker");
    };
    let Some(now) = now() else {
        return failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    if request.spoken_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS) {
        return failure(StatusCode::UNPROCESSABLE_ENTITY, "spoken_in_the_future");
    }
    match state.speech.is_speaker(&speaker).await {
        Ok(true) => {}
        // Unknown and not-permitted Bonds are indistinguishable on purpose.
        Ok(false) => return failure(StatusCode::FORBIDDEN, "speaker_not_permitted"),
        Err(error) => {
            tracing::error!(%error, "speaker lookup failed");
            return failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
        }
    }
    let id = line_id(&request.source, &request.external_id);
    if now.saturating_sub(request.spoken_at) > SPEECH_TTL_SECONDS {
        return json(
            StatusCode::OK,
            IngestResponse {
                line_id: id.as_str().to_owned(),
                status: IngestStatus::Expired,
                relayed_to: 0,
            },
        );
    }
    let line = SpokenLine::new(
        id,
        speaker.clone(),
        text,
        DecimalU64::new(request.spoken_at),
    );
    let created = match state.speech.record(&line, now).await {
        Ok(created) => created,
        Err(error) => {
            tracing::error!(%error, "spoken line write failed");
            return failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
        }
    };
    if !created {
        return json(
            StatusCode::OK,
            IngestResponse {
                line_id: line.id().as_str().to_owned(),
                status: IngestStatus::Duplicate,
                relayed_to: 0,
            },
        );
    }
    let recipients = match telegram_recipients(&state, &speaker, now).await {
        Ok(recipients) => recipients,
        Err(error) => {
            // The line is stored and audible on the web; only the copy fails.
            tracing::error!(%error, "spoken line recipient lookup failed");
            Vec::new()
        }
    };
    let relayed_to = recipients.len();
    if !recipients.is_empty() {
        let relay = Arc::clone(&state.relay);
        let copy = format!("{speaker}: {}", line.text());
        tokio::spawn(async move { relay.deliver(recipients, copy).await });
    }
    json(
        StatusCode::CREATED,
        IngestResponse {
            line_id: line.id().as_str().to_owned(),
            status: IngestStatus::Recorded,
            relayed_to,
        },
    )
}

/// Telegram users within earshot of the speaker, nearest first. The speaker
/// is never sent their own line back.
async fn telegram_recipients(
    state: &SpeechApiState,
    speaker: &PubDress,
    now: u64,
) -> Result<Vec<i64>, RecipientError> {
    let Some(origin) = placed(state.auth.locations.read(speaker.as_str()).await?, now) else {
        return Ok(Vec::new());
    };
    let candidates = state
        .speech
        .telegram_listeners_near(
            origin,
            state.config.earshot,
            now.saturating_sub(LOCATION_MAX_AGE_SECONDS),
            speaker,
        )
        .await?;
    let mut heard: Vec<(u32, i64)> = candidates
        .into_iter()
        .filter(|listener| within_earshot(origin, listener.coordinate, state.config.earshot))
        .map(|listener| {
            (
                distance_meters(origin, listener.coordinate),
                listener.telegram_user_id,
            )
        })
        .collect();
    heard.sort_unstable();
    heard.dedup_by_key(|(_, telegram_user_id)| *telegram_user_id);
    heard.truncate(MAX_RELAY_RECIPIENTS);
    Ok(heard.into_iter().map(|(_, id)| id).collect())
}

#[derive(Debug, Error)]
enum RecipientError {
    #[error(transparent)]
    Location(#[from] crate::location_control::BondLocationRepositoryError),
    #[error(transparent)]
    Speech(#[from] SpeechRepositoryError),
}

#[derive(Serialize)]
struct NearbyResponse {
    lines: Vec<SpokenLine>,
}

async fn read_nearby(State(state): State<SpeechApiState>, headers: HeaderMap) -> Response {
    let Some(now) = now() else {
        return failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    let (identity, cookie) = match authenticate_bond(&state.auth, &headers, now).await {
        Ok(value) => value,
        Err(code) => return status_only(code),
    };
    let Ok(listener) = PubDress::from_str(&identity.pub_dress) else {
        tracing::error!("stored Bond pub_dress is invalid");
        return failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    let mut response = match nearby_lines(&state, &listener, now).await {
        Ok(lines) => json(StatusCode::OK, NearbyResponse { lines }),
        Err(error) => {
            tracing::error!(%error, "nearby spoken lines failed");
            failure(StatusCode::SERVICE_UNAVAILABLE, "unavailable")
        }
    };
    if let Some(cookie) = cookie {
        append_cookie(&mut response, cookie);
    }
    response
}

/// What `listener` can hear right now: their own lines, and the lines of
/// every speaker whose current location is within earshot of theirs. A
/// listener with no current location hears only themself.
async fn nearby_lines(
    state: &SpeechApiState,
    listener: &PubDress,
    now: u64,
) -> Result<Vec<SpokenLine>, RecipientError> {
    let recent = state
        .speech
        .recent(now.saturating_sub(SPEECH_TTL_SECONDS))
        .await?;
    let here = placed(state.auth.locations.read(listener.as_str()).await?, now);
    let mut audible = Vec::with_capacity(recent.len());
    let mut heard_from: Vec<(PubDress, bool)> = Vec::new();
    for line in recent {
        if line.speaker() == listener {
            audible.push(line);
            continue;
        }
        let Some(here) = here else { continue };
        let near = if let Some((_, near)) = heard_from
            .iter()
            .find(|(speaker, _)| speaker == line.speaker())
        {
            *near
        } else {
            let there = placed(
                state.auth.locations.read(line.speaker().as_str()).await?,
                now,
            );
            let near = there.is_some_and(|there| within_earshot(there, here, state.config.earshot));
            heard_from.push((line.speaker().clone(), near));
            near
        };
        if near {
            audible.push(line);
        }
    }
    Ok(audible)
}

/// The coordinate a location still places its Bond at: a declared point
/// always, an observation only while it is fresh.
fn placed(location: Option<BondLocation>, now: u64) -> Option<GeoCoordinate> {
    let location = location?;
    let fresh = now.saturating_sub(location.updated_at.get()) <= LOCATION_MAX_AGE_SECONDS;
    (location.mode == BondLocationMode::Manual || fresh).then_some(location.coordinate)
}

fn line_id(source: &str, external_id: &str) -> SpokenLineId {
    let digest = Sha256::digest(format!("{source}\n{external_id}").as_bytes());
    let mut value = String::with_capacity(5 + 64);
    value.push_str("line_");
    for byte in digest {
        value.push_str(&format!("{byte:02x}"));
    }
    SpokenLineId::try_from(value).expect("a sha256 hex digest is a canonical line id")
}

fn is_origin_part(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ORIGIN_LEN
        && value.bytes().all(|b| b.is_ascii_graphic())
}

fn now() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_secs())
}

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
}

fn failure(code: StatusCode, error: &'static str) -> Response {
    json(code, ErrorBody { error })
}

fn status_only(code: StatusCode) -> Response {
    let mut response = code.into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        "no-store".parse().expect("valid Cache-Control"),
    );
    response
}

fn json<T: Serialize>(code: StatusCode, value: T) -> Response {
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

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
    };
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use tokio::sync::mpsc;
    use tower::ServiceExt as _;
    use url::form_urlencoded;

    use super::*;
    use crate::ProviderIdentity;

    const TELEGRAM_TOKEN: &str = "123456:development-token";
    const INGEST_TOKEN: &str = "speech-ingest-token-that-is-long-enough-to-pass";
    const KYIV: (f64, f64) = (30.5234, 50.4501);

    struct RecordingRelay(mpsc::UnboundedSender<(Vec<i64>, String)>);

    impl SpeechRelay for RecordingRelay {
        fn deliver(
            &self,
            telegram_user_ids: Vec<i64>,
            text: String,
        ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
            let _ = self.0.send((telegram_user_ids, text));
            Box::pin(async {})
        }
    }

    struct Harness {
        app: Router,
        database_url: String,
        identities: IdentityRepository,
        locations: BondLocationRepository,
        speech: SpeechRepository,
        relayed: mpsc::UnboundedReceiver<(Vec<i64>, String)>,
        _database: tempfile::NamedTempFile,
    }

    fn unix_now() -> u64 {
        now().expect("system clock is after the Unix epoch")
    }

    fn point(east_meters: f64, north_meters: f64) -> GeoCoordinate {
        // Close enough to a tangent plane at this scale for placing fixtures.
        let latitude = KYIV.1 + north_meters / 111_320.0;
        let longitude = KYIV.0 + east_meters / (111_320.0 * KYIV.1.to_radians().cos());
        GeoCoordinate::from_degrees(longitude, latitude).expect("valid coordinate")
    }

    async fn harness() -> Harness {
        let database = tempfile::NamedTempFile::new().expect("temporary database");
        let database_url = format!("sqlite://{}", database.path().display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        // Speech's historical seed includes a reserved administrator. Restore
        // that pre-reservation identity rather than publicly registering one.
        let legacy = sqlx::SqlitePool::connect(&database_url)
            .await
            .expect("legacy pool");
        sqlx::raw_sql(
            "DROP TRIGGER identities_reserved_admin_prefix_insert;
             INSERT INTO identities (pub_dress, identity_kind, created_at) VALUES ('0x0sky', 'human', 10);
             INSERT INTO identity_providers (provider, provider_subject, pub_dress) VALUES ('telegram', '1', '0x0sky');",
        ).execute(&legacy).await.expect("legacy administrator");
        sqlx::raw_sql(include_str!("../migrations/0021_reserved_admin_prefix.sql"))
            .execute(&legacy)
            .await
            .expect("restore reservation");
        legacy.close().await;
        for (pub_dress, telegram) in [("0x0sky", 1), ("0xfrSb", 2)] {
            register(&identities, pub_dress, telegram).await;
        }
        let locations = BondLocationRepository::connect(&database_url)
            .await
            .expect("location repository");
        let speech = SpeechRepository::connect(&database_url)
            .await
            .expect("speech repository");
        let (sender, relayed) = mpsc::unbounded_channel();
        let app = speech_router(
            identities.clone(),
            locations.clone(),
            speech.clone(),
            TelegramInitDataVerifier::new(TELEGRAM_TOKEN.to_owned(), 300),
            None,
            NativeAuthConfig::new(
                "test-auth-secret-that-is-at-least-thirty-two-bytes",
                "test-password-pepper-that-is-at-least-thirty-two-bytes",
            )
            .expect("valid native auth configuration"),
            Arc::new(RecordingRelay(sender)),
            SpeechConfig::new(INGEST_TOKEN, 500).expect("speech config"),
        );
        Harness {
            app,
            database_url,
            identities,
            locations,
            speech,
            relayed,
            _database: database,
        }
    }

    async fn register(identities: &IdentityRepository, pub_dress: &str, telegram: i64) {
        let pub_dress: PubDress = pub_dress.parse().expect("valid pub_dress");
        identities
            .register(&pub_dress, &ProviderIdentity::telegram(telegram), 10)
            .await
            .expect("registration");
    }

    async fn place(harness: &Harness, pub_dress: &str, at: GeoCoordinate, updated_at: u64) {
        harness
            .locations
            .write(
                pub_dress,
                BondLocation::new(at, BondLocationMode::Live, DecimalU64::new(updated_at)),
            )
            .await
            .expect("location write");
    }

    fn signed_init_data(user_id: i64) -> String {
        let mut fields = BTreeMap::from([
            ("auth_date", unix_now().to_string()),
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
        secret.update(TELEGRAM_TOKEN.as_bytes());
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

    fn ingest_body(external_id: &str, speaker: &str, text: &str, spoken_at: u64) -> String {
        serde_json::json!({
            "source": "telegram.channel:sky",
            "external_id": external_id,
            "speaker": speaker,
            "text": text,
            "spoken_at": spoken_at,
        })
        .to_string()
    }

    async fn ingest(
        harness: &Harness,
        token: Option<&str>,
        body: String,
    ) -> (StatusCode, serde_json::Value) {
        let mut request =
            Request::post("/api/v1/speech").header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = harness
            .app
            .clone()
            .oneshot(request.body(Body::from(body)).expect("request"))
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 8192).await.expect("body");
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    async fn nearby(harness: &Harness, telegram: i64) -> (StatusCode, Vec<String>) {
        let response = harness
            .app
            .clone()
            .oneshot(
                Request::get("/api/v1/speech/nearby")
                    .header(AUTHORIZATION, format!("tma {}", signed_init_data(telegram)))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 65536).await.expect("body");
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        let texts = value["lines"]
            .as_array()
            .map(|lines| {
                lines
                    .iter()
                    .map(|line| line["text"].as_str().expect("text").to_owned())
                    .collect()
            })
            .unwrap_or_default();
        (status, texts)
    }

    #[tokio::test]
    async fn ingest_needs_the_service_token() {
        let harness = harness().await;
        let body = ingest_body("sky/1", "0x0sky", "привіт", unix_now());
        for token in [None, Some("wrong"), Some("")] {
            let (status, _) = ingest(&harness, token, body.clone()).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
        }
        let (status, _) = ingest(&harness, Some(INGEST_TOKEN), body).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    #[test]
    fn a_short_token_or_a_wild_radius_is_refused() {
        assert!(SpeechConfig::new("short", 500).is_err());
        assert!(SpeechConfig::new(INGEST_TOKEN, 0).is_err());
        assert!(SpeechConfig::new(INGEST_TOKEN, 5_001).is_err());
    }

    #[tokio::test]
    async fn the_first_two_speakers_are_carried_over_once_and_a_name_grants_nothing_later() {
        let harness = harness().await;
        for name in ["0x0sky", "0xfrSb"] {
            let name: PubDress = name.parse().expect("pub_dress");
            assert!(harness.speech.is_speaker(&name).await.expect("lookup"));
        }

        register(&harness.identities, "0x1alice", 3).await;
        let alice: PubDress = "0x1alice".parse().expect("pub_dress");
        assert!(!harness.speech.is_speaker(&alice).await.expect("lookup"));
        assert!(harness.speech.allow_speaker(&alice).await.expect("allow"));
        assert!(harness.speech.is_speaker(&alice).await.expect("lookup"));

        // A later registration of a carried-over name gets nothing: the seed
        // ran when the table was created, not on every start.
        let pool = sqlx::SqlitePool::connect(&harness.database_url)
            .await
            .expect("raw pool");
        sqlx::query("DELETE FROM bond_speakers WHERE pub_dress = '0xfrSb'")
            .execute(&pool)
            .await
            .expect("revoke");
        pool.close().await;
        let reopened = SpeechRepository::connect(&harness.database_url)
            .await
            .expect("reopened repository");
        let frsb: PubDress = "0xfrSb".parse().expect("pub_dress");
        assert!(!reopened.is_speaker(&frsb).await.expect("lookup"));
    }

    #[tokio::test]
    async fn only_a_permitted_registered_bond_may_speak() {
        let harness = harness().await;
        register(&harness.identities, "0x1alice", 3).await;
        for speaker in ["0x1alice", "0x1nobody"] {
            let (status, body) = ingest(
                &harness,
                Some(INGEST_TOKEN),
                ingest_body("a/1", speaker, "hi", unix_now()),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{speaker}");
            assert_eq!(body["error"], "speaker_not_permitted");
        }
    }

    #[tokio::test]
    async fn malformed_lines_are_refused_without_being_stored() {
        let harness = harness().await;
        let now = unix_now();
        let cases = [
            (ingest_body("a/1", "0x0sky", "", now), "invalid_text"),
            (ingest_body("a/1", "0x0sky", &"я".repeat(281), now), "invalid_text"),
            (ingest_body("a/1", "0x0sky", " leading", now), "invalid_text"),
            (ingest_body("a/1", "sky", "hi", now), "invalid_speaker"),
            (ingest_body("a 1", "0x0sky", "hi", now), "invalid_origin"),
            (ingest_body("", "0x0sky", "hi", now), "invalid_origin"),
            (ingest_body("a/1", "0x0sky", "hi", now + 3_600), "spoken_in_the_future"),
            (r#"{"source":"s","external_id":"e","speaker":"0x0sky","text":"hi","spoken_at":1,"x":1}"#.to_owned(), "invalid_request"),
            ("not json".to_owned(), "invalid_request"),
        ];
        for (body, error) in cases {
            let (status, response) = ingest(&harness, Some(INGEST_TOKEN), body.clone()).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
            assert_eq!(response["error"], error, "{body}");
        }
        assert!(harness.speech.recent(0).await.expect("recent").is_empty());
    }

    #[tokio::test]
    async fn a_redelivered_utterance_is_one_line_and_one_copy() {
        let mut harness = harness().await;
        let now = unix_now();
        place(&harness, "0x0sky", point(0.0, 0.0), now).await;
        register(&harness.identities, "0x1near", 7).await;
        place(&harness, "0x1near", point(100.0, 0.0), now).await;

        let body = ingest_body("sky/9", "0x0sky", "привіт усім", now);
        let (first, first_body) = ingest(&harness, Some(INGEST_TOKEN), body.clone()).await;
        assert_eq!(first, StatusCode::CREATED);
        assert_eq!(first_body["status"], "recorded");
        assert_eq!(first_body["relayed_to"], 1);
        let (second, second_body) = ingest(&harness, Some(INGEST_TOKEN), body).await;
        assert_eq!(second, StatusCode::OK);
        assert_eq!(second_body["status"], "duplicate");
        assert_eq!(second_body["line_id"], first_body["line_id"]);

        let (recipients, text) = harness.relayed.recv().await.expect("one copy");
        assert_eq!(recipients, vec![7]);
        assert_eq!(text, "0x0sky: привіт усім");
        assert!(
            harness.relayed.try_recv().is_err(),
            "a duplicate must not relay again"
        );
        assert_eq!(harness.speech.recent(0).await.expect("recent").len(), 1);
    }

    #[tokio::test]
    async fn an_expired_line_is_acknowledged_but_never_stored_or_relayed() {
        let mut harness = harness().await;
        let old = unix_now() - SPEECH_TTL_SECONDS - 5;
        let (status, body) = ingest(
            &harness,
            Some(INGEST_TOKEN),
            ingest_body("sky/1", "0x0sky", "давно", old),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "expired");
        assert!(harness.speech.recent(0).await.expect("recent").is_empty());
        assert!(harness.relayed.try_recv().is_err());
    }

    #[tokio::test]
    async fn the_telegram_copy_goes_only_to_bonds_within_earshot() {
        let mut harness = harness().await;
        let now = unix_now();
        place(&harness, "0x0sky", point(0.0, 0.0), now).await;
        for (name, telegram, east, updated_at) in [
            ("0x1near", 10, 200.0, now),
            ("0x1edge", 11, 480.0, now),
            ("0x1far", 12, 800.0, now),
            ("0x1stale", 13, 100.0, now - LOCATION_MAX_AGE_SECONDS - 60),
        ] {
            register(&harness.identities, name, telegram).await;
            place(&harness, name, point(east, 0.0), updated_at).await;
        }
        // Registered and nearby, but never placed anywhere: hears nothing.
        register(&harness.identities, "0x1unplaced", 14).await;
        // The other permitted speaker is close by; the speaker is never echoed.
        place(&harness, "0xfrSb", point(50.0, 0.0), now).await;

        let (status, body) = ingest(
            &harness,
            Some(INGEST_TOKEN),
            ingest_body("sky/2", "0x0sky", "тут хтось є?", now),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let (mut recipients, _) = harness.relayed.recv().await.expect("one copy");
        recipients.sort_unstable();
        assert_eq!(recipients, vec![2, 10, 11]);
        assert_eq!(body["relayed_to"], 3);
    }

    #[tokio::test]
    async fn a_speaker_with_no_current_location_is_heard_by_nobody_over_telegram() {
        let mut harness = harness().await;
        let now = unix_now();
        register(&harness.identities, "0x1near", 7).await;
        place(&harness, "0x1near", point(0.0, 0.0), now).await;
        let (status, body) = ingest(
            &harness,
            Some(INGEST_TOKEN),
            ingest_body("sky/3", "0x0sky", "тиша", now),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(body["relayed_to"], 0);
        assert!(harness.relayed.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_declared_point_does_not_age_but_an_observation_does() {
        let now = unix_now();
        let old = now - 24 * 3_600;
        let there = point(0.0, 0.0);
        let manual = BondLocation::new(there, BondLocationMode::Manual, DecimalU64::new(old));
        let live = BondLocation::new(there, BondLocationMode::Live, DecimalU64::new(old));
        let fresh = BondLocation::new(there, BondLocationMode::Live, DecimalU64::new(now));
        assert_eq!(placed(Some(manual), now), Some(there));
        assert_eq!(placed(Some(live), now), None);
        assert_eq!(placed(Some(fresh), now), Some(there));
        assert_eq!(placed(None, now), None);
    }

    #[tokio::test]
    async fn the_web_hears_its_own_lines_and_the_lines_of_speakers_nearby() {
        let harness = harness().await;
        let now = unix_now();
        place(&harness, "0x0sky", point(0.0, 0.0), now).await;
        place(&harness, "0xfrSb", point(3_000.0, 0.0), now).await;
        register(&harness.identities, "0x1near", 7).await;
        place(&harness, "0x1near", point(120.0, 0.0), now).await;
        register(&harness.identities, "0x1lost", 8).await;

        for (external_id, speaker, text) in [
            ("sky/1", "0x0sky", "я поруч"),
            ("frsb/1", "0xfrSb", "я далеко"),
        ] {
            let (status, _) = ingest(
                &harness,
                Some(INGEST_TOKEN),
                ingest_body(external_id, speaker, text, now),
            )
            .await;
            assert_eq!(status, StatusCode::CREATED);
        }

        // The listener nearby hears 0x0sky and not the distant speaker.
        assert_eq!(
            nearby(&harness, 7).await,
            (StatusCode::OK, vec!["я поруч".to_owned()])
        );
        // Each speaker hears themself, as if they were speaking.
        assert_eq!(
            nearby(&harness, 1).await,
            (StatusCode::OK, vec!["я поруч".to_owned()])
        );
        assert_eq!(
            nearby(&harness, 2).await,
            (StatusCode::OK, vec!["я далеко".to_owned()])
        );
        // A Bond with no current location hears nobody else.
        assert_eq!(nearby(&harness, 8).await, (StatusCode::OK, Vec::new()));
    }

    #[tokio::test]
    async fn the_web_stops_hearing_a_line_after_it_expires() {
        let harness = harness().await;
        let now = unix_now();
        place(&harness, "0x0sky", point(0.0, 0.0), now).await;
        // Stored directly: ingest refuses lines that are already inaudible.
        let stale = SpokenLine::new(
            line_id("s", "old"),
            "0x0sky".parse().expect("pub_dress"),
            "давно".parse().expect("text"),
            DecimalU64::new(now - SPEECH_TTL_SECONDS - 1),
        );
        harness.speech.record(&stale, now).await.expect("record");
        assert_eq!(nearby(&harness, 1).await, (StatusCode::OK, Vec::new()));
    }

    #[tokio::test]
    async fn listening_needs_a_signed_in_bond() {
        let harness = harness().await;
        let response = harness
            .app
            .clone()
            .oneshot(
                Request::get("/api/v1/speech/nearby")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn responses_never_carry_a_coordinate() {
        let harness = harness().await;
        let now = unix_now();
        place(&harness, "0x0sky", point(0.0, 0.0), now).await;
        let (_, ingest_body) = ingest(
            &harness,
            Some(INGEST_TOKEN),
            ingest_body("sky/1", "0x0sky", "привіт", now),
        )
        .await;
        let response = harness
            .app
            .clone()
            .oneshot(
                Request::get("/api/v1/speech/nearby")
                    .header(AUTHORIZATION, format!("tma {}", signed_init_data(1)))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let bytes = to_bytes(response.into_body(), 65536).await.expect("body");
        let text = String::from_utf8(bytes.to_vec()).expect("utf8");
        for forbidden in ["longitude", "latitude", "coordinate", "_e7"] {
            assert!(!text.contains(forbidden), "{forbidden} leaked into {text}");
            assert!(!ingest_body.to_string().contains(forbidden));
        }
    }
}
