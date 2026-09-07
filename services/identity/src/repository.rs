// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;

use crate::{AvaiaPubDress, PubDress};

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
    /// The owned Avaia is identity state. `None` is valid only for a
    /// pre-amendment human Bond that has not yet crossed an authenticated
    /// reconciliation boundary.
    pub avaia_pub_dress: Option<String>,
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

        if self.has_identity_column("tg_id").await? {
            sqlx::raw_sql(include_str!("../migrations/0002_provider_accounts.sql"))
                .execute(&self.pool)
                .await?;
        }

        sqlx::raw_sql(include_str!("../migrations/0003_native_auth.sql"))
            .execute(&self.pool)
            .await?;
        if !self.has_identity_column("identity_kind").await? {
            sqlx::raw_sql(include_str!("../migrations/0004_owned_avaia_identity.sql"))
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    async fn has_identity_column(&self, name: &str) -> Result<bool, RepositoryError> {
        let columns = sqlx::query("PRAGMA table_info(identities)")
            .fetch_all(&self.pool)
            .await?;
        Ok(columns
            .iter()
            .any(|column| column.get::<String, _>("name") == name))
    }

    pub async fn register(
        &self,
        pub_dress: &PubDress,
        provider_identity: &ProviderIdentity,
        now: u64,
    ) -> Result<RegistrationOutcome, RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        if let Some(mut record) = find_by_provider_in(&mut transaction, provider_identity).await? {
            if record.avaia_pub_dress.is_none() {
                let owner = pub_dress_for(&record)?;
                record.avaia_pub_dress =
                    create_owned_avaia_in(&mut transaction, &owner, now).await?;
            }
            transaction.commit().await?;
            return Ok(RegistrationOutcome::AlreadyRegistered(record));
        }

        let identity_insert = sqlx::query(
            "INSERT INTO identities (pub_dress, identity_kind, created_at) \
             VALUES (?, 'human', ?) ON CONFLICT DO NOTHING",
        )
        .bind(pub_dress.as_str())
        .bind(now as i64)
        .execute(&mut *transaction)
        .await?;

        if identity_insert.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(RegistrationOutcome::HandleUnavailable);
        }

        let Some(avaia_pub_dress) = create_owned_avaia_in(&mut transaction, pub_dress, now).await?
        else {
            transaction.rollback().await?;
            return Ok(RegistrationOutcome::AvaiaUnavailable);
        };

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
            avaia_pub_dress: Some(avaia_pub_dress),
        }))
    }

    pub async fn find_by_provider(
        &self,
        provider_identity: &ProviderIdentity,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let pub_dress = sqlx::query_scalar::<_, String>(
            "SELECT identities.pub_dress \
             FROM identity_providers \
             JOIN identities ON identities.pub_dress = identity_providers.pub_dress \
             WHERE identities.identity_kind = 'human' \
               AND identity_providers.provider = ? \
               AND identity_providers.provider_subject = ?",
        )
        .bind(provider_identity.provider.as_str())
        .bind(&provider_identity.subject)
        .fetch_optional(&self.pool)
        .await?;

        match pub_dress {
            Some(value) => Ok(Some(identity_for_pub_dress(&self.pool, value).await?)),
            None => Ok(None),
        }
    }

    pub async fn reconcile_owned_avaia(
        &self,
        pub_dress: &PubDress,
        now: u64,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let human_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human')",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if !human_exists {
            transaction.rollback().await?;
            return Ok(None);
        }

        let avaia_pub_dress = create_owned_avaia_in(&mut transaction, pub_dress, now).await?;
        let record = IdentityRecord {
            pub_dress: pub_dress.to_string(),
            avaia_pub_dress,
        };
        transaction.commit().await?;
        Ok(Some(record))
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

    #[allow(clippy::too_many_arguments)]
    pub async fn register_native(
        &self,
        pub_dress: &PubDress,
        password_hash: &str,
        password_hash_version: i64,
        recovery_key_hash: &[u8],
        challenge_hash: &[u8],
        idempotency_key_hash: &[u8],
        now: u64,
        challenge_expires_at: u64,
    ) -> Result<NativeRegistrationOutcome, RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        let replay = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM native_registration_idempotency \
             WHERE idempotency_key_hash = ?",
        )
        .bind(idempotency_key_hash)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(pub_dress) = replay {
            let record = identity_for_pub_dress_in(&mut transaction, pub_dress).await?;
            transaction.commit().await?;
            return Ok(NativeRegistrationOutcome::IdempotentReplay(record));
        }

        let identity_insert = sqlx::query(
            "INSERT INTO identities (pub_dress, identity_kind, created_at) \
             VALUES (?, 'human', ?) ON CONFLICT DO NOTHING",
        )
        .bind(pub_dress.as_str())
        .bind(now as i64)
        .execute(&mut *transaction)
        .await?;
        if identity_insert.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(NativeRegistrationOutcome::HandleUnavailable);
        }

        let Some(avaia_pub_dress) = create_owned_avaia_in(&mut transaction, pub_dress, now).await?
        else {
            transaction.rollback().await?;
            return Ok(NativeRegistrationOutcome::AvaiaUnavailable);
        };

        sqlx::query(
            "INSERT INTO native_credentials \
             (pub_dress, password_hash, password_hash_version, recovery_key_hash, active, created_at, updated_at) \
             VALUES (?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(pub_dress.as_str())
        .bind(password_hash)
        .bind(password_hash_version)
        .bind(recovery_key_hash)
        .bind(now as i64)
        .bind(now as i64)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO native_registration_challenges \
             (challenge_hash, pub_dress, expires_at, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(challenge_hash)
        .bind(pub_dress.as_str())
        .bind(challenge_expires_at as i64)
        .bind(now as i64)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO native_registration_idempotency \
             (idempotency_key_hash, pub_dress, created_at) VALUES (?, ?, ?)",
        )
        .bind(idempotency_key_hash)
        .bind(pub_dress.as_str())
        .bind(now as i64)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(NativeRegistrationOutcome::Registered(IdentityRecord {
            pub_dress: pub_dress.to_string(),
            avaia_pub_dress: Some(avaia_pub_dress),
        }))
    }

    pub async fn find_native_credential(
        &self,
        pub_dress: &PubDress,
    ) -> Result<Option<NativeCredentialRecord>, RepositoryError> {
        let row = sqlx::query(
            "SELECT pub_dress, password_hash, password_hash_version, recovery_key_hash, active \
             FROM native_credentials WHERE pub_dress = ?",
        )
        .bind(pub_dress.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(native_credential_from_row))
    }

    pub async fn activate_native_registration(
        &self,
        challenge_hash: &[u8],
        now: u64,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let pub_dress = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM native_registration_challenges \
             WHERE challenge_hash = ? AND expires_at > ?",
        )
        .bind(challenge_hash)
        .bind(now as i64)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(pub_dress) = pub_dress else {
            transaction.rollback().await?;
            return Ok(None);
        };

        sqlx::query("UPDATE native_credentials SET active = 1, updated_at = ? WHERE pub_dress = ?")
            .bind(now as i64)
            .bind(&pub_dress)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM native_registration_challenges WHERE challenge_hash = ?")
            .bind(challenge_hash)
            .execute(&mut *transaction)
            .await?;
        let record = identity_for_pub_dress_in(&mut transaction, pub_dress).await?;
        transaction.commit().await?;
        Ok(Some(record))
    }

    pub async fn create_native_session(
        &self,
        token_hash: &[u8],
        pub_dress: &str,
        now: u64,
        expires_at: u64,
    ) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO native_sessions (token_hash, pub_dress, expires_at, created_at) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(token_hash)
        .bind(pub_dress)
        .bind(expires_at as i64)
        .bind(now as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn find_native_session(
        &self,
        token_hash: &[u8],
        now: u64,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let pub_dress = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM native_sessions \
             WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
        )
        .bind(token_hash)
        .bind(now as i64)
        .fetch_optional(&self.pool)
        .await?;
        match pub_dress {
            Some(value) => Ok(Some(identity_for_pub_dress(&self.pool, value).await?)),
            None => Ok(None),
        }
    }

    pub async fn revoke_native_session(
        &self,
        token_hash: &[u8],
        now: u64,
    ) -> Result<(), RepositoryError> {
        sqlx::query(
            "UPDATE native_sessions SET revoked_at = ? \
             WHERE token_hash = ? AND revoked_at IS NULL",
        )
        .bind(now as i64)
        .bind(token_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn replace_native_credential_after_recovery(
        &self,
        pub_dress: &PubDress,
        expected_recovery_key_hash: &[u8],
        password_hash: &str,
        password_hash_version: i64,
        replacement_recovery_key_hash: &[u8],
        now: u64,
    ) -> Result<bool, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let update = sqlx::query(
            "UPDATE native_credentials \
             SET password_hash = ?, password_hash_version = ?, recovery_key_hash = ?, \
                 active = 1, updated_at = ? \
             WHERE pub_dress = ? AND recovery_key_hash = ? AND active = 1",
        )
        .bind(password_hash)
        .bind(password_hash_version)
        .bind(replacement_recovery_key_hash)
        .bind(now as i64)
        .bind(pub_dress.as_str())
        .bind(expected_recovery_key_hash)
        .execute(&mut *transaction)
        .await?;
        if update.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false);
        }
        sqlx::query(
            "UPDATE native_sessions SET revoked_at = ? \
             WHERE pub_dress = ? AND revoked_at IS NULL",
        )
        .bind(now as i64)
        .bind(pub_dress.as_str())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn update_password_hash_if_version_advances(
        &self,
        pub_dress: &str,
        current_version: i64,
        new_hash: &str,
        new_version: i64,
        now: u64,
    ) -> Result<(), RepositoryError> {
        sqlx::query(
            "UPDATE native_credentials SET password_hash = ?, password_hash_version = ?, updated_at = ? \
             WHERE pub_dress = ? AND password_hash_version = ? AND password_hash_version < ?",
        )
        .bind(new_hash)
        .bind(new_version)
        .bind(now as i64)
        .bind(pub_dress)
        .bind(current_version)
        .bind(new_version)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

async fn create_owned_avaia_in(
    transaction: &mut Transaction<'_, Sqlite>,
    owner: &PubDress,
    now: u64,
) -> Result<Option<String>, sqlx::Error> {
    if let Some(existing) = owned_avaia_for_owner_in(transaction, owner.as_str()).await? {
        return Ok(Some(existing));
    }

    let candidate = AvaiaPubDress::derive_default(owner).to_string();
    let insert = sqlx::query(
        "INSERT INTO identities \
         (pub_dress, identity_kind, owner_pub_dress, created_at) \
         VALUES (?, 'avaia', ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(&candidate)
    .bind(owner.as_str())
    .bind(now as i64)
    .execute(&mut **transaction)
    .await?;

    if insert.rows_affected() == 1 {
        return Ok(Some(candidate));
    }

    // A concurrent owner reconciliation can race on the owner-unique index.
    // Re-read the owner before classifying the failed insert as an address
    // collision with another identity.
    owned_avaia_for_owner_in(transaction, owner.as_str()).await
}

async fn owned_avaia_for_owner_in(
    transaction: &mut Transaction<'_, Sqlite>,
    owner_pub_dress: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT pub_dress FROM identities \
         WHERE identity_kind = 'avaia' AND owner_pub_dress = ?",
    )
    .bind(owner_pub_dress)
    .fetch_optional(&mut **transaction)
    .await
}

async fn identity_for_pub_dress(
    pool: &SqlitePool,
    pub_dress: String,
) -> Result<IdentityRecord, sqlx::Error> {
    let avaia_pub_dress = sqlx::query_scalar::<_, String>(
        "SELECT pub_dress FROM identities \
         WHERE identity_kind = 'avaia' AND owner_pub_dress = ?",
    )
    .bind(&pub_dress)
    .fetch_optional(pool)
    .await?;
    Ok(IdentityRecord {
        pub_dress,
        avaia_pub_dress,
    })
}

async fn identity_for_pub_dress_in(
    transaction: &mut Transaction<'_, Sqlite>,
    pub_dress: String,
) -> Result<IdentityRecord, sqlx::Error> {
    let avaia_pub_dress = owned_avaia_for_owner_in(transaction, &pub_dress).await?;
    Ok(IdentityRecord {
        pub_dress,
        avaia_pub_dress,
    })
}

async fn find_by_provider_in(
    transaction: &mut Transaction<'_, Sqlite>,
    provider_identity: &ProviderIdentity,
) -> Result<Option<IdentityRecord>, sqlx::Error> {
    let pub_dress = sqlx::query_scalar::<_, String>(
        "SELECT identities.pub_dress \
         FROM identity_providers \
         JOIN identities ON identities.pub_dress = identity_providers.pub_dress \
         WHERE identities.identity_kind = 'human' \
           AND identity_providers.provider = ? \
           AND identity_providers.provider_subject = ?",
    )
    .bind(provider_identity.provider.as_str())
    .bind(&provider_identity.subject)
    .fetch_optional(&mut **transaction)
    .await?;
    match pub_dress {
        Some(value) => Ok(Some(identity_for_pub_dress_in(transaction, value).await?)),
        None => Ok(None),
    }
}

fn pub_dress_for(record: &IdentityRecord) -> Result<PubDress, RepositoryError> {
    record
        .pub_dress
        .parse()
        .map_err(|_| RepositoryError::CorruptHumanPubDress)
}

fn native_credential_from_row(row: sqlx::sqlite::SqliteRow) -> NativeCredentialRecord {
    NativeCredentialRecord {
        pub_dress: row.get("pub_dress"),
        password_hash: row.get("password_hash"),
        password_hash_version: row.get("password_hash_version"),
        recovery_key_hash: row.get("recovery_key_hash"),
        active: row.get::<i64, _>("active") == 1,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeCredentialRecord {
    pub pub_dress: String,
    pub password_hash: String,
    pub password_hash_version: i64,
    pub recovery_key_hash: Vec<u8>,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeRegistrationOutcome {
    Registered(IdentityRecord),
    IdempotentReplay(IdentityRecord),
    HandleUnavailable,
    AvaiaUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistrationOutcome {
    Registered(IdentityRecord),
    AlreadyRegistered(IdentityRecord),
    HandleUnavailable,
    AvaiaUnavailable,
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("identity storage failed: {0}")]
    Storage(#[from] sqlx::Error),
    #[error("stored human pub_dress is invalid")]
    CorruptHumanPubDress,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{
        IdentityRepository, NativeRegistrationOutcome, ProviderIdentity, RegistrationOutcome,
        identity_for_pub_dress,
    };
    use crate::PubDress;

    #[tokio::test]
    async fn owned_avaia_migration_is_idempotent_on_reopen() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());

        let repository = IdentityRepository::connect(&database_url)
            .await
            .expect("first initialization");
        drop(repository);

        IdentityRepository::connect(&database_url)
            .await
            .expect("second initialization must not replay additive migration");
    }

    #[tokio::test]
    async fn provider_registration_atomically_creates_the_owned_avaia() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let address = PubDress::from_str("0xda-sha.").expect("valid pub_dress");

        let outcome = repository
            .register(&address, &ProviderIdentity::telegram(10), 100)
            .await
            .expect("registration");
        assert!(matches!(
            outcome,
            RegistrationOutcome::Registered(record)
                if record.pub_dress == "0xda-sha."
                    && record.avaia_pub_dress.as_deref() == Some("da-sha.ai")
        ));
    }

    #[tokio::test]
    async fn provider_registration_rolls_back_when_the_default_avaia_collides() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let occupying_owner = PubDress::from_str("0x0sky").expect("valid first owner");
        repository
            .register(&occupying_owner, &ProviderIdentity::telegram(10), 100)
            .await
            .expect("occupying registration");

        // Core deliberately maps both `sky` and `sk` to the same default
        // Avaia stem, so this is a real canonical-address collision rather
        // than a hand-written guess at the naming contract.
        let candidate_owner = PubDress::from_str("0x0sk").expect("valid second owner");
        assert_eq!(
            AvaiaPubDress::derive_default(&occupying_owner),
            AvaiaPubDress::derive_default(&candidate_owner)
        );
        assert!(matches!(
            repository
                .register(&candidate_owner, &ProviderIdentity::discord("20"), 101)
                .await,
            Ok(RegistrationOutcome::AvaiaUnavailable)
        ));
        assert!(
            repository
                .is_pub_dress_available(&candidate_owner)
                .await
                .expect("rolled-back human address remains available")
        );
    }

    #[tokio::test]
    async fn pre_amendment_human_is_reconciled_only_at_the_current_boundary() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        sqlx::query("INSERT INTO identities (pub_dress) VALUES ('0xda-sha.')")
            .execute(&repository.pool)
            .await
            .expect("legacy human fixture");
        let address = PubDress::from_str("0xda-sha.").expect("valid pub_dress");

        let before = identity_for_pub_dress(&repository.pool, address.to_string())
            .await
            .expect("identity lookup");
        assert_eq!(before.avaia_pub_dress, None);

        let reconciled = repository
            .reconcile_owned_avaia(&address, 777)
            .await
            .expect("reconciliation")
            .expect("human exists");
        assert_eq!(reconciled.avaia_pub_dress.as_deref(), Some("da-sha.ai"));
        let created_at = sqlx::query_scalar::<_, i64>(
            "SELECT CAST(created_at AS INTEGER) FROM identities WHERE pub_dress = 'da-sha.ai'",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("creation timestamp");
        assert_eq!(created_at, 777);
    }

    #[tokio::test]
    async fn provider_subjects_remain_namespaced_and_existing_registration_is_idempotent() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let telegram_address = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let discord_address = PubDress::from_str("0x7sky").expect("valid pub_dress");

        repository
            .register(&telegram_address, &ProviderIdentity::telegram(42), 100)
            .await
            .expect("telegram insert");
        repository
            .register(&discord_address, &ProviderIdentity::discord("42"), 100)
            .await
            .expect("discord insert");

        let telegram = repository
            .find_by_provider(&ProviderIdentity::telegram(42))
            .await
            .expect("lookup")
            .expect("identity");
        assert_eq!(telegram.avaia_pub_dress.as_deref(), Some("0skai"));
        assert!(matches!(
            repository
                .register(&discord_address, &ProviderIdentity::discord("42"), 101)
                .await,
            Ok(RegistrationOutcome::AlreadyRegistered(record))
                if record.avaia_pub_dress.as_deref() == Some("7skai")
        ));
    }

    #[tokio::test]
    async fn availability_is_global_case_sensitive_and_without_reservation() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let lower = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let title = PubDress::from_str("0x0Sky").expect("valid pub_dress");

        assert!(
            repository
                .is_pub_dress_available(&lower)
                .await
                .expect("lookup")
        );
        repository
            .register(&lower, &ProviderIdentity::telegram(42), 100)
            .await
            .expect("registration");
        assert!(
            !repository
                .is_pub_dress_available(&lower)
                .await
                .expect("lookup")
        );
        assert!(
            repository
                .is_pub_dress_available(&title)
                .await
                .expect("lookup")
        );
    }

    #[tokio::test]
    async fn native_registration_is_atomic_and_requires_recovery_acknowledgement() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let address = PubDress::from_str("0x0sky").expect("valid pub_dress");

        let outcome = repository
            .register_native(
                &address,
                "$argon2id$test",
                1,
                b"recovery",
                b"challenge",
                b"idempotency",
                100,
                200,
            )
            .await
            .expect("native registration");
        assert!(matches!(
            outcome,
            NativeRegistrationOutcome::Registered(record)
                if record.avaia_pub_dress.as_deref() == Some("0skai")
        ));
        assert!(
            !repository
                .find_native_credential(&address)
                .await
                .expect("credential lookup")
                .expect("credential")
                .active
        );
        assert_eq!(
            repository
                .activate_native_registration(b"challenge", 199)
                .await
                .expect("activation")
                .expect("identity")
                .avaia_pub_dress
                .as_deref(),
            Some("0skai")
        );
    }

    #[tokio::test]
    async fn native_idempotency_does_not_create_a_second_avaia() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let address = PubDress::from_str("0x0sky").expect("valid pub_dress");

        repository
            .register_native(
                &address,
                "hash",
                1,
                b"recovery-1",
                b"challenge-1",
                b"idem-1",
                100,
                200,
            )
            .await
            .expect("first registration");
        assert!(matches!(
            repository
                .register_native(
                    &address,
                    "different",
                    1,
                    b"recovery-2",
                    b"challenge-2",
                    b"idem-1",
                    101,
                    201,
                )
                .await,
            Ok(NativeRegistrationOutcome::IdempotentReplay(record))
                if record.avaia_pub_dress.as_deref() == Some("0skai")
        ));
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM identities WHERE identity_kind = 'avaia' AND owner_pub_dress = '0x0sky'",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn sessions_are_revocable_and_keep_the_owned_avaia_projection() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let address = PubDress::from_str("0x0sky").expect("valid pub_dress");
        repository
            .register_native(
                &address,
                "hash",
                1,
                b"recovery",
                b"challenge",
                b"idem",
                100,
                200,
            )
            .await
            .expect("registration");
        repository
            .activate_native_registration(b"challenge", 101)
            .await
            .expect("activation");
        repository
            .create_native_session(b"session", "0x0sky", 101, 200)
            .await
            .expect("session");
        let session = repository
            .find_native_session(b"session", 199)
            .await
            .expect("session lookup")
            .expect("active session");
        assert_eq!(session.avaia_pub_dress.as_deref(), Some("0skai"));
        assert_eq!(
            repository
                .find_native_session(b"session", 200)
                .await
                .expect("expired"),
            None
        );
        repository
            .revoke_native_session(b"session", 150)
            .await
            .expect("revocation");
        assert_eq!(
            repository
                .find_native_session(b"session", 151)
                .await
                .expect("revoked"),
            None
        );
    }
}
