// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! Opt-in host flow that attaches an AIS identity to an existing legacy Bond
//! (#621, Core #115 contract `docs/ais-legacy-bond-migration.md`).
//!
//! Off unless the composition root builds a [`LegacyMigration`]. The host owns
//! only HTTP: cookies, CSRF, rate limits and redirects. Every proof and every
//! write is Core's:
//!
//! 1. `POST migrate/start` — the owner of a *fresh, password-authenticated*
//!    native session asks to migrate. Core records a pending intent bound to
//!    that session's digest and a server-minted handle; the browser is sent to
//!    AIS with a migration-only OIDC transaction (own cookie, own MAC domain).
//! 2. The shared `callback` hands a migration transaction to Core's
//!    `record_ais_callback`, which verifies state, nonce, PKCE, issuer,
//!    audience, `auth_time` and the return path bound to the handle.
//! 3. `POST migrate/confirm` — an explicit owner action, CSRF-protected.
//!    Core rechecks both proofs and attaches atomically; the legacy session is
//!    revoked in the same transaction, so the host clears its cookie.
//!
//! A public address is never read from the request: the Bond is the one
//! behind the native session, and the AIS identity is the one AIS verified.
//! No product session is minted here: after attachment the person signs in
//! through AIS as usual and Core restores the same profile.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode, header::COOKIE},
    response::Response,
};
use nilxone_identity::{
    SecretDigester, TokenFactory,
    aiaiaiai_sign_in::{Callback, MIGRATION_TRANSACTION_COOKIE, SignInFlow, TRANSACTION_COOKIE},
    public_info::{LegacyBondMigrationRepository, LegacyMigrationError},
};

use super::{
    CallbackQuery, ProductState, csrf_required, not_configured, rate_limited, unavailable,
    valid_csrf,
};
use crate::browser_web_auth::{
    append_cookie, clear_cookie, no_store_error, no_store_json, now_unix_seconds, read_cookie,
    redirect_with_cookies, secure_cookie,
};

/// The native Bond session (`api.rs`); read here, never minted.
const NATIVE_SESSION_COOKIE: &str = "__Host-0x1_session";
/// The raw migration handle. Only its digest reaches Core.
pub const MIGRATION_HANDLE_COOKIE: &str = "__Host-0x1_migration";
const HANDLE_DOMAIN: &str = "legacy-migration-transaction";
/// Core's hard lifetime for an intent; the handle cookie never outlives it.
const HANDLE_TTL_SECONDS: u64 = 600;
/// After attachment the person signs in through AIS like everyone else.
const SIGN_IN_AGAIN: &str = "/api/v1/auth/aiaiaiai/start?return=%2F";

/// Everything the migration routes need. Built only when the operator opts
/// in and Core has verified that legacy and product tables share one store.
#[derive(Clone)]
pub struct LegacyMigration {
    flow: SignInFlow,
    store: LegacyBondMigrationRepository,
    digester: SecretDigester,
}

impl LegacyMigration {
    /// `flow` must be Core's `SignInFlow::legacy_migration` for `0x1`;
    /// an ordinary product flow is refused so its transactions can never be
    /// presented as migration proof.
    pub fn new(
        flow: SignInFlow,
        store: LegacyBondMigrationRepository,
        digester: SecretDigester,
    ) -> Option<Self> {
        flow.is_legacy_migration().then_some(Self {
            flow,
            store,
            digester,
        })
    }

    /// Both digests are derived here from cookies the server set; nothing in
    /// a request body or query names the Bond or the transaction.
    fn proofs(&self, headers: &HeaderMap) -> Option<(Vec<u8>, Vec<u8>)> {
        let native = read_cookie(headers, NATIVE_SESSION_COOKIE)?;
        let handle = read_cookie(headers, MIGRATION_HANDLE_COOKIE)?;
        Some((
            self.digester.digest("native-session", &native),
            self.digester.digest(HANDLE_DOMAIN, &handle),
        ))
    }
}

