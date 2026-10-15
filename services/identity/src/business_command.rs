// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Out-of-band business operations. There is no public route to a role or a
//! station; an operator runs these against the service's own database:
//!
//! ```text
//! identity-bot business grant <pub_dress>
//! identity-bot business station <owner pub_dress> <Avaia address> <longitude> <latitude>
//! ```

use crate::{
    AvaiaPubDress, BondAccessRole, BusinessStationOutcome, GeoCoordinate, IdentityRepository,
    PubDress,
};

/// Runs one operation and answers the line to print. `Err` is a refusal or a
/// failure; the caller exits non-zero with it.
pub async fn run(
    repository: &IdentityRepository,
    args: &[String],
    now: u64,
) -> Result<String, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["business", "grant", pub_dress] => {
            let pub_dress = parse_pub_dress(pub_dress)?;
            let granted = repository
                .set_role(&pub_dress, BondAccessRole::Business)
                .await
                .map_err(|error| error.to_string())?;
            if granted {
                Ok(format!("{pub_dress}: business"))
            } else {
                Err(format!("{pub_dress}: no such human Bond"))
            }
        }
        ["business", "station", owner, station, longitude, latitude] => {
            let owner = parse_pub_dress(owner)?;
            let station = station
                .parse::<AvaiaPubDress>()
                .map_err(|error| format!("{station}: not an Avaia address ({error})"))?;
            let coordinate = parse_coordinate(longitude, latitude)?;
            match repository
                .station_business_avaia(&owner, &station, coordinate, now)
                .await
                .map_err(|error| error.to_string())?
            {
                BusinessStationOutcome::Stationed(station) => Ok(format!(
                    "{}: stationed for {} at {}, {}",
                    station.pub_dress,
                    station.owner_pub_dress,
                    station.coordinate.longitude_degrees(),
                    station.coordinate.latitude_degrees()
                )),
                BusinessStationOutcome::Unknown => Err(format!("{owner}: no such human Bond")),
                BusinessStationOutcome::BusinessRoleRequired => {
                    Err(format!("{owner}: not a business; grant the role first"))
                }
                BusinessStationOutcome::OwnerDiscriminatorMismatch => Err(format!(
                    "{station}: must keep {owner}'s discriminator, x{}…ai",
                    owner.discriminator()
                )),
                BusinessStationOutcome::AddressUnavailable => {
                    Err(format!("{station}: the address is taken"))
                }
            }
        }
        _ => Err(USAGE.to_owned()),
    }
}

const USAGE: &str = "usage:\n  \
    identity-bot business grant <pub_dress>\n  \
    identity-bot business station <owner> <Avaia address> <longitude> <latitude>";

fn parse_pub_dress(value: &str) -> Result<PubDress, String> {
    value
        .parse::<PubDress>()
        .map_err(|error| format!("{value}: not a pub_dress ({error})"))
}

fn parse_coordinate(longitude: &str, latitude: &str) -> Result<GeoCoordinate, String> {
    let longitude = longitude
        .parse::<f64>()
        .map_err(|_| format!("{longitude}: not a longitude"))?;
    let latitude = latitude
        .parse::<f64>()
        .map_err(|_| format!("{latitude}: not a latitude"))?;
    GeoCoordinate::from_degrees(longitude, latitude)
        .map_err(|error| format!("{longitude}, {latitude}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::run;
    use crate::{IdentityRepository, ProviderIdentity, PubDress};

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_owned).collect()
    }

    #[tokio::test]
    async fn grants_the_role_then_stations_a_shop() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let owner: PubDress = "0xda-market".parse().expect("owner");
        repository
            .register(&owner, &ProviderIdentity::telegram(77), 100)
            .await
            .expect("registration");
        let station = "business station 0xda-market xda-market-batkivshchynai 30.5632 50.4265";

        let refused = run(&repository, &args(station), 101).await;
        assert_eq!(
            refused,
            Err("0xda-market: not a business; grant the role first".to_owned())
        );
        assert_eq!(
            run(&repository, &args("business grant 0xda-market"), 101).await,
            Ok("0xda-market: business".to_owned())
        );
        assert_eq!(
            run(&repository, &args(station), 102).await,
            Ok(
                "xda-market-batkivshchynai: stationed for 0xda-market at 30.5632, 50.4265"
                    .to_owned()
            )
        );
    }

    #[tokio::test]
    async fn refuses_what_it_cannot_parse() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        assert!(
            run(&repository, &args("business grant nobody"), 1)
                .await
                .is_err()
        );
        assert!(
            run(&repository, &args("business grant 0xdghost"), 1)
                .await
                .is_err()
        );
        assert!(
            run(
                &repository,
                &args("business station 0xda-market xda-market-shop 30.5 50.4"),
                1
            )
            .await
            .is_err()
        );
        assert!(
            run(
                &repository,
                &args("business station 0xda-market xda-market-shopai 30.5 95"),
                1
            )
            .await
            .is_err()
        );
        assert!(run(&repository, &args("business"), 1).await.is_err());
    }
}
