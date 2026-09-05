// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    fmt,
    time::{SystemTime, UNIX_EPOCH},
};

use thiserror::Error;

/// A UTC instant in the single storage format `YYYY-MM-DDTHH:MM:SSZ`.
///
/// The trash keeps one canonical shape so that lexicographic ordering,
/// range filters, and retention cutoffs are the same comparison.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Timestamp(String);

impl Timestamp {
    /// Parses a client-stated RFC 3339 instant.
    ///
    /// Only the UTC designator is accepted. A numeric offset would make the
    /// trash responsible for calendar arithmetic it cannot verify, so a
    /// reporter converts to UTC before dumping.
    pub fn parse(value: &str) -> Result<Self, TimestampError> {
        let bytes = value.as_bytes();
        if bytes.len() < 20 {
            return Err(TimestampError);
        }
        let year = digits(&bytes[0..4])?;
        let month = digits(&bytes[5..7])?;
        let day = digits(&bytes[8..10])?;
        let hour = digits(&bytes[11..13])?;
        let minute = digits(&bytes[14..16])?;
        let second = digits(&bytes[17..19])?;
        if bytes[4] != b'-'
            || bytes[7] != b'-'
            || !matches!(bytes[10], b'T' | b't')
            || bytes[13] != b':'
            || bytes[16] != b':'
        {
            return Err(TimestampError);
        }

        let tail = &bytes[19..];
        let tail = if tail[0] == b'.' {
            let fraction = tail[1..]
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if fraction == 0 {
                return Err(TimestampError);
            }
            &tail[1 + fraction..]
        } else {
            tail
        };
        if tail.len() != 1 || !matches!(tail[0], b'Z' | b'z') {
            return Err(TimestampError);
        }

        if !(1..=12).contains(&month)
            || day < 1
            || day > days_in_month(year, month)
            || hour > 23
            || minute > 59
            || second > 60
        {
            return Err(TimestampError);
        }

        // A reported leap second is folded into the last ordinary second
        // rather than rejected: the trash never drops a real report over a
        // clock representation detail.
        Ok(Self(format!(
            "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{:02}Z",
            second.min(59)
        )))
    }

    /// Renders an instant from Unix seconds using the proleptic Gregorian calendar.
    pub fn from_unix_seconds(seconds: u64) -> Self {
        let days = i64::try_from(seconds / 86_400).unwrap_or(i64::MAX);
        let time_of_day = seconds % 86_400;
        let (year, month, day) = civil_from_days(days);
        Self(format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            time_of_day / 3_600,
            (time_of_day % 3_600) / 60,
            time_of_day % 60
        ))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
#[error("timestamp must be RFC 3339 UTC, for example 2026-09-05T12:34:56Z")]
pub struct TimestampError;

pub trait Clock: Send + Sync {
    fn now_unix_seconds(&self) -> u64;

    fn now(&self) -> Timestamp {
        Timestamp::from_unix_seconds(self.now_unix_seconds())
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix_seconds(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs())
    }
}

fn digits(bytes: &[u8]) -> Result<u64, TimestampError> {
    bytes.iter().try_fold(0_u64, |value, byte| {
        if byte.is_ascii_digit() {
            Ok(value * 10 + u64::from(byte - b'0'))
        } else {
            Err(TimestampError)
        }
    })
}

const fn leap_year(year: u64) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

const fn days_in_month(year: u64, month: u64) -> u64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if leap_year(year) => 29,
        _ => 28,
    }
}

/// Days since the Unix epoch to a civil date, after Howard Hinnant's
/// `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::{Timestamp, TimestampError};

    #[test]
    fn parsing_normalizes_every_accepted_utc_shape_to_one_storage_format() {
        for (input, expected) in [
            ("2026-09-05T12:34:56Z", "2026-09-05T12:34:56Z"),
            ("2026-09-05T12:34:56.789Z", "2026-09-05T12:34:56Z"),
            ("2026-09-05t12:34:56.000000001z", "2026-09-05T12:34:56Z"),
            ("2016-12-31T23:59:60Z", "2016-12-31T23:59:59Z"),
            ("2024-02-29T00:00:00Z", "2024-02-29T00:00:00Z"),
        ] {
            assert_eq!(
                Timestamp::parse(input).expect("accepted instant").as_str(),
                expected
            );
        }
    }

    #[test]
    fn parsing_rejects_offsets_impossible_dates_and_partial_input() {
        for input in [
            "2026-09-05T12:34:56+02:00",
            "2026-09-05T12:34:56",
            "2026-09-05 12:34:56Z",
            "2026-02-30T00:00:00Z",
            "2023-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-09-05T24:00:00Z",
            "2026-09-05T12:34:56.Z",
            "",
        ] {
            assert_eq!(Timestamp::parse(input), Err(TimestampError), "{input}");
        }
    }

    #[test]
    fn unix_seconds_and_parsing_agree_on_the_same_instants() {
        for (seconds, expected) in [
            (0, "1970-01-01T00:00:00Z"),
            (1_709_164_800, "2024-02-29T00:00:00Z"),
            (1_788_000_000, "2026-08-29T10:40:00Z"),
        ] {
            let rendered = Timestamp::from_unix_seconds(seconds);
            assert_eq!(rendered.as_str(), expected);
            assert_eq!(Timestamp::parse(expected), Ok(rendered));
        }
    }

    #[test]
    fn storage_format_orders_lexicographically_by_instant() {
        let earlier = Timestamp::from_unix_seconds(1_700_000_000);
        let later = Timestamp::from_unix_seconds(1_800_000_000);
        assert!(earlier < later);
        assert!(earlier.as_str() < later.as_str());
        assert_eq!(earlier.as_str().len(), 20);
    }
}
