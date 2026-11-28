// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    env,
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use identity_bot::{
    BondLocationRepository, BrowserOAuthConfig, DiscordOAuthClient, GithubEvidenceConfig,
    GithubEvidenceRepository, IdentityRepository, NativeAuthConfig, OAuthClientCredentials,
    PartnerLookupConfig, ProviderLinkRepository, ProviderSecretCipher, TelegramInitDataVerifier,
    aiaiaiai_sign_in, api, browser_web_auth, business_command, github_evidence, issuer,
    location_control_router, partner_account_router, partner_lookup_router, product_sign_in,
    provider_self_service_router, public_api, public_info,
    speech::{DEFAULT_EARSHOT_METERS, SpeechConfig, SpeechRepository, speech_router},
};
use tracing::info;
use tracing_subscriber::EnvFilter;
use url::Url;

const DEFAULT_PUBLIC_ORIGIN: &str = "https://nilx.one";

/// The HTTP service owns provider evidence verification, not Telegram transport.
/// Refuse even an empty token variable; do not silently accept the old runtime.
fn public_telegram_verifier(
    bot_id: Option<&str>,
    token_present: bool,
    polling: Option<&str>,
    max_age: u64,
) -> Result<TelegramInitDataVerifier, &'static str> {
    if token_present {
        return Err("TELEGRAM_BOT_TOKEN belongs exclusively to nilx-one/bot");
    }
    if polling.is_some_and(|value| value != "disabled") {
        return Err("Web cannot poll Telegram updates");
    }
    let id = bot_id
        .filter(|value| {
            !value.is_empty()
                && !value.starts_with('0')
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or("TELEGRAM_BOT_ID must be a canonical positive public bot identifier")?;
    TelegramInitDataVerifier::for_production_bot(id, max_age)
        .ok_or("Telegram public verification authority is invalid")
}

fn telegram_verifier_from_environment() -> Result<TelegramInitDataVerifier, &'static str> {
    let bot_id = env::var("TELEGRAM_BOT_ID").ok();
    let polling = env::var("TELEGRAM_POLLING").ok();
    let max_age = env::var("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS")
        .map_or(Ok(300_u64), |value| value.parse::<u64>())
        .map_err(|_| "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS must be an unsigned integer")?;
    public_telegram_verifier(
        bot_id.as_deref(),
        env::var_os("TELEGRAM_BOT_TOKEN").is_some(),
        polling.as_deref(),
        max_age,
    )
}

