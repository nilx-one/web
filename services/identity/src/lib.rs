// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api {
    include!("api.rs");
    include!("api_admin_roles.rs");
    include!("api_avaia_lifecycle.rs");
    include!("api_pub_info.rs");
    include!("api_awards.rs");
    include!("api_xping.rs");
    include!("api_finds.rs");
    include!("api_market.rs");
    include!("api_business_memberships.rs");
    include!("api_business_creation.rs");
    include!("session_activation.rs");
}
pub mod ais_purchase;
pub mod browser_web_auth;
pub use nilxone_identity::aiaiaiai_sign_in;
pub mod business_command;
pub mod issuer;
pub use nilxone_identity::cell_orbs;
pub use nilxone_identity::credentials;
pub mod discord_oauth;
pub use nilxone_identity::find_attestation;
pub use nilxone_identity::finds;
pub mod github_evidence;
pub mod location_control;
pub use nilxone_identity::market_issuer;
pub use nilxone_identity::market_visit;
pub mod partner_account;
pub mod partner_lookup;
pub mod product_bond_auth;
pub mod product_sign_in;
pub use nilxone_identity::provider_link;
pub use nilxone_identity::provider_secret;
pub use nilxone_identity::public_info;
pub mod provider_self_service;
pub mod public_api;
pub use nilxone_identity::rate_limit;
pub use nilxone_identity::repository;
pub mod speech;
pub mod telegram_init_data;

pub use browser_web_auth::{BrowserOAuthConfig, OAuthClientCredentials};
pub use credentials::{
    NativeAuthConfig, PasswordEngine, PasswordPolicyError, RememberedBondSigner, SecretDigester,
    TokenFactory,
};
pub use discord_oauth::{DiscordAccessToken, DiscordOAuthClient, DiscordOAuthError};
pub use github_evidence::{GithubEvidenceConfig, GithubEvidenceRepository};
pub use location_control::{
    BondAccessRole, BondLocationRepository, BondLocationRepositoryError, PendingLocationIntent,
    TelegramLocationIntents, location_control_router,
};
pub use nilxone_contracts::{
    AvaiaPubDress, AvaiaPubDressError, BondLocation, BondLocationMode, DecimalU64, GeoCoordinate,
    GeoCoordinateError, PubDress, PubDressError, PubDressLabel, PubDressLabelError, StationCaption,
    StationPubDress, StationPubDressError,
};
pub use partner_account::partner_account_router;
pub use partner_lookup::{PartnerLookupConfig, PartnerLookupConfigError, partner_lookup_router};
pub use product_bond_auth::ProductBondAuth;
pub use provider_link::{ProviderLinkOutcome, ProviderLinkRepository, SelfDisconnectOutcome};
pub use provider_secret::{ProviderSecretCipher, ProviderSecretError};
pub use provider_self_service::provider_self_service_router;
pub use repository::{
    ActivationRequest, ActivationRequestStatus, AdminRoleDecision, AdminRoleRequest,
    AdminRoleTelegramConfirmation, AdminRoleTelegramDelivery, AvaiaConfigurationState,
    AvaiaIdentityRecord, AvaiaLocation, AvaiaTravelOutcome, AvaiaUpdateOutcome,
    BusinessRegistrationOutcome, BusinessStation, BusinessStationOutcome, IdentityProvider,
    IdentityRecord, IdentityRepository, NativeCredentialRecord, NativeRegistrationOutcome,
    ProviderIdentity, PubDressRenameOutcome, PublicIdentityRecord, RegistrationOutcome,
    RepositoryError, TelegramMessageSlot,
};
pub use telegram_init_data::{TelegramInitDataError, TelegramInitDataVerifier};

