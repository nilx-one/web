// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;

use crate::{AvaiaPubDress, PubDress, PubDressLabel};

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
    /// The DNS A-label allocated to this Bond. `None` means no public label is
    /// allocated; callers must not derive ownership from `pub_dress` instead.
    pub pub_dress_label: Option<String>,
    /// The persisted allocation suffix. Empty for the unsuffixed first claim.
    pub pub_dress_label_suffix: String,
}

impl IdentityRecord {
    /// Creates a transient record before the authenticated reconciliation read.
    /// No public address is claimed until repository state is read back.
    pub fn unresolved(pub_dress: String) -> Self {
        Self {
            pub_dress,
            avaia_pub_dress: None,
            pub_dress_label: None,
            pub_dress_label_suffix: String::new(),
        }
    }

    /// Returns the product-readable public URL only from persisted allocation
    /// state. DNS transport keeps the A-label; Unicode is presentation only.
    pub fn readable_url(&self, zone: &str) -> Option<String> {
        let stored_label = self.pub_dress_label.as_ref()?;
        let label = if stored_label.starts_with("xn--") {
            format!("{}{}", self.pub_dress, self.pub_dress_label_suffix)
        } else {
            stored_label.clone()
        };
        Some(format!("https://{label}.{zone}"))
    }
}

/// A public lookup is authoritative because it comes from the allocated stored
/// DNS label, never by decoding a hostname and guessing which case-sensitive
/// `pub_dress` it meant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicIdentityRecord {
    pub identity: IdentityRecord,
    pub pub_dress_label: String,
    pub pub_dress_label_suffix: String,
}

impl PublicIdentityRecord {
    /// Product-readable URL. DNS still carries `pub_dress_label`; the readable
    /// Unicode form is presentation only and is safe because this record already
    /// proves which Bond owns that A-label.
    pub fn readable_url(&self, zone: &str) -> String {
        let label = if self.pub_dress_label.starts_with("xn--") {
            format!("{}{}", self.identity.pub_dress, self.pub_dress_label_suffix)
        } else {
            self.pub_dress_label.clone()
        };
        format!("https://{label}.{zone}")
    }
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
        if !self.has_identity_column("avatar_model").await? {
            sqlx::raw_sql(include_str!("../migrations/0005_avatar_model.sql"))
                .execute(&self.pool)
                .await?;
        }
        if !self.has_identity_column("pub_dress_label").await? {
            sqlx::raw_sql(include_str!("../migrations/0006_pub_dress_label.sql"))
                .execute(&self.pool)
                .await?;
        }
        self.backfill_pub_dress_labels().await?;
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

