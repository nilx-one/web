# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from pathlib import Path

# Enforce the cross-capability GitHub account invariant when provider binding is created.
path = Path("services/identity/src/provider_link.rs")
text = path.read_text()
needle = '''        if !human_exists {
            transaction.rollback().await?;
            return Ok(ProviderLinkOutcome::IdentityMissing);
        }

        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
'''
replacement = '''        if !human_exists {
            transaction.rollback().await?;
            return Ok(ProviderLinkOutcome::IdentityMissing);
        }

        let evidence_table_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'github_evidence_connections')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if provider.provider == IdentityProvider::Github && evidence_table_exists {
            if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
                "SELECT pub_dress FROM github_evidence_connections WHERE github_user_id = ?",
            )
            .bind(&provider.subject)
            .fetch_optional(&mut *transaction)
            .await?
                && existing_pub_dress != pub_dress.as_str()
            {
                transaction.commit().await?;
                return Ok(ProviderLinkOutcome::ProviderAlreadyLinked);
            }
            if let Some(existing_subject) = sqlx::query_scalar::<_, String>(
                "SELECT github_user_id FROM github_evidence_connections WHERE pub_dress = ?",
            )
            .bind(pub_dress.as_str())
            .fetch_optional(&mut *transaction)
            .await?
                && existing_subject != provider.subject
            {
                transaction.commit().await?;
                return Ok(ProviderLinkOutcome::ProviderTypeAlreadyLinked);
            }
        }

        if let Some(existing_pub_dress) = sqlx::query_scalar::<_, String>(
'''
if text.count(needle) != 1:
    raise SystemExit("provider link insertion boundary changed")
text = text.replace(needle, replacement, 1)

text = text.replace(
    "    use crate::{IdentityProvider, IdentityRepository, ProviderIdentity, PubDress};",
    "    use crate::{\n        GithubEvidenceRepository, IdentityProvider, IdentityRepository, ProviderIdentity, PubDress,\n    };",
    1,
)

test_marker = '''    #[tokio::test]
    async fn initialized_provider_link_storage_enforces_provider_type_cardinality_directly() {
'''
test = r'''    #[tokio::test]
    async fn github_provider_binding_cannot_drift_from_existing_evidence_account() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database = directory.path().join("identity.sqlite");
        let database_url = format!("sqlite://{}", database.display());
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identity repository");
        let links = ProviderLinkRepository::connect(&database_url)
            .await
            .expect("provider link repository");
        let _evidence = GithubEvidenceRepository::connect(&database_url)
            .await
            .expect("GitHub evidence repository");
        let first = register_bond(&identities, "0x0sky", "evidence-first").await;
        let second = register_bond(&identities, "0x1sky", "evidence-second").await;

        sqlx::query(
            "INSERT INTO github_evidence_connections \
             (pub_dress, github_user_id, login, profile_url, avatar_url, encrypted_access_token, connection_state, connected_at, refreshed_at) \
             VALUES (?, '42', 'evidence-user', 'https://github.com/evidence-user', 'https://avatars.example/42', X'01', 'connected', 1, 1)",
        )
        .bind(first.as_str())
        .execute(&links.pool)
        .await
        .expect("evidence fixture");

        assert_eq!(
            links
                .link(&first, &ProviderIdentity::github(43))
                .await
                .expect("different account for evidence owner"),
            ProviderLinkOutcome::ProviderTypeAlreadyLinked
        );
        assert_eq!(
            links
                .link(&second, &ProviderIdentity::github(42))
                .await
                .expect("evidence account on another Bond"),
            ProviderLinkOutcome::ProviderAlreadyLinked
        );
        assert_eq!(
            links
                .link(&first, &ProviderIdentity::github(42))
                .await
                .expect("matching account"),
            ProviderLinkOutcome::Linked
        );
    }

'''
if text.count(test_marker) != 1:
    raise SystemExit("provider link test marker changed")
text = text.replace(test_marker, test + test_marker, 1)
path.write_text(text)

