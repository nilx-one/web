// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api;
pub mod repository;
pub mod telegram_init_data;

pub use ox1_contracts::{PubDress, PubDressError};
pub use repository::{IdentityRecord, IdentityRepository, RegistrationOutcome, RepositoryError};
pub use telegram_init_data::{TelegramInitDataError, TelegramInitDataVerifier};
