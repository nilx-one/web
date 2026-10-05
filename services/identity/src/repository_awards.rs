// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/// The most device chains one Bond may hold: a bound on the table, not on how
/// many devices a person may own.
pub const MAX_EXPERIENCE_CHAINS: i64 = 32;

/// One committed award, validated and priced by the service
/// (docs/avaia-outings.md, R3). `id` is the commitment: an HMAC of a record
/// that stays on the device. Nothing here names a place, except `claim`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommittedAward {
    pub id: String,
    pub parent: Option<String>,
    pub chain: String,
    pub kind: &'static str,
    /// The pick-up's tier, `0` for a kind that has none.
    pub tier: u8,
    pub earner: ExperienceEarner,
    /// What the service priced it at. Never what a client asked for.
    pub amount: u64,
    /// The cap on this kind (and tier) per Bond per week.
    pub weekly_cap: u32,
    /// Set for a pick-up of a claimed tier: the find, as the service rolled it.
    pub claim: Option<FindClaim>,
}

/// A rare find a pick-up claims, as the service rolled it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FindClaim {
    pub artifact_sha: String,
    pub epoch: i64,
    pub tier: u8,
}

/// What became of one committed award.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AwardOutcome {
    /// Paid, and the chain's head moved to it.
    Accepted,
    /// Already paid under this commitment: a retry. Nothing changed.
    Duplicate,
    /// Its parent is not the chain's head. The device commits again on `head`.
    Behind { head: Option<String> },
    /// The Bond has had as many of these this week as the cap allows.
    Capped,
    /// This Bond claimed the find before, on another device. Paid once.
    AlreadyYours,
    /// Another Bond claimed the find first. Oh crap.
    Taken,
    /// A new chain, and the Bond already holds as many as it may.
    TooManyChains,
}

impl AwardOutcome {
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Duplicate => "duplicate",
            Self::Behind { .. } => "behind",
            Self::Capped => "capped",
            Self::AlreadyYours => "already_yours",
            Self::Taken => "taken",
            Self::TooManyChains => "too_many_chains",
        }
    }
}

/// One entry of a week's claimed set: the find, and whether it is this Bond's.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimedFind {
    pub artifact_sha: String,
    pub yours: bool,
}

impl IdentityRepository {
    /// Commits awards in order, all in one transaction: each is checked
    /// against its chain's head, the week's cap and, for a rare pick-up, the
    /// claim, and is paid only if all of them hold. A claim and its award
    /// are written together or not at all. `epoch` is the current week, which
    /// the caps count in and claims are pruned against.
    pub async fn commit_awards(
        &self,
        owner: &PubDress,
        awards: &[CommittedAward],
        epoch: i64,
        now: u64,
    ) -> Result<(PubInfoExperience, Vec<AwardOutcome>), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let now = xp_param(now)?;
        sqlx::query(
            "INSERT INTO bond_pub_info \
             (owner_pub_dress, carried_bond_xp, carried_avaia_xp, bond_xp, avaia_xp, updated_at) \
             VALUES (?, 0, 0, 0, 0, ?) \
             ON CONFLICT(owner_pub_dress) DO NOTHING",
        )
        .bind(owner.as_str())
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        if awards.iter().any(|award| award.claim.is_some()) {
            sqlx::query("DELETE FROM find_claims WHERE epoch < ?")
                .bind(epoch - 2)
                .execute(&mut *transaction)
                .await?;
        }
        let mut outcomes = Vec::with_capacity(awards.len());
        for award in awards {
            outcomes.push(commit_award(&mut transaction, owner, award, epoch, now).await?);
        }
        let experience = read_pub_info_in(&mut transaction, owner).await?;
        transaction.commit().await?;
        Ok((experience, outcomes))
    }

    /// The claims of `epoch` in the given sha buckets (two hex digits each),
    /// each marked as this Bond's or not. It never names another Bond.
    pub async fn read_claims(
        &self,
        owner: &PubDress,
        epoch: i64,
        buckets: &[u8],
    ) -> Result<Vec<ClaimedFind>, RepositoryError> {
        let mut claims = Vec::new();
        for &bucket in buckets {
            let low = format!("{bucket:02x}");
            let high = if bucket == u8::MAX {
                "g".to_owned()
            } else {
                format!("{:02x}", bucket + 1)
            };
            let rows = sqlx::query(
                "SELECT artifact_sha, owner_pub_dress = ? AS yours FROM find_claims \
                 WHERE epoch = ? AND artifact_sha >= ? AND artifact_sha < ? \
                 ORDER BY artifact_sha",
            )
            .bind(owner.as_str())
            .bind(epoch)
            .bind(low)
            .bind(high)
            .fetch_all(&self.pool)
            .await?;
            for row in rows {
                claims.push(ClaimedFind {
                    artifact_sha: row.try_get("artifact_sha")?,
                    yours: row.try_get::<i64, _>("yours")? != 0,
                });
            }
        }
        Ok(claims)
    }
}

