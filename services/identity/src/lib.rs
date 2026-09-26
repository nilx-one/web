// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api {
    include!("api.rs");
    include!("api_avaia.rs");
}
pub mod browser_web_auth;
pub mod credentials;
pub mod discord_oauth;
pub mod github_evidence;
pub mod location_control;
pub mod provider_link;
pub mod provider_secret;
pub mod provider_self_service;
pub mod public_api;
pub mod rate_limit;
pub mod repository {
    include!("repository.rs");
    include!("repository_avaia.rs");
}
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
    GeoCoordinateError, PubDress, PubDressError, PubDressLabel, PubDressLabelError,
};
pub use provider_link::{ProviderLinkOutcome, ProviderLinkRepository, SelfDisconnectOutcome};
pub use provider_secret::{ProviderSecretCipher, ProviderSecretError};
pub use provider_self_service::provider_self_service_router;
pub use repository::{
    AvaiaConfigurationState, AvaiaIdentityRecord, AvaiaLocation, AvaiaUpdateOutcome,
    IdentityProvider, IdentityRecord, IdentityRepository, NativeCredentialRecord,
    NativeRegistrationOutcome, ProviderIdentity, PubDressRenameOutcome, PublicIdentityRecord,
    RegistrationOutcome, RepositoryError,
};
pub use telegram_init_data::{TelegramInitDataError, TelegramInitDataVerifier};
