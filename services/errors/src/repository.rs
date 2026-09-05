// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;

use crate::{report::ErrorReport, time::Timestamp};

pub const MAX_PAGE_SIZE: u32 = 500;
pub const DEFAULT_PAGE_SIZE: u32 = 50;

/// Append-only storage for dumped errors.
///
/// Every project writes into one table so that a single query answers "what
/// broke, where, and when" across `nilx-one`, `aiaiaiai-tech`, and any other
/// project holding an ingest token.
#[derive(Clone, Debug)]
pub struct ErrorTrashRepository {
    pool: SqlitePool,
}

impl ErrorTrashRepository {
    pub async fn connect(database_url: &str) -> Result<Self, RepositoryError> {
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
        let repository = Self { pool };
        repository.initialize().await?;
        Ok(repository)
    }

    async fn initialize(&self) -> Result<(), RepositoryError> {
        sqlx::raw_sql(include_str!("../migrations/0001_error_trash.sql"))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Stores a batch atomically: a reporter either dumps the whole batch or
    /// retries it, and never has to reason about a partially accepted request.
    pub async fn record(&self, reports: &[ErrorReport]) -> Result<Vec<i64>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let mut identifiers = Vec::with_capacity(reports.len());

        for report in reports {
            let identifier = sqlx::query_scalar::<_, i64>(
                "INSERT INTO errors (project, \"type\", full_text, observed_at, received_at) \
                 VALUES (?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(report.project())
            .bind(report.error_type())
            .bind(report.full_text())
            .bind(report.observed_at().as_str())
            .bind(report.received_at().as_str())
            .fetch_one(&mut *transaction)
            .await?;
            identifiers.push(identifier);
        }

        transaction.commit().await?;
        Ok(identifiers)
    }

    /// Reads the most recent errors first, optionally narrowed to one project,
    /// one type, or a time window over the reported observation instant.
    pub async fn list(&self, query: &ErrorQuery) -> Result<Vec<StoredError>, RepositoryError> {
        let rows = sqlx::query(
            "SELECT id, project, \"type\", full_text, observed_at, received_at \
             FROM errors \
             WHERE (?1 IS NULL OR project = ?1) \
               AND (?2 IS NULL OR \"type\" = ?2) \
               AND (?3 IS NULL OR observed_at >= ?3) \
               AND (?4 IS NULL OR observed_at <= ?4) \
             ORDER BY observed_at DESC, id DESC \
             LIMIT ?5",
        )
        .bind(query.project.as_deref())
        .bind(query.error_type.as_deref())
        .bind(query.since.as_ref().map(Timestamp::as_str))
        .bind(query.until.as_ref().map(Timestamp::as_str))
        .bind(i64::from(query.limit.clamp(1, MAX_PAGE_SIZE)))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(stored_error_from_row).collect())
    }

    /// Drops what the retention policy no longer keeps.
    ///
    /// Age is measured on `received_at` because that is the trash clock; a
    /// reporter cannot extend or shorten its own retention with a wrong
    /// `observed_at`.
    pub async fn prune(
        &self,
        policy: &RetentionPolicy,
        now: &Timestamp,
    ) -> Result<u64, RepositoryError> {
        let mut removed = 0;

        if let Some(cutoff) = policy.cutoff(now) {
            removed += sqlx::query("DELETE FROM errors WHERE received_at < ?")
                .bind(cutoff.as_str())
                .execute(&self.pool)
                .await?
                .rows_affected();
        }

        if let Some(max_rows) = policy.max_rows {
            removed +=
                sqlx::query("DELETE FROM errors WHERE id <= (SELECT MAX(id) FROM errors) - ?")
                    .bind(i64::try_from(max_rows).unwrap_or(i64::MAX))
                    .execute(&self.pool)
                    .await?
                    .rows_affected();
        }

        Ok(removed)
    }

    pub async fn count(&self) -> Result<i64, RepositoryError> {
        Ok(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM errors")
            .fetch_one(&self.pool)
            .await?)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ErrorQuery {
    pub project: Option<String>,
    pub error_type: Option<String>,
    pub since: Option<Timestamp>,
    pub until: Option<Timestamp>,
    pub limit: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredError {
    pub id: i64,
    pub project: String,
    pub error_type: String,
    pub full_text: String,
    pub observed_at: String,
    pub received_at: String,
}

/// How long the trash keeps a dump, and how much of it at most.
///
/// Both bounds are optional: an unbounded sink is a deliberate choice an
/// operator can make, not the default.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetentionPolicy {
    pub retention_days: Option<u32>,
    pub max_rows: Option<u64>,
}

impl RetentionPolicy {
    pub const DEFAULT_RETENTION_DAYS: u32 = 90;
    pub const DEFAULT_MAX_ROWS: u64 = 1_000_000;

    fn cutoff(&self, now: &Timestamp) -> Option<Timestamp> {
        let retention_days = self.retention_days?;
        let now_seconds = seconds_from_timestamp(now)?;
        Some(Timestamp::from_unix_seconds(now_seconds.saturating_sub(
            u64::from(retention_days).saturating_mul(86_400),
        )))
    }
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            retention_days: Some(Self::DEFAULT_RETENTION_DAYS),
            max_rows: Some(Self::DEFAULT_MAX_ROWS),
        }
    }
}