    /// Existing Bonds predate the stored public-label column. Backfill in stable
    /// creation order: the earliest human Bond wins a colliding DNS label and a
    /// later collision stays unallocated rather than inventing mutuality or a
    /// suffix the owner never chose.
    async fn backfill_pub_dress_labels(&self) -> Result<(), RepositoryError> {
        let rows = sqlx::query(
            "SELECT pub_dress FROM identities \
             WHERE identity_kind = 'human' AND pub_dress_label IS NULL \
             ORDER BY created_at ASC, pub_dress COLLATE BINARY ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        for row in rows {
            let raw: String = row.get("pub_dress");
            let pub_dress =
                PubDress::from_str(&raw).map_err(|_| RepositoryError::CorruptHumanPubDress)?;
            let Some(label) = default_pub_dress_label(&pub_dress) else {
                continue;
            };
            sqlx::query(
                "UPDATE OR IGNORE identities \
                 SET pub_dress_label = ?, pub_dress_label_suffix = '' \
                 WHERE pub_dress = ? AND identity_kind = 'human' \
                   AND pub_dress_label IS NULL",
            )
            .bind(label)
            .bind(pub_dress.as_str())
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn register(
        &self,
        pub_dress: &PubDress,
        provider_identity: &ProviderIdentity,
        now: u64,
    ) -> Result<RegistrationOutcome, RepositoryError> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;

        if let Some(mut record) = find_by_provider_in(&mut transaction, provider_identity).await? {
            if record.avaia_pub_dress.is_none() {
                let owner = pub_dress_for(&record)?;
                record.avaia_pub_dress =
                    create_owned_avaia_in(&mut transaction, &owner, now).await?;
            }
            transaction.commit().await?;
            return Ok(RegistrationOutcome::AlreadyRegistered(record));
        }

        match insert_human_with_public_label_in(&mut transaction, pub_dress, now).await? {
            HumanIdentityInsertOutcome::Inserted => {}
            HumanIdentityInsertOutcome::PubDressUnavailable => {
                transaction.rollback().await?;
                return Ok(RegistrationOutcome::HandleUnavailable);
            }
            HumanIdentityInsertOutcome::PublicLabelUnavailable => {
                transaction.rollback().await?;
                return Ok(RegistrationOutcome::PublicLabelUnavailable);
            }
        }

        let Some(_avaia_pub_dress) =
            create_owned_avaia_in(&mut transaction, pub_dress, now).await?
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

        let record = identity_for_pub_dress_in(&mut transaction, pub_dress.to_string()).await?;
        transaction.commit().await?;
        Ok(RegistrationOutcome::Registered(record))
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

        create_owned_avaia_in(&mut transaction, pub_dress, now).await?;
        let record = identity_for_pub_dress_in(&mut transaction, pub_dress.to_string()).await?;
        transaction.commit().await?;
        Ok(Some(record))
    }

    /// Moves a human Bond to another address it already owns the right to
    /// choose. The Bond, its provider bindings, credentials and sessions are the
    /// same facts under the new address; only the address changes.
    ///
    /// The owned Avaia address is a derivation of its owner's address, so it
    /// moves with the owner rather than outliving the name it was derived from.
    pub async fn rename_pub_dress(
        &self,
        current: &PubDress,
        next: &PubDress,
        now: u64,
    ) -> Result<PubDressRenameOutcome, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        // `identities.owner_pub_dress` is the one reference without
        // ON UPDATE CASCADE, so the owned Avaia row is re-pointed by the second
        // statement and the constraint is checked at commit instead of between
        // the two. Every other reference cascades on its own.
        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *transaction)
            .await?;

