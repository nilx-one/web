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

        sqlx::raw_sql(include_str!("../migrations/0003_native_auth.sql"))
            .execute(&self.pool)
            .await?;

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

        let replay = sqlx::query(
            "SELECT pub_dress FROM native_registration_idempotency \
             WHERE idempotency_key_hash = ?",
        )
        .bind(idempotency_key_hash)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(row) = replay {
            transaction.commit().await?;
            return Ok(NativeRegistrationOutcome::IdempotentReplay(
                identity_from_row(row),
            ));
        }

        let identity_insert =
            sqlx::query("INSERT INTO identities (pub_dress) VALUES (?) ON CONFLICT DO NOTHING")
                .bind(pub_dress.as_str())
                .execute(&mut *transaction)
                .await?;
        if identity_insert.rows_affected() == 0 {
            transaction.commit().await?;
            return Ok(NativeRegistrationOutcome::HandleUnavailable);
        }

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
        let challenge = sqlx::query(
            "SELECT pub_dress FROM native_registration_challenges \
             WHERE challenge_hash = ? AND expires_at > ?",
        )
        .bind(challenge_hash)
        .bind(now as i64)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(challenge) = challenge else {
            transaction.commit().await?;
            return Ok(None);
        };
        let pub_dress: String = challenge.get("pub_dress");
        sqlx::query(
            "UPDATE native_credentials SET active = 1, updated_at = ? WHERE pub_dress = ?",
        )
        .bind(now as i64)
        .bind(&pub_dress)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM native_registration_challenges WHERE challenge_hash = ?")
            .bind(challenge_hash)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(Some(IdentityRecord { pub_dress }))
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
        let row = sqlx::query(
            "SELECT pub_dress FROM native_sessions \
             WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
        )
        .bind(token_hash)
        .bind(now as i64)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(identity_from_row))
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
            transaction.commit().await?;
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

    use super::{
        IdentityRepository, NativeRegistrationOutcome, ProviderIdentity, RegistrationOutcome,
    };
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
        assert!(matches!(outcome, NativeRegistrationOutcome::Registered(_)));
        assert_eq!(
            repository
                .find_native_credential(&address)
                .await
                .expect("credential lookup")
                .expect("credential")
                .active,
            false
        );
        assert_eq!(
            repository
                .activate_native_registration(b"challenge", 199)
                .await
                .expect("activation")
                .expect("identity")
                .pub_dress,
            "0x0sky"
        );
        assert!(
            repository
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
                .expect("one-time activation"),
            None
        );
    }

    #[tokio::test]
    async fn native_registration_rechecks_uniqueness_and_idempotency_in_storage() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let first = PubDress::from_str("0x0sky").expect("valid pub_dress");
        let second = PubDress::from_str("0x1sky").expect("valid pub_dress");

        repository
            .register_native(
                &first,
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
                    &first,
                    "different",
                    1,
                    b"recovery-2",
                    b"challenge-2",
                    b"idem-1",
                    100,
                    200,
                )
                .await,
            Ok(NativeRegistrationOutcome::IdempotentReplay(record)) if record.pub_dress == "0x0sky"
        ));
        assert!(matches!(
            repository
                .register_native(
                    &first,
                    "different",
                    1,
                    b"recovery-3",
                    b"challenge-3",
                    b"idem-3",
                    100,
                    200,
                )
                .await,
            Ok(NativeRegistrationOutcome::HandleUnavailable)
        ));
        assert!(
            repository
                .is_pub_dress_available(&second)
                .await
                .expect("unrelated address")
        );
    }

    #[tokio::test]
    async fn sessions_are_revocable_and_expire_at_the_storage_boundary() {
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
        assert_eq!(
            repository
                .find_native_session(b"session", 199)
                .await
                .expect("session lookup")
                .expect("active session")
                .pub_dress,
            "0x0sky"
        );
        assert_eq!(
            repository
                .find_native_session(b"session", 200)
                .await
                .expect("expired session"),
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
                .expect("revoked session"),
            None
        );
    }
}