fn seconds_from_timestamp(timestamp: &Timestamp) -> Option<u64> {
    let text = timestamp.as_str();
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<u64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Civil date to days since the Unix epoch, after Howard Hinnant's
/// `days_from_civil`, restricted to instants the trash can store.
fn days_from_civil(year: u64, month: u64, day: u64) -> Option<u64> {
    if year < 1970 || !(1..=12).contains(&month) {
        return None;
    }
    let year = if month <= 2 { year - 1 } else { year };
    let era = year / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * if month > 2 { month - 3 } else { month + 9 } + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    (era * 146_097 + day_of_era).checked_sub(719_468)
}

fn stored_error_from_row(row: sqlx::sqlite::SqliteRow) -> StoredError {
    StoredError {
        id: row.get("id"),
        project: row.get("project"),
        error_type: row.get("type"),
        full_text: row.get("full_text"),
        observed_at: row.get("observed_at"),
        received_at: row.get("received_at"),
    }
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("error trash storage failed: {0}")]
    Storage(#[from] sqlx::Error),
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_PAGE_SIZE, ErrorQuery, ErrorTrashRepository, RetentionPolicy,
        seconds_from_timestamp,
    };
    use crate::{report::ErrorReport, time::Timestamp};

    const NOW: u64 = 1_800_000_000;

    async fn repository() -> ErrorTrashRepository {
        ErrorTrashRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize")
    }

    fn report(project: &str, error_type: &str, observed_at: u64) -> ErrorReport {
        ErrorReport::new(
            project,
            error_type,
            &format!("{error_type} from {project}"),
            Timestamp::from_unix_seconds(observed_at),
            Timestamp::from_unix_seconds(NOW),
        )
        .expect("valid report")
    }

    fn query(limit: u32) -> ErrorQuery {
        ErrorQuery {
            limit,
            ..ErrorQuery::default()
        }
    }

    #[tokio::test]
    async fn every_project_shares_one_table_and_reads_newest_first() {
        let repository = repository().await;
        repository
            .record(&[
                report("nilx-one/web", "panic", NOW - 60),
                report("aiaiaiai-tech/core", "http_500", NOW - 30),
                report("nilx-one/web", "http_500", NOW),
            ])
            .await
            .expect("batch is stored");

        let all = repository
            .list(&query(DEFAULT_PAGE_SIZE))
            .await
            .expect("listing");
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].project, "nilx-one/web");
        assert_eq!(all[0].error_type, "http_500");
        assert_eq!(all[0].observed_at, "2027-01-15T08:00:00Z");
        assert_eq!(all[2].observed_at, "2027-01-15T07:59:00Z");
    }

    #[tokio::test]
    async fn filters_narrow_by_project_type_and_observation_window() {
        let repository = repository().await;
        repository
            .record(&[
                report("nilx-one/web", "panic", NOW - 600),
                report("aiaiaiai-tech/core", "panic", NOW),
                report("nilx-one/web", "http_500", NOW),
            ])
            .await
            .expect("batch is stored");

        let by_project = repository
            .list(&ErrorQuery {
                project: Some("nilx-one/web".to_owned()),
                ..query(DEFAULT_PAGE_SIZE)
            })
            .await
            .expect("listing");
        assert_eq!(by_project.len(), 2);

        let by_type = repository
            .list(&ErrorQuery {
                error_type: Some("panic".to_owned()),
                ..query(DEFAULT_PAGE_SIZE)
            })
            .await
            .expect("listing");
        assert_eq!(by_type.len(), 2);

        let windowed = repository
            .list(&ErrorQuery {
                since: Some(Timestamp::from_unix_seconds(NOW - 60)),
                ..query(DEFAULT_PAGE_SIZE)
            })
            .await
            .expect("listing");
        assert_eq!(windowed.len(), 2);

        let limited = repository.list(&query(1)).await.expect("listing");
        assert_eq!(limited.len(), 1);
    }

    #[tokio::test]
    async fn retention_drops_old_dumps_by_the_trash_clock_not_the_reported_one() {
        let repository = repository().await;
        let stale = ErrorReport::new(
            "nilx-one/web",
            "panic",
            "old",
            Timestamp::from_unix_seconds(NOW),
            Timestamp::from_unix_seconds(NOW - 40 * 86_400),
        )
        .expect("valid report");
        repository
            .record(&[stale, report("nilx-one/web", "panic", NOW)])
            .await
            .expect("batch is stored");

        let removed = repository
            .prune(
                &RetentionPolicy {
                    retention_days: Some(30),
                    max_rows: None,
                },
                &Timestamp::from_unix_seconds(NOW),
            )
            .await
            .expect("prune");

        assert_eq!(removed, 1);
        assert_eq!(repository.count().await.expect("count"), 1);
    }

    #[tokio::test]
    async fn retention_also_bounds_the_table_by_row_count() {
        let repository = repository().await;
        for index in 0..5 {
            repository
                .record(&[report("nilx-one/web", "panic", NOW + index)])
                .await
                .expect("stored");
        }

        let removed = repository
            .prune(
                &RetentionPolicy {
                    retention_days: None,
                    max_rows: Some(2),
                },
                &Timestamp::from_unix_seconds(NOW),
            )
            .await
            .expect("prune");

        assert_eq!(removed, 3);
        let remaining = repository
            .list(&query(DEFAULT_PAGE_SIZE))
            .await
            .expect("listing");
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].observed_at, "2027-01-15T08:00:04Z");
    }

    #[test]
    fn retention_cutoffs_round_trip_through_the_storage_format() {
        for seconds in [0, 1_700_000_000, NOW, NOW + 400 * 86_400] {
            assert_eq!(
                seconds_from_timestamp(&Timestamp::from_unix_seconds(seconds)),
                Some(seconds)
            );
        }
    }
}
