// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! A business names each station by a caption, `xda-market Золоті Ворота`, and
//! the station's address is formed from it: the business's own full address,
//! `-`, then the caption's place transliterated (Ukrainian by the official
//! 2010 table), lowercased, with whitespace as `-`: `0xda-market-zoloti-vorota`.
//! A leading business name in the caption (`0xda-market` or `xda-market`) is
//! the prefix already and is not repeated. A station address takes no `ai`
//! ending: it is the business's, not a companion's. The caption is kept as
//! written.

use crate::{PubDress, PubDressError};

/// The longest caption accepted, in scalars; the address it forms is bounded
/// again by the `PubDress` grammar.
pub const MAX_CAPTION_SCALARS: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CaptionError {
    Empty,
    TooLong,
    /// The caption names the business and no place.
    NoPlace,
    /// The formed address is not a `PubDress`.
    Address(PubDressError),
}

impl core::fmt::Display for CaptionError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Empty => formatter.write_str("the caption is empty"),
            Self::TooLong => write!(
                formatter,
                "the caption is longer than {MAX_CAPTION_SCALARS} characters"
            ),
            Self::NoPlace => formatter.write_str("the caption names no place"),
            Self::Address(error) => write!(formatter, "it forms no station address ({error})"),
        }
    }
}

/// A caption as stored: trimmed, with inner whitespace runs collapsed.
pub fn normalize_caption(caption: &str) -> Result<String, CaptionError> {
    let words: Vec<&str> = caption.split_whitespace().collect();
    if words.is_empty() {
        return Err(CaptionError::Empty);
    }
    let caption = words.join(" ");
    if caption.chars().count() > MAX_CAPTION_SCALARS {
        return Err(CaptionError::TooLong);
    }
    Ok(caption)
}

/// The station address a business's caption forms.
pub fn station_address(owner: &PubDress, caption: &str) -> Result<PubDress, CaptionError> {
    let caption = normalize_caption(caption)?;
    let owner_name = owner.as_str();
    // `0xda-market` is also written `xda-market`, the way its Avaia is.
    let short_name = owner_name[1..].to_lowercase();
    let mut words = caption.split(' ').peekable();
    if words
        .peek()
        .is_some_and(|first| *first == owner_name || first.to_lowercase() == short_name)
    {
        words.next();
    }
    let place: Vec<&str> = words.collect();
    if place.is_empty() {
        return Err(CaptionError::NoPlace);
    }

    let mut slug = String::with_capacity(caption.len());
    for (index, word) in place.iter().enumerate() {
        if index > 0 {
            slug.push('-');
        }
        let mut word_start = true;
        let mut previous: Option<char> = None;
        for scalar in word.chars() {
            let lower = scalar.to_lowercase().next().unwrap_or(scalar);
            match transliterate(lower, previous, word_start) {
                Some(latin) => slug.push_str(latin),
                None => slug.push(lower),
            }
            word_start = !lower.is_alphanumeric() && !is_apostrophe(lower);
            previous = Some(lower);
        }
    }
    format!("{owner_name}-{slug}")
        .parse()
        .map_err(CaptionError::Address)
}

/// Whether an address is one of this business's station addresses by shape.
pub fn is_station_of(owner: &PubDress, station: &PubDress) -> bool {
    station
        .as_str()
        .strip_prefix(owner.as_str())
        .is_some_and(|rest| rest.len() > 1 && rest.starts_with('-'))
}

fn is_apostrophe(scalar: char) -> bool {
    matches!(scalar, '\'' | 'ʼ' | '’')
}

/// Ukrainian national transliteration (Cabinet of Ministers resolution 55,
/// 2010). `None` keeps the scalar as it is.
fn transliterate(scalar: char, previous: Option<char>, word_start: bool) -> Option<&'static str> {
    Some(match scalar {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        // `зг` is written `zgh`, to tell it from `ж`.
        'г' if previous == Some('з') => "gh",
        'г' => "h",
        'ґ' => "g",
        'д' => "d",
        'е' => "e",
        'є' if word_start => "ye",
        'є' => "ie",
        'ж' => "zh",
        'з' => "z",
        'и' => "y",
        'і' => "i",
        'ї' if word_start => "yi",
        'ї' => "i",
        'й' if word_start => "y",
        'й' => "i",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ь' | '\'' | 'ʼ' | '’' => "",
        'ю' if word_start => "yu",
        'ю' => "iu",
        'я' if word_start => "ya",
        'я' => "ia",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{CaptionError, is_station_of, normalize_caption, station_address};
    use crate::PubDress;

    fn market() -> PubDress {
        "0xda-market".parse().expect("owner")
    }

    #[test]
    fn forms_the_shop_addresses_from_their_captions() {
        for (caption, address) in [
            ("xda-market Золоті Ворота", "0xda-market-zoloti-vorota"),
            (
                "0xda-market Батьківщина-Мати",
                "0xda-market-batkivshchyna-maty",
            ),
            ("Батьківщина-Мати", "0xda-market-batkivshchyna-maty"),
            ("xda-market  Згорани ", "0xda-market-zghorany"),
            ("Їжак Юрій Яр", "0xda-market-yizhak-yurii-yar"),
            ("В'ячеслав", "0xda-market-viacheslav"),
            ("Поділ 2", "0xda-market-podil-2"),
        ] {
            assert_eq!(
                station_address(&market(), caption).map(|value| value.to_string()),
                Ok(address.to_owned()),
                "{caption}"
            );
        }
    }

    #[test]
    fn keeps_the_caption_as_written() {
        assert_eq!(
            normalize_caption("  xda-market   Золоті Ворота "),
            Ok("xda-market Золоті Ворота".to_owned())
        );
        assert_eq!(normalize_caption("   "), Err(CaptionError::Empty));
        assert_eq!(
            normalize_caption(&"я".repeat(65)),
            Err(CaptionError::TooLong)
        );
    }

    #[test]
    fn refuses_a_caption_that_forms_no_station_address() {
        assert_eq!(
            station_address(&market(), "xda-market"),
            Err(CaptionError::NoPlace)
        );
        // The PubDress grammar bounds the address, whatever the caption allows.
        assert!(matches!(
            station_address(&market(), "Їжакевич Юрій Яготинський"),
            Err(CaptionError::Address(_))
        ));
        assert!(matches!(
            station_address(&market(), "🌍"),
            Err(CaptionError::Address(_))
        ));
    }

    #[test]
    fn a_station_address_is_its_business_then_a_place() {
        let station: PubDress = "0xda-market-zoloti-vorota".parse().expect("station");
        assert!(is_station_of(&market(), &station));
        assert!(!is_station_of(&market(), &market()));
        let other: PubDress = "0xda-marketing".parse().expect("other");
        assert!(!is_station_of(&market(), &other));
    }
}
