# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from pathlib import Path

path = Path("services/identity/src/github_evidence.rs")
text = path.read_text()
text = text.replace(
    "    #[cfg(test)]\n    #[cfg(test)]\n    fn with_endpoints",
    "    #[cfg(test)]\n    fn with_endpoints",
    1,
)

old_imports = '''    use std::str::FromStr;

    use super::{
        EvidenceTransaction, EvidenceTransactionSigner, GithubEvidenceConfig,
        GithubEvidenceConnectOutcome, GithubEvidenceRepository, GithubUser,
    };
    use crate::{
        IdentityRepository, NativeAuthConfig, ProviderIdentity, ProviderLinkRepository,
        ProviderSecretCipher, PubDress,
    };
    use url::Url;
'''
new_imports = '''    use std::{
        str::FromStr,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
    };

    use axum::{
        Json, Router,
        body::{Body, to_bytes},
        extract::State,
        http::{Request, StatusCode, header},
        response::{IntoResponse, Response},
        routing::post,
    };
    use tower::ServiceExt as _;

    use super::{
        CSRF_HEADER, EVIDENCE_TRANSACTION_COOKIE, EvidenceTransaction, EvidenceTransactionSigner,
        GithubEvidenceConfig, GithubEvidenceConnectOutcome, GithubEvidenceRepository, GithubUser,
        SESSION_COOKIE, now_unix_seconds, router as evidence_router, token_aad,
    };
    use crate::{
        IdentityRepository, NativeAuthConfig, OAuthClientCredentials, ProviderIdentity,
        ProviderLinkRepository, ProviderSecretCipher, PubDress,
    };
    use url::Url;
'''
if old_imports not in text:
    raise SystemExit("github evidence test imports changed")
text = text.replace(old_imports, new_imports, 1)

