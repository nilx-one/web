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
    "    IdentityRepository, NativeAuthConfig, OAuthClientCredentials, ProviderSecretCipher, PubDress,\n    SecretDigester,\n};\nuse crate::browser_web_auth::authenticated_native_session;\n",
    "    IdentityRecord, IdentityRepository, NativeAuthConfig, OAuthClientCredentials,\n    ProviderSecretCipher, PubDress, SecretDigester,\n};\n",
    "evidence imports",
)
text = replace_once(
    text,
    'const EVIDENCE_TRANSACTION_COOKIE: &str = "__Host-ox1_github_evidence";\n',
    'const EVIDENCE_TRANSACTION_COOKIE: &str = "__Host-ox1_github_evidence";\nconst SESSION_COOKIE: &str = "__Host-ox1_session";\n',
    "session cookie constant",
)
text = replace_once(
    text,
    '''        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
''',
    '''        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0012_github_evidence_connection.sql"))
            .execute(&pool)
            .await?;
        Ok(Self { pool })
''',
    "evidence repository migration",
)
text = replace_once(
    text,
    '        .append_pair("code_challenge_method", "S256")\n        .append_pair("prompt", "select_account");\n',
    '        .append_pair("code_challenge_method", "S256");\n',
    "authorize query tail",
)
text = replace_once(
    text,
    '''    if !token.scope.trim().is_empty() {
        return callback_failure("github_evidence_scope_rejected");
    }
''',
    '''    if !token.scope.trim().is_empty() {
        let _ = revoke_token(&state, credentials, &token.access_token).await;
        return callback_failure("github_evidence_scope_rejected");
    }
''',
    "token scope rejection",
)
text = replace_once(
    text,
    '''    if !inspection.scopes.is_empty() {
        return callback_failure("github_evidence_scope_rejected");
    }
''',
    '''    if !inspection.scopes.is_empty() {
        let _ = revoke_token(&state, credentials, &token.access_token).await;
        return callback_failure("github_evidence_scope_rejected");
    }
''',
    "inspection scope rejection",
)
text = replace_once(
    text,
    '''        Err(error) => {
            tracing::error!(%error, "GitHub evidence token encryption failed");
            return callback_failure("github_evidence_unavailable");
        }
''',
    '''        Err(error) => {
            tracing::error!(%error, "GitHub evidence token encryption failed");
            let _ = revoke_token(&state, credentials, &token.access_token).await;
            return callback_failure("github_evidence_unavailable");
        }
''',
    "encryption rejection",
)
text = replace_once(
    text,
    '''        Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch) => {
            callback_failure("github_evidence_identity_mismatch")
        }
        Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected) => {
            callback_failure("github_evidence_account_in_use")
        }
        Ok(GithubEvidenceConnectOutcome::BondMissing) => {
            callback_failure("native_authentication_required")
        }
        Err(error) => {
            tracing::error!(%error, "GitHub evidence connection persistence failed");
            callback_failure("github_evidence_unavailable")
        }
''',
    '''        Ok(GithubEvidenceConnectOutcome::ProviderIdentityMismatch) => {
            let _ = revoke_token(&state, credentials, &token.access_token).await;
            callback_failure("github_evidence_identity_mismatch")
        }
        Ok(GithubEvidenceConnectOutcome::GithubAccountAlreadyConnected) => {
            let _ = revoke_token(&state, credentials, &token.access_token).await;
            callback_failure("github_evidence_account_in_use")
        }
        Ok(GithubEvidenceConnectOutcome::BondMissing) => {
            let _ = revoke_token(&state, credentials, &token.access_token).await;
            callback_failure("native_authentication_required")
        }
        Err(error) => {
            tracing::error!(%error, "GitHub evidence connection persistence failed");
            let _ = revoke_token(&state, credentials, &token.access_token).await;
            callback_failure("github_evidence_unavailable")
        }
''',
    "persistence rejection outcomes",
)
text = replace_once(
    text,
    '''fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
''',
    '''async fn authenticated_native_session(
    repository: &IdentityRepository,
    native_auth: &NativeAuthConfig,
    headers: &HeaderMap,
    now: u64,
) -> Option<IdentityRecord> {
    let token = read_cookie(headers, SESSION_COOKIE)?;
    let hash = native_auth
        .secret_digester()
        .digest("native-session", &token);
    repository.find_native_session(&hash, now).await.ok()?
}

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
''',
    "native-session helper",
)
path.write_text(text)

