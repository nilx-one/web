// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use thiserror::Error;

use crate::report::valid_project;

pub const MIN_TOKEN_CHARS: usize = 32;
const WILDCARD_PROJECT: &str = "*";

/// What an accepted ingest token is allowed to write.
///
/// The project comes from the token, not from the request body, so one
/// project's token can never dump errors under another project's name. A
/// wildcard token is the deliberate exception for a shared organization
/// reporter that names its own project.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IngestScope {
    Project(String),
    Any,
}

impl IngestScope {
    /// Resolves the project a request may write, given what it asked for.
    pub fn resolve<'a>(&'a self, requested: Option<&'a str>) -> Result<&'a str, ScopeError> {
        match (self, requested) {
            (Self::Project(project), None) => Ok(project),
            (Self::Project(project), Some(requested)) if requested == project => Ok(project),
            (Self::Project(_), Some(_)) => Err(ScopeError::ForeignProject),
            (Self::Any, Some(requested)) => Ok(requested),
            (Self::Any, None) => Err(ScopeError::MissingProject),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum ScopeError {
    #[error("this ingest token may not write another project's errors")]
    ForeignProject,
    #[error("a wildcard ingest token must name the reporting project")]
    MissingProject,
}

/// The configured ingest tokens, held only as digests.
#[derive(Clone, Debug, Default)]
pub struct IngestTokens {
    entries: Vec<(Digest, IngestScope)>,
}

impl IngestTokens {
    /// Reads `project:token` pairs separated by commas or whitespace.
    ///
    /// Parsing fails closed: one malformed or short entry rejects the whole
    /// configuration rather than silently starting with fewer reporters than
    /// the operator configured.
    pub fn parse(specification: &str) -> Result<Self, IngestTokenError> {
        let mut entries = Vec::new();

        for entry in specification
            .split([',', '\n', '\r', '\t', ' '])
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
        {
            let (project, token) = entry.split_once(':').ok_or(IngestTokenError::Malformed)?;
            if token.chars().count() < MIN_TOKEN_CHARS {
                return Err(IngestTokenError::TokenTooShort);
            }
            let scope = if project == WILDCARD_PROJECT {
                IngestScope::Any
            } else if valid_project(project) {
                IngestScope::Project(project.to_owned())
            } else {
                return Err(IngestTokenError::InvalidProject);
            };
            let digest = digest(token);
            if entries
                .iter()
                .any(|(existing, _): &(Digest, IngestScope)| existing == &digest)
            {
                return Err(IngestTokenError::DuplicateToken);
            }
            entries.push((digest, scope));
        }

        if entries.is_empty() {
            return Err(IngestTokenError::Empty);
        }
        Ok(Self { entries })
    }

    pub fn authorize(&self, token: &str) -> Option<&IngestScope> {
        let presented = digest(token);
        self.entries
            .iter()
            .find(|(candidate, _)| bool::from(candidate.ct_eq(&presented)))
            .map(|(_, scope)| scope)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// The optional token that may read the trash back.
///
/// Reading is disabled until a token is configured, because dumped error text
/// routinely contains internal detail that no anonymous caller should see.
#[derive(Clone, Debug)]
pub struct ReadToken(Digest);

impl ReadToken {
    pub fn parse(token: &str) -> Result<Self, IngestTokenError> {
        if token.chars().count() < MIN_TOKEN_CHARS {
            return Err(IngestTokenError::TokenTooShort);
        }
        Ok(Self(digest(token)))
    }

    pub fn verify(&self, token: &str) -> bool {
        bool::from(self.0.ct_eq(&digest(token)))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum IngestTokenError {
    #[error("no ingest token is configured")]
    Empty,
    #[error("each ingest token must be written as project:token")]
    Malformed,
    #[error("an ingest token project must be * or 1–64 characters of [A-Za-z0-9._/@-]")]
    InvalidProject,
    #[error("an ingest token must contain at least 32 characters")]
    TokenTooShort,
    #[error("the same ingest token is configured for more than one project")]
    DuplicateToken,
}

type Digest = [u8; 32];

fn digest(token: &str) -> Digest {
    Sha256::digest(token.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::{IngestScope, IngestTokenError, IngestTokens, ReadToken, ScopeError};

    const WEB_TOKEN: &str = "web-ingest-token-that-is-long-enough";
    const SHARED_TOKEN: &str = "shared-ingest-token-that-is-long-enough";

    fn tokens() -> IngestTokens {
        IngestTokens::parse(&format!("nilx-one/web:{WEB_TOKEN}, *:{SHARED_TOKEN}"))
            .expect("valid configuration")
    }

    #[test]
    fn a_bound_token_writes_only_its_own_project() {
        let tokens = tokens();
        let scope = tokens.authorize(WEB_TOKEN).expect("known token");

        assert_eq!(scope.resolve(None), Ok("nilx-one/web"));
        assert_eq!(scope.resolve(Some("nilx-one/web")), Ok("nilx-one/web"));
        assert_eq!(
            scope.resolve(Some("aiaiaiai-tech/core")),
            Err(ScopeError::ForeignProject)
        );
    }

    #[test]
    fn a_wildcard_token_must_name_the_reporting_project() {
        let tokens = tokens();
        let scope = tokens.authorize(SHARED_TOKEN).expect("known token");

        assert_eq!(scope, &IngestScope::Any);
        assert_eq!(
            scope.resolve(Some("aiaiaiai-tech/core")),
            Ok("aiaiaiai-tech/core")
        );
        assert_eq!(scope.resolve(None), Err(ScopeError::MissingProject));
    }

    #[test]
    fn unknown_tokens_are_never_authorized() {
        let tokens = tokens();

        assert!(tokens.authorize("").is_none());
        assert!(
            tokens
                .authorize("web-ingest-token-that-is-long-enoug")
                .is_none()
        );
        assert!(
            tokens
                .authorize(&format!("{WEB_TOKEN}{WEB_TOKEN}"))
                .is_none()
        );
    }

    #[test]
    fn configuration_fails_closed_on_every_unusable_entry() {
        assert_eq!(
            IngestTokens::parse("   ").err(),
            Some(IngestTokenError::Empty)
        );
        assert_eq!(
            IngestTokens::parse("nilx-one/web").err(),
            Some(IngestTokenError::Malformed)
        );
        assert_eq!(
            IngestTokens::parse("nilx-one/web:short").err(),
            Some(IngestTokenError::TokenTooShort)
        );
        assert_eq!(
            IngestTokens::parse(&format!("nilx+one:{WEB_TOKEN}")).err(),
            Some(IngestTokenError::InvalidProject)
        );
        assert_eq!(
            IngestTokens::parse(&format!("a/one:{WEB_TOKEN} b/two:{WEB_TOKEN}")).err(),
            Some(IngestTokenError::DuplicateToken)
        );
        assert_eq!(tokens().len(), 2);
    }

    #[test]
    fn the_read_token_is_compared_whole() {
        let token = ReadToken::parse(SHARED_TOKEN).expect("valid read token");

        assert!(token.verify(SHARED_TOKEN));
        assert!(!token.verify(WEB_TOKEN));
        assert!(!token.verify(&SHARED_TOKEN[..SHARED_TOKEN.len() - 1]));
        assert_eq!(
            ReadToken::parse("short").err(),
            Some(IngestTokenError::TokenTooShort)
        );
    }
}
