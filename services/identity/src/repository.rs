// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use thiserror::Error;

use crate::{AvaiaPubDress, BondAccessRole, DecimalU64, GeoCoordinate, PubDress, PubDressLabel};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IdentityProvider {
    Telegram,
    Discord,
    Github,
}

impl IdentityProvider {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Discord => "discord",
            Self::Github => "github",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderIdentity {
    pub provider: IdentityProvider,
    pub subject: String,
}

/// A Single Active Client activation request (`nilx-one/0x1`
/// `documents/15-devices-and-recovery.md`). `Pending` is the confirmation
/// window on the active client. `Objectable` is the live-device objection
/// window, and only a credential-authenticated requester reaches it.
/// `Accepted`/`Declined`/`Objected`/`Expired` are terminal. `Expired` is a
/// host-authenticated request past its TTL, a requester that is no longer a
/// live session, or a request superseded by a newer one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActivationRequestStatus {
    Pending,
    Objectable,
    Accepted,
    Declined,
    Objected,
    Expired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActivationRequest {
    pub id: Vec<u8>,
    pub pub_dress: String,
    pub requester_token_hash: Vec<u8>,
    pub client_label: String,
    /// Copied from the requester session at creation. Route 3 (the silent
    /// objection window) is only for a credential-authenticated requester.
    pub credential_authenticated: bool,
    pub status: ActivationRequestStatus,
    pub responds_by: u64,
    pub objection_deadline: Option<u64>,
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

    pub fn github(user_id: u64) -> Self {
        Self {
            provider: IdentityProvider::Github,
            subject: user_id.to_string(),
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
        self.migrate_provider_catalog().await?;

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
        self.migrate_avatar_catalog().await?;
        self.backfill_pub_dress_labels().await?;
        sqlx::raw_sql(include_str!("../migrations/0013_avaia_location.sql"))
            .execute(&self.pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0017_bond_pub_info.sql"))
            .execute(&self.pool)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0020_committed_experience.sql"))
            .execute(&self.pool)
            .await?;
        self.migrate_avaia_prefix().await?;
        self.migrate_bond_roles().await?;
        if !self.has_native_sessions_column("active").await? {
            sqlx::raw_sql(include_str!("../migrations/0016_session_activation.sql"))
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// Creates `bond_roles` and carries the previous name-derived admins over,
    /// exactly once: a Bond that registers one of those names later gets no
    /// role from it.
    async fn migrate_bond_roles(&self) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name = 'bond_roles')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if !exists {
            sqlx::raw_sql(include_str!("../migrations/0015_bond_roles.sql"))
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// The application role of a human Bond; no stored role means `user`.
    pub async fn role_for(&self, pub_dress: &str) -> Result<BondAccessRole, RepositoryError> {
        let stored =
            sqlx::query_scalar::<_, String>("SELECT role FROM bond_roles WHERE pub_dress = ?")
                .bind(pub_dress)
                .fetch_optional(&self.pool)
                .await?;
        match stored {
            None => Ok(BondAccessRole::default()),
            Some(value) => {
                BondAccessRole::from_stored(&value).ok_or(RepositoryError::CorruptBondRole)
            }
        }
    }

    /// Assigns a role to an existing human Bond. There is no public route to
    /// this: registration only ever creates `user` Bonds.
    pub async fn set_role(
        &self,
        pub_dress: &PubDress,
        role: BondAccessRole,
    ) -> Result<bool, RepositoryError> {
        let result = sqlx::query(
            "INSERT INTO bond_roles (pub_dress, role) \
             SELECT pub_dress, ? FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human' \
             ON CONFLICT(pub_dress) DO UPDATE SET role = excluded.role",
        )
        .bind(role.as_str())
        .bind(pub_dress.as_str())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Stored Avaia addresses predate the literal `x` prefix. Rewrite them once,
    /// keeping any configuration state the rename trigger would otherwise flip.
    async fn migrate_avaia_prefix(&self) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let legacy = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities \
             WHERE identity_kind = 'avaia' AND substr(pub_dress, 1, 1) <> 'x')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if legacy {
            let configured = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
                 WHERE type = 'table' AND name = 'avaia_configuration')",
            )
            .fetch_one(&mut *transaction)
            .await?;
            sqlx::raw_sql(include_str!("../migrations/0014_avaia_x_prefix.sql"))
                .execute(&mut *transaction)
                .await?;
            if configured {
                sqlx::raw_sql(include_str!("../migrations/0007_avaia_configuration.sql"))
                    .execute(&mut *transaction)
                    .await?;
            }
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn migrate_provider_catalog(&self) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let schema: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'identity_providers'",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if !schema.contains("'github'") {
            sqlx::raw_sql(include_str!("../migrations/0010_github_provider.sql"))
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn migrate_avatar_catalog(&self) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let schema: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'identities'",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if !schema.contains("'dasha-v2-study'") {
            sqlx::raw_sql(include_str!("../migrations/0008_dasha_v2_avatar.sql"))
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
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

    async fn has_native_sessions_column(&self, name: &str) -> Result<bool, RepositoryError> {
        let columns = sqlx::query("PRAGMA table_info(native_sessions)")
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

        if let Some(record) = find_by_provider_in(&mut transaction, provider_identity).await? {
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

    /// Reads the full record of a human Bond. Observational only: a Bond
    /// without an Avaia stays without one until its owner creates it through
    /// the explicit Avaia setup.
    pub async fn resolve_human_identity(
        &self,
        pub_dress: &PubDress,
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

        // A Bond without an Avaia keeps none: renaming is not a creation
        // boundary.
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
            // Naming is not a creation boundary: only the explicit Avaia
            // setup creates one.
            None => {
                transaction.rollback().await?;
                return Ok(PubDressRenameOutcome::AvaiaMissing);
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

    /// A new session starts active only if the Bond currently holds no other
    /// active, still-valid session — the base case where there is nothing to
    /// activate against. Otherwise it starts inactive: activation is a
    /// separate, explicit step (`SessionActivationRequest`), never implied by
    /// merely authenticating on a new client. See `nilx-one/0x1`
    /// `documents/15-devices-and-recovery.md`, Single Active Client.
    ///
    /// `credential_authenticated` is true only for a password mint (login,
    /// recovery, registration acknowledgement). Host material must pass
    /// false: it is not the long-lived credential and must not silent-takeover.
    ///
    /// `supersede_token_hash` revokes the session this browser already
    /// presented, in the same transaction and before the active-session
    /// check, so a same-browser re-login that was active comes up active
    /// instead of orphaning that row for the rest of its TTL. A different
    /// device presents no cookie and still starts inactive.
    ///
    /// Returns whether the new session became active.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_native_session(
        &self,
        token_hash: &[u8],
        pub_dress: &str,
        now: u64,
        expires_at: u64,
        client_label: &str,
        credential_authenticated: bool,
        supersede_token_hash: Option<&[u8]>,
    ) -> Result<bool, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        if let Some(supersede) = supersede_token_hash.filter(|hash| *hash != token_hash) {
            sqlx::query(
                "UPDATE native_sessions SET revoked_at = ? \
                 WHERE token_hash = ? AND revoked_at IS NULL",
            )
            .bind(now as i64)
            .bind(supersede)
            .execute(&mut *transaction)
            .await?;
        }
        let has_active = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM native_sessions \
             WHERE pub_dress = ? AND active = 1 AND revoked_at IS NULL AND expires_at > ?)",
        )
        .bind(pub_dress)
        .bind(now as i64)
        .fetch_one(&mut *transaction)
        .await?;
        let becomes_active = !has_active;
        sqlx::query(
            "INSERT INTO native_sessions \
             (token_hash, pub_dress, expires_at, created_at, active, client_label, \
              credential_authenticated) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(token_hash)
        .bind(pub_dress)
        .bind(expires_at as i64)
        .bind(now as i64)
        .bind(becomes_active)
        .bind(client_label)
        .bind(i64::from(credential_authenticated))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(becomes_active)
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

    /// Same lookup as `find_native_session`, plus whether this session is
    /// currently the active one. An inactive session still identifies its
    /// Bond for reads; only a caller that would act for the Bond needs the
    /// flag.
    /// The client label a session was minted with, so an action taken in its
    /// name (such as requesting activation) can be shown under the same
    /// name the person already sees for that session.
    pub async fn native_session_client_label(
        &self,
        token_hash: &[u8],
    ) -> Result<Option<String>, RepositoryError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT client_label FROM native_sessions WHERE token_hash = ?",
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn find_native_session_with_activity(
        &self,
        token_hash: &[u8],
        now: u64,
    ) -> Result<Option<(IdentityRecord, bool)>, RepositoryError> {
        let row = sqlx::query(
            "SELECT pub_dress, active FROM native_sessions \
             WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
        )
        .bind(token_hash)
        .bind(now as i64)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => {
                let pub_dress: String = row.get("pub_dress");
                let active: bool = row.get("active");
                Ok(Some((
                    identity_for_pub_dress(&self.pool, pub_dress).await?,
                    active,
                )))
            }
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

    /// Creates a pending activation request naming the requesting client.
    /// The caller already authenticated the requester (a session cookie or a
    /// fresh provider/credential check) before this is reachable.
    ///
    /// Any other open request for this Bond is expired in the same
    /// transaction first. The inbox shows one request; a hidden sibling must
    /// not be able to accept itself later by polling its own status.
    /// `credential_authenticated` is copied from the requester session so
    /// route 3 follows how that session was minted, not a later edit.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_activation_request(
        &self,
        id: &[u8],
        pub_dress: &str,
        requester_token_hash: &[u8],
        client_label: &str,
        now: u64,
        responds_by: u64,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        expire_open_activation_requests(&mut transaction, pub_dress, None, now).await?;
        let credential_authenticated = sqlx::query_scalar::<_, i64>(
            "SELECT credential_authenticated FROM native_sessions WHERE token_hash = ?",
        )
        .bind(requester_token_hash)
        .fetch_optional(&mut *transaction)
        .await?
        .unwrap_or(0)
            == 1;
        sqlx::query(
            "INSERT INTO session_activation_requests \
             (id, pub_dress, requester_token_hash, client_label, credential_authenticated, \
              status, created_at, responds_by) \
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        )
        .bind(id)
        .bind(pub_dress)
        .bind(requester_token_hash)
        .bind(client_label)
        .bind(i64::from(credential_authenticated))
        .bind(now as i64)
        .bind(responds_by as i64)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// The request the active client should be shown, if any, with the lazy
    /// pending -> objectable and objectable -> accepted transitions applied
    /// first. There is no background sweep; every read of a request passes
    /// through this.
    pub async fn pending_activation_request_for(
        &self,
        pub_dress: &str,
        now: u64,
        objection_window_seconds: u64,
    ) -> Result<Option<ActivationRequest>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, pub_dress, requester_token_hash, client_label, status, \
                    responds_by, objection_deadline, credential_authenticated \
             FROM session_activation_requests \
             WHERE pub_dress = ? AND status IN ('pending', 'objectable') \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(pub_dress)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(row) = row else {
            transaction.commit().await?;
            return Ok(None);
        };
        let request = decode_activation_request(&row)?;
        let request = advance_activation_request(&mut transaction, request, now, objection_window_seconds)
            .await?;
        transaction.commit().await?;
        Ok(match request.status {
            ActivationRequestStatus::Pending | ActivationRequestStatus::Objectable => Some(request),
            _ => None,
        })
    }

    /// The requester's own view of a request it created, so it can learn the
    /// outcome without guessing from whether its session became active.
    pub async fn activation_request_status(
        &self,
        id: &[u8],
        requester_token_hash: &[u8],
        now: u64,
        objection_window_seconds: u64,
    ) -> Result<Option<ActivationRequest>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, pub_dress, requester_token_hash, client_label, status, \
                    responds_by, objection_deadline, credential_authenticated \
             FROM session_activation_requests \
             WHERE id = ? AND requester_token_hash = ?",
        )
        .bind(id)
        .bind(requester_token_hash)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(row) = row else {
            transaction.commit().await?;
            return Ok(None);
        };
        let request = decode_activation_request(&row)?;
        let request = advance_activation_request(&mut transaction, request, now, objection_window_seconds)
            .await?;
        transaction.commit().await?;
        Ok(Some(request))
    }

    /// Accepts a request on behalf of the currently active session: the
    /// requester becomes active, and whichever session was active becomes
    /// inactive but stays signed in. Returns `false` if there is no such
    /// pending/objectable request for this Bond (already resolved, wrong
    /// Bond, or never existed) rather than erroring, since a stale UI action
    /// racing a lazy sweep is an ordinary outcome, not a failure.
    pub async fn accept_activation_request(
        &self,
        id: &[u8],
        pub_dress: &str,
        now: u64,
        objection_window_seconds: u64,
    ) -> Result<bool, RepositoryError> {
        self.resolve_activation_request(
            id,
            pub_dress,
            now,
            objection_window_seconds,
            ActivationRequestStatus::Accepted,
            true,
        )
        .await
    }

    /// Declines a request: terminal, no session changes. Same "false means
    /// nothing to do" contract as `accept_activation_request`.
    pub async fn decline_activation_request(
        &self,
        id: &[u8],
        pub_dress: &str,
        now: u64,
        objection_window_seconds: u64,
    ) -> Result<bool, RepositoryError> {
        self.resolve_activation_request(
            id,
            pub_dress,
            now,
            objection_window_seconds,
            ActivationRequestStatus::Declined,
            false,
        )
        .await
    }

    /// The active client's objection during the live-device objection
    /// window: only valid while the request is `objectable`, never while it
    /// is still merely `pending` (that path is a decline, not an objection).
    pub async fn object_to_activation_request(
        &self,
        id: &[u8],
        pub_dress: &str,
        now: u64,
        objection_window_seconds: u64,
    ) -> Result<bool, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let Some(row) = sqlx::query(
            "SELECT id, pub_dress, requester_token_hash, client_label, status, \
                    responds_by, objection_deadline, credential_authenticated \
             FROM session_activation_requests \
             WHERE id = ? AND pub_dress = ?",
        )
        .bind(id)
        .bind(pub_dress)
        .fetch_optional(&mut *transaction)
        .await?
        else {
            transaction.commit().await?;
            return Ok(false);
        };
        let request = decode_activation_request(&row)?;
        let request =
            advance_activation_request(&mut transaction, request, now, objection_window_seconds).await?;
        if request.status != ActivationRequestStatus::Objectable {
            transaction.commit().await?;
            return Ok(false);
        }
        sqlx::query(
            "UPDATE session_activation_requests SET status = 'objected', resolved_at = ? \
             WHERE id = ? AND status = 'objectable'",
        )
        .bind(now as i64)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        expire_open_activation_requests(&mut transaction, pub_dress, Some(id), now).await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn resolve_activation_request(
        &self,
        id: &[u8],
        pub_dress: &str,
        now: u64,
        objection_window_seconds: u64,
        outcome: ActivationRequestStatus,
        activate_requester: bool,
    ) -> Result<bool, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let Some(row) = sqlx::query(
            "SELECT id, pub_dress, requester_token_hash, client_label, status, \
                    responds_by, objection_deadline, credential_authenticated \
             FROM session_activation_requests \
             WHERE id = ? AND pub_dress = ?",
        )
        .bind(id)
        .bind(pub_dress)
        .fetch_optional(&mut *transaction)
        .await?
        else {
            transaction.commit().await?;
            return Ok(false);
        };
        let request = decode_activation_request(&row)?;
        let request =
            advance_activation_request(&mut transaction, request, now, objection_window_seconds).await?;
        if !matches!(
            request.status,
            ActivationRequestStatus::Pending | ActivationRequestStatus::Objectable
        ) {
            transaction.commit().await?;
            return Ok(false);
        }
        if activate_requester {
            let activated =
                activate_session_in(&mut transaction, pub_dress, &request.requester_token_hash, now)
                    .await?;
            if !activated {
                sqlx::query(
                    "UPDATE session_activation_requests SET status = 'expired', resolved_at = ? \
                     WHERE id = ? AND status IN ('pending', 'objectable')",
                )
                .bind(now as i64)
                .bind(id)
                .execute(&mut *transaction)
                .await?;
                expire_open_activation_requests(&mut transaction, pub_dress, Some(id), now).await?;
                transaction.commit().await?;
                return Ok(false);
            }
        }
        let status_literal = match outcome {
            ActivationRequestStatus::Accepted => "accepted",
            ActivationRequestStatus::Declined => "declined",
            _ => unreachable!("resolve_activation_request only accepts or declines"),
        };
        sqlx::query(
            "UPDATE session_activation_requests SET status = ?, resolved_at = ? WHERE id = ?",
        )
        .bind(status_literal)
        .bind(now as i64)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        expire_open_activation_requests(&mut transaction, pub_dress, Some(id), now).await?;
        transaction.commit().await?;
        Ok(true)
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

/// Makes `requester_token_hash` the one active session for `pub_dress` and
/// deactivates whichever session was active. The deactivated session is not
/// revoked: it stays signed in, only no longer able to act for the Bond.
///
/// Returns false, and changes nothing, when the requester is not a live
/// session (missing, revoked, expired, or an empty hash). Deactivating the
/// real client first would leave the Bond with nobody active.
async fn activate_session_in(
    transaction: &mut Transaction<'_, Sqlite>,
    pub_dress: &str,
    requester_token_hash: &[u8],
    now: u64,
) -> Result<bool, sqlx::Error> {
    let live = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM native_sessions \
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?)",
    )
    .bind(requester_token_hash)
    .bind(now as i64)
    .fetch_one(&mut **transaction)
    .await?;
    if !live {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE native_sessions SET active = 0 \
         WHERE pub_dress = ? AND active = 1 AND revoked_at IS NULL AND expires_at > ? \
         AND token_hash != ?",
    )
    .bind(pub_dress)
    .bind(now as i64)
    .bind(requester_token_hash)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "UPDATE native_sessions SET active = 1 \
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .bind(requester_token_hash)
    .bind(now as i64)
    .execute(&mut **transaction)
    .await?;
    Ok(true)
}

/// Expires every open request for `pub_dress`, optionally keeping `except_id`.
/// Accept, decline, object, and a newer create all call this so a sibling
/// left pending cannot later activate itself through its own status read.
async fn expire_open_activation_requests(
    transaction: &mut Transaction<'_, Sqlite>,
    pub_dress: &str,
    except_id: Option<&[u8]>,
    now: u64,
) -> Result<(), sqlx::Error> {
    match except_id {
        Some(id) => {
            sqlx::query(
                "UPDATE session_activation_requests SET status = 'expired', resolved_at = ? \
                 WHERE pub_dress = ? AND id != ? AND status IN ('pending', 'objectable')",
            )
            .bind(now as i64)
            .bind(pub_dress)
            .bind(id)
            .execute(&mut **transaction)
            .await?;
        }
        None => {
            sqlx::query(
                "UPDATE session_activation_requests SET status = 'expired', resolved_at = ? \
                 WHERE pub_dress = ? AND status IN ('pending', 'objectable')",
            )
            .bind(now as i64)
            .bind(pub_dress)
            .execute(&mut **transaction)
            .await?;
        }
    }
    Ok(())
}

fn decode_activation_request(row: &sqlx::sqlite::SqliteRow) -> Result<ActivationRequest, RepositoryError> {
    let status = match row.get::<String, _>("status").as_str() {
        "pending" => ActivationRequestStatus::Pending,
        "objectable" => ActivationRequestStatus::Objectable,
        "accepted" => ActivationRequestStatus::Accepted,
        "declined" => ActivationRequestStatus::Declined,
        "objected" => ActivationRequestStatus::Objected,
        "expired" => ActivationRequestStatus::Expired,
        _ => return Err(RepositoryError::CorruptActivationRequestStatus),
    };
    Ok(ActivationRequest {
        id: row.get("id"),
        pub_dress: row.get("pub_dress"),
        requester_token_hash: row.get("requester_token_hash"),
        client_label: row.get("client_label"),
        credential_authenticated: row.get::<i64, _>("credential_authenticated") == 1,
        status,
        responds_by: row.get::<i64, _>("responds_by") as u64,
        objection_deadline: row
            .get::<Option<i64>, _>("objection_deadline")
            .map(|value| value as u64),
    })
}

/// Applies the lazy `pending` -> `objectable` -> `accepted` transitions this
/// request is due for as of `now`, persisting whichever transition(s) apply,
/// and returns the request in its now-current state. There is no background
/// sweep; every read or action on a request passes through here first, so
/// nothing observes a state this function would have already advanced past.
async fn advance_activation_request(
    transaction: &mut Transaction<'_, Sqlite>,
    request: ActivationRequest,
    now: u64,
    objection_window_seconds: u64,
) -> Result<ActivationRequest, RepositoryError> {
    if request.status == ActivationRequestStatus::Pending && now >= request.responds_by {
        // Route 3 is only for a credential-authenticated requester. Host
        // material (Telegram initData, Discord, GitHub, browser OAuth) is
        // not the long-lived credential: an unanswered request expires and
        // the active client stays active.
        if !request.credential_authenticated {
            sqlx::query(
                "UPDATE session_activation_requests SET status = 'expired', resolved_at = ? \
                 WHERE id = ? AND status = 'pending'",
            )
            .bind(now as i64)
            .bind(&request.id)
            .execute(&mut **transaction)
            .await?;
            return Ok(ActivationRequest {
                status: ActivationRequestStatus::Expired,
                ..request
            });
        }
        // Anchor the objection window at responds_by, not at this read.
        // A late poll must not extend the window by however long the
        // requester waited to ask.
        let objection_deadline = request.responds_by.saturating_add(objection_window_seconds);
        sqlx::query(
            "UPDATE session_activation_requests \
             SET status = 'objectable', objection_deadline = ? \
             WHERE id = ? AND status = 'pending'",
        )
        .bind(objection_deadline as i64)
        .bind(&request.id)
        .execute(&mut **transaction)
        .await?;
        return Box::pin(advance_activation_request(
            transaction,
            ActivationRequest {
                status: ActivationRequestStatus::Objectable,
                objection_deadline: Some(objection_deadline),
                ..request
            },
            now,
            objection_window_seconds,
        ))
        .await;
    }
    if request.status == ActivationRequestStatus::Objectable
        && request.objection_deadline.is_some_and(|deadline| now >= deadline)
    {
        let activated = activate_session_in(
            transaction,
            &request.pub_dress,
            &request.requester_token_hash,
            now,
        )
        .await?;
        if !activated {
            sqlx::query(
                "UPDATE session_activation_requests SET status = 'expired', resolved_at = ? \
                 WHERE id = ? AND status = 'objectable'",
            )
            .bind(now as i64)
            .bind(&request.id)
            .execute(&mut **transaction)
            .await?;
            return Ok(ActivationRequest {
                status: ActivationRequestStatus::Expired,
                ..request
            });
        }
        sqlx::query(
            "UPDATE session_activation_requests SET status = 'accepted', resolved_at = ? \
             WHERE id = ? AND status = 'objectable'",
        )
        .bind(now as i64)
        .bind(&request.id)
        .execute(&mut **transaction)
        .await?;
        return Ok(ActivationRequest {
            status: ActivationRequestStatus::Accepted,
            ..request
        });
    }
    Ok(request)
}

/// A closed device-and-host label for a session. The raw User-Agent is never
/// stored. Spec examples look like `iPhone · Safari`. `host` is the minting
/// host (`Telegram`, `Discord`, `GitHub`) or `Browser` when the browser
/// itself is the host, in which case the browser name takes that place.
pub fn session_client_label(host: &str, user_agent: Option<&str>) -> String {
    let user_agent = user_agent.unwrap_or("");
    let device = classify_client_device(user_agent);
    let browser = classify_client_browser(user_agent);
    let host_part = if host.eq_ignore_ascii_case("browser") || host.is_empty() {
        browser.unwrap_or("Browser")
    } else {
        host
    };
    let label = match device {
        Some(device) => format!("{device} · {host_part}"),
        None => host_part.to_owned(),
    };
    bounded_client_label(label)
}

fn classify_client_device(user_agent: &str) -> Option<&'static str> {
    let user_agent = ascii_prefix(user_agent, 512).to_ascii_lowercase();
    if user_agent.contains("iphone") {
        Some("iPhone")
    } else if user_agent.contains("ipad") {
        Some("iPad")
    } else if user_agent.contains("android") {
        Some("Android")
    } else if user_agent.contains("cros") {
        Some("Chromebook")
    } else if user_agent.contains("macintosh") || user_agent.contains("mac os x") {
        Some("Mac")
    } else if user_agent.contains("windows") {
        Some("Windows")
    } else if user_agent.contains("linux") {
        Some("Linux")
    } else {
        None
    }
}

fn classify_client_browser(user_agent: &str) -> Option<&'static str> {
    let user_agent = ascii_prefix(user_agent, 512).to_ascii_lowercase();
    if user_agent.contains("edg/") || user_agent.contains("edga/") || user_agent.contains("edge/") {
        Some("Edge")
    } else if user_agent.contains("chrome/") || user_agent.contains("crios/") {
        Some("Chrome")
    } else if user_agent.contains("firefox/") || user_agent.contains("fxios/") {
        Some("Firefox")
    } else if user_agent.contains("safari/") {
        Some("Safari")
    } else {
        None
    }
}

fn ascii_prefix(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn bounded_client_label(label: String) -> String {
    const MAX_BYTES: usize = 80;
    if label.len() <= MAX_BYTES {
        return label;
    }
    let mut end = MAX_BYTES;
    while !label.is_char_boundary(end) {
        end -= 1;
    }
    label[..end].to_owned()
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
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PubDressRenameOutcome {
    Renamed(IdentityRecord),
    /// Another identity — human or Avaia — already holds the requested address.
    Unavailable,
    /// The Avaia address the new owner address derives belongs to someone else.
    AvaiaUnavailable,
    /// The owner has not created an Avaia yet, so there is nothing to name.
    AvaiaMissing,
    /// The address the caller presented is no longer a human Bond.
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistrationOutcome {
    Registered(IdentityRecord),
    AlreadyRegistered(IdentityRecord),
    HandleUnavailable,
    PublicLabelUnavailable,
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("identity storage failed: {0}")]
    Storage(#[from] sqlx::Error),
    #[error("stored human pub_dress is invalid")]
    CorruptHumanPubDress,
    #[error("stored public-label suffix is invalid for this pub_dress")]
    CorruptPublicLabelSuffix,
    #[error("stored Avaia location violates its contract")]
    CorruptAvaiaLocation,
    #[error("stored Bond role is not a known role")]
    CorruptBondRole,
    #[error("stored activation request status is not a known status")]
    CorruptActivationRequestStatus,
    #[error("stored pub_info experience is not a known total")]
    CorruptPubInfo,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{
        IdentityRepository, NativeRegistrationOutcome, ProviderIdentity, PubDressRenameOutcome,
        RegistrationOutcome,
    };
    use crate::{AvaiaPubDress, PubDress, PubDressLabel};

    #[tokio::test]
    async fn fourth_avatar_upgrade_preserves_existing_identities_and_provider_bindings() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("legacy-avatars.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let options = sqlx::sqlite::SqliteConnectOptions::from_str(&database_url)
            .expect("database URL")
            .create_if_missing(true)
            .foreign_keys(true);
        let legacy = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("legacy connection");
        for migration in [
            include_str!("../migrations/0001_identities.sql"),
            include_str!("../migrations/0002_provider_accounts.sql"),
            include_str!("../migrations/0003_native_auth.sql"),
            include_str!("../migrations/0004_owned_avaia_identity.sql"),
            include_str!("../migrations/0005_avatar_model.sql"),
            include_str!("../migrations/0006_pub_dress_label.sql"),
        ] {
            sqlx::raw_sql(migration)
                .execute(&legacy)
                .await
                .expect("historical migration");
        }
        sqlx::raw_sql(
            "INSERT INTO identities (pub_dress, avatar_model) VALUES ('0x0Sky', 'dasha-study');
             INSERT INTO identities (pub_dress, identity_kind, owner_pub_dress)
                 VALUES ('0Skai', 'avaia', '0x0Sky');
             INSERT INTO identity_providers (provider, provider_subject, pub_dress)
                 VALUES ('telegram', '12345', '0x0Sky');",
        )
        .execute(&legacy)
        .await
        .expect("legacy data");
        legacy.close().await;

        let address = "0x0Sky";
        let repository = IdentityRepository::connect(&database_url)
            .await
            .expect("upgrade");
        assert_eq!(
            repository.avatar_model(address).await.expect("old choice"),
            Some("dasha-study".to_owned())
        );
        repository
            .set_avatar_model(address, "dasha-v2-study")
            .await
            .expect("fourth choice accepted");
        assert!(
            repository
                .set_avatar_model(address, "not-published")
                .await
                .is_err()
        );
        repository.pool.close().await;

        let reopened = IdentityRepository::connect(&database_url)
            .await
            .expect("idempotent reopen");
        assert_eq!(
            reopened.avatar_model(address).await.expect("new choice"),
            Some("dasha-v2-study".to_owned())
        );
        let owner: String = sqlx::query_scalar(
            "SELECT owner_pub_dress FROM identities WHERE pub_dress = 'x0Skai'",
        )
        .fetch_one(&reopened.pool)
        .await
        .expect("owned identity survives");
        assert_eq!(owner, "0x0Sky");
        let provider: String = sqlx::query_scalar(
            "SELECT pub_dress FROM identity_providers WHERE provider_subject = '12345'",
        )
        .fetch_one(&reopened.pool)
        .await
        .expect("provider survives");
        assert_eq!(provider, "0x0Sky");
        assert!(
            sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&reopened.pool)
                .await
                .expect("foreign key check")
                .is_empty()
        );
    }

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
    async fn provider_registration_creates_only_the_human_bond() {
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
                if record.pub_dress == "0xda-sha." && record.avaia_pub_dress.is_none()
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
    async fn provider_registration_is_not_gated_on_the_default_avaia_address() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let occupying_owner = PubDress::from_str("0x0sky").expect("valid first owner");
        repository
            .register(&occupying_owner, &ProviderIdentity::telegram(10), 100)
            .await
            .expect("occupying registration");
        let occupied = AvaiaPubDress::derive_default(&occupying_owner);
        repository
            .configure_owned_avaia(&occupying_owner, &occupied, 100)
            .await
            .expect("explicit Avaia creation");

        // Core deliberately maps both `sky` and `sk` to the same default
        // Avaia stem. Registration creates no Avaia, so that collision is no
        // longer a reason to refuse the human Bond.
        let candidate_owner = PubDress::from_str("0x0sk").expect("valid second owner");
        assert_eq!(occupied, AvaiaPubDress::derive_default(&candidate_owner));
        let registered = repository
            .register(&candidate_owner, &ProviderIdentity::discord("20"), 101)
            .await
            .expect("registration");
        assert!(matches!(
            registered,
            RegistrationOutcome::Registered(ref record) if record.avaia_pub_dress.is_none()
        ));
    }

    #[tokio::test]
    async fn repeated_provider_registration_reports_no_avaia_it_did_not_create() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let owner = PubDress::from_str("0x0sky").expect("valid owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(11), 100)
            .await
            .expect("registration");
        let again = repository
            .register(&owner, &ProviderIdentity::telegram(11), 101)
            .await
            .expect("repeated registration");
        assert!(matches!(
            again,
            RegistrationOutcome::AlreadyRegistered(ref record) if record.avaia_pub_dress.is_none()
        ));
        assert_eq!(
            repository.owned_avaia_identity(&owner).await.expect("read"),
            None
        );
    }

    #[tokio::test]
    async fn renaming_a_bond_without_an_avaia_creates_none() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let current = PubDress::from_str("0x0sky").expect("valid owner");
        let next = PubDress::from_str("0x0mira").expect("valid next");
        repository
            .register(&current, &ProviderIdentity::telegram(12), 100)
            .await
            .expect("registration");
        let renamed = repository
            .rename_pub_dress(&current, &next)
            .await
            .expect("rename");
        assert!(matches!(
            renamed,
            PubDressRenameOutcome::Renamed(ref record) if record.avaia_pub_dress.is_none()
        ));
    }

    #[tokio::test]
    async fn naming_an_avaia_that_does_not_exist_is_refused() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        let owner = PubDress::from_str("0x0sky").expect("valid owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(13), 100)
            .await
            .expect("registration");
        let next = AvaiaPubDress::from_str("x0newai").expect("valid Avaia");
        assert_eq!(
            repository
                .rename_owned_avaia(&owner, &next)
                .await
                .expect("rename"),
            PubDressRenameOutcome::AvaiaMissing
        );
        assert_eq!(
            repository.owned_avaia_identity(&owner).await.expect("read"),
            None
        );
    }

    #[tokio::test]
    async fn pre_amendment_human_is_resolved_without_gaining_an_avaia() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository must initialize");
        sqlx::query("INSERT INTO identities (pub_dress) VALUES ('0xda-sha.')")
            .execute(&repository.pool)
            .await
            .expect("legacy human fixture");
        let address = PubDress::from_str("0xda-sha.").expect("valid pub_dress");

        let resolved = repository
            .resolve_human_identity(&address)
            .await
            .expect("resolution")
            .expect("human exists");
        assert_eq!(resolved.pub_dress, "0xda-sha.");
        assert_eq!(resolved.avaia_pub_dress, None);
        let avaia_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM identities WHERE identity_kind = 'avaia'",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("count");
        assert_eq!(avaia_count, 0);
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
        assert_eq!(telegram.avaia_pub_dress, None);
        assert_eq!(
            telegram.readable_url("nilx.one").as_deref(),
            Some("https://0x0sky.nilx.one")
        );
        assert!(matches!(
            repository
                .register(&discord_address, &ProviderIdentity::discord("42"), 101)
                .await,
            Ok(RegistrationOutcome::AlreadyRegistered(record))
                if record.pub_dress == "0x7sky" && record.avaia_pub_dress.is_none()
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
                if record.avaia_pub_dress.is_none()
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
                .avaia_pub_dress,
            None
        );
    }

    #[tokio::test]
    async fn native_idempotency_replays_without_creating_an_avaia() {
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
                if record.avaia_pub_dress.is_none()
                    && record.pub_dress_label.as_deref() == Some("0x0sky")
        ));
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM identities WHERE identity_kind = 'avaia' AND owner_pub_dress = '0x0sky'",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("count");
        assert_eq!(count, 0);
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
        let avaia = AvaiaPubDress::from_str("x0skai").expect("valid Avaia");
        repository
            .configure_owned_avaia(&address, &avaia, 101)
            .await
            .expect("explicit Avaia creation");
        repository
            .create_native_session(b"session", "0x0sky", 101, 200, "test", false, None)
            .await
            .expect("session");
        let session = repository
            .find_native_session(b"session", 199)
            .await
            .expect("session lookup")
            .expect("active session");
        assert_eq!(session.avaia_pub_dress.as_deref(), Some("x0skai"));
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

    #[test]
    fn session_labels_name_a_device_and_host_from_a_closed_set() {
        let iphone_safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) \
             AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(
            super::session_client_label("Browser", Some(iphone_safari)),
            "iPhone · Safari"
        );
        let android_chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
        assert_eq!(
            super::session_client_label("Browser", Some(android_chrome)),
            "Android · Chrome"
        );
        let windows_edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
        assert_eq!(
            super::session_client_label("Browser", Some(windows_edge)),
            "Windows · Edge"
        );
        assert_eq!(
            super::session_client_label("Telegram", Some(iphone_safari)),
            "iPhone · Telegram"
        );
        assert_eq!(super::session_client_label("Telegram", None), "Telegram");
        assert_eq!(super::session_client_label("Browser", None), "Browser");
        assert!(!super::session_client_label("Browser", Some(iphone_safari)).contains("Mozilla"));
    }

    #[tokio::test]
    async fn re_login_on_the_presented_session_stays_active() {
        let repository = registered_repository().await;
        assert!(
            repository
                .create_native_session(b"first", "0x0sky", 101, 10_000, "Mac · Safari", true, None)
                .await
                .expect("first session")
        );
        assert!(
            repository
                .create_native_session(
                    b"second",
                    "0x0sky",
                    102,
                    10_000,
                    "Mac · Safari",
                    true,
                    Some(b"first"),
                )
                .await
                .expect("same-browser re-login")
        );
        assert_eq!(
            repository
                .find_native_session(b"first", 102)
                .await
                .expect("lookup"),
            None
        );
        let (_, active) = repository
            .find_native_session_with_activity(b"second", 102)
            .await
            .expect("lookup")
            .expect("live session");
        assert!(active);
    }

    #[tokio::test]
    async fn a_revoked_requester_cannot_deactivate_the_live_session() {
        let repository = registered_repository().await;
        assert!(
            repository
                .create_native_session(b"active", "0x0sky", 101, 10_000, "A", false, None)
                .await
                .expect("active session")
        );
        assert!(
            !repository
                .create_native_session(b"inactive", "0x0sky", 102, 10_000, "B", false, None)
                .await
                .expect("inactive session")
        );
        repository
            .create_activation_request(b"req", "0x0sky", b"inactive", "B", 102, 500)
            .await
            .expect("request");
        repository
            .revoke_native_session(b"inactive", 103)
            .await
            .expect("revoke requester");
        assert!(
            !repository
                .accept_activation_request(b"req", "0x0sky", 150, 86_400)
                .await
                .expect("accept")
        );
        let (_, still_active) = repository
            .find_native_session_with_activity(b"active", 150)
            .await
            .expect("lookup")
            .expect("the original session is still live");
        assert!(still_active);
    }

    async fn registered_repository() -> super::IdentityRepository {
        let repository = super::IdentityRepository::connect("sqlite::memory:")
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
    }
}
