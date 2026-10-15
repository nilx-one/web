// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/// A stationed Avaia: one per shop of a business Bond, standing at the shop.
#[derive(Clone, Debug, PartialEq)]
pub struct BusinessStation {
    pub pub_dress: String,
    pub owner_pub_dress: String,
    pub coordinate: GeoCoordinate,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BusinessStationOutcome {
    Stationed(BusinessStation),
    /// The owner is not a human Bond.
    Unknown,
    /// The owner's stored role is not `business`.
    BusinessRoleRequired,
    /// A station keeps its owner's discriminator, like any Avaia address.
    OwnerDiscriminatorMismatch,
    /// Another identity, or another business's station, holds the address.
    AddressUnavailable,
}

impl IdentityRepository {
    /// Stations a business Bond's Avaia at a shop, or restates the point of a
    /// station it already keeps. There is no public route to this: like a
    /// role, a station is assigned out of band.
    pub async fn station_business_avaia(
        &self,
        owner: &PubDress,
        station: &AvaiaPubDress,
        coordinate: GeoCoordinate,
        now: u64,
    ) -> Result<BusinessStationOutcome, RepositoryError> {
        if station.owner_discriminator() != owner.discriminator() {
            return Ok(BusinessStationOutcome::OwnerDiscriminatorMismatch);
        }
        let now = i64::try_from(now).map_err(|_| RepositoryError::CorruptAvaiaLocation)?;
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;

        let role = sqlx::query_scalar::<_, Option<String>>(
            "SELECT r.role FROM identities i \
             LEFT JOIN bond_roles r ON r.pub_dress = i.pub_dress \
             WHERE i.pub_dress = ? AND i.identity_kind = 'human'",
        )
        .bind(owner.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        match role {
            None => {
                transaction.rollback().await?;
                return Ok(BusinessStationOutcome::Unknown);
            }
            Some(role) if role.as_deref() != Some(BondAccessRole::Business.as_str()) => {
                transaction.rollback().await?;
                return Ok(BusinessStationOutcome::BusinessRoleRequired);
            }
            Some(_) => {}
        }

        let keeper = sqlx::query_scalar::<_, String>(
            "SELECT owner_pub_dress FROM business_stations WHERE avaia_pub_dress = ?",
        )
        .bind(station.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
        match keeper.as_deref() {
            Some(keeper) if keeper != owner.as_str() => {
                transaction.rollback().await?;
                return Ok(BusinessStationOutcome::AddressUnavailable);
            }
            Some(_) => {
                sqlx::query(
                    "UPDATE business_stations SET longitude_e7 = ?, latitude_e7 = ? \
                     WHERE avaia_pub_dress = ?",
                )
                .bind(i64::from(coordinate.longitude_e7()))
                .bind(i64::from(coordinate.latitude_e7()))
                .bind(station.as_str())
                .execute(&mut *transaction)
                .await?;
            }
            None => {
                sqlx::query("INSERT INTO business_station_intents (avaia_pub_dress) VALUES (?)")
                    .bind(station.as_str())
                    .execute(&mut *transaction)
                    .await?;
                let inserted = sqlx::query(
                    "INSERT INTO identities (pub_dress, identity_kind, owner_pub_dress, created_at) \
                     VALUES (?, 'avaia', NULL, ?) ON CONFLICT DO NOTHING",
                )
                .bind(station.as_str())
                .bind(now)
                .execute(&mut *transaction)
                .await?;
                if inserted.rows_affected() == 0 {
                    transaction.rollback().await?;
                    return Ok(BusinessStationOutcome::AddressUnavailable);
                }
                sqlx::query(
                    "INSERT INTO business_stations \
                     (avaia_pub_dress, owner_pub_dress, longitude_e7, latitude_e7, created_at) \
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(station.as_str())
                .bind(owner.as_str())
                .bind(i64::from(coordinate.longitude_e7()))
                .bind(i64::from(coordinate.latitude_e7()))
                .bind(now)
                .execute(&mut *transaction)
                .await?;
                sqlx::query("DELETE FROM business_station_intents WHERE avaia_pub_dress = ?")
                    .bind(station.as_str())
                    .execute(&mut *transaction)
                    .await?;
            }
        }

        transaction.commit().await?;
        Ok(BusinessStationOutcome::Stationed(BusinessStation {
            pub_dress: station.as_str().to_owned(),
            owner_pub_dress: owner.as_str().to_owned(),
            coordinate,
        }))
    }

    /// Every station, in a stable order. Stations are public: the point a
    /// shop stands at is what a business publishes for every Bond to find.
    pub async fn business_stations(&self) -> Result<Vec<BusinessStation>, RepositoryError> {
        let rows = sqlx::query(
            "SELECT avaia_pub_dress, owner_pub_dress, longitude_e7, latitude_e7 \
             FROM business_stations \
             ORDER BY owner_pub_dress COLLATE BINARY, created_at, avaia_pub_dress COLLATE BINARY",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let longitude_e7 = i32::try_from(row.get::<i64, _>("longitude_e7"))
                    .map_err(|_| RepositoryError::CorruptAvaiaLocation)?;
                let latitude_e7 = i32::try_from(row.get::<i64, _>("latitude_e7"))
                    .map_err(|_| RepositoryError::CorruptAvaiaLocation)?;
                Ok(BusinessStation {
                    pub_dress: row.get("avaia_pub_dress"),
                    owner_pub_dress: row.get("owner_pub_dress"),
                    coordinate: GeoCoordinate::new(longitude_e7, latitude_e7)
                        .map_err(|_| RepositoryError::CorruptAvaiaLocation)?,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod business_station_repository_tests {
    use super::*;

    async fn business(repository: &IdentityRepository, pub_dress: &str, tg: i64) -> PubDress {
        let owner: PubDress = pub_dress.parse().expect("owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(tg), 100)
            .await
            .expect("registration");
        assert!(
            repository
                .set_role(&owner, BondAccessRole::Business)
                .await
                .expect("role")
        );
        owner
    }

    fn point(longitude: f64, latitude: f64) -> GeoCoordinate {
        GeoCoordinate::from_degrees(longitude, latitude).expect("coordinate")
    }

    #[tokio::test]
    async fn a_business_keeps_one_station_per_shop_beside_its_own_avaia() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let owner = business(&repository, "0xda-market", 9901).await;
        let first: AvaiaPubDress = "xda-market-batkivshchynai".parse().expect("station");
        let second: AvaiaPubDress = "xda-market-zoloti-vorotai".parse().expect("station");

        for (station, at) in [(&first, point(30.5632, 50.4265)), (&second, point(30.5131, 50.4489))] {
            assert!(matches!(
                repository
                    .station_business_avaia(&owner, station, at, 101)
                    .await
                    .expect("station"),
                BusinessStationOutcome::Stationed(_)
            ));
        }
        // The companion Avaia is still the owner's one, independent of shops.
        assert_eq!(repository.owned_avaia_identity(&owner).await.expect("read"), None);
        let own: AvaiaPubDress = "xda-marketai".parse().expect("Avaia");
        assert!(matches!(
            repository
                .configure_owned_avaia(&owner, &own, 102)
                .await
                .expect("create"),
            AvaiaUpdateOutcome::Updated(_)
        ));

        let stations = repository.business_stations().await.expect("stations");
        assert_eq!(
            stations
                .iter()
                .map(|station| station.pub_dress.as_str())
                .collect::<Vec<_>>(),
            ["xda-market-batkivshchynai", "xda-market-zoloti-vorotai"]
        );
        assert!(stations.iter().all(|station| station.owner_pub_dress == "0xda-market"));
        assert_eq!(stations[0].coordinate, point(30.5632, 50.4265));
    }

    #[tokio::test]
    async fn restationing_moves_the_point_and_keeps_one_station() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let owner = business(&repository, "0xda-market", 9902).await;
        let station: AvaiaPubDress = "xda-market-batkivshchynai".parse().expect("station");
        for at in [point(30.56, 50.42), point(30.5632, 50.4265)] {
            repository
                .station_business_avaia(&owner, &station, at, 101)
                .await
                .expect("station");
        }
        let stations = repository.business_stations().await.expect("stations");
        assert_eq!(stations.len(), 1);
        assert_eq!(stations[0].coordinate, point(30.5632, 50.4265));
    }

    #[tokio::test]
    async fn only_a_business_stations_and_never_over_another_identity() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let user: PubDress = "0xduser".parse().expect("user");
        repository
            .register(&user, &ProviderIdentity::telegram(9903), 100)
            .await
            .expect("registration");
        let at = point(30.5131, 50.4489);
        let station: AvaiaPubDress = "xduser-shopai".parse().expect("station");
        assert_eq!(
            repository
                .station_business_avaia(&user, &station, at, 101)
                .await
                .expect("user"),
            BusinessStationOutcome::BusinessRoleRequired
        );
        let stranger: PubDress = "0xdnobody".parse().expect("stranger");
        assert_eq!(
            repository
                .station_business_avaia(&stranger, &station, at, 101)
                .await
                .expect("unknown"),
            BusinessStationOutcome::Unknown
        );

        let owner = business(&repository, "0xda-market", 9904).await;
        let foreign: AvaiaPubDress = "x1shopai".parse().expect("foreign");
        assert_eq!(
            repository
                .station_business_avaia(&owner, &foreign, at, 101)
                .await
                .expect("discriminator"),
            BusinessStationOutcome::OwnerDiscriminatorMismatch
        );
        // `0xduser`'s own Avaia holds this address.
        let taken: AvaiaPubDress = "xduserai".parse().expect("taken");
        repository
            .configure_owned_avaia(&user, &taken, 102)
            .await
            .expect("create");
        assert_eq!(
            repository
                .station_business_avaia(&owner, &taken, at, 103)
                .await
                .expect("taken"),
            BusinessStationOutcome::AddressUnavailable
        );
        // And a station's address is taken for every other Avaia.
        let shop: AvaiaPubDress = "xda-market-zoloti-vorotai".parse().expect("shop");
        repository
            .station_business_avaia(&owner, &shop, at, 104)
            .await
            .expect("station");
        let rival = business(&repository, "0xdrival", 9905).await;
        assert_eq!(
            repository
                .station_business_avaia(&rival, &shop, at, 105)
                .await
                .expect("rival"),
            BusinessStationOutcome::AddressUnavailable
        );
        assert!(matches!(
            repository
                .rename_owned_avaia(&user, &shop)
                .await
                .expect("rename"),
            PubDressRenameOutcome::AvaiaUnavailable
        ));
    }

    #[tokio::test]
    async fn an_ownerless_avaia_without_a_station_intent_is_still_rejected() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        sqlx::query(
            "INSERT INTO identities (pub_dress, identity_kind, owner_pub_dress, created_at) \
             VALUES ('xdstrayai', 'avaia', NULL, 1)",
        )
        .execute(&repository.pool)
        .await
        .expect("insert");
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM identities WHERE identity_kind = 'avaia'",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("count");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn stations_survive_a_restart_and_leave_with_their_business() {
        let database = tempfile::NamedTempFile::new().expect("database");
        let url = format!("sqlite://{}", database.path().display());
        let repository = IdentityRepository::connect(&url).await.expect("repository");
        let owner = business(&repository, "0xda-market", 9906).await;
        let station: AvaiaPubDress = "xda-market-batkivshchynai".parse().expect("station");
        repository
            .station_business_avaia(&owner, &station, point(30.5632, 50.4265), 101)
            .await
            .expect("station");
        drop(repository);

        // Every start re-installs the 0013 guard before the station migration.
        let repository = IdentityRepository::connect(&url).await.expect("reopen");
        assert_eq!(repository.business_stations().await.expect("stations").len(), 1);
        let renamed: PubDress = "0xda-shop".parse().expect("rename");
        assert!(matches!(
            repository
                .rename_pub_dress(&owner, &renamed)
                .await
                .expect("rename"),
            PubDressRenameOutcome::Renamed(_)
        ));
        let stations = repository.business_stations().await.expect("stations");
        assert_eq!(stations[0].owner_pub_dress, "0xda-shop");
        assert_eq!(stations[0].pub_dress, "xda-market-batkivshchynai");

        sqlx::query("DELETE FROM identities WHERE pub_dress = '0xda-shop'")
            .execute(&repository.pool)
            .await
            .expect("delete");
        assert!(repository.business_stations().await.expect("stations").is_empty());
        let left = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM identities WHERE pub_dress = 'xda-market-batkivshchynai'",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("count");
        assert_eq!(left, 0);
    }
}
