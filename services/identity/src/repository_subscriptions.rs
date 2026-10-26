// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Issuer-side persistence only. The caller must first authenticate to
// 0xda-market's issuer API and validate a *processing* order, its snapshot,
// linked recipient and SKU. No browser/user endpoint calls this operation.
//
// The purchase debits authoritative seeds and grants Special in one SQLite
// BEGIN IMMEDIATE transaction. Core SubscriptionClock handles time priority.
use nilxone_contracts::{SubscriptionClock, SubscriptionTier};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerSpecialOrderSnapshot {
    pub order_id: String,
    pub recipient_pub_dress: String,
    pub sku: String,
    pub price_id: u64,
    pub amount_minor: u64,
    /// Resolved by the trusted issuer adapter from an agreed term policy.
    /// A client's notion of a month or duration is never authoritative.
    pub duration_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialSeedsOutcome {
    /// The debit and Special grant were committed together.
    Granted,
    /// Exact replay of an already committed issuer operation.
    AlreadyGranted,
    /// No credited authoritative seeds exist (or not enough).
    InsufficientSeeds,
    /// Wrong product, recipient, invalid duration, or amount.
    InvalidTerms,
    /// Order id was committed under different immutable terms.
    ConflictingReplay,
}

impl IdentityRepository {
    /// Atomic debit and Special grant for a verified 0xda-market issuer order.
    ///
    /// This is **not** proof that the caller actually authenticated the issuer;
    /// the future private issuer worker must validate the processing snapshot
    /// using its issuer bearer credentials and enforce the SKU's term duration
    /// policy before invoking this method. It is deliberately not exposed as
    /// an HTTP endpoint or user action.
    pub async fn settle_special_seeds(
        &self,
        owner: &PubDress,
        order: &IssuerSpecialOrderSnapshot,
        now_ms: u64,
    ) -> Result<SpecialSeedsOutcome, RepositoryError> {
        let valid_order_id = (8..=128).contains(&order.order_id.len())
            && order.order_id.bytes().all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':' | b'.')
            });
        let valid_sku = matches!(
            order.sku.as_str(),
            "0x1_special_1m" | "0x1_special_3m" | "0x1_special_6m" | "0x1_special_12m"
        );
        if !valid_order_id
            || !valid_sku
            || order.recipient_pub_dress != owner.as_str()
            || order.price_id == 0
            || order.amount_minor == 0
            || order.duration_ms == 0
        {
            return Ok(SpecialSeedsOutcome::InvalidTerms);
        }
        let (Ok(now), Ok(amount), Ok(duration), Ok(price_id)) = (
            i64::try_from(now_ms),
            i64::try_from(order.amount_minor),
            i64::try_from(order.duration_ms),
            i64::try_from(order.price_id),
        ) else {
            return Ok(SpecialSeedsOutcome::InvalidTerms);
        };

        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;

        // Replay is checked first, before inspecting the current wallet or
        // clock: later legitimate operations must not invalidate this receipt.
        let prior = sqlx::query(
            "SELECT owner_pub_dress, sku, price_id, amount_minor, duration_ms \
             FROM bond_seed_subscription_debits WHERE order_id = ?",
        )
        .bind(&order.order_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(prior) = prior {
            let identical =
                prior.try_get::<String, _>("owner_pub_dress")? == owner.as_str()
                && prior.try_get::<String, _>("sku")? == order.sku
                && prior.try_get::<i64, _>("price_id")? == price_id
                && prior.try_get::<i64, _>("amount_minor")? == amount
                && prior.try_get::<i64, _>("duration_ms")? == duration;
            return Ok(if identical {
                SpecialSeedsOutcome::AlreadyGranted
            } else {
                SpecialSeedsOutcome::ConflictingReplay
            });
        }

        let balance = sqlx::query_scalar::<_, i64>(
            "SELECT balance FROM bond_seeds WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .fetch_optional(&mut *transaction)
        .await?
        .unwrap_or(0);
        if balance < amount {
            return Ok(SpecialSeedsOutcome::InsufficientSeeds);
        }

        let previous: Option<String> = sqlx::query_scalar(
            "SELECT clock_json FROM bond_subscription_clocks \
             WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        let clock = match previous {
            Some(json) => serde_json::from_str::<SubscriptionClock>(&json)
                .map_err(|_| RepositoryError::CorruptSubscriptionClock)?,
            None => SubscriptionClock::new(owner.as_str(), now_ms)
                .map_err(|_| RepositoryError::CorruptSubscriptionClock)?,
        };
        if clock.bond_pub_dress != owner.as_str() {
            return Err(RepositoryError::CorruptSubscriptionClock);
        }
        // A refusal (rollback/overflow/corruption) must never debit the buyer.
        let next = clock.grant(SubscriptionTier::Special, order.duration_ms, now_ms)
            .map_err(|_| RepositoryError::CorruptSubscriptionClock)?;
        let serialized = serde_json::to_string(&next)
            .map_err(|_| RepositoryError::CorruptSubscriptionClock)?;

        let debit = sqlx::query(
            "UPDATE bond_seeds SET balance = balance - ? \
             WHERE owner_pub_dress = ? AND balance >= ?",
        )
        .bind(amount)
        .bind(owner.as_str())
        .bind(amount)
        .execute(&mut *transaction)
        .await?;
        if debit.rows_affected() != 1 {
            return Ok(SpecialSeedsOutcome::InsufficientSeeds);
        }

        sqlx::query(
            "INSERT INTO bond_subscription_clocks (owner_pub_dress, clock_json) \
             VALUES (?, ?) \
             ON CONFLICT(owner_pub_dress) DO UPDATE SET clock_json = excluded.clock_json",
        )
        .bind(owner.as_str())
        .bind(serialized)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO bond_seed_subscription_debits \
             (order_id, owner_pub_dress, sku, price_id, amount_minor, duration_ms, committed_at_ms) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&order.order_id)
        .bind(owner.as_str())
        .bind(&order.sku)
        .bind(price_id)
        .bind(amount)
        .bind(duration)
        .bind(now)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(SpecialSeedsOutcome::Granted)
    }

    /// Read the authority's effective Core clock. This does not grant access
    /// by itself; authenticated snapshots still belong to the service layer.
    pub async fn read_subscription_clock(
        &self,
        owner: &PubDress,
        now_ms: u64,
    ) -> Result<SubscriptionClock, RepositoryError> {
        let json = sqlx::query_scalar::<_, String>(
            "SELECT clock_json FROM bond_subscription_clocks WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .fetch_optional(&self.pool)
        .await?;
        match json {
            Some(json) => {
                let clock = serde_json::from_str::<SubscriptionClock>(&json)
                    .map_err(|_| RepositoryError::CorruptSubscriptionClock)?;
                if clock.bond_pub_dress == owner.as_str() {
                    Ok(clock)
                } else {
                    Err(RepositoryError::CorruptSubscriptionClock)
                }
            }
            None => SubscriptionClock::new(owner.as_str(), now_ms)
                .map_err(|_| RepositoryError::CorruptSubscriptionClock),
        }
    }
}

