// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;

use crate::PubDress;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IdentityProvider {
    Telegram,
    Discord,
}

impl IdentityProvider {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Discord => "discord",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderIdentity {
    pub provider: IdentityProvider,
    pub subject: String,
}

impl ProviderIdentity {
    pub fn telegram(user_id: i64) -> Self {
        Self {
            provider: IdentityProvider::Telegram,
            subject: user_id.to_string(),
        }
    }

    pub fn discord(user_id: impl Into<String>) -> Self {
        Self {
            provider: IdentityProvider::Discord,
            subject: user_id.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityRecord {
    pub pub_dress: String,
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

        if self.has_legacy_telegram_column().await? {
            sqlx::raw_sql(include_str!("../migrations/0002_provider_accounts.sql"))
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    async fn has_legacy_telegram_column(&self) -> Result<bool, RepositoryError> {
        let columns = sqlx::query("PRAGMA table_info(identities)")
            .fetch_all(&self.pool)
            .await?;
        Ok(columns
            .iter()
            .any(|column| column.get::<String, _>("name") == "tg_id"))
    }

    pub async fn register(
        &self,
        pub_dress: &PubDress,
        provider_identity: &ProviderIdentity,
    ) -> Result<RegistrationOutcome, RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        if let Some(record) = find_by_provider_in(&mut transaction, provider_identity).await? {
            transaction.commit().await?;
            return Ok(RegistrationOutcome::AlreadyRegistered(record));
        }

        let identity_insert =
            sqlx::query("INSERT INTO identities (pub_dress) VALUES (?) ON CONFLICT DO NOTHING")
                .bind(pub_dress.as_str())
                .execute(&mut *transaction)
                .await?;

        if identity_insert.rows_affected() == 0 {
            transaction.commit().await?;
            return Ok(RegistrationOutcome::HandleUnavailable);
        }

        sqlx::query(
            "INSERT INTO identity_providers (provider, provider_subject, pub_dress) VALUES (?, ?, ?)",
        )
        .bind(provider_identity.provider.as_str())
        .bind(&provider_identity.subject)
        .bind(pub_dress.as_str())
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(RegistrationOutcome::Registered(IdentityRecord {
            pub_dress: pub_dress.to_string(),
        }))
    }

    pub async fn find_by_provider(
        &self,
        provider_identity: &ProviderIdentity,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let row = sqlx::query(
            "SELECT identities.pub_dress \
             FROM identity_providers \
             JOIN identities ON identities.pub_dress = identity_providers.pub_dress \
             WHERE identity_providers.provider = ? AND identity_providers.provider_subject = ?",
        )
        .bind(provider_identity.provider.as_str())
        .bind(&provider_identity.subject)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(identity_from_row))
    }

    pub async fn is_pub_dress_available(
        &self,
        pub_dress: &PubDress,
    ) -> Result<bool, RepositoryError> {
        let occupied = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE pub_dress = ?)",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&self.pool)
        .await?;
        Ok(!occupied)
    }

    pub async fn find_by_telegram(
        &self,
        telegram_user_id: i64,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        self.find_by_provider(&ProviderIdentity::telegram(telegram_user_id))
            .await
    }
}

async fn find_by_provider_in(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    provider_identity: &ProviderIdentity,
) -> Result<Option<IdentityRecord>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT identities.pub_dress \
         FROM identity_providers \
         JOIN identities ON identities.pub_dress = identity_providers.pub_dress \
         WHERE identity_providers.provider = ? AND identity_providers.provider_subject = ?",
    )
    .bind(provider_identity.provider.as_str())
    .bind(&provider_identity.subject)
    .fetch_optional(&mut **transaction)
    .await?;
    Ok(row.map(identity_from_row))
}

fn identity_from_row(row: sqlx::sqlite::SqliteRow) -> IdentityRecord {
    IdentityRecord {
        pub_dress: row.get("pub_dress"),
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

    use super::{IdentityRepository, ProviderIdentity, RegistrationOutcome};
    use crate::PubDress;

    #[tokio::test]
    async fn insert_is_the_registration_and_collision_boundary_across_providers() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let first = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let second = PubDress::from_str("0x1sky").expect("valid pub_dress");
        let telegram = ProviderIdentity::telegram(10);
        let other_telegram = ProviderIdentity::telegram(11);
        let discord = ProviderIdentity::discord("42");

        assert!(matches!(
            repository.register(&first, &telegram).await,
            Ok(RegistrationOutcome::Registered(_))
        ));
        assert!(matches!(
            repository.register(&first, &other_telegram).await,
            Ok(RegistrationOutcome::HandleUnavailable)
        ));
        assert!(matches!(
            repository.register(&second, &telegram).await,
            Ok(RegistrationOutcome::AlreadyRegistered(record)) if record.pub_dress == "0x0sky"
        ));
        assert!(matches!(
            repository.register(&second, &discord).await,
            Ok(RegistrationOutcome::Registered(record)) if record.pub_dress == "0x1sky"
        ));
    }

    #[tokio::test]
    async fn provider_subjects_remain_namespaced() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let telegram_address = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let discord_address = PubDress::from_str("0x7sky").expect("valid pub_dress");

        repository
            .register(&telegram_address, &ProviderIdentity::telegram(42))
            .await
            .expect("telegram insert");
        repository
            .register(&discord_address, &ProviderIdentity::discord("42"))
            .await
            .expect("discord insert");

        assert_eq!(
            repository
                .find_by_provider(&ProviderIdentity::discord("42"))
                .await
                .expect("lookup must succeed")
                .expect("identity must exist")
                .pub_dress,
            "0x7sky"
        );
    }

    #[tokio::test]
    async fn availability_is_an_exact_case_sensitive_read_without_reservation() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let lower = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let title = PubDress::from_str("0x0Sky").expect("valid pub_dress");

        assert!(
            repository
                .is_pub_dress_available(&lower)
                .await
                .expect("availability lookup")
        );
        repository
            .register(&lower, &ProviderIdentity::telegram(42))
            .await
            .expect("registration");
        assert!(
            !repository
                .is_pub_dress_available(&lower)
                .await
                .expect("availability lookup")
        );
        assert!(
            repository
                .is_pub_dress_available(&title)
                .await
                .expect("case-sensitive availability lookup")
        );
    }
}