async fn run_operator_command(args: &[String]) -> i32 {
    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://identity.db".to_owned());
    let repository = match IdentityRepository::connect(&database_url).await {
        Ok(repository) => repository,
        Err(error) => {
            eprintln!("identity storage is unavailable: {error}");
            return 1;
        }
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    match business_command::run(&repository, args, now).await {
        Ok(line) => {
            println!("{line}");
            0
        }
        Err(line) => {
            eprintln!("{line}");
            2
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("identity_bot=info")),
        )
        .init();

    // `identity-bot business …` is an operator command, not the service.
    let args: Vec<String> = env::args().skip(1).collect();
    if args.as_slice() == ["--check-public-authority"] {
        telegram_verifier_from_environment().expect("public Telegram authority configuration");
        println!("Telegram public authority configuration verified");
        return;
    }
    if !args.is_empty() {
        std::process::exit(run_operator_command(&args).await);
    }

    let telegram_activity_verifier =
        telegram_verifier_from_environment().expect("public Telegram authority configuration");
    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://identity.db".to_owned());
    let http_bind = env::var("HTTP_BIND")
        .unwrap_or_else(|_| "0.0.0.0:1927".to_owned())
        .parse::<SocketAddr>()
        .expect("HTTP_BIND must be a socket address");
    let public_origin = env::var("PUBLIC_ORIGIN")
        .unwrap_or_else(|_| DEFAULT_PUBLIC_ORIGIN.to_owned())
        .parse::<Url>()
        .expect("PUBLIC_ORIGIN must be a valid URL");
    if public_origin.scheme() != "https" || public_origin.host_str().is_none() {
        panic!("PUBLIC_ORIGIN must be an https origin");
    }
    let native_auth = NativeAuthConfig::new(
        env::var("NATIVE_AUTH_SECRET").expect("NATIVE_AUTH_SECRET must be configured"),
        env::var("PASSWORD_PEPPER").expect("PASSWORD_PEPPER must be configured"),
    )
    .expect("native authentication secrets must satisfy the minimum length");

    let speech_config = env::var("SPEECH_INGEST_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .map(|token| {
            let earshot_meters = env::var("SPEECH_EARSHOT_METERS")
                .map_or(Ok(DEFAULT_EARSHOT_METERS), |value| value.parse::<u32>())
                .expect("SPEECH_EARSHOT_METERS must be an unsigned integer");
            SpeechConfig::new(&token, earshot_meters).expect(
                "SPEECH_INGEST_TOKEN and SPEECH_EARSHOT_METERS must satisfy the speech contract",
            )
        });
    let partner_lookup_config = env::var("PARTNER_LOOKUP_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .map(|token| {
            PartnerLookupConfig::new(&token)
                .expect("PARTNER_LOOKUP_TOKEN must satisfy the partner lookup contract")
        });
    let telegram_browser_oauth = oauth_credentials_from_environment(
        "TELEGRAM_OIDC_CLIENT_ID",
        "TELEGRAM_OIDC_CLIENT_SECRET",
        "Telegram browser authentication",
    );
    let discord_credentials = oauth_credentials_from_environment(
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "Discord authentication",
    );
    let github_browser_oauth = oauth_credentials_from_environment(
        "GITHUB_AUTH_CLIENT_ID",
        "GITHUB_AUTH_CLIENT_SECRET",
        "GitHub browser authentication",
    );
    let github_evidence_oauth = oauth_credentials_from_environment(
        "GITHUB_EVIDENCE_CLIENT_ID",
        "GITHUB_EVIDENCE_CLIENT_SECRET",
        "GitHub evidence connection",
    );
    if github_browser_oauth
        .as_ref()
        .zip(github_evidence_oauth.as_ref())
        .is_some_and(|(auth, evidence)| auth.client_id == evidence.client_id)
    {
        panic!(
            "GitHub browser authentication and evidence access must use different OAuth clients"
        );
    }
    let github_evidence_cipher = ProviderSecretCipher::from_hex_key(
        &env::var("GITHUB_EVIDENCE_ENCRYPTION_KEY")
            .expect("GITHUB_EVIDENCE_ENCRYPTION_KEY must be configured"),
    )
    .expect("GITHUB_EVIDENCE_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
    let discord_activity_oauth = discord_credentials.as_ref().map(|credentials| {
        DiscordOAuthClient::new(
            credentials.client_id.clone(),
            credentials.client_secret.clone(),
        )
    });

    let repository = IdentityRepository::connect(&database_url)
        .await
        .expect("identity database must initialize");
    repository
        .initialize_avaia_configuration()
        .await
        .expect("Avaia configuration storage must initialize");
    let locations = BondLocationRepository::connect(&database_url)
        .await
        .expect("Bond location storage must initialize");
    let speech = SpeechRepository::connect(&database_url)
        .await
        .expect("spoken line storage must initialize");
    let provider_links = ProviderLinkRepository::connect(&database_url)
        .await
        .expect("provider link database connection must initialize");
    let github_evidence_connections = GithubEvidenceRepository::connect(&database_url)
        .await
        .expect("GitHub evidence database connection must initialize");
    let browser_oauth = BrowserOAuthConfig::new(
        public_origin.clone(),
        telegram_browser_oauth,
        discord_credentials,
        github_browser_oauth,
    );
    let product_sign_in =
        product_sign_in_from_environment(&public_origin, &database_url, &native_auth).await;
    let (legacy_migration, product_bonds) = match product_sign_in {
        Some(_) => {
            product_bonds_from_environment(&public_origin, &database_url, &native_auth).await
        }
        None => (None, None),
    };
    let telegram_login_api = match env::var_os("TELEGRAM_LOGIN_AIS_PUBLIC_JWK") {
        None => axum::Router::new(),
        Some(value) => {
            use identity_bot::telegram_login::{
                Authority, ChatSignIn, HostAisToken, ISSUER, authenticated_router,
            };
            let authority = value
                .to_str()
                .and_then(Authority::from_public_jwk)
                .expect("Telegram login requires the trusted public AIS Ed25519 signing JWK");
            let callback = public_origin
                .join("/api/v1/telegram/login/callback")
                .expect("Telegram callback path");
            let config = aiaiaiai_sign_in::SignInClientConfig::public(
                ISSUER,
                None,
                "0x1",
                callback.as_str(),
            )
            .expect("Telegram AIS client configuration");
            let repository = public_info::PublicInfoRepository::connect(&database_url)
                .await
                .expect("Telegram login product database");
            // The callback and confirmation need the host's own AIS key;
            // without it the host only starts logins.
            let chat = match (
                env::var("TELEGRAM_LOGIN_HOST_AIS_KEY_ID"),
                env::var("TELEGRAM_LOGIN_HOST_AIS_SIGNING_SEED"),
            ) {
                (Ok(kid), Ok(seed)) => Some(ChatSignIn {
                    ais: HostAisToken::new(ISSUER, &kid, &seed)
                        .expect("Telegram chat sign-in requires a valid host AIS key"),
                    provisioning: product_bonds.clone(),
                    session_ttl_seconds: native_auth.session_ttl_seconds,
                }),
                (Err(_), Err(_)) => None,
                _ => panic!(
                    "TELEGRAM_LOGIN_HOST_AIS_KEY_ID and TELEGRAM_LOGIN_HOST_AIS_SIGNING_SEED \
                     are set together"
                ),
            };
            authenticated_router(
                repository,
                aiaiaiai_sign_in::SignInClient::new(config),
                authority,
                chat,
            )
        }
    };
    let product_api = product_sign_in::router_with_bonds(
        product_sign_in,
        legacy_migration,
        product_bonds.clone(),
    );
    let provider_api = browser_web_auth::router(
        repository.clone(),
        provider_links.clone(),
        native_auth.clone(),
        browser_oauth,
    );
    let issuer_api = issuer_from_environment()
        .map(|config| issuer::router(config, repository.clone(), native_auth.clone()));
    let github_evidence_api = github_evidence::router(
        repository.clone(),
        github_evidence_connections,
        native_auth.clone(),
        GithubEvidenceConfig::new(public_origin, github_evidence_oauth, github_evidence_cipher),
    );
    let public_api = public_api::router(repository.clone());
    let location_api = location_control_router(
        repository.clone(),
        locations.clone(),
        telegram_activity_verifier.clone(),
        discord_activity_oauth.clone(),
        native_auth.clone(),
        product_bonds.clone(),
    );
    let pub_info_api = api::pub_info_router_with_product_bonds(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier.clone(),
        discord_activity_oauth.clone(),
        native_auth.clone(),
        product_bonds.clone(),
    );
    let speech_api = speech_config.map(|config| {
        info!("spoken lines enabled");
        speech_router(
            repository.clone(),
            locations.clone(),
            speech.clone(),
            telegram_activity_verifier.clone(),
            discord_activity_oauth.clone(),
            native_auth.clone(),
            config,
            product_bonds.clone(),
        )
    });
    let avaia_api = api::avaia_router(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier.clone(),
        discord_activity_oauth.clone(),
        native_auth.clone(),
        product_bonds.clone(),
    );
    let provider_self_service_api = provider_self_service_router(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier.clone(),
    );
    let session_activation_api = api::session_activation_router(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier.clone(),
        discord_activity_oauth.clone(),
        native_auth.clone(),
    );
    let api = api::router_with_product_bonds(
        repository.clone(),
        provider_links.clone(),
        telegram_activity_verifier,
        discord_activity_oauth,
        native_auth,
        product_bonds,
    )
    .merge(avaia_api)
    .merge(pub_info_api)
    .merge(location_api)
    .merge(provider_api)
    .merge(product_api)
    .merge(telegram_login_api)
    .merge(provider_self_service_api)
    .merge(session_activation_api)
    .merge(github_evidence_api)
    .merge(public_api);
    let api = match issuer_api {
        Some(issuer_api) => api.merge(issuer_api),
        None => api,
    };
    let api = match speech_api {
        Some(speech_api) => api.merge(speech_api),
        None => api,
    };
    let api = match partner_lookup_config {
        Some(config) => api
            .merge(partner_lookup_router(
                config.clone(),
                provider_links.clone(),
            ))
            .merge(partner_account_router(
                config,
                repository.clone(),
                provider_links.clone(),
            )),
        None => api,
    };
    let listener = tokio::net::TcpListener::bind(http_bind)
        .await
        .expect("identity HTTP listener must bind");

    // A service that can hand a Bond to Market also settles what that Bond
    // buys there: the issuer worker follows the handoff secret, with no switch
    // of its own. A development service must still target its isolated TEST
    // Market, never production's.
    if let Some(config) = identity_bot::market_issuer_config() {
        if std::env::var("DEPLOY_ENV").as_deref() == Ok("development") {
            let browser = std::env::var("NILX_MARKET_BROWSER_ORIGIN").unwrap_or_default();
            let issuer = std::env::var("MARKET_ISSUER_URL").unwrap_or_default();
            assert!(
                identity_bot::development_market_issuer_endpoint_allowed(&browser, &issuer),
                "development issuer must target its isolated TEST Market origin"
            );
        }
        let config =
            config.expect("NILX_BROWSER_HANDOFF_TOKEN must satisfy the market issuer contract");
        let interval = config.poll_interval;
        info!(market = %config.base_url, "starting market issuer worker");
        let market = identity_bot::market_issuer::HttpMarketIssuer::new(config)
            .expect("market issuer HTTP client must build");
        let worker = identity_bot::market_issuer::MarketIssuerWorker::new(
            repository.clone(),
            market,
            Arc::new(identity_bot::market_issuer::system_now_ms),
        );
        // A paid Special becomes an item the Bond collects and activates, not
        // time granted at payment.
        let worker = worker.with_paid_items();
        tokio::spawn(identity_bot::market_issuer::run_market_issuer_worker(
            worker, interval,
        ));
    }
    // The Telegram checkout settles a separate Market queue and grants the term directly. A
    // Telegram order is authorized by the buyer's AIS permit, not by polling that queue, so the
    // worker only settles what a permit names. Without the queue the route is not served.
    let api = match identity_bot::telegram_issuer_url(
        std::env::var("MARKET_TELEGRAM_ISSUER_URL").ok().as_deref(),
    ) {
        Some(url) => {
            let secret = std::env::var("NILX_BROWSER_HANDOFF_TOKEN").unwrap_or_default();
            let config = identity_bot::market_issuer::MarketIssuerConfig::new(&secret, Some(&url))
                .expect("Telegram issuer must satisfy the market issuer contract");
            let market = identity_bot::market_issuer::HttpMarketIssuer::new(config)
                .expect("Telegram issuer HTTP client must build");
            let worker = identity_bot::market_issuer::MarketIssuerWorker::new(
                repository.clone(),
                market,
                Arc::new(identity_bot::market_issuer::system_now_ms),
            );
            info!("AIS Telegram purchases enabled");
            api.merge(identity_bot::ais_purchase::router(
                identity_bot::ais_purchase::AisPurchase::new(worker),
            ))
        }
        None => {
            info!("AIS Telegram purchases are not configured");
            api
        }
    };
    info!(%http_bind, "starting token-free identity HTTP service");
    axum::serve(listener, api)
        .await
        .expect("identity HTTP server must remain available");
}