path = Path("services/identity/src/main.rs")
text = path.read_text()
text = replace_once(
    text,
    "    DecimalU64, DiscordOAuthClient, GeoCoordinate, IdentityRecord, IdentityRepository,\n    NativeAuthConfig, OAuthClientCredentials, PendingLocationIntent, ProviderLinkRepository,\n    TelegramInitDataVerifier, TelegramLocationIntents, api, browser_web_auth,\n    location_control_router, public_api, role_for_pub_dress,\n",
    "    DecimalU64, DiscordOAuthClient, GeoCoordinate, GithubEvidenceConfig,\n    GithubEvidenceRepository, IdentityRecord, IdentityRepository, NativeAuthConfig,\n    OAuthClientCredentials, PendingLocationIntent, ProviderLinkRepository, ProviderSecretCipher,\n    TelegramInitDataVerifier, TelegramLocationIntents, api, browser_web_auth, github_evidence,\n    location_control_router, public_api, role_for_pub_dress,\n",
    "identity runtime imports",
)
old = '''    let github_browser_oauth = oauth_credentials_from_environment(
        "GITHUB_AUTH_CLIENT_ID",
        "GITHUB_AUTH_CLIENT_SECRET",
        "GitHub browser authentication",
    );
'''
text = replace_once(
    text,
    old,
    old
    + '''    let github_evidence_oauth = oauth_credentials_from_environment(
        "GITHUB_EVIDENCE_CLIENT_ID",
        "GITHUB_EVIDENCE_CLIENT_SECRET",
        "GitHub evidence connection",
    );
    let github_evidence_cipher = ProviderSecretCipher::from_hex_key(
        &env::var("GITHUB_EVIDENCE_ENCRYPTION_KEY")
            .expect("GITHUB_EVIDENCE_ENCRYPTION_KEY must be configured"),
    )
    .expect("GITHUB_EVIDENCE_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
''',
    "GitHub evidence runtime config",
)
old = '''    let provider_links = ProviderLinkRepository::connect(&database_url)
        .await
        .expect("provider link database connection must initialize");
'''
text = replace_once(
    text,
    old,
    old
    + '''    let github_evidence_connections = GithubEvidenceRepository::connect(&database_url)
        .await
        .expect("GitHub evidence database connection must initialize");
''',
    "GitHub evidence repository wiring",
)
text = replace_once(
    text,
    "            public_origin,\n            telegram_browser_oauth,\n",
    "            public_origin.clone(),\n            telegram_browser_oauth,\n",
    "public origin clone",
)
marker = "    let public_api = public_api::router(repository.clone());\n"
text = replace_once(
    text,
    marker,
    '''    let github_evidence_api = github_evidence::router(
        repository.clone(),
        github_evidence_connections,
        native_auth.clone(),
        GithubEvidenceConfig::new(
            public_origin,
            github_evidence_oauth,
            github_evidence_cipher,
        ),
    );
'''
    + marker,
    "GitHub evidence router",
)
text = replace_once(
    text,
    "    .merge(provider_api)\n    .merge(public_api);\n",
    "    .merge(provider_api)\n    .merge(github_evidence_api)\n    .merge(public_api);\n",
    "GitHub evidence API merge",
)
path.write_text(text)

