// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api;
pub mod credentials;
pub mod discord_oauth;
pub mod rate_limit;
pub mod repository;
pub mod telegram_init_data;

pub use credentials::{
    NativeAuthConfig, PasswordEngine, PasswordPolicyError, RememberedBondSigner, SecretDigester,
    TokenFactory,
};
pub use discord_oauth::{DiscordAccessToken, DiscordOAuthClient, DiscordOAuthError};
pub use ox1_contracts::{AvaiaPubDress, AvaiaPubDressError, PubDress, PubDressError};
pub use repository::{
    IdentityProvider, IdentityRecord, IdentityRepository, NativeCredentialRecord,
    NativeRegistrationOutcome, ProviderIdentity, RegistrationOutcome, RepositoryError,
};
pub use telegram_init_data::{TelegramInitDataError, TelegramInitDataVerifier};