marker = '''    #[tokio::test]
    async fn evidence_account_cannot_drift_from_the_bonds_github_provider() {
'''
helpers = r'''    const TEST_TOKEN: &str = "gho_evidence_test";

    #[derive(Clone)]
    struct MockGithubState {
        revoked: Arc<AtomicBool>,
    }

    async fn mock_token_exchange() -> Json<serde_json::Value> {
        Json(serde_json::json!({"access_token": TEST_TOKEN, "scope": ""}))
    }

    async fn mock_token_inspection(State(state): State<MockGithubState>) -> Response {
        if state.revoked.load(Ordering::SeqCst) {
            StatusCode::NOT_FOUND.into_response()
        } else {
            Json(serde_json::json!({
                "scopes": [],
                "user": {
                    "id": 42,
                    "login": "evidence-user",
                    "html_url": "https://github.com/evidence-user",
                    "avatar_url": "https://avatars.example/42"
                }
            }))
            .into_response()
        }
    }

    async fn mock_token_revoke(State(state): State<MockGithubState>) -> StatusCode {
        state.revoked.store(true, Ordering::SeqCst);
        StatusCode::NO_CONTENT
    }

    async fn spawn_mock_github(initially_revoked: bool) -> (Url, Arc<AtomicBool>) {
        let revoked = Arc::new(AtomicBool::new(initially_revoked));
        let app = Router::new()
            .route("/token", post(mock_token_exchange))
            .route(
                "/applications/client/token",
                post(mock_token_inspection).delete(mock_token_revoke),
            )
            .with_state(MockGithubState {
                revoked: Arc::clone(&revoked),
            });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock GitHub listener");
        let address = listener.local_addr().expect("mock GitHub address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("mock GitHub server");
        });
        (
            Url::parse(&format!("http://{address}/")).expect("mock GitHub URL"),
            revoked,
        )
    }

    struct EvidenceTestStack {
        _directory: tempfile::TempDir,
        app: Router,
        evidence: GithubEvidenceRepository,
        auth: NativeAuthConfig,
        cipher: ProviderSecretCipher,
        bond: PubDress,
        session_token: String,
    }

    async fn evidence_test_stack(provider_root: &Url) -> EvidenceTestStack {
        let directory = tempfile::tempdir().expect("directory");
        let database_url = format!(
            "sqlite://{}",
            directory.path().join("identity.sqlite").display()
        );
        let identities = IdentityRepository::connect(&database_url)
            .await
            .expect("identities");
        let evidence = GithubEvidenceRepository::connect(&database_url)
            .await
            .expect("evidence");
        let bond = register_bond(&identities, "0x0sky", "http").await;
        let auth = auth();
        let session_token = "native-session-token".to_owned();
        let now = now_unix_seconds().expect("clock");
        let session_hash = auth
            .secret_digester()
            .digest("native-session", &session_token);
        identities
            .create_native_session(
                &session_hash,
                bond.as_str(),
                now.saturating_sub(1),
                now.saturating_add(3600),
            )
            .await
            .expect("native session");
        let cipher = ProviderSecretCipher::from_hex_key(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        .expect("cipher");
        let config = GithubEvidenceConfig::new(
            Url::parse("https://nilx.one").expect("origin"),
            Some(OAuthClientCredentials::new("client", "secret")),
            cipher.clone(),
        )
        .with_endpoints(
            provider_root.join("authorize").expect("authorize"),
            provider_root.join("token").expect("token"),
            provider_root.clone(),
        );
        let app = evidence_router(identities.clone(), evidence.clone(), auth.clone(), config);
        EvidenceTestStack {
            _directory: directory,
            app,
            evidence,
            auth,
            cipher,
            bond,
            session_token,
        }
    }

    fn session_cookie(session_token: &str) -> String {
        format!("{SESSION_COOKIE}={session_token}")
    }

    async fn begin_connection(stack: &EvidenceTestStack) -> (String, String) {
        let response = stack
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/github/evidence/start")
                    .header(header::COOKIE, session_cookie(&stack.session_token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("start response");
        assert_eq!(response.status(), StatusCode::FOUND);
        let transaction_cookie = response
            .headers()
            .get(header::SET_COOKIE)
            .expect("transaction cookie")
            .to_str()
            .expect("cookie text")
            .split(';')
            .next()
            .expect("cookie pair")
            .to_owned();
        let location = response
            .headers()
            .get(header::LOCATION)
            .expect("authorize location")
            .to_str()
            .expect("location text");
        let state = Url::parse(location)
            .expect("authorize URL")
            .query_pairs()
            .find_map(|(key, value)| (key == "state").then(|| value.into_owned()))
            .expect("OAuth state");
        (transaction_cookie, state)
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        serde_json::from_slice(&bytes).expect("JSON response")
    }

    #[tokio::test]
    async fn happy_callback_persists_only_encrypted_evidence_credential() {
        let (provider_root, _) = spawn_mock_github(false).await;
        let stack = evidence_test_stack(&provider_root).await;
        let (transaction_cookie, state) = begin_connection(&stack).await;
        let response = stack
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/github/evidence/callback?code=accepted&state={state}"
                    ))
                    .header(
                        header::COOKIE,
                        format!(
                            "{}; {transaction_cookie}",
                            session_cookie(&stack.session_token)
                        ),
                    )
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("callback response");
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            response
                .headers()
                .get(header::LOCATION)
                .expect("redirect")
                .to_str()
                .expect("redirect text"),
            "/identity?github_evidence=connected"
        );
        let record = stack
            .evidence
            .get(&stack.bond)
            .await
            .expect("lookup")
            .expect("connected evidence");
        assert_ne!(record.encrypted_access_token, TEST_TOKEN.as_bytes());
        assert_eq!(
            stack
                .cipher
                .open(
                    &record.encrypted_access_token,
                    token_aad(&record.pub_dress, &record.github_user_id).as_bytes(),
                )
                .expect("decrypt test token"),
            TEST_TOKEN
        );
    }

    #[tokio::test]
    async fn callback_rejects_state_mismatch_without_persisting_connection() {
        let (provider_root, _) = spawn_mock_github(false).await;
        let stack = evidence_test_stack(&provider_root).await;
        let (transaction_cookie, _) = begin_connection(&stack).await;
        let response = stack
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/github/evidence/callback?code=accepted&state=wrong")
                    .header(
                        header::COOKIE,
                        format!(
                            "{}; {transaction_cookie}",
                            session_cookie(&stack.session_token)
                        ),
                    )
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("callback response");
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            response
                .headers()
                .get(header::LOCATION)
                .expect("redirect")
                .to_str()
                .expect("redirect text"),
            "/identity?github_evidence_error=github_evidence_state_mismatch"
        );
        assert!(
            stack
                .evidence
                .get(&stack.bond)
                .await
                .expect("lookup")
                .is_none()
        );
    }

    #[tokio::test]
    async fn callback_rejects_expired_signed_transaction() {
        let (provider_root, _) = spawn_mock_github(false).await;
        let stack = evidence_test_stack(&provider_root).await;
        let now = now_unix_seconds().expect("clock");
        let transaction = EvidenceTransaction {
            pub_dress: stack.bond.to_string(),
            state: "expired-state".to_owned(),
            verifier: "expired-verifier".to_owned(),
            expires_at: now.saturating_sub(1),
        };
        let signed = EvidenceTransactionSigner::new(stack.auth.secret_digester())
            .issue(&transaction)
            .expect("signed transaction");
        let response = stack
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/github/evidence/callback?code=accepted&state=expired-state")
                    .header(
                        header::COOKIE,
                        format!(
                            "{}; {EVIDENCE_TRANSACTION_COOKIE}={signed}",
                            session_cookie(&stack.session_token)
                        ),
                    )
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("callback response");
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            response
                .headers()
                .get(header::LOCATION)
                .expect("redirect")
                .to_str()
                .expect("redirect text"),
            "/identity?github_evidence_error=github_evidence_transaction_expired"
        );
    }

    #[tokio::test]
    async fn revoked_token_projects_and_persists_degraded_state() {
        let (provider_root, _) = spawn_mock_github(true).await;
        let stack = evidence_test_stack(&provider_root).await;
        let github = user(42, "evidence-user");
        let encrypted = stack
            .cipher
            .seal(
                TEST_TOKEN,
                token_aad(stack.bond.as_str(), "42").as_bytes(),
            )
            .expect("encrypt token");
        stack
            .evidence
            .connect_account(&stack.bond, &github, &encrypted, 10)
            .await
            .expect("persist evidence");
        let response = stack
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/github/evidence")
                    .header(header::COOKIE, session_cookie(&stack.session_token))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("read response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["state"], "degraded");
        assert_eq!(body["diagnostic"], "token_revoked");
        let record = stack
            .evidence
            .get(&stack.bond)
            .await
            .expect("lookup")
            .expect("evidence row");
        assert_eq!(record.connection_state, "degraded");
        assert_eq!(record.diagnostic.as_deref(), Some("token_revoked"));
    }

    #[tokio::test]
    async fn disconnect_revokes_provider_token_before_clearing_local_credential() {
        let (provider_root, revoked) = spawn_mock_github(false).await;
        let stack = evidence_test_stack(&provider_root).await;
        let github = user(42, "evidence-user");
        let encrypted = stack
            .cipher
            .seal(
                TEST_TOKEN,
                token_aad(stack.bond.as_str(), "42").as_bytes(),
            )
            .expect("encrypt token");
        stack
            .evidence
            .connect_account(&stack.bond, &github, &encrypted, 10)
            .await
            .expect("persist evidence");
        let response = stack
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/github/evidence/disconnect")
                    .header(header::COOKIE, session_cookie(&stack.session_token))
                    .header(CSRF_HEADER, "1")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("disconnect response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response_json(response).await["state"], "disconnected");
        assert!(revoked.load(Ordering::SeqCst));
        assert!(
            stack
                .evidence
                .get(&stack.bond)
                .await
                .expect("lookup")
                .is_none()
        );
    }

'''
if marker not in text:
    raise SystemExit("acceptance insertion marker missing")
text = text.replace(marker, helpers + marker, 1)
path.write_text(text)