/// The aiaiaiai Identity issuer (`auth.aiaiaiai.org`). All three settings or
/// none: a half-configured issuer must not start.
fn issuer_from_environment() -> Option<issuer::IssuerConfig> {
    let read = |key: &str| env::var(key).ok().filter(|value| !value.is_empty());
    match (
        read("AIAIAIAI_ISSUER"),
        read("AIAIAIAI_ISSUER_SIGNING_KEY"),
        read("AIAIAIAI_ISSUER_CLIENTS"),
    ) {
        (Some(origin), Some(key), Some(clients)) => {
            let config = issuer::IssuerConfig::new(&origin, &key, &clients)
                .unwrap_or_else(|error| panic!("{error}"));
            info!(issuer = %origin, "aiaiaiai Identity issuer enabled");
            Some(config)
        }
        (None, None, None) => {
            info!("aiaiaiai Identity issuer is not configured");
            None
        }
        _ => panic!(
            "AIAIAIAI_ISSUER, AIAIAIAI_ISSUER_SIGNING_KEY and AIAIAIAI_ISSUER_CLIENTS must be configured together"
        ),
    }
}

/// 0x1 as a client of AIS, through Core's product service. 0x1 has one
/// database: the product profile and its sessions are tables in the same
/// `DATABASE_URL` as the rest of 0x1's state, never in AIS's.
async fn product_sign_in_from_environment(
    public_origin: &Url,
    database_url: &str,
    native_auth: &NativeAuthConfig,
) -> Option<product_sign_in::ProductSignIn> {
    let read = |key: &str| env::var(key).ok().filter(|value| !value.is_empty());
    // The issuer's address is the one setting, and it is not a secret: 0x1 is a
    // public client of AIS, so there is nothing to generate, store or carry.
    let Some(issuer) = read("AIAIAIAI_SIGN_IN_ISSUER") else {
        info!("aiaiaiai sign-in is not configured");
        return None;
    };
    let backchannel = read("AIAIAIAI_SIGN_IN_BACKCHANNEL");
    let config = product_sign_in_client(&issuer, backchannel.as_deref(), public_origin)
        .unwrap_or_else(|error| panic!("aiaiaiai sign-in configuration: {error}"));
    let flow = aiaiaiai_sign_in::SignInFlow::new(
        aiaiaiai_sign_in::SignInClient::new(config),
        native_auth.secret_digester(),
    );
    let repository = public_info::PublicInfoRepository::connect(database_url)
        .await
        .expect("the 0x1 product tables must initialize");
    let service = public_info::PublicInfoService::new(flow, repository)
        .expect("the product service accepts the 0x1 client");
    info!(issuer = %issuer, "aiaiaiai sign-in enabled for the 0x1 site");
    Some(product_sign_in::ProductSignIn::new(service, native_auth))
}