        let suffix = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress_label_suffix FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human'",
        )
        .bind(current.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(suffix) = suffix else {
            transaction.rollback().await?;
            return Ok(PubDressRenameOutcome::Unknown);
        };

        let occupied = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE pub_dress = ?)",
        )
        .bind(next.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if occupied {
            transaction.rollback().await?;
            return Ok(PubDressRenameOutcome::Unavailable);
        }

        let next_label = pub_dress_label_with_suffix(next, &suffix)?;
        if let Some(label) = next_label.as_deref() {
            let label_occupied = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM identities \
                 WHERE identity_kind = 'human' \
                   AND pub_dress_label = ? COLLATE NOCASE \
                   AND pub_dress <> ?)",
            )
            .bind(label)
            .bind(current.as_str())
            .fetch_one(&mut *transaction)
            .await?;
            if label_occupied {
                transaction.rollback().await?;
                return Ok(PubDressRenameOutcome::Unavailable);
            }
        }

        let existing_avaia = owned_avaia_for_owner_in(&mut transaction, current.as_str()).await?;
        // A derived Avaia address is a consequence of its owner's name, so it
        // follows the owner. An address its owner chose is not a derivation:
        // renaming the human keeps the Avaia exactly as it was named, which the
        // shared discriminator leaves canonical.
        let derived_from_current = AvaiaPubDress::derive_default(current).to_string();
        let derived_avaia = existing_avaia
            .as_deref()
            .is_some_and(|existing| existing == derived_from_current)
            .then(|| AvaiaPubDress::derive_default(next).to_string());
        if let Some(derived) = derived_avaia.as_deref() {
            let avaia_occupied = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM identities \
                 WHERE pub_dress = ? AND owner_pub_dress IS NOT ?)",
            )
            .bind(derived)
            .bind(current.as_str())
            .fetch_one(&mut *transaction)
            .await?;
            if avaia_occupied {
                transaction.rollback().await?;
                return Ok(PubDressRenameOutcome::AvaiaUnavailable);
            }
        }

        sqlx::query("UPDATE identities SET pub_dress = ?, pub_dress_label = ? WHERE pub_dress = ?")
            .bind(next.as_str())
            .bind(next_label)
            .bind(current.as_str())
            .execute(&mut *transaction)
            .await?;

        if let Some(existing) = existing_avaia {
            let moved = derived_avaia.unwrap_or(existing);
            sqlx::query(
                "UPDATE identities SET pub_dress = ?, owner_pub_dress = ? \
                 WHERE identity_kind = 'avaia' AND owner_pub_dress = ?",
            )
            .bind(&moved)
            .bind(next.as_str())
            .bind(current.as_str())
            .execute(&mut *transaction)
            .await?;
        } else {
            // A pre-amendment Bond crossing this boundary gains the Avaia its
            // new address derives, exactly as an authenticated read would.
            let Some(_created) = create_owned_avaia_in(&mut transaction, next, now).await? else {
                transaction.rollback().await?;
                return Ok(PubDressRenameOutcome::AvaiaUnavailable);
            };
        }

        let record = identity_for_pub_dress_in(&mut transaction, next.to_string()).await?;
        transaction.commit().await?;
        Ok(PubDressRenameOutcome::Renamed(record))
    }

    /// Names the Avaia a human Bond owns. The address keeps its owner's
    /// discriminator and the canonical `ai` suffix, both of which the parsed
    /// address already carries; only the name in between is a choice.
    pub async fn rename_owned_avaia(
        &self,
        owner: &PubDress,
        next: &AvaiaPubDress,
        now: u64,
    ) -> Result<PubDressRenameOutcome, RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        let human_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human')",
        )
        .bind(owner.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if !human_exists {
            transaction.rollback().await?;
            return Ok(PubDressRenameOutcome::Unknown);
        }

        let occupied = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities \
             WHERE pub_dress = ? \
               AND NOT (identity_kind = 'avaia' AND owner_pub_dress IS ?))",
        )
        .bind(next.as_str())
        .bind(owner.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if occupied {
            transaction.rollback().await?;
            return Ok(PubDressRenameOutcome::AvaiaUnavailable);
        }

        let existing = owned_avaia_for_owner_in(&mut transaction, owner.as_str()).await?;
        match existing {
            Some(_) => {
                sqlx::query(
                    "UPDATE identities SET pub_dress = ? \
                     WHERE identity_kind = 'avaia' AND owner_pub_dress = ?",
                )
                .bind(next.as_str())
                .bind(owner.as_str())
                .execute(&mut *transaction)
                .await?;
            }
            // A Bond that predates the Avaia amendment names one here rather
            // than waiting for a derivation it has already replaced.
            None => {
                sqlx::query(
                    "INSERT INTO identities \
                     (pub_dress, identity_kind, owner_pub_dress, created_at) \
                     VALUES (?, 'avaia', ?, ?)",
                )
                .bind(next.as_str())
                .bind(owner.as_str())
                .bind(now as i64)
                .execute(&mut *transaction)
                .await?;
            }
        }

        let record = identity_for_pub_dress_in(&mut transaction, owner.to_string()).await?;
        transaction.commit().await?;
        Ok(PubDressRenameOutcome::Renamed(record))
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

    pub async fn is_pub_dress_label_available(
        &self,
        label: &PubDressLabel,
    ) -> Result<bool, RepositoryError> {
        let occupied = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities \
             WHERE identity_kind = 'human' AND pub_dress_label = ? COLLATE NOCASE)",
        )
        .bind(label.as_str())
        .fetch_one(&self.pool)
        .await?;
        Ok(!occupied)
    }

    pub async fn find_by_pub_dress_label(
        &self,
        label: &PubDressLabel,
    ) -> Result<Option<PublicIdentityRecord>, RepositoryError> {
        let row = sqlx::query(
            "SELECT pub_dress, pub_dress_label, pub_dress_label_suffix \
             FROM identities \
             WHERE identity_kind = 'human' AND pub_dress_label = ? COLLATE NOCASE",
        )
        .bind(label.as_str())
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let pub_dress: String = row.get("pub_dress");
        let pub_dress_label: String = row.get("pub_dress_label");
        let pub_dress_label_suffix: String = row.get("pub_dress_label_suffix");
        let identity = identity_for_pub_dress(&self.pool, pub_dress).await?;
        Ok(Some(PublicIdentityRecord {
            identity,
            pub_dress_label,
            pub_dress_label_suffix,
        }))
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
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;

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

        match insert_human_with_public_label_in(&mut transaction, pub_dress, now).await? {
            HumanIdentityInsertOutcome::Inserted => {}
            HumanIdentityInsertOutcome::PubDressUnavailable => {
                transaction.rollback().await?;
                return Ok(NativeRegistrationOutcome::HandleUnavailable);
            }
            HumanIdentityInsertOutcome::PublicLabelUnavailable => {
                transaction.rollback().await?;
                return Ok(NativeRegistrationOutcome::PublicLabelUnavailable);
            }
        }

        let Some(_avaia_pub_dress) =
            create_owned_avaia_in(&mut transaction, pub_dress, now).await?
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

        let record = identity_for_pub_dress_in(&mut transaction, pub_dress.to_string()).await?;
        transaction.commit().await?;
        Ok(NativeRegistrationOutcome::Registered(record))
    }

    /// The provider binding is the authority; a submitted handle cannot select an owner.
    /// An acknowledged credential is immutable through this setup path.
    #[allow(clippy::too_many_arguments)]
    pub async fn prepare_provider_password(
        &self,
        provider: &ProviderIdentity,
        password_hash: &str,
        password_hash_version: i64,
        recovery_key_hash: &[u8],
        challenge_hash: &[u8],
        now: u64,
        expires_at: u64,
    ) -> Result<Option<IdentityRecord>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let pub_dress = sqlx::query_scalar::<_, String>(
            "INSERT INTO native_credentials \
             (pub_dress, password_hash, password_hash_version, recovery_key_hash, active, created_at, updated_at) \
             SELECT p.pub_dress, ?, ?, ?, 0, ?, ? FROM identity_providers p \
             JOIN identities i ON i.pub_dress = p.pub_dress \
             WHERE p.provider = ? AND p.provider_subject = ? AND i.identity_kind = 'human' \
             ON CONFLICT(pub_dress) DO UPDATE SET password_hash = excluded.password_hash, \
             password_hash_version = excluded.password_hash_version, \
             recovery_key_hash = excluded.recovery_key_hash, updated_at = excluded.updated_at \
             WHERE native_credentials.active = 0 RETURNING pub_dress",
        )
        .bind(password_hash)
        .bind(password_hash_version)
        .bind(recovery_key_hash)
        .bind(now as i64)
        .bind(now as i64)
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(pub_dress) = pub_dress else {
            transaction.rollback().await?;
            return Ok(None);
        };
        sqlx::query(
            "INSERT INTO native_registration_challenges \
             (challenge_hash, pub_dress, expires_at, created_at) VALUES (?, ?, ?, ?) \
             ON CONFLICT(pub_dress) DO UPDATE SET challenge_hash = excluded.challenge_hash, \
             expires_at = excluded.expires_at, created_at = excluded.created_at",
        )
        .bind(challenge_hash)
        .bind(&pub_dress)
        .bind(expires_at as i64)
        .bind(now as i64)
        .execute(&mut *transaction)
        .await?;
        let record = identity_for_pub_dress_in(&mut transaction, pub_dress).await?;
        transaction.commit().await?;
        Ok(Some(record))
    }

    /// The avatar a Bond chose, or `None` while it has chosen none.
    pub async fn avatar_model(&self, pub_dress: &str) -> Result<Option<String>, RepositoryError> {
        Ok(sqlx::query_scalar::<_, Option<String>>(
            "SELECT avatar_model FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human'",
        )
        .bind(pub_dress)
        .fetch_optional(&self.pool)
        .await?
        .flatten())
    }

    /// Records that choice. Returns false when the address is not a human Bond.
    pub async fn set_avatar_model(
        &self,
        pub_dress: &str,
        model: &str,
    ) -> Result<bool, RepositoryError> {
        let updated = sqlx::query(
            "UPDATE identities SET avatar_model = ? \
             WHERE pub_dress = ? AND identity_kind = 'human'",
        )
        .bind(model)
        .bind(pub_dress)
        .execute(&self.pool)
        .await?;
        Ok(updated.rows_affected() == 1)
    }

    pub async fn password_required(&self, pub_dress: &str) -> Result<bool, RepositoryError> {
        let active = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM native_credentials WHERE pub_dress = ? AND active = 1)",
        )
        .bind(pub_dress)
        .fetch_one(&self.pool)
        .await?;
        Ok(!active)
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

