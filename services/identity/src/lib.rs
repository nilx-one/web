// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api;
pub mod discord_oauth;
pub mod repository;
pub mod telegram_init_data;

pub use discord_oauth::{DiscordAccessToken, DiscordOAuthClient, DiscordOAuthError};
pub use ox1_contracts::{PubDress, PubDressError};
pub use repository::{
    IdentityProvider, IdentityRecord, IdentityRepository, ProviderIdentity, RegistrationOutcome,
    RepositoryError,
};
pub use telegram_init_data::{TelegramInitDataError, TelegramInitDataVerifier};