/// True when the callback carries a migration OIDC transaction. Starting
/// either flow clears the other's transaction cookie, so at most one is live.
pub(super) fn is_migration_callback(state: &ProductState, headers: &HeaderMap) -> bool {
    state.migration.is_some()
        && read_cookie(headers, MIGRATION_TRANSACTION_COOKIE).is_some_and(|value| !value.is_empty())
}

/// Set on the product start when migration is configured, so a stale
/// migration transaction cannot capture an ordinary sign-in callback.
pub(super) fn clear_migration_transaction() -> String {
    clear_cookie(MIGRATION_TRANSACTION_COOKIE)
}

fn failure(error: &LegacyMigrationError) -> Response {
    let (status, code, message) = match error {
        LegacyMigrationError::InvalidLegacyProof => (
            StatusCode::UNAUTHORIZED,
            "fresh_bond_sign_in_required",
            "Sign in to your Bond with its password again, then start within ten minutes.",
        ),
        LegacyMigrationError::AlreadyBound => (
            StatusCode::CONFLICT,
            "bond_already_attached",
            "This Bond is already attached to an aiaiaiai account. Sign in through aiaiaiai.",
        ),
        LegacyMigrationError::AlreadyPending => (
            StatusCode::CONFLICT,
            "migration_pending",
            "A migration for this sign-in is already in progress.",
        ),
        LegacyMigrationError::IdentityConflict => (
            StatusCode::CONFLICT,
            "identity_conflict",
            "This aiaiaiai account already has a 0x1 profile. Nothing was changed.",
        ),
        LegacyMigrationError::InvalidAisProof => (
            StatusCode::UNAUTHORIZED,
            "aiaiaiai_proof_invalid",
            "The aiaiaiai sign-in could not be verified. Start again.",
        ),
        LegacyMigrationError::NotConfirmed
        | LegacyMigrationError::ExpiredConfirmation
        | LegacyMigrationError::InvalidTransaction => (
            StatusCode::GONE,
            "migration_expired",
            "This migration has expired. Start again.",
        ),
        LegacyMigrationError::UnsupportedTopology | LegacyMigrationError::Storage(_) => {
            return unavailable();
        }
    };
    no_store_error(status, code, message)
}

fn migration_disabled() -> Response {
    no_store_error(
        StatusCode::NOT_FOUND,
        "migration_not_enabled",
        "Bond migration is not enabled.",
    )
}

pub(super) async fn start(State(state): State<ProductState>, headers: HeaderMap) -> Response {
    if state.sign_in.is_none() {
        return not_configured();
    }
    let Some(migration) = state.migration.as_ref() else {
        return migration_disabled();
    };
    if !valid_csrf(&headers) {
        return csrf_required();
    }
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    let source = crate::api::request_source(&headers);
    if let Err(retry_after) =
        state
            .limiter
            .consume(format!("migration:start:{source}"), now, 10, 600)
    {
        return rate_limited(retry_after);
    }
    let Some(native) = read_cookie(&headers, NATIVE_SESSION_COOKIE) else {
        // Someone already signed in through aiaiaiai has nothing to move.
        if read_cookie(&headers, super::PRODUCT_SESSION_COOKIE).is_some() {
            return no_store_error(
                StatusCode::CONFLICT,
                "already_aiaiaiai",
                "You are already signed in through aiaiaiai.",
            );
        }
        return failure(&LegacyMigrationError::InvalidLegacyProof);
    };
    let Ok(handle) = TokenFactory::session() else {
        return unavailable();
    };
    let legacy_hash = migration.digester.digest("native-session", &native);
    let transaction_hash = migration.digester.digest(HANDLE_DOMAIN, &handle);
    if let Err(error) = migration
        .store
        .begin(&legacy_hash, &transaction_hash, now)
        .await
    {
        return failure(&error);
    }
    let Ok(return_path) = LegacyBondMigrationRepository::migration_return_path(&transaction_hash)
    else {
        return unavailable();
    };
    let Ok(started) = migration.flow.start(Some(&return_path), now) else {
        return unavailable();
    };
    let mut response = no_store_json(
        StatusCode::OK,
        serde_json::json!({ "authorization_url": started.location.as_str() }),
    );
    append_cookie(
        &mut response,
        secure_cookie(MIGRATION_HANDLE_COOKIE, &handle, HANDLE_TTL_SECONDS),
    );
    append_cookie(&mut response, started.set_cookie);
    append_cookie(&mut response, clear_cookie(TRANSACTION_COOKIE));
    response
}