path = Path("services/identity/deploy/prepare-runtime-env.sh")
text = path.read_text()
text = replace_once(
    text,
    'native_auth_secret="$(read_existing_value NATIVE_AUTH_SECRET)"\npassword_pepper="$(read_existing_value PASSWORD_PEPPER)"\n',
    'native_auth_secret="$(read_existing_value NATIVE_AUTH_SECRET)"\npassword_pepper="$(read_existing_value PASSWORD_PEPPER)"\ngithub_evidence_encryption_key="$(read_existing_value GITHUB_EVIDENCE_ENCRYPTION_KEY)"\n',
    "evidence encryption key read",
)
text = replace_once(
    text,
    'if [ "${#password_pepper}" -lt 32 ] || [ "$password_pepper" = "$native_auth_secret" ]; then\n  password_pepper="$(generate_secret)"\nfi\n',
    'if [ "${#password_pepper}" -lt 32 ] || [ "$password_pepper" = "$native_auth_secret" ]; then\n  password_pepper="$(generate_secret)"\nfi\nif [ "${#github_evidence_encryption_key}" -ne 64 ] || ! printf \'%s\' "$github_evidence_encryption_key" | grep -Eq \'^[0-9a-fA-F]{64}$\'; then\n  github_evidence_encryption_key="$(generate_secret)"\nfi\n',
    "evidence encryption key generation",
)
text = replace_once(
    text,
    '[ "$native_auth_secret" != "$password_pepper" ]\n\nif grep -Eq \'^(NATIVE_AUTH_SECRET|PASSWORD_PEPPER)=\' "$provider_env"; then\n',
    '[ "$native_auth_secret" != "$password_pepper" ]\n[ "${#github_evidence_encryption_key}" -eq 64 ]\n\nif grep -Eq \'^(NATIVE_AUTH_SECRET|PASSWORD_PEPPER|GITHUB_EVIDENCE_ENCRYPTION_KEY)=\' "$provider_env"; then\n',
    "server-owned secret guard",
)
text = replace_once(
    text,
    '''validate_pair "GitHub browser OAuth" "$github_auth_client_id" "$github_auth_client_secret"

next_env=''',
    '''validate_pair "GitHub browser OAuth" "$github_auth_client_id" "$github_auth_client_secret"

github_evidence_client_id="$(read_provider_value GITHUB_EVIDENCE_CLIENT_ID)"
github_evidence_client_secret="$(read_provider_value GITHUB_EVIDENCE_CLIENT_SECRET)"
github_evidence_from_provider=false
if [ -n "$github_evidence_client_id" ] || [ -n "$github_evidence_client_secret" ]; then
  github_evidence_from_provider=true
else
  github_evidence_client_id="$(read_existing_value GITHUB_EVIDENCE_CLIENT_ID)"
  github_evidence_client_secret="$(read_existing_value GITHUB_EVIDENCE_CLIENT_SECRET)"
fi
validate_pair "GitHub evidence OAuth" "$github_evidence_client_id" "$github_evidence_client_secret"

next_env=''',
    "evidence OAuth preservation",
)
text = replace_once(
    text,
    "  printf 'PASSWORD_PEPPER=%s\\n' \"$password_pepper\"\n",
    "  printf 'PASSWORD_PEPPER=%s\\n' \"$password_pepper\"\n  printf 'GITHUB_EVIDENCE_ENCRYPTION_KEY=%s\\n' \"$github_evidence_encryption_key\"\n",
    "evidence key write",
)
text = replace_once(
    text,
    '  cat "$provider_env"\n',
    '''  if [ "$github_evidence_from_provider" = false ] && [ -n "$github_evidence_client_id" ]; then
    printf 'GITHUB_EVIDENCE_CLIENT_ID=%s\n' "$github_evidence_client_id"
    printf 'GITHUB_EVIDENCE_CLIENT_SECRET=%s\n' "$github_evidence_client_secret"
  fi
  cat "$provider_env"
''',
    "evidence OAuth retained write",
)
path.write_text(text)

