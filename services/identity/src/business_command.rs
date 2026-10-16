// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Out-of-band business operations. There is no public route to a role or a
//! station; an operator runs these against the service's own database:
//!
//! ```text
//! identity-bot business register <pub_dress>
//! identity-bot business grant <pub_dress>
//! identity-bot business station <owner pub_dress> "<caption>" <longitude> <latitude>
//! ```
//!
//! A station's address is formed from its caption by Core
//! (`StationPubDress::from_caption`, `docs/business-station.md` in nilx-one/core):
//! `"xda-market Золоті Ворота"` stations `0xda-market-zoloti-vorota`.

use crate::{
    BondAccessRole, BusinessRegistrationOutcome, BusinessStationOutcome, GeoCoordinate,
    IdentityRepository, PubDress, StationPubDress,
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
        ["business", "register", pub_dress] => {
            let pub_dress = parse_pub_dress(pub_dress)?;
            match repository
                .register_business(&pub_dress, now)
                .await
                .map_err(|error| error.to_string())?
            {
                BusinessRegistrationOutcome::Registered(_) => {
                    Ok(format!("{pub_dress}: registered, business, no sign-in yet"))
                }
                BusinessRegistrationOutcome::AlreadyBusiness(_) => {
                    Ok(format!("{pub_dress}: already a business"))
                }
                BusinessRegistrationOutcome::Unavailable => {
                    Err(format!("{pub_dress}: the address is taken or reserved"))
                }
                BusinessRegistrationOutcome::PublicLabelUnavailable => {
                    Err(format!("{pub_dress}: its public label is taken"))
                }
            }
        }
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
        ["business", "station", owner, caption, longitude, latitude] => {
            let owner = parse_pub_dress(owner)?;
            let formed = StationPubDress::from_caption(&owner, caption)
                .map_err(|error| format!("\"{caption}\": {error}"))?;
            let (station, written) = (formed.address, formed.caption);
            let coordinate = parse_coordinate(longitude, latitude)?;
            match repository
                .station_business_avaia(&owner, &station, Some(&written), coordinate, now)
                .await
                .map_err(|error| error.to_string())?
            {
                BusinessStationOutcome::Stationed(station) => Ok(format!(
                    "{}: \"{}\" stationed for {} at {}, {}",
                    station.pub_dress,
                    station.caption.as_deref().unwrap_or_default(),
                    station.owner_pub_dress,
                    station.coordinate.longitude_degrees(),
                    station.coordinate.latitude_degrees()
                )),
                BusinessStationOutcome::Unknown => Err(format!("{owner}: no such human Bond")),
                BusinessStationOutcome::BusinessRoleRequired => Err(format!(
                    "{owner}: not a business; register or grant it first"
                )),
                BusinessStationOutcome::NotOwnersAddress => {
                    Err(format!("{station}: not an address of {owner}"))
                }
                BusinessStationOutcome::AddressUnavailable => {
                    Err(format!("{station}: the address is taken"))
                }
            }
        }
        _ => Err(USAGE.to_owned()),
    }
}

const USAGE: &str = "usage:\n  \
    identity-bot business register <pub_dress>\n  \
    identity-bot business grant <pub_dress>\n  \
    identity-bot business station <owner> \"<caption>\" <longitude> <latitude>";

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
    use crate::IdentityRepository;

    fn args(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).to_owned()).collect()
    }

    #[tokio::test]
    async fn registers_the_first_business_with_two_points() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        let gate = [
            "business",
            "station",
            "0xda-market",
            "xda-market Золоті Ворота",
            "30.5131",
            "50.4489",
        ];

        assert_eq!(
            run(&repository, &args(&gate), 100).await,
            Err("0xda-market: no such human Bond".to_owned())
        );
        assert_eq!(
            run(
                &repository,
                &args(&["business", "register", "0xda-market"]),
                100
            )
            .await,
            Ok("0xda-market: registered, business, no sign-in yet".to_owned())
        );
        assert_eq!(
            run(
                &repository,
                &args(&["business", "register", "0xda-market"]),
                100
            )
            .await,
            Ok("0xda-market: already a business".to_owned())
        );
        assert_eq!(
            run(&repository, &args(&gate), 101).await,
            Ok("0xda-market-zoloti-vorota: \"xda-market Золоті Ворота\" stationed for 0xda-market at 30.5131, 50.4489".to_owned())
        );
        assert_eq!(
            run(
                &repository,
                &args(&[
                    "business",
                    "station",
                    "0xda-market",
                    "xda-market Батьківщина-Мати",
                    "30.5632",
                    "50.4265"
                ]),
                102
            )
            .await
            .map(|line| line.split(':').next().map(str::to_owned)),
            Ok(Some("0xda-market-batkivshchyna-maty".to_owned()))
        );
        // A business has no single location to set: it is its points.
        assert!(
            run(
                &repository,
                &args(&[
                    "business",
                    "locate",
                    "0xda-market",
                    "0xda-market-zoloti-vorota"
                ]),
                103
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn refuses_what_it_cannot_parse() {
        let repository = IdentityRepository::connect("sqlite::memory:")
            .await
            .expect("repository");
        for line in [
            &["business", "register", "nobody"][..],
            &["business", "grant", "0xdghost"],
            &[
                "business",
                "station",
                "0xda-market",
                "Золоті Ворота",
                "30.5",
                "50.4",
            ],
            &[
                "business",
                "station",
                "0xda-market",
                "xda-market shop",
                "30.5",
                "95",
            ],
            &["business"],
        ] {
            assert!(run(&repository, &args(line), 1).await.is_err(), "{line:?}");
        }
    }
}