#[cfg(test)]
mod special_seeds_tests {
    use super::*;

    async fn setup() -> (IdentityRepository, PubDress) {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("database");
        let owner: PubDress = "0x0sky".parse().expect("owner");
        sqlx::query(
            "INSERT INTO identities(pub_dress, identity_kind, created_at) \
             VALUES (?, 'human', 1)",
        )
        .bind(owner.as_str())
        .execute(&repository.pool)
        .await
        .expect("identity");
        (repository, owner)
    }

    fn order(id: &str) -> IssuerSpecialOrderSnapshot {
        IssuerSpecialOrderSnapshot {
            order_id: id.to_owned(),
            recipient_pub_dress: "0x0sky".to_owned(),
            sku: "0x1_special_1m".to_owned(),
            price_id: 42,
            amount_minor: 640,
            duration_ms: 30 * 24 * 60 * 60 * 1000,
        }
    }

    async fn fund_fixture(repository: &IdentityRepository, owner: &PubDress, amount: i64) {
        // Test-only setup, NOT a funding or import API. A live issuer must
        // receive credits exclusively from verified server-owned gameplay.
        sqlx::query("INSERT INTO bond_seeds(owner_pub_dress,balance) VALUES (?, ?)")
            .bind(owner.as_str())
            .bind(amount)
            .execute(&repository.pool)
            .await
            .expect("fixture balance");
    }