/// Development issuer traffic must use the same isolated HTTPS TEST Market as
/// the browser handoff. A missing or production target cannot be a fallback.
/// This is a deployment safety rule, never proof of a customer's purchase.
#[must_use]
pub fn development_market_issuer_endpoint_allowed(browser_origin: &str, issuer_url: &str) -> bool {
    let (Ok(browser), Ok(issuer)) = (url::Url::parse(browser_origin), url::Url::parse(issuer_url))
    else {
        return false;
    };
    browser.scheme() == "https"
        && issuer.scheme() == "https"
        && browser.host_str().is_some()
        && browser.host_str() != Some("0xda-market.nilx.one")
        && browser.path() == "/"
        && issuer.path() == "/issuer"
        && browser.origin() == issuer.origin()
        && browser.username().is_empty()
        && issuer.username().is_empty()
        && browser.password().is_none()
        && issuer.password().is_none()
        && browser.query().is_none()
        && issuer.query().is_none()
        && browser.fragment().is_none()
        && issuer.fragment().is_none()
}

/// The Market issuer follows the handoff secret: a service that can hand a Bond
/// to Market also settles what that Bond buys there. `None` without the secret;
/// no separate switch turns the worker or the return check on.
pub fn market_issuer_config()
-> Option<Result<market_issuer::MarketIssuerConfig, market_issuer::MarketIssuerConfigError>> {
    let secret = std::env::var("NILX_BROWSER_HANDOFF_TOKEN").unwrap_or_default();
    if secret.is_empty() {
        return None;
    }
    let url = std::env::var("MARKET_ISSUER_URL")
        .ok()
        .filter(|value| !value.is_empty());
    Some(market_issuer::MarketIssuerConfig::new(
        &secret,
        url.as_deref(),
    ))
}

/// The issuer queue of the production chat checkout, when this service runs it.
/// A development service never does: its only queue is the browser one, so the
/// chat flow is proven against the same worker that settles browser orders.
/// An empty value means "not configured", never a malformed URL that would stop
/// the whole Identity service from booting (the browser worker treats it alike).
pub fn telegram_issuer_url(deploy_env: Option<&str>, configured: Option<&str>) -> Option<String> {
    if deploy_env == Some("development") {
        return None;
    }
    configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod telegram_issuer_url_tests {
    use super::telegram_issuer_url as url;

    const QUEUE: &str = "https://0xda-market.nilx.one/production-issuer/issuer";

    #[test]
    fn a_development_service_never_runs_the_chat_queue() {
        assert_eq!(url(Some("development"), Some(QUEUE)), None);
    }

    #[test]
    fn missing_or_blank_means_not_configured() {
        assert_eq!(url(None, None), None);
        assert_eq!(url(Some("production"), None), None);
        assert_eq!(url(Some("production"), Some("")), None);
        assert_eq!(url(None, Some("  \n")), None);
    }

    #[test]
    fn a_production_or_unnamed_service_uses_the_configured_queue() {
        assert_eq!(url(Some("production"), Some(QUEUE)).as_deref(), Some(QUEUE));
        assert_eq!(
            url(None, Some(&format!(" {QUEUE}\n"))).as_deref(),
            Some(QUEUE)
        );
    }
}

#[cfg(test)]
mod development_market_issuer_endpoint_tests {
    use super::development_market_issuer_endpoint_allowed as allowed;

    #[test]
    fn requires_same_separate_test_market_origin() {
        assert!(allowed(
            "https://market-test.onrender.com",
            "https://market-test.onrender.com/issuer"
        ));
        assert!(!allowed(
            "https://market-test.onrender.com",
            "https://0xda-market.nilx.one/issuer"
        ));
        assert!(!allowed(
            "https://0xda-market.nilx.one",
            "https://0xda-market.nilx.one/issuer"
        ));
        assert!(!allowed("", "https://market-test.onrender.com/issuer"));
        assert!(!allowed(
            "https://market-test.onrender.com",
            "http://market-test.onrender.com/issuer"
        ));
        assert!(!allowed(
            "https://market-test.onrender.com",
            "https://market-test.onrender.com/issuer?token=abc"
        ));
    }
}
