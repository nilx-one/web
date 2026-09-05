// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

pub mod api;
pub mod auth;
pub mod rate_limit;
pub mod report;
pub mod repository;
pub mod time;

pub use auth::{IngestScope, IngestTokenError, IngestTokens, ReadToken, ScopeError};
pub use rate_limit::RequestLimiter;
pub use report::{ErrorReport, ReportError};
pub use repository::{
    ErrorQuery, ErrorTrashRepository, RepositoryError, RetentionPolicy, StoredError,
};
pub use time::{Clock, SystemClock, Timestamp, TimestampError};
