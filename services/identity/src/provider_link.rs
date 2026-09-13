// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::str::FromStr;

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};

use crate::{IdentityProvider, ProviderIdentity, PubDress};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderLinkOutcome {
    Linked,
    AlreadyLinked,
    ProviderAlreadyLinked,
    ProviderTypeAlreadyLinked,
    IdentityMissing,
}

#[derive(Clone, Debug)]
pub struct ProviderLinkRepository {
    pool: SqlitePool,
}

impl ProviderLinkRepository {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let max_connections = if database_url.contains(":memory:") {
            1
        } else {
            5
        };
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(false)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        sqlx::raw_sql(include_str!(
            "../migrations/0011_provider_type_cardinality.sql"
        ))
        .execute(&pool)
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

        let evidence_table_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'github_evidence_connections')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if provider.provider == IdentityProvider::Github && evidence_table_exists {
            if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
                "SELECT pub_dress FROM github_evidence_connections WHERE github_user_id = ?",
            )
            .bind(&provider.subject)
            .fetch_optional(&mut *transaction)
            .await?
                && existing_pub_dress != pub_dress.as_str()
            {
                transaction.commit().await?;
                return Ok(ProviderLinkOutcome::ProviderAlreadyLinked);
            }
            if let Some(existing_subject) = sqlx::query_scalar::<_, String>(
                "SELECT github_user_id FROM github_evidence_connections WHERE pub_dress = ?",
            )
            .bind(pub_dress.as_str())
            .fetch_optional(&mut *transaction)
            .await?
                && existing_subject != provider.subject
            {
                transaction.commit().await?;
                return Ok(ProviderLinkOutcome::ProviderTypeAlreadyLinked);
            }
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

        let same_provider_subject = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = ? LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .bind(provider.provider.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        if same_provider_subject.is_some() {
            transaction.commit().await?;
            return Ok(ProviderLinkOutcome::ProviderTypeAlreadyLinked);
        }

        let insert = sqlx::query(
            "INSERT INTO identity_providers (provider, provider_subject, pub_dress) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
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

        let existing_pub_dress = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = ? AND provider_subject = ?",
        )
        .bind(provider.provider.as_str())
        .bind(&provider.subject)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(existing_pub_dress) = existing_pub_dress {
            transaction.commit().await?;
            return Ok(if existing_pub_dress == pub_dress.as_str() {
                ProviderLinkOutcome::AlreadyLinked
            } else {
                ProviderLinkOutcome::ProviderAlreadyLinked
            });
        }

        let same_provider_subject = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = ? LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .bind(provider.provider.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(if same_provider_subject.is_some() {
            ProviderLinkOutcome::ProviderTypeAlreadyLinked
        } else {
            ProviderLinkOutcome::IdentityMissing
        })
    }

    pub async fn list(&self, pub_dress: &PubDress) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar::<_, String>(
            "SELECT provider FROM identity_providers WHERE pub_dress = ? ORDER BY CASE provider WHEN 'telegram' THEN 0 WHEN 'discord' THEN 1 WHEN 'github' THEN 2 ELSE 99 END",
        )
        .bind(pub_dress.as_str())
        .fetch_all(&self.pool)
        .await
    }

    pub async fn unlink(
        &self,
        pub_dress: &PubDress,
        provider: IdentityProvider,
    ) -> Result<bool, sqlx::Error> {
        let deleted =
            sqlx::query("DELETE FROM identity_providers WHERE pub_dress = ? AND provider = ?")
                .bind(pub_dress.as_str())
                .bind(provider.as_str())
                .execute(&self.pool)
                .await?;
        Ok(deleted.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{ProviderLinkOutcome, ProviderLinkRepository};
    use crate::{
        GithubEvidenceRepository, IdentityProvider, IdentityRepository, ProviderIdentity, PubDress,
    };

    async fn register_bond(
        identities: &IdentityRepository,
        pub_dress: &str,
        seed: &str,
    ) -> PubDress {
        let bond = PubDress::from_str(pub_dress).expect("valid Bond");
        identities
            .register_native(
                &bond,
                "hash",
                1,
                format!("recovery-{seed}").as_bytes(),
                format!("challenge-{seed}").as_bytes(),
                format!("idempotency-{seed}").as_bytes(),
                100,
                200,
            )
            .await
            .expect("native Bond registration");
        bond
    }

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
        let bond = register_bond(&identities, "0x0sky", "first").await;

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
        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::github(75973992))
                .await
                .expect("GitHub link"),
            ProviderLinkOutcome::Linked
        );
        assert_eq!(
            links.list(&bond).await.expect("provider list"),
            vec!["telegram".to_owned(), "github".to_owned()]
        );
    }

    #[tokio::test]
    async fn one_bond_has_one_account_per_provider_type_and_can_disconnect_it() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let bond = register_bond(&identities, "0x0sky", "one-provider").await;

        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::github(1))
                .await
                .expect("first GitHub link"),
            ProviderLinkOutcome::Linked
        );
        assert_eq!(
            links
                .link(&bond, &ProviderIdentity::github(2))
                .await
                .expect("second GitHub link"),
            ProviderLinkOutcome::ProviderTypeAlreadyLinked
        );
        assert_eq!(
            links.list(&bond).await.expect("provider list"),
            vec!["github".to_owned()]
        );
        assert!(
            links
                .unlink(&bond, IdentityProvider::Github)
                .await
                .expect("unlink")
        );
        assert!(links.list(&bond).await.expect("provider list").is_empty());
        assert!(
            !links
                .unlink(&bond, IdentityProvider::Github)
                .await
                .expect("idempotent absence")
        );
    }

    #[tokio::test]
    async fn github_provider_binding_cannot_drift_from_existing_evidence_account() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let _evidence = GithubEvidenceRepository::connect(&database_url)
            .await
            .expect("GitHub evidence repository");
        let first = register_bond(&identities, "0x0sky", "evidence-first").await;
        let second = register_bond(&identities, "0x1sky", "evidence-second").await;

        sqlx::query(
            "INSERT INTO github_evidence_connections \
             (pub_dress, github_user_id, login, profile_url, avatar_url, encrypted_access_token, connection_state, connected_at, refreshed_at) \
             VALUES (?, '42', 'evidence-user', 'https://github.com/evidence-user', 'https://avatars.example/42', X'01', 'connected', 1, 1)",
        )
        .bind(first.as_str())
        .execute(&links.pool)
        .await
        .expect("evidence fixture");

        assert_eq!(
            links
                .link(&first, &ProviderIdentity::github(43))
                .await
                .expect("different account for evidence owner"),
            ProviderLinkOutcome::ProviderTypeAlreadyLinked
        );
        assert_eq!(
            links
                .link(&second, &ProviderIdentity::github(42))
                .await
                .expect("evidence account on another Bond"),
            ProviderLinkOutcome::ProviderAlreadyLinked
        );
        assert_eq!(
            links
                .link(&first, &ProviderIdentity::github(42))
                .await
                .expect("matching account"),
            ProviderLinkOutcome::Linked
        );
    }

    #[tokio::test]
    async fn initialized_provider_link_storage_enforces_provider_type_cardinality_directly() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let bond = register_bond(&identities, "0x0sky", "db-boundary").await;

        links
            .link(&bond, &ProviderIdentity::github(1))
            .await
            .expect("first GitHub link");
        let duplicate = sqlx::query(
            "INSERT INTO identity_providers (provider, provider_subject, pub_dress) VALUES ('github', '2', ?)",
        )
        .bind(bond.as_str())
        .execute(&links.pool)
        .await;
        assert!(
            duplicate.is_err(),
            "database must reject a second GitHub account for one Bond"
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
        let first = register_bond(&identities, "0x0sky", "first").await;
        let second = register_bond(&identities, "0x1sky", "second").await;
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