async fn commit_award(
    transaction: &mut Transaction<'_, Sqlite>,
    owner: &PubDress,
    award: &CommittedAward,
    epoch: i64,
    now: i64,
) -> Result<AwardOutcome, RepositoryError> {
    let seen = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM bond_experience_events WHERE owner_pub_dress = ? AND event_id = ?",
    )
    .bind(owner.as_str())
    .bind(&award.id)
    .fetch_one(&mut **transaction)
    .await?;
    if seen > 0 {
        return Ok(AwardOutcome::Duplicate);
    }

    let head = sqlx::query_scalar::<_, String>(
        "SELECT head FROM experience_chains WHERE owner_pub_dress = ? AND chain = ?",
    )
    .bind(owner.as_str())
    .bind(&award.chain)
    .fetch_optional(&mut **transaction)
    .await?;
    if head != award.parent {
        return Ok(AwardOutcome::Behind { head });
    }
    if head.is_none() {
        let chains = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM experience_chains WHERE owner_pub_dress = ?",
        )
        .bind(owner.as_str())
        .fetch_one(&mut **transaction)
        .await?;
        if chains >= MAX_EXPERIENCE_CHAINS {
            return Ok(AwardOutcome::TooManyChains);
        }
    }

    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count FROM experience_kind_counts \
         WHERE owner_pub_dress = ? AND epoch = ? AND kind = ? AND tier = ?",
    )
    .bind(owner.as_str())
    .bind(epoch)
    .bind(award.kind)
    .bind(i64::from(award.tier))
    .fetch_optional(&mut **transaction)
    .await?
    .unwrap_or(0);
    if count >= i64::from(award.weekly_cap) {
        return Ok(AwardOutcome::Capped);
    }

    if let Some(claim) = &award.claim {
        let claimed = sqlx::query(
            "INSERT INTO find_claims (artifact_sha, epoch, tier, owner_pub_dress) \
             VALUES (?, ?, ?, ?) ON CONFLICT(artifact_sha) DO NOTHING",
        )
        .bind(&claim.artifact_sha)
        .bind(claim.epoch)
        .bind(i64::from(claim.tier))
        .bind(owner.as_str())
        .execute(&mut **transaction)
        .await?
        .rows_affected();
        if claimed == 0 {
            let holder = sqlx::query_scalar::<_, String>(
                "SELECT owner_pub_dress FROM find_claims WHERE artifact_sha = ?",
            )
            .bind(&claim.artifact_sha)
            .fetch_one(&mut **transaction)
            .await?;
            return Ok(if holder == owner.as_str() {
                AwardOutcome::AlreadyYours
            } else {
                AwardOutcome::Taken
            });
        }
    }

    apply_event(
        transaction,
        owner,
        &ExperienceAward {
            id: award.id.clone(),
            earner: award.earner,
            amount: award.amount,
        },
        u64::try_from(now).map_err(|_| RepositoryError::CorruptPubInfo)?,
    )
    .await?;
    sqlx::query(
        "INSERT INTO experience_chains (owner_pub_dress, chain, head, length) VALUES (?, ?, ?, 1) \
         ON CONFLICT(owner_pub_dress, chain) DO UPDATE SET head = excluded.head, length = length + 1",
    )
    .bind(owner.as_str())
    .bind(&award.chain)
    .bind(&award.id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "INSERT INTO experience_kind_counts (owner_pub_dress, epoch, kind, tier, count) \
         VALUES (?, ?, ?, ?, 1) \
         ON CONFLICT(owner_pub_dress, epoch, kind, tier) DO UPDATE SET count = count + 1",
    )
    .bind(owner.as_str())
    .bind(epoch)
    .bind(award.kind)
    .bind(i64::from(award.tier))
    .execute(&mut **transaction)
    .await?;
    Ok(AwardOutcome::Accepted)
}

