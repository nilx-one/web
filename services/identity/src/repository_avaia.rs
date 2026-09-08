// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AvaiaConfigurationState {
    Unconfigured,
    Configured,
}

impl AvaiaConfigurationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unconfigured => "unconfigured",
            Self::Configured => "configured",
        }
    }

    fn from_storage(value: &str) -> Option<Self> {
        match value {
            "unconfigured" => Some(Self::Unconfigured),
            "configured" => Some(Self::Configured),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AvaiaIdentityRecord {
    pub pub_dress: String,
    pub owner_pub_dress: String,
    pub configuration_state: AvaiaConfigurationState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AvaiaUpdateOutcome {
    Updated(AvaiaIdentityRecord),
    AvaiaUnavailable,
    OwnerDiscriminatorMismatch,
    Unknown,
}

impl IdentityRepository {
    /// Applies the additive Avaia-profile persistence migration. Production
    /// startup calls this before accepting registrations; profile operations
    /// also call it so older embedders remain safe and idempotent.
    pub async fn initialize_avaia_configuration(&self) -> Result<(), RepositoryError> {
        sqlx::raw_sql(include_str!("../migrations/0007_avaia_configuration.sql"))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn owned_avaia_identity(
        &self,
        owner: &PubDress,
    ) -> Result<Option<AvaiaIdentityRecord>, RepositoryError> {
        self.initialize_avaia_configuration().await?;
        let row = sqlx::query(
            "SELECT avaia_pub_dress, owner_pub_dress, configuration_state \
             FROM avaia_configuration WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .fetch_optional(&self.pool)
        .await?;
        row.map(avaia_identity_from_row).transpose()
    }

    /// Saves owner-controlled Avaia identity configuration. Identity existence
    /// and local AI runtime availability remain separate concerns.
    pub async fn configure_owned_avaia(
        &self,
        owner: &PubDress,
        next: &AvaiaPubDress,
        now: u64,
    ) -> Result<AvaiaUpdateOutcome, RepositoryError> {
        if next.owner_discriminator() != owner.discriminator() {
            return Ok(AvaiaUpdateOutcome::OwnerDiscriminatorMismatch);
        }

        self.initialize_avaia_configuration().await?;
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let human_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities \
             WHERE pub_dress = ? AND identity_kind = 'human')",
        )
        .bind(owner.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if !human_exists {
            transaction.rollback().await?;
            return Ok(AvaiaUpdateOutcome::Unknown);
        }

        if owned_avaia_for_owner_in(&mut transaction, owner.as_str())
            .await?
            .is_none()
        {
            let Some(_) = create_owned_avaia_in(&mut transaction, owner, now).await? else {
                transaction.rollback().await?;
                return Ok(AvaiaUpdateOutcome::AvaiaUnavailable);
            };
        }

        let Some(current) = avaia_identity_for_owner_in(&mut transaction, owner.as_str()).await?
        else {
            return Err(RepositoryError::Storage(sqlx::Error::RowNotFound));
        };
        if current.pub_dress == next.as_str() {
            sqlx::query(
                "UPDATE avaia_configuration SET configuration_state = 'configured' \
                 WHERE owner_pub_dress = ?",
            )
            .bind(owner.as_str())
            .execute(&mut *transaction)
            .await?;
            let Some(record) =
                avaia_identity_for_owner_in(&mut transaction, owner.as_str()).await?
            else {
                return Err(RepositoryError::Storage(sqlx::Error::RowNotFound));
            };
            transaction.commit().await?;
            return Ok(AvaiaUpdateOutcome::Updated(record));
        }

        // The identities primary key is the global public-address collision
        // boundary. UPDATE OR IGNORE keeps the operation atomic without a
        // check-then-update race; the sidecar key follows through its FK.
        let updated = sqlx::query(
            "UPDATE OR IGNORE identities SET pub_dress = ? \
             WHERE identity_kind = 'avaia' AND owner_pub_dress = ?",
        )
        .bind(next.as_str())
        .bind(owner.as_str())
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(AvaiaUpdateOutcome::AvaiaUnavailable);
        }

        sqlx::query(
            "UPDATE avaia_configuration SET configuration_state = 'configured' \
             WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .execute(&mut *transaction)
        .await?;
        let Some(record) = avaia_identity_for_owner_in(&mut transaction, owner.as_str()).await?
        else {
            return Err(RepositoryError::Storage(sqlx::Error::RowNotFound));
        };
        transaction.commit().await?;
        Ok(AvaiaUpdateOutcome::Updated(record))
    }
}

async fn avaia_identity_for_owner_in(
    transaction: &mut Transaction<'_, Sqlite>,
    owner_pub_dress: &str,
) -> Result<Option<AvaiaIdentityRecord>, RepositoryError> {
    let row = sqlx::query(
        "SELECT avaia_pub_dress, owner_pub_dress, configuration_state \
         FROM avaia_configuration WHERE owner_pub_dress = ?",
    )
    .bind(owner_pub_dress)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(avaia_identity_from_row).transpose()
}

fn avaia_identity_from_row(
    row: sqlx::sqlite::SqliteRow,
) -> Result<AvaiaIdentityRecord, RepositoryError> {
    let raw_state: String = row.get("configuration_state");
    let Some(configuration_state) = AvaiaConfigurationState::from_storage(&raw_state) else {
        return Err(RepositoryError::Storage(sqlx::Error::RowNotFound));
    };
    Ok(AvaiaIdentityRecord {
        pub_dress: row.get("avaia_pub_dress"),
        owner_pub_dress: row.get("owner_pub_dress"),
        configuration_state,
    })
}

#[cfg(test)]
mod avaia_configuration_tests {
    use super::*;

    #[tokio::test]
    async fn migration_backfills_existing_avaia_as_unconfigured() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let owner: PubDress = "0x0sky".parse().expect("owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(700), 100)
            .await
            .expect("registration");

        let profile = repository
            .owned_avaia_identity(&owner)
            .await
            .expect("profile")
            .expect("owned Avaia");
        assert_eq!(profile.pub_dress, "0skai");
        assert_eq!(profile.owner_pub_dress, "0x0sky");
        assert_eq!(
            profile.configuration_state,
            AvaiaConfigurationState::Unconfigured
        );
    }

    #[tokio::test]
    async fn initialized_schema_persists_unconfigured_at_avaia_creation() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        repository
            .initialize_avaia_configuration()
            .await
            .expect("migration");
        let owner: PubDress = "0x0mira".parse().expect("owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(701), 100)
            .await
            .expect("registration");

        let stored = sqlx::query_scalar::<_, String>(
            "SELECT configuration_state FROM avaia_configuration WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .fetch_one(&repository.pool)
        .await
        .expect("stored state");
        assert_eq!(stored, "unconfigured");
    }

    #[tokio::test]
    async fn first_save_and_replay_are_configured_and_idempotent() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        repository
            .initialize_avaia_configuration()
            .await
            .expect("migration");
        let owner: PubDress = "0x0sky".parse().expect("owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(702), 100)
            .await
            .expect("registration");
        let same: AvaiaPubDress = "0skai".parse().expect("Avaia");

        for now in [101, 102] {
            let outcome = repository
                .configure_owned_avaia(&owner, &same, now)
                .await
                .expect("save");
            assert!(matches!(
                outcome,
                AvaiaUpdateOutcome::Updated(ref record)
                    if record.pub_dress == "0skai"
                        && record.configuration_state == AvaiaConfigurationState::Configured
            ));
        }
    }

    #[tokio::test]
    async fn configuration_rejects_foreign_discriminator_and_global_collision() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        repository
            .initialize_avaia_configuration()
            .await
            .expect("migration");
        let owner: PubDress = "0x0sky".parse().expect("owner");
        let other: PubDress = "0x0mira".parse().expect("other");
        repository
            .register(&owner, &ProviderIdentity::telegram(703), 100)
            .await
            .expect("owner registration");
        repository
            .register(&other, &ProviderIdentity::discord("704"), 100)
            .await
            .expect("other registration");

        let wrong_owner: AvaiaPubDress = "1newai".parse().expect("other discriminator");
        assert!(matches!(
            repository
                .configure_owned_avaia(&owner, &wrong_owner, 101)
                .await,
            Ok(AvaiaUpdateOutcome::OwnerDiscriminatorMismatch)
        ));

        let occupied: AvaiaPubDress = "0mirai".parse().expect("occupied Avaia");
        assert!(matches!(
            repository.configure_owned_avaia(&owner, &occupied, 102).await,
            Ok(AvaiaUpdateOutcome::AvaiaUnavailable)
        ));
        let unchanged = repository
            .owned_avaia_identity(&owner)
            .await
            .expect("profile")
            .expect("owned Avaia");
        assert_eq!(unchanged.pub_dress, "0skai");
        assert_eq!(
            unchanged.configuration_state,
            AvaiaConfigurationState::Unconfigured
        );
    }
}