const PUBLIC_LABEL_RETRY_SUFFIXES: [&str; 8] = ["2", "3", "4", "5", "6", "7", "8", "9"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HumanIdentityInsertOutcome {
    Inserted,
    PubDressUnavailable,
    PublicLabelUnavailable,
}

async fn insert_human_with_public_label_in(
    transaction: &mut Transaction<'_, Sqlite>,
    pub_dress: &PubDress,
    now: u64,
) -> Result<HumanIdentityInsertOutcome, RepositoryError> {
    let stem = match PubDressLabel::stem(pub_dress) {
        Ok(stem) => stem,
        Err(_) => {
            let inserted = sqlx::query(
                "INSERT INTO identities \
                 (pub_dress, identity_kind, pub_dress_label, pub_dress_label_suffix, created_at) \
                 VALUES (?, 'human', NULL, '', ?) ON CONFLICT DO NOTHING",
            )
            .bind(pub_dress.as_str())
            .bind(now as i64)
            .execute(&mut **transaction)
            .await?;
            return Ok(if inserted.rows_affected() == 1 {
                HumanIdentityInsertOutcome::Inserted
            } else {
                HumanIdentityInsertOutcome::PubDressUnavailable
            });
        }
    };

    for suffix in core::iter::once("").chain(PUBLIC_LABEL_RETRY_SUFFIXES) {
        let label = match PubDressLabel::compose(&stem, suffix) {
            Ok(label) => label,
            Err(_) => continue,
        };
        let inserted = sqlx::query(
            "INSERT INTO identities \
             (pub_dress, identity_kind, pub_dress_label, pub_dress_label_suffix, created_at) \
             VALUES (?, 'human', ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(pub_dress.as_str())
        .bind(label.as_str())
        .bind(suffix)
        .bind(now as i64)
        .execute(&mut **transaction)
        .await?;
        if inserted.rows_affected() == 1 {
            return Ok(HumanIdentityInsertOutcome::Inserted);
        }

        // The failed INSERT is the collision boundary. This read only
        // classifies which UNIQUE constraint rejected it; it never
        // reserves a label or performs a check-then-insert allocation.
        let pub_dress_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE pub_dress = ?)",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&mut **transaction)
        .await?;
        if pub_dress_exists {
            return Ok(HumanIdentityInsertOutcome::PubDressUnavailable);
        }
    }

    Ok(HumanIdentityInsertOutcome::PublicLabelUnavailable)
}

fn default_pub_dress_label(pub_dress: &PubDress) -> Option<String> {
    PubDressLabel::stem(pub_dress)
        .ok()
        .map(|stem| stem.as_str().to_owned())
}

fn pub_dress_label_with_suffix(
    pub_dress: &PubDress,
    suffix: &str,
) -> Result<Option<String>, RepositoryError> {
    let Ok(stem) = PubDressLabel::stem(pub_dress) else {
        return if suffix.is_empty() {
            Ok(None)
        } else {
            Err(RepositoryError::CorruptPublicLabelSuffix)
        };
    };
    if suffix.is_empty() {
        return Ok(Some(stem.as_str().to_owned()));
    }
    PubDressLabel::compose(&stem, suffix)
        .map(|label| Some(label.as_str().to_owned()))
        .map_err(|_| RepositoryError::CorruptPublicLabelSuffix)
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
    let public = sqlx::query(
        "SELECT pub_dress_label, pub_dress_label_suffix FROM identities \
         WHERE pub_dress = ? AND identity_kind = 'human'",
    )
    .bind(&pub_dress)
    .fetch_one(pool)
    .await?;
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
        pub_dress_label: public.get("pub_dress_label"),
        pub_dress_label_suffix: public.get("pub_dress_label_suffix"),
    })
}

