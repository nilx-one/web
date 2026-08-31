// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::collections::BTreeMap;

use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use thiserror::Error;
use url::form_urlencoded;

type HmacSha256 = Hmac<Sha256>;

const SECRET_KEY_LABEL: &[u8] = b"WebAppData";
const FUTURE_SKEW_SECONDS: u64 = 30;

#[derive(Clone, Debug)]
pub struct TelegramInitDataVerifier {
    bot_token: String,
    max_age_seconds: u64,
}

impl TelegramInitDataVerifier {
    #[must_use]
    pub fn new(bot_token: String, max_age_seconds: u64) -> Self {
        Self {
            bot_token,
            max_age_seconds,
        }
    }

    pub fn verify(
        &self,
        init_data: &str,
        now_unix_seconds: u64,
    ) -> Result<VerifiedTelegramUser, TelegramInitDataError> {
        let fields = parse_fields(init_data)?;
        verify_hash(&fields, &self.bot_token)?;

        let auth_date = fields
            .get("auth_date")
            .ok_or(TelegramInitDataError::MissingAuthDate)?
            .parse::<u64>()
            .map_err(|_| TelegramInitDataError::InvalidAuthDate)?;
        verify_freshness(
            auth_date,
            now_unix_seconds,
            self.max_age_seconds,
            FUTURE_SKEW_SECONDS,
        )?;

        let user = fields
            .get("user")
            .ok_or(TelegramInitDataError::MissingUser)?;
        let user: TelegramUser =
            serde_json::from_str(user).map_err(|_| TelegramInitDataError::InvalidUser)?;

        if user.is_bot {
            return Err(TelegramInitDataError::BotUser);
        }

        Ok(VerifiedTelegramUser { id: user.id })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VerifiedTelegramUser {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
struct TelegramUser {
    id: i64,
    #[serde(default)]
    is_bot: bool,
}

fn parse_fields(init_data: &str) -> Result<BTreeMap<String, String>, TelegramInitDataError> {
    if init_data.is_empty() {
        return Err(TelegramInitDataError::Empty);
    }

    let mut fields = BTreeMap::new();
    for (key, value) in form_urlencoded::parse(init_data.as_bytes()) {
        if fields
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err(TelegramInitDataError::DuplicateField);
        }
    }

    if fields.is_empty() {
        return Err(TelegramInitDataError::Empty);
    }
    Ok(fields)
}

fn verify_hash(
    fields: &BTreeMap<String, String>,
    bot_token: &str,
) -> Result<(), TelegramInitDataError> {
    let received_hash = fields
        .get("hash")
        .ok_or(TelegramInitDataError::MissingHash)?;
    let received_hash = decode_hex_32(received_hash)?;
    let data_check_string = fields
        .iter()
        .filter(|(key, _)| key.as_str() != "hash")
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n");

    let mut secret_key_mac =
        HmacSha256::new_from_slice(SECRET_KEY_LABEL).expect("HMAC accepts keys of any size");
    secret_key_mac.update(bot_token.as_bytes());
    let secret_key = secret_key_mac.finalize().into_bytes();

    let mut data_mac =
        HmacSha256::new_from_slice(&secret_key).expect("HMAC accepts keys of any size");
    data_mac.update(data_check_string.as_bytes());
    data_mac
        .verify_slice(&received_hash)
        .map_err(|_| TelegramInitDataError::InvalidHash)
}

fn decode_hex_32(value: &str) -> Result<[u8; 32], TelegramInitDataError> {
    if value.len() != 64 {
        return Err(TelegramInitDataError::InvalidHash);
    }

    let mut bytes = [0_u8; 32];
    let (pairs, remainder) = value.as_bytes().as_chunks::<2>();
    if !remainder.is_empty() {
        return Err(TelegramInitDataError::InvalidHash);
    }
    for (index, pair) in pairs.iter().enumerate() {
        let high = decode_hex_digit(pair[0]).ok_or(TelegramInitDataError::InvalidHash)?;
        let low = decode_hex_digit(pair[1]).ok_or(TelegramInitDataError::InvalidHash)?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

fn decode_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn verify_freshness(
    auth_date: u64,
    now: u64,
    max_age: u64,
    future_skew: u64,
) -> Result<(), TelegramInitDataError> {
    if auth_date > now.saturating_add(future_skew) {
        return Err(TelegramInitDataError::FutureAuthDate);
    }
    if now.saturating_sub(auth_date) > max_age {
        return Err(TelegramInitDataError::Expired);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum TelegramInitDataError {
    #[error("Telegram initData is empty")]
    Empty,
    #[error("Telegram initData contains a duplicate field")]
    DuplicateField,
    #[error("Telegram initData does not contain hash")]
    MissingHash,
    #[error("Telegram initData hash is invalid")]
    InvalidHash,
    #[error("Telegram initData does not contain auth_date")]
    MissingAuthDate,
    #[error("Telegram initData auth_date is invalid")]
    InvalidAuthDate,
    #[error("Telegram initData is expired")]
    Expired,
    #[error("Telegram initData auth_date is in the future")]
    FutureAuthDate,
    #[error("Telegram initData does not contain a user")]
    MissingUser,
    #[error("Telegram initData user is invalid")]
    InvalidUser,
    #[error("Telegram bot accounts cannot register an identity")]
    BotUser,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use url::form_urlencoded;

    use super::{
        FUTURE_SKEW_SECONDS, HmacSha256, SECRET_KEY_LABEL, TelegramInitDataError,
        TelegramInitDataVerifier,
    };

    const TOKEN: &str = "123456:development-token";
    const NOW: u64 = 1_800_000_000;

    fn signed_init_data(auth_date: u64, user: &str) -> String {
        let mut fields = BTreeMap::from([
            ("auth_date", auth_date.to_string()),
            ("query_id", "query-1".to_owned()),
            ("user", user.to_owned()),
        ]);
        let data_check_string = fields
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut secret = HmacSha256::new_from_slice(SECRET_KEY_LABEL).expect("valid HMAC key");
        secret.update(TOKEN.as_bytes());
        let secret = secret.finalize().into_bytes();
        let mut signature = Hmac::<Sha256>::new_from_slice(&secret).expect("valid HMAC key");
        signature.update(data_check_string.as_bytes());
        let hash = signature
            .finalize()
            .into_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        fields.insert("hash", hash);

        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields)
            .finish()
    }

    #[test]
    fn verifies_signature_freshness_and_user() {
        let verifier = TelegramInitDataVerifier::new(TOKEN.to_owned(), 300);
        let init_data = signed_init_data(NOW - 20, r#"{"id":42,"first_name":"Sasha"}"#);
        let verified = verifier
            .verify(&init_data, NOW)
            .expect("signed initData must verify");

        assert_eq!(verified.id, 42);
    }

    #[test]
    fn rejects_tampering_and_stale_or_future_auth_dates() {
        let verifier = TelegramInitDataVerifier::new(TOKEN.to_owned(), 300);
        let valid = signed_init_data(NOW, r#"{"id":42,"first_name":"Sasha"}"#);
        assert_eq!(
            verifier.verify(&valid.replace("query-1", "query-2"), NOW),
            Err(TelegramInitDataError::InvalidHash)
        );

        let expired = signed_init_data(NOW - 301, r#"{"id":42}"#);
        assert_eq!(
            verifier.verify(&expired, NOW),
            Err(TelegramInitDataError::Expired)
        );

        let future = signed_init_data(NOW + FUTURE_SKEW_SECONDS + 1, r#"{"id":42}"#);
        assert_eq!(
            verifier.verify(&future, NOW),
            Err(TelegramInitDataError::FutureAuthDate)
        );
    }

    #[test]
    fn rejects_duplicate_fields_and_bot_users() {
        let verifier = TelegramInitDataVerifier::new(TOKEN.to_owned(), 300);
        let duplicate = format!("{}&auth_date={NOW}", signed_init_data(NOW, r#"{"id":42}"#));
        assert_eq!(
            verifier.verify(&duplicate, NOW),
            Err(TelegramInitDataError::DuplicateField)
        );

        let bot = signed_init_data(NOW, r#"{"id":42,"is_bot":true}"#);
        assert_eq!(
            verifier.verify(&bot, NOW),
            Err(TelegramInitDataError::BotUser)
        );
    }
}
