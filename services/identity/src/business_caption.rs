// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! A business names each station by a caption, `xda-market Золоті Ворота`, and
//! the station's Avaia address is formed from it: Ukrainian is transliterated
//! by the official 2010 table, everything is lowercased, whitespace becomes
//! `-`, and the address takes the Avaia `ai` ending the way a default Avaia
//! address does (`xda-market-zoloti-vorotai`). The caption is kept as written.

use crate::{AvaiaPubDress, AvaiaPubDressError};

/// The longest caption accepted, in scalars; the address it forms is bounded
/// again by the Avaia grammar.
pub const MAX_CAPTION_SCALARS: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CaptionError {
    Empty,
    TooLong,
    /// The formed address is not an Avaia address.
    Address(AvaiaPubDressError),
}

impl core::fmt::Display for CaptionError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Empty => formatter.write_str("the caption is empty"),
            Self::TooLong => write!(
                formatter,
                "the caption is longer than {MAX_CAPTION_SCALARS} characters"
            ),
            Self::Address(error) => write!(formatter, "it forms no Avaia address ({error})"),
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

/// The station address a caption forms.
pub fn station_address(caption: &str) -> Result<AvaiaPubDress, CaptionError> {
    let caption = normalize_caption(caption)?;
    let mut slug = String::with_capacity(caption.len());
    let mut word_start = true;
    let mut previous: Option<char> = None;
    for scalar in caption.chars() {
        if scalar.is_whitespace() {
            slug.push('-');
            word_start = true;
            previous = None;
            continue;
        }
        let lower = scalar.to_lowercase().next().unwrap_or(scalar);
        match transliterate(lower, previous, word_start) {
            Some(latin) => slug.push_str(latin),
            None => slug.push(lower),
        }
        word_start = !lower.is_alphanumeric() && lower != '\'' && lower != 'ʼ';
        previous = Some(lower);
    }
    let address = with_ai_ending(&slug);
    address.parse().map_err(CaptionError::Address)
}

/// The Avaia ending, as a default address takes it: a final vowel gives way.
fn with_ai_ending(slug: &str) -> String {
    if slug.ends_with("ai") {
        return slug.to_owned();
    }
    let stem = match slug.chars().next_back() {
        Some('a' | 'e' | 'i' | 'o' | 'u' | 'y') if slug.chars().count() > 2 => {
            &slug[..slug.len() - 1]
        }
        _ => slug,
    };
    format!("{stem}ai")
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
    use super::{CaptionError, normalize_caption, station_address};

    #[test]
    fn forms_the_shop_addresses_from_their_captions() {
        for (caption, address) in [
            ("xda-market Золоті Ворота", "xda-market-zoloti-vorotai"),
            (
                "xda-market Батьківщина-Мати",
                "xda-market-batkivshchyna-matai",
            ),
            ("xda-market  Згорани ", "xda-market-zghoranai"),
            ("xda Їжак Юрій Яр", "xda-yizhak-yurii-yar"),
            ("xda-market В'ячеслав", "xda-market-viacheslav"),
            ("xda-market Подільai", "xda-market-podilai"),
        ] {
            let formed = station_address(caption).map(|value| value.to_string());
            let expected = if address.ends_with("ai") {
                address.to_owned()
            } else {
                format!("{address}ai")
            };
            assert_eq!(formed, Ok(expected), "{caption}");
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
    fn refuses_a_caption_that_forms_no_avaia_address() {
        assert!(matches!(
            station_address("Золоті Ворота"),
            Err(CaptionError::Address(_))
        ));
        // The Avaia grammar bounds the address, whatever the caption allows.
        assert!(matches!(
            station_address("xda-market Їжакевич Юрій Яготин"),
            Err(CaptionError::Address(_))
        ));
        assert!(matches!(
            station_address("xda-market 🌍"),
            Err(CaptionError::Address(_))
        ));
    }
}
