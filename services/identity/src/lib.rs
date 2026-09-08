// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api {
    include!("api.rs");
    include!("api_avaia.rs");
}
pub mod browser_web_auth;
pub mod credentials;
pub mod discord_oauth;
pub mod provider_link;
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
pub use ox1_contracts::{
    AvaiaPubDress, AvaiaPubDressError, PubDress, PubDressError, PubDressLabel, PubDressLabelError,
};
pub use provider_link::{ProviderLinkOutcome, ProviderLinkRepository};
pub use repository::{
    AvaiaConfigurationState, AvaiaIdentityRecord, AvaiaUpdateOutcome, IdentityProvider,
    IdentityRecord, IdentityRepository, NativeCredentialRecord, NativeRegistrationOutcome,
    ProviderIdentity, PubDressRenameOutcome, PublicIdentityRecord, RegistrationOutcome,
    RepositoryError,
};
pub use telegram_init_data::{TelegramInitDataError, TelegramInitDataVerifier};