#[cfg(test)]
mod award_tests {
    use super::{
        AwardOutcome, CommittedAward, ExperienceEarner, FindClaim, IdentityRepository,
        PubInfoExperience,
    };
    use crate::{ProviderIdentity, PubDress};

    const EPOCH: i64 = 2961;

    async fn repository() -> (IdentityRepository, PubDress, PubDress) {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let sky: PubDress = "0x0sky".parse().expect("owner");
        let other: PubDress = "0xfrSb".parse().expect("other");
        repository
            .register(&sky, &ProviderIdentity::telegram(7), 100)
            .await
            .expect("registration");
        repository
            .register(&other, &ProviderIdentity::telegram(8), 100)
            .await
            .expect("registration");
        (repository, sky, other)
    }

    fn zone(id: &str, parent: Option<&str>) -> CommittedAward {
        CommittedAward {
            id: id.to_owned(),
            parent: parent.map(str::to_owned),
            chain: "ch:phone".to_owned(),
            kind: "zone_walked",
            tier: 0,
            earner: ExperienceEarner::Bond,
            amount: 30,
            weekly_cap: 2,
            claim: None,
        }
    }

    fn pick_up(id: &str, chain: &str, sha: &str) -> CommittedAward {
        CommittedAward {
            id: id.to_owned(),
            parent: None,
            chain: chain.to_owned(),
            kind: "find_picked_up",
            tier: 5,
            earner: ExperienceEarner::Bond,
            amount: 400,
            weekly_cap: 10,
            claim: Some(FindClaim {
                artifact_sha: sha.to_owned(),
                epoch: EPOCH,
                tier: 5,
            }),
        }
    }

    #[tokio::test]
    async fn a_chain_moves_forward_only_and_a_retry_pays_once() {
        let (repository, sky, _) = repository().await;
        let (experience, outcomes) = repository
            .commit_awards(
                &sky,
                &[
                    zone("xp:a", None),
                    zone("xp:b", Some("xp:a")),
                    zone("xp:a", None),
                    zone("xp:c", Some("xp:a")),
                    zone("xp:d", None),
                ],
                EPOCH,
                200,
            )
            .await
            .expect("commit");
        assert_eq!(
            outcomes,
            [
                AwardOutcome::Accepted,
                AwardOutcome::Accepted,
                AwardOutcome::Duplicate,
                AwardOutcome::Behind {
                    head: Some("xp:b".to_owned())
                },
                AwardOutcome::Behind {
                    head: Some("xp:b".to_owned())
                },
            ]
        );
        assert_eq!(
            experience,
            PubInfoExperience {
                bond_xp: 60,
                avaia_xp: 0
            }
        );
    }

    #[tokio::test]
    async fn a_week_holds_no_more_of_a_kind_than_its_cap() {
        let (repository, sky, _) = repository().await;
        let (_, outcomes) = repository
            .commit_awards(
                &sky,
                &[
                    zone("xp:a", None),
                    zone("xp:b", Some("xp:a")),
                    zone("xp:c", Some("xp:b")),
                ],
                EPOCH,
                200,
            )
            .await
            .expect("commit");
        assert_eq!(outcomes[2], AwardOutcome::Capped);
        // A new week counts afresh.
        let (_, next) = repository
            .commit_awards(&sky, &[zone("xp:c", Some("xp:b"))], EPOCH + 1, 300)
            .await
            .expect("commit");
        assert_eq!(next, [AwardOutcome::Accepted]);
    }