    #[tokio::test]
    async fn no_authoritative_seeds_means_no_purchase_or_grant() {
        let (repository, owner) = setup().await;
        assert_eq!(
            repository.settle_special_seeds(&owner, &order("order-no-funds"), 100).await.unwrap(),
            SpecialSeedsOutcome::InsufficientSeeds
        );
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM bond_seed_subscription_debits")
            .fetch_one(&repository.pool).await.unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            repository.read_subscription_clock(&owner, 100).await.unwrap().special_remaining_ms.get(),
            0
        );
    }

    #[tokio::test]
    async fn debit_grant_and_replay_are_atomic_and_once_only() {
        let (repository, owner) = setup().await;
        fund_fixture(&repository, &owner, 1000).await;
        let verified = order("order-verified-1");
        assert_eq!(
            repository.settle_special_seeds(&owner, &verified, 100).await.unwrap(),
            SpecialSeedsOutcome::Granted
        );
        assert_eq!(
            repository.settle_special_seeds(&owner, &verified, 200).await.unwrap(),
            SpecialSeedsOutcome::AlreadyGranted
        );
        let balance: i64 = sqlx::query_scalar(
            "SELECT balance FROM bond_seeds WHERE owner_pub_dress = ?",
        ).bind(owner.as_str()).fetch_one(&repository.pool).await.unwrap();
        assert_eq!(balance, 360);
        let clock = repository.read_subscription_clock(&owner, 200).await.unwrap();
        assert_eq!(clock.special_remaining_ms.get(), verified.duration_ms);
        assert_eq!(clock.settled_at_ms.get(), 100);

        let mut conflict = verified.clone();
        conflict.amount_minor += 1;
        assert_eq!(
            repository.settle_special_seeds(&owner, &conflict, 200).await.unwrap(),
            SpecialSeedsOutcome::ConflictingReplay
        );
    }

    #[tokio::test]
    async fn excludes_exclusive_and_rejects_recipient_mismatch() {
        let (repository, owner) = setup().await;
        fund_fixture(&repository, &owner, 5000).await;
        let mut invalid = order("order-invalid-1");
        invalid.sku = "0x1_exclusive_1m".to_owned();
        assert_eq!(
            repository.settle_special_seeds(&owner, &invalid, 100).await.unwrap(),
            SpecialSeedsOutcome::InvalidTerms
        );
        invalid.sku = "0x1_special_1m".to_owned();
        invalid.recipient_pub_dress = "0x0other".to_owned();
        assert_eq!(
            repository.settle_special_seeds(&owner, &invalid, 100).await.unwrap(),
            SpecialSeedsOutcome::InvalidTerms
        );
        assert_eq!(
            repository.read_subscription_clock(&owner, 100).await.unwrap().special_remaining_ms.get(),
            0
        );
    }

    #[tokio::test]
    async fn grant_during_exclusive_does_not_consume_paused_special() {
        let (repository, owner) = setup().await;
        fund_fixture(&repository, &owner, 1000).await;
        let exclusive = SubscriptionClock::new(owner.as_str(), 100)
            .unwrap().grant(SubscriptionTier::Exclusive, 5_000, 100).unwrap();
        sqlx::query(
            "INSERT INTO bond_subscription_clocks(owner_pub_dress,clock_json) VALUES (?, ?)",
        ).bind(owner.as_str())
         .bind(serde_json::to_string(&exclusive).unwrap())
         .execute(&repository.pool).await.unwrap();

        let purchase = order("order-paused-1");
        assert_eq!(
            repository.settle_special_seeds(&owner, &purchase, 200).await.unwrap(),
            SpecialSeedsOutcome::Granted
        );
        let clock = repository.read_subscription_clock(&owner, 200).await.unwrap();
        assert_eq!(clock.exclusive_remaining_ms.get(), 4900);
        assert_eq!(clock.special_remaining_ms.get(), purchase.duration_ms);
        assert_eq!(
            clock.snapshot(200, 500).unwrap().entitlement.unwrap().tier,
            SubscriptionTier::Exclusive
        );
    }

    #[tokio::test]
    async fn clock_failure_does_not_debit_or_record_an_order() {
        let (repository, owner) = setup().await;
        fund_fixture(&repository, &owner, 1000).await;
        let original = SubscriptionClock::new(owner.as_str(), 1_000).unwrap();
        sqlx::query(
            "INSERT INTO bond_subscription_clocks(owner_pub_dress,clock_json) VALUES (?, ?)",
        ).bind(owner.as_str())
         .bind(serde_json::to_string(&original).unwrap())
         .execute(&repository.pool).await.unwrap();
        assert!(matches!(
            repository.settle_special_seeds(&owner, &order("order-rollback"), 999).await,
            Err(RepositoryError::CorruptSubscriptionClock)
        ));
        let balance: i64 = sqlx::query_scalar(
            "SELECT balance FROM bond_seeds WHERE owner_pub_dress = ?",
        ).bind(owner.as_str()).fetch_one(&repository.pool).await.unwrap();
        assert_eq!(balance, 1000);
    }
}
