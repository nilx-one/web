# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one {label}")
    return text.replace(old, new, 1)


path = Path("services/identity/src/github_evidence.rs")
text = path.read_text()
text = replace_once(
    text,
    ".signer\n        .verify(&cookie)\n        .filter(|transaction| transaction.expires_at > now)",
    ".signer\n        .verify::<EvidenceTransaction>(&cookie)\n        .filter(|transaction| transaction.expires_at > now)",
    "evidence transaction verification",
)
text = replace_once(
    text,
    "    fn with_endpoints(mut self, authorize: Url, token: Url, api_root: Url) -> Self {",
    "    #[cfg(test)]\n    fn with_endpoints(mut self, authorize: Url, token: Url, api_root: Url) -> Self {",
    "test endpoint override",
)

for old, new, label in [
    (
        '''        if let Some(bound_subject) = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = 'github' LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .fetch_optional(&mut *transaction)
        .await?
        {
            if bound_subject != github_user_id {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch);
            }
        }
''',
        '''        if let Some(bound_subject) = sqlx::query_scalar::<_, String>(
            "SELECT provider_subject FROM identity_providers WHERE pub_dress = ? AND provider = 'github' LIMIT 1",
        )
        .bind(pub_dress.as_str())
        .fetch_optional(&mut *transaction)
        .await?
            && bound_subject != github_user_id
        {
            transaction.commit().await?;
            return Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch);
        }
''',
        "Bond GitHub subject invariant",
    ),
    (
        '''        if let Some(bound_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = 'github' AND provider_subject = ? LIMIT 1",
        )
        .bind(&github_user_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            if bound_pub_dress != pub_dress.as_str() {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected);
            }
        }
''',
        '''        if let Some(bound_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM identity_providers WHERE provider = 'github' AND provider_subject = ? LIMIT 1",
        )
        .bind(&github_user_id)
        .fetch_optional(&mut *transaction)
        .await?
            && bound_pub_dress != pub_dress.as_str()
        {
            transaction.commit().await?;
            return Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected);
        }
''',
        "GitHub provider ownership invariant",
    ),
    (
        '''        if let Some(existing) = &existing_for_bond {
            if existing != &github_user_id {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch);
            }
        }
''',
        '''        if let Some(existing) = &existing_for_bond
            && existing != &github_user_id
        {
            transaction.commit().await?;
            return Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch);
        }
''',
        "existing Bond evidence invariant",
    ),
    (
        '''        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM github_evidence_connections WHERE github_user_id = ?",
        )
        .bind(&github_user_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            if existing_pub_dress != pub_dress.as_str() {
                transaction.commit().await?;
                return Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected);
            }
        }
''',
        '''        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
            "SELECT pub_dress FROM github_evidence_connections WHERE github_user_id = ?",
        )
        .bind(&github_user_id)
        .fetch_optional(&mut *transaction)
        .await?
            && existing_pub_dress != pub_dress.as_str()
        {
            transaction.commit().await?;
            return Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected);
        }
''',
        "existing GitHub evidence ownership invariant",
    ),
]:
    text = replace_once(text, old, new, label)

text = replace_once(
    text,
    '''    use super::{EvidenceTransaction, EvidenceTransactionSigner, GithubEvidenceConnectOutcome, GithubEvidenceRepository, GithubUser};
    use crate::{IdentityRepository, NativeAuthConfig, ProviderIdentity, ProviderLinkRepository, PubDress};
''',
    '''    use super::{
        EvidenceTransaction, EvidenceTransactionSigner, GithubEvidenceConfig,
        GithubEvidenceConnectOutcome, GithubEvidenceRepository, GithubUser,
    };
    use crate::{
        IdentityRepository, NativeAuthConfig, ProviderIdentity, ProviderLinkRepository,
        ProviderSecretCipher, PubDress,
    };
    use url::Url;
''',
    "evidence test imports",
)
text = replace_once(
    text,
    '''    #[test]
    fn transaction_signature_is_bound_to_payload() {
''',
    '''    #[test]
    fn test_provider_endpoints_are_explicitly_overridable() {
        let cipher = ProviderSecretCipher::from_hex_key(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        .expect("cipher");
        let config = GithubEvidenceConfig::new(
            Url::parse("https://nilx.one").expect("origin"),
            None,
            cipher,
        )
        .with_endpoints(
            Url::parse("http://127.0.0.1:4101/authorize").expect("authorize"),
            Url::parse("http://127.0.0.1:4101/token").expect("token"),
            Url::parse("http://127.0.0.1:4101/").expect("api root"),
        );
        assert_eq!(config.api_root.as_str(), "http://127.0.0.1:4101/");
    }

    #[test]
    fn transaction_signature_is_bound_to_payload() {
''',
    "test endpoint override coverage",
)
path.write_text(text)

path = Path("services/identity/src/provider_secret.rs")
text = path.read_text()
text = replace_once(
    text,
    '''fn decode_hex(value: &str) -> Result<Vec<u8>, ProviderSecretError> {
    if value.len() % 2 != 0 || !value.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return Err(ProviderSecretError::InvalidKey);
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).map_err(|_| ProviderSecretError::InvalidKey)?;
            u8::from_str_radix(text, 16).map_err(|_| ProviderSecretError::InvalidKey)
        })
        .collect()
}
''',
    '''fn decode_hex(value: &str) -> Result<Vec<u8>, ProviderSecretError> {
    if !value.len().is_multiple_of(2) || !value.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return Err(ProviderSecretError::InvalidKey);
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| ProviderSecretError::InvalidKey)
        })
        .collect()
}
''',
    "hex decoder",
)
path.write_text(text)
