// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

//! The AIS product session as an actor for an attached legacy Bond (#621,
//! Core `docs/ais-legacy-bond-migration.md`).
//!
//! Only Core's durable `legacy_bond_bindings` link can turn a product session
//! into a Bond, through `resolve_session_bond`; a public name, display name or
//! pairwise subject never does. This module only presents the request's
//! product cookie. The session's activity is reported, never assumed: Core
//! re-checks `active = 1` atomically at every write it guards. A request
//! with no, an unknown, an expired, a signed-out or an unbound product
//! session resolves to nothing, exactly as if no cookie had been sent.

use axum::http::HeaderMap;
use std::str::FromStr as _;

use nilxone_identity::{
    IdentityRecord, IdentityRepository, PubDress, SecretDigester,
    public_info::{LegacyBondMigrationRepository, ProvisionError, PublicInfoRepository},
};

use crate::{
    browser_web_auth::read_cookie,
    product_sign_in::{PRODUCT_SESSION_COOKIE, PRODUCT_SESSION_DOMAIN},
};

/// A product session's route to its attached legacy Bond.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProductBond {
    /// The Bond's current legacy address, as Core resolved it.
    pub pub_dress: String,
    /// Whether this session is the active client (early answer only).
    pub active: bool,
    /// The session digest bytes Core's atomic spend check takes.
    pub session_hash: Vec<u8>,
}

/// Why a first sign-in could not be given a Bond; the callback turns each into
/// a coded error for the site, never a session.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProvisionFailure {
    /// The address AIS assigned already belongs to another Bond.
    AddressTaken,
    /// The sign-in carried no usable address.
    NoAddress,
    Unavailable,
}

impl ProvisionFailure {
    pub(crate) const fn code(self) -> &'static str {
        match self {
            Self::AddressTaken => "bond_address_taken",
            Self::NoAddress => "bond_address_missing",
            Self::Unavailable => "bond_unavailable",
        }
    }
}

/// Built only when AIS sign-in and the migration store are both configured.
#[derive(Clone)]
pub struct ProductBondAuth {
    store: LegacyBondMigrationRepository,
    product: PublicInfoRepository,
    digester: SecretDigester,
}

impl ProductBondAuth {
    pub fn new(
        store: LegacyBondMigrationRepository,
        product: PublicInfoRepository,
        digester: SecretDigester,
    ) -> Self {
        Self {
            store,
            product,
            digester,
        }
    }

    /// Ends the request's product session, if it has one. Idempotent: an
    /// unknown or expired session is not an error. Core also ends the
    /// session's part in an open activation request.
    pub(crate) async fn sign_out(&self, headers: &HeaderMap, now: u64) -> Result<(), ()> {
        let Some(token) = read_cookie(headers, PRODUCT_SESSION_COOKIE) else {
            return Ok(());
        };
        let digest = self.digester.digest(PRODUCT_SESSION_DOMAIN, &token);
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        self.product
            .close_session(&hex, now)
            .await
            .map_err(|error| {
                tracing::error!(%error, "product session sign-out failed");
            })
    }

    /// Gives a person's AIS profile its Bond on their first sign-in, or
    /// confirms it already has one. Never links an existing Bond by name:
    /// Core refuses an address another Bond already holds.
    pub(crate) async fn provision(
        &self,
        profile_id: &str,
        now: u64,
    ) -> Result<(), ProvisionFailure> {
        match self.store.provision_new_bond(profile_id, now).await {
            Ok(_) => Ok(()),
            Err(ProvisionError::AddressTaken) => Err(ProvisionFailure::AddressTaken),
            Err(ProvisionError::NoAddress | ProvisionError::NoProfile) => {
                Err(ProvisionFailure::NoAddress)
            }
            Err(error) => {
                tracing::error!(%error, "creating the Bond of an AIS sign-in failed");
                Err(ProvisionFailure::Unavailable)
            }
        }
    }

    /// The Bond a request's product session acts for, as the identity record
    /// every game route works with. `Ok(None)` when there is no such session.
    pub(crate) async fn bond(
        &self,
        repository: &IdentityRepository,
        headers: &HeaderMap,
        now: u64,
    ) -> Result<Option<(IdentityRecord, ProductBond)>, ()> {
        let Some(bond) = self.resolve(headers, now).await? else {
            return Ok(None);
        };
        let Ok(pub_dress) = PubDress::from_str(&bond.pub_dress) else {
            return Err(());
        };
        match repository.resolve_human_identity(&pub_dress).await {
            Ok(Some(identity)) => Ok(Some((identity, bond))),
            Ok(None) => Ok(None),
            Err(error) => {
                tracing::error!(%error, "product session identity resolution failed");
                Err(())
            }
        }
    }

    /// `Ok(None)` when the request carries no product session that resolves
    /// to an attached Bond; `Err` only when Core's store is unavailable.
    pub(crate) async fn resolve(
        &self,
        headers: &HeaderMap,
        now: u64,
    ) -> Result<Option<ProductBond>, ()> {
        let Some(token) = read_cookie(headers, PRODUCT_SESSION_COOKIE) else {
            return Ok(None);
        };
        let digest = self.digester.digest(PRODUCT_SESSION_DOMAIN, &token);
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        match self.store.resolve_session_bond(&hex, now).await {
            Ok(Some(bond)) => Ok(Some(ProductBond {
                pub_dress: bond.pub_dress,
                active: bond.active,
                session_hash: digest,
            })),
            Ok(None) => Ok(None),
            Err(error) => {
                tracing::error!(%error, "product session Bond lookup failed");
                Err(())
            }
        }
    }
}

#[cfg(test)]
#[path = "product_bond_auth_tests.rs"]
mod tests;