path = Path("services/identity/deploy/prepare-runtime-env.test.sh")
text = path.read_text()
text = replace_once(
    text,
    'pepper_first="$(value_of PASSWORD_PEPPER "$runtime")"\n',
    'pepper_first="$(value_of PASSWORD_PEPPER "$runtime")"\nevidence_key_first="$(value_of GITHUB_EVIDENCE_ENCRYPTION_KEY "$runtime")"\n',
    "evidence test key capture",
)
text = replace_once(
    text,
    '[ "$native_first" != "$pepper_first" ]\n',
    '[ "$native_first" != "$pepper_first" ]\n[ "${#evidence_key_first}" -eq 64 ]\n',
    "evidence key length assertion",
)
text = replace_once(
    text,
    "  printf '%s\\n' 'GITHUB_AUTH_CLIENT_SECRET=github-auth-secret'\n",
    "  printf '%s\\n' 'GITHUB_AUTH_CLIENT_SECRET=github-auth-secret'\n  printf '%s\\n' 'GITHUB_EVIDENCE_CLIENT_ID=github-evidence-client'\n  printf '%s\\n' 'GITHUB_EVIDENCE_CLIENT_SECRET=github-evidence-secret'\n",
    "evidence provider fixture",
)
text = replace_once(
    text,
    '[ "$(value_of GITHUB_AUTH_CLIENT_SECRET "$runtime")" = github-auth-secret ]\n',
    '[ "$(value_of GITHUB_AUTH_CLIENT_SECRET "$runtime")" = github-auth-secret ]\n[ "$(value_of GITHUB_EVIDENCE_CLIENT_ID "$runtime")" = github-evidence-client ]\n[ "$(value_of GITHUB_EVIDENCE_CLIENT_SECRET "$runtime")" = github-evidence-secret ]\n[ "$(value_of GITHUB_EVIDENCE_ENCRYPTION_KEY "$runtime")" = "$evidence_key_first" ]\n',
    "evidence configured assertions",
)
text = replace_once(
    text,
    '[ "$(value_of GITHUB_AUTH_CLIENT_SECRET "$runtime")" = github-auth-secret ]\n\n{\n  printf \'%s\\n\' \'TELOXIDE_TOKEN=github-missing-pair\'\n',
    '[ "$(value_of GITHUB_AUTH_CLIENT_SECRET "$runtime")" = github-auth-secret ]\n[ "$(value_of GITHUB_EVIDENCE_CLIENT_ID "$runtime")" = github-evidence-client ]\n[ "$(value_of GITHUB_EVIDENCE_CLIENT_SECRET "$runtime")" = github-evidence-secret ]\n[ "$(value_of GITHUB_EVIDENCE_ENCRYPTION_KEY "$runtime")" = "$evidence_key_first" ]\n\n{\n  printf \'%s\\n\' \'TELOXIDE_TOKEN=github-evidence-missing-pair\'\n  printf \'%s\\n\' \'GITHUB_EVIDENCE_CLIENT_ID=github-evidence-client\'\n} >"$provider"\nif sh "$prepare" "$runtime" "$provider" >/dev/null 2>&1; then\n  echo "incomplete GitHub evidence OAuth credentials unexpectedly succeeded" >&2\n  exit 1\nfi\n\n{\n  printf \'%s\\n\' \'TELOXIDE_TOKEN=github-missing-pair\'\n',
    "evidence preservation and incomplete pair tests",
)
needle = '''{
  printf '%s\n' 'TELOXIDE_TOKEN=attempted-override'
  printf '%s\n' 'NATIVE_AUTH_SECRET=not-allowed'
} >"$provider"
'''
text = replace_once(
    text,
    needle,
    '''{
  printf '%s\n' 'TELOXIDE_TOKEN=attempted-evidence-key-override'
  printf '%s\n' 'GITHUB_EVIDENCE_ENCRYPTION_KEY=not-allowed'
} >"$provider"
if sh "$prepare" "$runtime" "$provider" >/dev/null 2>&1; then
  echo "GitHub evidence encryption-key override unexpectedly succeeded" >&2
  exit 1
fi

'''
    + needle,
    "evidence key override test",
)
path.write_text(text)