/// The AIS Bond features that come with AIS sign-in: attaching an AIS identity
/// to an existing Bond, giving a person's first sign-in its Bond, and letting
/// a Bond's product session act in the game. They need Core's store, which
/// refuses to prepare unless legacy and product tables share this database.
async fn product_bonds_from_environment(
    public_origin: &Url,
    database_url: &str,
    native_auth: &NativeAuthConfig,
) -> (
    Option<product_sign_in::LegacyMigration>,
    Option<identity_bot::ProductBondAuth>,
) {
    let Some(issuer) = env::var("AIAIAIAI_SIGN_IN_ISSUER")
        .ok()
        .filter(|value| !value.is_empty())
    else {
        return (None, None);
    };
    let backchannel = env::var("AIAIAIAI_SIGN_IN_BACKCHANNEL")
        .ok()
        .filter(|value| !value.is_empty());
    let config = product_sign_in_client(&issuer, backchannel.as_deref(), public_origin)
        .unwrap_or_else(|error| panic!("AIS Bond sign-in configuration: {error}"));
    let flow = aiaiaiai_sign_in::SignInFlow::legacy_migration(
        aiaiaiai_sign_in::SignInClient::new(config),
        native_auth.secret_digester(),
    )
    .expect("legacy migration proves only the 0x1 client");
    let repository = public_info::PublicInfoRepository::connect(database_url)
        .await
        .expect("the 0x1 product tables must initialize");
    let store = public_info::LegacyBondMigrationRepository::prepare(repository.clone())
        .await
        .expect("AIS Bonds need legacy and product tables in one SQLite store");
    let bonds = identity_bot::ProductBondAuth::new(
        store.clone(),
        repository,
        native_auth.secret_digester(),
    );
    info!("AIS Bonds enabled");
    (
        product_sign_in::LegacyMigration::new(flow, store, native_auth.secret_digester()),
        Some(bonds),
    )
}