async fn identity_for_pub_dress_in(
    transaction: &mut Transaction<'_, Sqlite>,
    pub_dress: String,
) -> Result<IdentityRecord, sqlx::Error> {
    let public = sqlx::query(
        "SELECT pub_dress_label, pub_dress_label_suffix FROM identities \
         WHERE pub_dress = ? AND identity_kind = 'human'",
    )
    .bind(&pub_dress)
    .fetch_one(&mut **transaction)
    .await?;
    let avaia_pub_dress = owned_avaia_for_owner_in(transaction, &pub_dress).await?;
    Ok(IdentityRecord {
        pub_dress,
        avaia_pub_dress,
        pub_dress_label: public.get("pub_dress_label"),
        pub_dress_label_suffix: public.get("pub_dress_label_suffix"),
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
    PublicLabelUnavailable,
    AvaiaUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PubDressRenameOutcome {
    Renamed(IdentityRecord),
    /// Another identity — human or Avaia — already holds the requested address.
    Unavailable,
    /// The Avaia address the new owner address derives belongs to someone else.
    AvaiaUnavailable,
    /// The address the caller presented is no longer a human Bond.
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistrationOutcome {
    Registered(IdentityRecord),
    AlreadyRegistered(IdentityRecord),
    HandleUnavailable,
    PublicLabelUnavailable,
    AvaiaUnavailable,
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("identity storage failed: {0}")]
    Storage(#[from] sqlx::Error),
    #[error("stored human pub_dress is invalid")]
    CorruptHumanPubDress,
    #[error("stored public-label suffix is invalid for this pub_dress")]
    CorruptPublicLabelSuffix,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{
        IdentityRepository, NativeRegistrationOutcome, ProviderIdentity, RegistrationOutcome,
        identity_for_pub_dress,
    };
    use crate::{AvaiaPubDress, PubDress, PubDressLabel};

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
    async fn public_label_is_stored_atomically_and_resolves_to_the_allocated_bond() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let address = PubDress::from_str("0x0небо").expect("valid pub_dress");
        let registered = match repository
            .register(&address, &ProviderIdentity::telegram(10), 100)
            .await
            .expect("registration")
        {
            RegistrationOutcome::Registered(record) => record,
            other => panic!("unexpected registration outcome: {other:?}"),
        };

        let label = PubDressLabel::stem(&address).expect("label");
        assert_eq!(label.as_str(), "xn--0x0-dddt1cj");
        assert_eq!(registered.pub_dress_label.as_deref(), Some(label.as_str()));
        assert_eq!(registered.pub_dress_label_suffix, "");
        assert_eq!(
            registered.readable_url("nilx.one").as_deref(),
            Some("https://0x0небо.nilx.one")
        );
        let record = repository
            .find_by_pub_dress_label(
                &PubDressLabel::from_str(label.as_str()).expect("stored label"),
            )
            .await
            .expect("lookup")
            .expect("allocated Bond");
        assert_eq!(record.identity.pub_dress, "0x0небо");
        assert_eq!(record.readable_url("nilx.one"), "https://0x0небо.nilx.one");
    }

    #[tokio::test]
    async fn a_dns_fold_collision_allocates_the_first_decimal_suffix() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let lower = PubDress::from_str("0x0небо").expect("lower");
        let title = PubDress::from_str("0x0Небо").expect("title");
        let first = match repository
            .register(&lower, &ProviderIdentity::telegram(10), 100)
            .await
            .expect("first registration")
        {
            RegistrationOutcome::Registered(record) => record,
            other => panic!("unexpected first outcome: {other:?}"),
        };
        let second = match repository
            .register(&title, &ProviderIdentity::discord("20"), 101)
            .await
            .expect("second registration")
        {
            RegistrationOutcome::Registered(record) => record,
            other => panic!("unexpected second outcome: {other:?}"),
        };
        assert_eq!(first.pub_dress_label_suffix, "");
        assert_eq!(second.pub_dress_label_suffix, "2");
        assert_ne!(first.pub_dress_label, second.pub_dress_label);
        assert_eq!(
            second.readable_url("nilx.one").as_deref(),
            Some("https://0x0Небо2.nilx.one")
        );
    }

    #[tokio::test]
    async fn concurrent_dns_fold_claims_allocate_distinct_labels() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let repository = IdentityRepository::connect(&database_url)
            .await
            .expect("repository must initialize");
        let first_repository = repository.clone();
        let second_repository = repository.clone();
        let lower = PubDress::from_str("0x0небо").expect("lower");
        let title = PubDress::from_str("0x0Небо").expect("title");
        let telegram = ProviderIdentity::telegram(10);
        let discord = ProviderIdentity::discord("20");

        let (first, second) = tokio::join!(
            first_repository.register(&lower, &telegram, 100),
            second_repository.register(&title, &discord, 101),
        );
        let first = match first.expect("first registration") {
            RegistrationOutcome::Registered(record) => record,
            other => panic!("unexpected first outcome: {other:?}"),
        };
        let second = match second.expect("second registration") {
            RegistrationOutcome::Registered(record) => record,
            other => panic!("unexpected second outcome: {other:?}"),
        };

        assert_ne!(first.pub_dress_label, second.pub_dress_label);
        let mut suffixes = [
            first.pub_dress_label_suffix.as_str(),
            second.pub_dress_label_suffix.as_str(),
        ];
        suffixes.sort_unstable();
        assert_eq!(suffixes, ["", "2"]);
    }

    #[tokio::test]
    async fn public_label_retries_are_bounded_and_roll_back_on_exhaustion() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let candidate = PubDress::from_str("0x0Sky").expect("candidate");
        let stem = PubDressLabel::stem(&candidate).expect("stem");
        for suffix in core::iter::once("").chain(super::PUBLIC_LABEL_RETRY_SUFFIXES) {
            let label = PubDressLabel::compose(&stem, suffix).expect("candidate label");
            sqlx::query(
                "INSERT INTO identities \
                 (pub_dress, identity_kind, pub_dress_label, pub_dress_label_suffix, created_at) \
                 VALUES (?, 'human', ?, ?, ?)",
            )
            .bind(format!(
                "0x{}fixture{}",
                suffix.len(),
                if suffix.is_empty() { "aa" } else { suffix }
            ))
            .bind(label.as_str())
            .bind(suffix)
            .bind(1_i64)
            .execute(&repository.pool)
            .await
            .expect("occupy label");
        }

        assert!(matches!(
            repository
                .register(&candidate, &ProviderIdentity::telegram(42), 100)
                .await,
            Ok(RegistrationOutcome::PublicLabelUnavailable)
        ));
        assert!(
            repository
                .is_pub_dress_available(&candidate)
                .await
                .expect("failed allocation must not create the Bond")
        );
        assert!(
            repository
                .find_by_provider(&ProviderIdentity::telegram(42))
                .await
                .expect("provider lookup")
                .is_none()
        );
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
        assert_eq!(
            telegram.readable_url("nilx.one").as_deref(),
            Some("https://0x0sky.nilx.one")
        );
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
                    && record.readable_url("nilx.one").as_deref() == Some("https://0x0sky.nilx.one")
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
                    && record.pub_dress_label.as_deref() == Some("0x0sky")
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
            session.readable_url("nilx.one").as_deref(),
            Some("https://0x0sky.nilx.one")
        );
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