path = Path("services/identity/deploy/env.example")
text = path.read_text().rstrip() + "\n"
text += "GITHUB_EVIDENCE_CLIENT_ID=replace-with-dedicated-read-only-github-oauth-client-id\n"
text += "GITHUB_EVIDENCE_CLIENT_SECRET=replace-with-dedicated-read-only-github-oauth-client-secret\n"
text += "GITHUB_EVIDENCE_ENCRYPTION_KEY=replace-with-64-hex-character-server-owned-key\n"
path.write_text(text)

path = Path(".github/workflows/deploy-identity-service.yml")
text = path.read_text()
text = replace_once(
    text,
    "      GITHUB_AUTH_CLIENT_SECRET:\n        required: false\n",
    "      GITHUB_AUTH_CLIENT_SECRET:\n        required: false\n      GITHUB_EVIDENCE_CLIENT_SECRET:\n        required: false\n",
    "deploy evidence secret declaration",
)
text = replace_once(
    text,
    "      GITHUB_AUTH_CLIENT_SECRET: ${{ secrets.GITHUB_AUTH_CLIENT_SECRET }}\n",
    "      GITHUB_AUTH_CLIENT_SECRET: ${{ secrets.GITHUB_AUTH_CLIENT_SECRET }}\n      GITHUB_EVIDENCE_CLIENT_ID: ${{ vars.GITHUB_EVIDENCE_CLIENT_ID }}\n      GITHUB_EVIDENCE_CLIENT_SECRET: ${{ secrets.GITHUB_EVIDENCE_CLIENT_SECRET }}\n",
    "deploy evidence env",
)
old = '''          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] || [ -n "$GITHUB_AUTH_CLIENT_SECRET" ]; then
            test -n "$GITHUB_AUTH_CLIENT_ID"
            test -n "$GITHUB_AUTH_CLIENT_SECRET"
          fi
'''
text = replace_once(
    text,
    old,
    old
    + '''          if [ -n "$GITHUB_EVIDENCE_CLIENT_ID" ] || [ -n "$GITHUB_EVIDENCE_CLIENT_SECRET" ]; then
            test -n "$GITHUB_EVIDENCE_CLIENT_ID"
            test -n "$GITHUB_EVIDENCE_CLIENT_SECRET"
          fi
''',
    "deploy evidence validation",
)
old = '''          if [ -n "$GITHUB_AUTH_CLIENT_ID" ] && [ -n "$GITHUB_AUTH_CLIENT_SECRET" ]; then
            printf 'GITHUB_AUTH_CLIENT_ID=%s\n' "$GITHUB_AUTH_CLIENT_ID" >>"$provider_file"
            printf 'GITHUB_AUTH_CLIENT_SECRET=%s\n' "$GITHUB_AUTH_CLIENT_SECRET" >>"$provider_file"
          fi
'''
text = replace_once(
    text,
    old,
    old
    + '''          if [ -n "$GITHUB_EVIDENCE_CLIENT_ID" ] && [ -n "$GITHUB_EVIDENCE_CLIENT_SECRET" ]; then
            printf 'GITHUB_EVIDENCE_CLIENT_ID=%s\n' "$GITHUB_EVIDENCE_CLIENT_ID" >>"$provider_file"
            printf 'GITHUB_EVIDENCE_CLIENT_SECRET=%s\n' "$GITHUB_EVIDENCE_CLIENT_SECRET" >>"$provider_file"
          fi
''',
    "deploy evidence provider file",
)
path.write_text(text)