/// Reached from the shared callback only for a migration transaction. Every
/// outcome clears the OIDC transaction cookie; the handle stays until the
/// owner confirms or it expires.
pub(super) async fn callback(
    migration: &LegacyMigration,
    headers: &HeaderMap,
    query: &CallbackQuery,
    now: u64,
) -> Response {
    let clear = clear_cookie(MIGRATION_TRANSACTION_COOKIE);
    let Some(proofs) = migration.proofs(headers) else {
        return redirect_with_cookies("/?migration_error=migration_expired", [clear]);
    };
    let cookie_header = headers.get(COOKIE).and_then(|value| value.to_str().ok());
    let recorded = migration
        .store
        .record_ais_callback(
            &migration.flow,
            cookie_header,
            Callback {
                code: query.code.as_deref(),
                state: query.state.as_deref(),
                error: query.error.as_deref(),
            },
            (&proofs.0, &proofs.1),
            now,
        )
        .await;
    match recorded {
        Ok(recorded) => redirect_with_cookies("/?migration=confirm", [recorded.clear_cookie]),
        Err(error) => {
            let code = match error {
                LegacyMigrationError::InvalidLegacyProof => "fresh_bond_sign_in_required",
                LegacyMigrationError::InvalidAisProof => "aiaiaiai_proof_invalid",
                LegacyMigrationError::Storage(_) => "migration_unavailable",
                _ => "migration_expired",
            };
            redirect_with_cookies(&format!("/?migration_error={code}"), [clear])
        }
    }
}

/// The explicit owner action. A repeat after Core already confirmed (for
/// example a lost response) goes straight to the idempotent commit check.
pub(super) async fn confirm(State(state): State<ProductState>, headers: HeaderMap) -> Response {
    if state.sign_in.is_none() {
        return not_configured();
    }
    let Some(migration) = state.migration.as_ref() else {
        return migration_disabled();
    };
    if !valid_csrf(&headers) {
        return csrf_required();
    }
    let Some(now) = now_unix_seconds() else {
        return unavailable();
    };
    let source = crate::api::request_source(&headers);
    if let Err(retry_after) =
        state
            .limiter
            .consume(format!("migration:confirm:{source}"), now, 20, 600)
    {
        return rate_limited(retry_after);
    }
    let Some((legacy_hash, transaction_hash)) = migration.proofs(&headers) else {
        return failure(&LegacyMigrationError::InvalidTransaction);
    };
    match migration
        .store
        .confirm_verified(&legacy_hash, &transaction_hash, now)
        .await
    {
        Ok(()) | Err(LegacyMigrationError::NotConfirmed) => {}
        Err(error) => return failure(&error),
    }
    match migration
        .store
        .commit_confirmed(&legacy_hash, &transaction_hash, now)
        .await
    {
        Ok(_) => {
            let mut response = no_store_json(
                StatusCode::OK,
                serde_json::json!({ "attached": true, "next": SIGN_IN_AGAIN }),
            );
            // Core revoked the legacy session in the commit transaction.
            append_cookie(&mut response, clear_cookie(NATIVE_SESSION_COOKIE));
            append_cookie(&mut response, clear_cookie(MIGRATION_HANDLE_COOKIE));
            response
        }
        Err(error) => failure(&error),
    }
}