    #[tokio::test]
    async fn the_first_bond_claims_a_find_and_the_next_one_hears_oh_crap() {
        let (repository, sky, other) = repository().await;
        let sha = "ab".repeat(32);
        let (first, outcomes) = repository
            .commit_awards(&sky, &[pick_up("xp:mine", "ch:phone", &sha)], EPOCH, 200)
            .await
            .expect("commit");
        assert_eq!(outcomes, [AwardOutcome::Accepted]);
        assert_eq!(first.bond_xp, 400);

        let (again, outcomes) = repository
            .commit_awards(&sky, &[pick_up("xp:laptop", "ch:laptop", &sha)], EPOCH, 201)
            .await
            .expect("commit");
        assert_eq!(outcomes, [AwardOutcome::AlreadyYours]);
        assert_eq!(again.bond_xp, 400);

        let (theirs, outcomes) = repository
            .commit_awards(&other, &[pick_up("xp:theirs", "ch:x", &sha)], EPOCH, 202)
            .await
            .expect("commit");
        assert_eq!(outcomes, [AwardOutcome::Taken]);
        assert_eq!(theirs.bond_xp, 0);

        // Neither refusal moved a chain: the next award starts each anew.
        let (_, outcomes) = repository
            .commit_awards(&other, &[zone("xp:z", None)], EPOCH, 203)
            .await
            .expect("commit");
        assert_eq!(outcomes, [AwardOutcome::Accepted]);
    }

    #[tokio::test]
    async fn the_claimed_set_is_read_per_bucket_and_names_no_other_bond() {
        let (repository, sky, other) = repository().await;
        let mine = format!("ab{}", "0".repeat(62));
        let theirs = format!("ab{}", "f".repeat(62));
        let elsewhere = format!("ac{}", "0".repeat(62));
        let last_bucket = "f".repeat(64);
        repository
            .commit_awards(
                &sky,
                &[
                    pick_up("xp:1", "ch:1", &mine),
                    pick_up("xp:2", "ch:2", &last_bucket),
                ],
                EPOCH,
                200,
            )
            .await
            .expect("commit");
        repository
            .commit_awards(
                &other,
                &[
                    pick_up("xp:3", "ch:3", &theirs),
                    pick_up("xp:4", "ch:4", &elsewhere),
                ],
                EPOCH,
                200,
            )
            .await
            .expect("commit");

        let claims = repository
            .read_claims(&sky, EPOCH, &[0xab, 0xff])
            .await
            .expect("claims");
        let read: Vec<(&str, bool)> = claims
            .iter()
            .map(|claim| (claim.artifact_sha.as_str(), claim.yours))
            .collect();
        assert_eq!(
            read,
            [
                (mine.as_str(), true),
                (theirs.as_str(), false),
                (last_bucket.as_str(), true)
            ]
        );
        assert!(
            repository
                .read_claims(&sky, EPOCH + 1, &[0xab])
                .await
                .expect("claims")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_claim_is_pruned_once_its_week_is_two_weeks_old() {
        let (repository, sky, other) = repository().await;
        let sha = "cd".repeat(32);
        repository
            .commit_awards(&sky, &[pick_up("xp:1", "ch:1", &sha)], EPOCH, 200)
            .await
            .expect("commit");
        // Two weeks on, another claim prunes it; the award it paid stands.
        let later = "ef".repeat(32);
        let mut next = pick_up("xp:2", "ch:2", &later);
        next.claim = Some(FindClaim {
            artifact_sha: later.clone(),
            epoch: EPOCH + 3,
            tier: 5,
        });
        let (experience, _) = repository
            .commit_awards(&other, &[next], EPOCH + 3, 300)
            .await
            .expect("commit");
        assert_eq!(experience.bond_xp, 400);
        assert!(
            repository
                .read_claims(&sky, EPOCH, &[0xcd])
                .await
                .expect("claims")
                .is_empty()
        );
        assert_eq!(
            repository.read_pub_info(&sky).await.expect("read").bond_xp,
            400
        );
    }

    #[tokio::test]
    async fn a_bond_holds_a_bounded_number_of_chains() {
        let (repository, sky, _) = repository().await;
        let awards: Vec<CommittedAward> = (0..=super::MAX_EXPERIENCE_CHAINS)
            .map(|index| CommittedAward {
                chain: format!("ch:{index}"),
                kind: "find_seen",
                amount: 10,
                weekly_cap: 400,
                ..zone(&format!("xp:{index}"), None)
            })
            .collect();
        let (_, outcomes) = repository
            .commit_awards(&sky, &awards, EPOCH, 200)
            .await
            .expect("commit");
        assert_eq!(outcomes.last(), Some(&AwardOutcome::TooManyChains));
        assert!(
            outcomes[..outcomes.len() - 1]
                .iter()
                .all(|outcome| *outcome == AwardOutcome::Accepted)
        );
    }
}