/// 0x1 as a public client of AIS: no secret, only PKCE and the exact callback.
/// Core's product service accepts only the `0x1` client, so the id is not
/// a setting.
fn product_sign_in_client(
    issuer: &str,
    backchannel: Option<&str>,
    public_origin: &Url,
) -> Result<aiaiaiai_sign_in::SignInClientConfig, aiaiaiai_sign_in::SignInConfigError> {
    let redirect_uri = public_origin
        .join("/api/v1/auth/aiaiaiai/callback")
        .expect("the callback path stays on the public origin");
    aiaiaiai_sign_in::SignInClientConfig::public(issuer, backchannel, "0x1", redirect_uri.as_str())
}

fn oauth_credentials_from_environment(
    client_id_key: &str,
    client_secret_key: &str,
    label: &str,
) -> Option<OAuthClientCredentials> {
    let client_id = env::var(client_id_key)
        .ok()
        .filter(|value| !value.is_empty());
    let client_secret = env::var(client_secret_key)
        .ok()
        .filter(|value| !value.is_empty());

    match (client_id, client_secret) {
        (Some(client_id), Some(client_secret)) => {
            info!(provider = label, "provider authentication enabled");
            Some(OAuthClientCredentials::new(client_id, client_secret))
        }
        (None, None) => {
            info!(
                provider = label,
                "provider authentication is not configured"
            );
            None
        }
        _ => panic!("{client_id_key} and {client_secret_key} must be configured together"),
    }
}

