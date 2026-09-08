// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};

use crate::{ProviderIdentity, PubDress};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderLinkOutcome {
    Linked,
    AlreadyLinked,
    ProviderAlreadyLinked,
    IdentityMissing,
}

/// Persistence boundary for attaching an already-verified external provider to
/// an already-authenticated human Bond. It deliberately cannot create either
/// side of the relationship: provider proof and Bond authentication happen
/// before this adapter is called.
#[derive(Clone, Debug)]
pub struct ProviderLinkRepository {
    pool: SqlitePool,
}

impl ProviderLinkRepository {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let max_connections = if database_url.contains(":memory:") { 1 } else { 5 };
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(false)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    pub async fn link(
        &self,
        pub_dress: &PubDress,
        provider: &ProviderIdentity,
    ) -> Result<ProviderLinkOutcome, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let human_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM identities WHERE pub_dress = ? AND identity_kind = 'human')",
        )
        .bind(pub_dress.as_str())
        .fetch_one(&mut *transaction)
        .await?;
        if !human_exists {
            transaction.rollback().await?;
            return Ok(ProviderLinkOutcome::IdentityMissing);
        }

        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = ? AND provider_subject = ?",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .fetch_optional(&mut *transaction)
        .await?
        {
            transaction.commit().await?;
            return Ok(if existing_pub_dress == pub_dress.as_str() {
                ProviderLinkOutcome::AlreadyLinked
            } else {
                ProviderLinkOutcome::ProviderAlreadyLinked
            });
        }

        let insert = sqlx::query(
            "INSERT INTO identity_providers (provider, provider_subject, pub_dress) \
             VALUES (?, ?, ?) ON CONFLICT(provider, provider_subject) DO NOTHING",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .bind(pub_dress.as_str())
        .execute(&mut *transaction)
        .await?;
        if insert.rows_affected() == 1 {
            transaction.commit().await?;
            return Ok(ProviderLinkOutcome::Linked);
        }

        // A concurrent callback may have claimed the provider between the
        // lookup and insert. Re-read the authoritative binding before deciding.
        let existing_pub_dress = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = ? AND provider_subject = ?",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .fetch_optional(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(match existing_pub_dress.as_deref() {
            Some(value) if value == pub_dress.as_str() => ProviderLinkOutcome::AlreadyLinked,
            Some(_) => ProviderLinkOutcome::ProviderAlreadyLinked,
            None => ProviderLinkOutcome::IdentityMissing,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{ProviderLinkOutcome, ProviderLinkRepository};
    use crate::{IdentityRepository, ProviderIdentity, PubDress};

    #[tokio::test]
    async fn verified_provider_can_only_link_to_an_existing_human_bond() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let bond = PubDress::from_str("0x0sky").expect("valid Bond");
        identities
            .register_native(
                &bond,
                "hash",
                1,
                b"recovery",
                b"challenge",
                b"idempotency",
                100,
                200,
            )
            .await
            .expect("native Bond registration");

        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::telegram(42))
                .await
                .expect("link"),
            ProviderLinkOutcome::Linked
        );
        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::telegram(42))
                .await
                .expect("idempotent link"),
            ProviderLinkOutcome::AlreadyLinked
        );
        assert_eq!(
            identities
                .find_by_provider(&ProviderIdentity::telegram(42))
                .await
                .expect("provider lookup")
                .expect("bound identity")
                .pub_dress,
            "0x0sky"
        );
    }

    #[tokio::test]
    async fn provider_binding_cannot_be_moved_between_bonds() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let first = PubDress::from_str("0x0sky").expect("valid first Bond");
        let second = PubDress::from_str("0x1sky").expect("valid second Bond");
        identities
            .register_native(
                &first,
                "hash",
                1,
                b"recovery-1",
                b"challenge-1",
                b"idempotency-1",
                100,
                200,
            )
            .await
            .expect("first Bond registration");
        identities
            .register_native(
                &second,
                "hash",
                1,
                b"recovery-2",
                b"challenge-2",
                b"idempotency-2",
                101,
                201,
            )
            .await
            .expect("second Bond registration");
        let provider = ProviderIdentity::discord("42");
        assert_eq!(
            links.link(&first, &provider).await.expect("first link"),
            ProviderLinkOutcome::Linked
        );
        assert_eq!(
            links.link(&second, &provider).await.expect("second link"),
            ProviderLinkOutcome::ProviderAlreadyLinked
        );
    }
}
