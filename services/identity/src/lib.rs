// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api {
    include!("api.rs");
    include!("api_admin_roles.rs");
    include!("api_avaia_lifecycle.rs");
    include!("api_pub_info.rs");
    include!("api_awards.rs");
    include!("api_xping.rs");
    include!("api_market.rs");
    include!("api_business_memberships.rs");
    include!("api_business_creation.rs");
    include!("session_activation.rs");
}
pub mod browser_web_auth;
pub mod business_command;
pub use nilxone_identity::cell_orbs;
pub use nilxone_identity::credentials;
pub mod discord_oauth;
pub use nilxone_identity::finds;
pub mod github_evidence;
pub mod location_control;
pub use nilxone_identity::market_issuer;
pub use nilxone_identity::market_visit;
pub mod partner_account;
pub mod partner_lookup;
pub use nilxone_identity::provider_link;
pub use nilxone_identity::provider_secret;
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