#[cfg(test)]
mod tests {
    use super::{product_sign_in_client, public_telegram_verifier};
    use url::Url;

    #[test]
    fn the_0x1_site_is_a_public_client_of_ais_on_its_own_callback() {
        let origin = Url::parse("https://nilx.one").unwrap();
        let config = product_sign_in_client("https://auth.aiaiaiai.org", None, &origin).unwrap();
        assert_eq!(config.client_id(), "0x1");
        assert_eq!(config.issuer(), "https://auth.aiaiaiai.org");
        assert!(format!("{config:?}").contains("client_secret: None"));
        assert!(product_sign_in_client("http://auth.aiaiaiai.org", None, &origin).is_err());
    }

    #[test]
    fn the_http_runtime_only_accepts_public_telegram_authority() {
        assert!(public_telegram_verifier(Some("123456"), false, None, 300).is_ok());
        assert!(public_telegram_verifier(Some("123456"), false, Some("disabled"), 300).is_ok());
        assert!(public_telegram_verifier(Some("123456"), true, None, 300).is_err());
        for polling in ["enabled", "", "unknown"] {
            assert!(public_telegram_verifier(Some("123456"), false, Some(polling), 300).is_err());
        }
        for bot_id in [
            None,
            Some(""),
            Some("0"),
            Some("0123"),
            Some("+123"),
            Some("123:token"),
            Some("18446744073709551616"),
        ] {
            assert!(public_telegram_verifier(bot_id, false, None, 300).is_err());
        }
    }
}
