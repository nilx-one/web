// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;

use crate::PubDress;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityRecord {
    pub pub_dress: String,
    pub telegram_user_id: i64,
}

#[derive(Clone, Debug)]
pub struct IdentityRepository {
    pool: SqlitePool,
}

impl IdentityRepository {
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
        sqlx::query(include_str!("../migrations/0001_identities.sql"))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn register(
        &self,
        pub_dress: &PubDress,
        telegram_user_id: i64,
    ) -> Result<RegistrationOutcome, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query(
            "INSERT INTO identities (pub_dress, tg_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(pub_dress.as_str())
        .bind(telegram_user_id)
        .execute(&mut *transaction)
        .await?;

        let outcome = if result.rows_affected() == 1 {
            RegistrationOutcome::Registered(IdentityRecord {
                pub_dress: pub_dress.to_string(),
                telegram_user_id,
            })
        } else if let Some(record) = find_by_telegram_in(&mut transaction, telegram_user_id).await?
        {
            RegistrationOutcome::AlreadyRegistered(record)
        } else {
            RegistrationOutcome::HandleUnavailable
        };

        transaction.commit().await?;
        Ok(outcome)
    }

    pub async fn find_by_telegram(
        &self,
        telegram_user_id: i64,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let row = sqlx::query("SELECT pub_dress, tg_id FROM identities WHERE tg_id = ?")
            .bind(telegram_user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(identity_from_row))
    }
}

async fn find_by_telegram_in(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    telegram_user_id: i64,
) -> Result<Option<IdentityRecord>, sqlx::Error> {
    let row = sqlx::query("SELECT pub_dress, tg_id FROM identities WHERE tg_id = ?")
        .bind(telegram_user_id)
        .fetch_optional(&mut **transaction)
        .await?;
    Ok(row.map(identity_from_row))
}

fn identity_from_row(row: sqlx::sqlite::SqliteRow) -> IdentityRecord {
    IdentityRecord {
        pub_dress: row.get("pub_dress"),
        telegram_user_id: row.get("tg_id"),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistrationOutcome {
    Registered(IdentityRecord),
    AlreadyRegistered(IdentityRecord),
    HandleUnavailable,
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("identity storage failed: {0}")]
    Storage(#[from] sqlx::Error),
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{IdentityRepository, RegistrationOutcome};
    use crate::PubDress;

    #[tokio::test]
    async fn insert_is_the_registration_and_collision_boundary() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let first = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let second = PubDress::from_str("0x1sky").expect("valid pub_dress");

        assert!(matches!(
            repository.register(&first, 10).await,
            Ok(RegistrationOutcome::Registered(_))
        ));
        assert!(matches!(
            repository.register(&first, 11).await,
            Ok(RegistrationOutcome::HandleUnavailable)
        ));
        assert!(matches!(
            repository.register(&second, 10).await,
            Ok(RegistrationOutcome::AlreadyRegistered(record)) if record.pub_dress == "0x0sky"
        ));
    }

    #[tokio::test]
    async fn exact_handles_remain_distinct() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let first = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let second = PubDress::from_str("0x7sky").expect("valid pub_dress");

        repository.register(&first, 10).await.expect("first insert");
        repository
            .register(&second, 11)
            .await
            .expect("second insert");

        assert_eq!(
            repository
                .find_by_telegram(11)
                .await
                .expect("lookup must succeed")
                .expect("identity must exist")
                .pub_dress,
            "0x7sky"
        );
    }
}