# Dedicated OAuth client IDs are a runtime invariant, not documentation only.
path = Path("services/identity/src/main.rs")
text = path.read_text()
needle = '''    let github_evidence_oauth = oauth_credentials_from_environment(
        "GITHUB_EVIDENCE_CLIENT_ID",
        "GITHUB_EVIDENCE_CLIENT_SECRET",
        "GitHub evidence connection",
    );
    let github_evidence_cipher = ProviderSecretCipher::from_hex_key(
'''
replacement = '''    let github_evidence_oauth = oauth_credentials_from_environment(
        "GITHUB_EVIDENCE_CLIENT_ID",
        "GITHUB_EVIDENCE_CLIENT_SECRET",
        "GitHub evidence connection",
    );
    if github_browser_oauth
        .as_ref()
        .zip(github_evidence_oauth.as_ref())
        .is_some_and(|(auth, evidence)| auth.client_id == evidence.client_id)
    {
        panic!("GitHub browser authentication and evidence access must use different OAuth clients");
    }
    let github_evidence_cipher = ProviderSecretCipher::from_hex_key(
'''
if text.count(needle) != 1:
    raise SystemExit("main GitHub evidence credential boundary changed")
text = text.replace(needle, replacement, 1)
path.write_text(text)

# Preserve the same invariant in deployment state preparation.
path = Path("services/identity/deploy/prepare-runtime-env.sh")
text = path.read_text()
needle = '''validate_pair "GitHub evidence OAuth" "$github_evidence_client_id" "$github_evidence_client_secret"

next_env="$(mktemp "$runtime_dir/.runtime.env.XXXXXX")"
'''
replacement = '''validate_pair "GitHub evidence OAuth" "$github_evidence_client_id" "$github_evidence_client_secret"
if [ -n "$github_auth_client_id" ] && [ -n "$github_evidence_client_id" ] && [ "$github_auth_client_id" = "$github_evidence_client_id" ]; then
  echo "GitHub browser authentication and evidence access must use different OAuth clients" >&2
  exit 1
fi

next_env="$(mktemp "$runtime_dir/.runtime.env.XXXXXX")"
'''
if text.count(needle) != 1:
    raise SystemExit("runtime OAuth validation boundary changed")
text = text.replace(needle, replacement, 1)
text = text.replace(
    "    printf 'GITHUB_EVIDENCE_CLIENT_ID=%s\n' \"$github_evidence_client_id\"\n    printf 'GITHUB_EVIDENCE_CLIENT_SECRET=%s\n' \"$github_evidence_client_secret\"",
    "    printf 'GITHUB_EVIDENCE_CLIENT_ID=%s\\n' \"$github_evidence_client_id\"\n    printf 'GITHUB_EVIDENCE_CLIENT_SECRET=%s\\n' \"$github_evidence_client_secret\"",
    1,
)
path.write_text(text)

path = Path("services/identity/deploy/prepare-runtime-env.test.sh")
text = path.read_text()
marker = '''{
  printf '%s\\n' 'TELOXIDE_TOKEN=github-missing-pair'
'''
test = r'''{
  printf '%s\n' 'TELOXIDE_TOKEN=github-shared-client'
  printf '%s\n' 'GITHUB_AUTH_CLIENT_ID=shared-client'
  printf '%s\n' 'GITHUB_AUTH_CLIENT_SECRET=github-auth-secret'
  printf '%s\n' 'GITHUB_EVIDENCE_CLIENT_ID=shared-client'
  printf '%s\n' 'GITHUB_EVIDENCE_CLIENT_SECRET=github-evidence-secret'
} >"$provider"
if sh "$prepare" "$runtime" "$provider" >/dev/null 2>&1; then
  echo "shared GitHub auth/evidence OAuth client unexpectedly succeeded" >&2
  exit 1
fi

'''
if text.count(marker) != 1:
    raise SystemExit("runtime env test marker changed")
text = text.replace(marker, test + marker, 1)
path.write_text(text)
