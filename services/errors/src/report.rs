// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use thiserror::Error;

use crate::time::Timestamp;

pub const MAX_PROJECT_CHARS: usize = 64;
pub const MAX_TYPE_CHARS: usize = 128;
pub const MAX_FULL_TEXT_CHARS: usize = 32_768;

const TRUNCATION_MARKER: &str = "\n… [truncated by error-trash]";

/// One accepted error dump.
///
/// The trash stores what a project reports; it does not classify, group, or
/// interpret the failure. `observed_at` is the reporter's statement about when
/// the error was noticed and `received_at` is the trash clock, so a wrong
/// client clock degrades one column instead of the record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ErrorReport {
    project: String,
    error_type: String,
    full_text: String,
    observed_at: Timestamp,
    received_at: Timestamp,
}

impl ErrorReport {
    pub fn new(
        project: &str,
        error_type: &str,
        full_text: &str,
        observed_at: Timestamp,
        received_at: Timestamp,
    ) -> Result<Self, ReportError> {
        let project = project.trim();
        let error_type = error_type.trim();
        let full_text = full_text.trim_end_matches(['\r', '\n', ' ', '\t']);

        if !valid_project(project) {
            return Err(ReportError::InvalidProject);
        }
        if error_type.is_empty() || error_type.chars().count() > MAX_TYPE_CHARS {
            return Err(ReportError::InvalidType);
        }
        if error_type.chars().any(char::is_control) {
            return Err(ReportError::InvalidType);
        }
        if full_text.trim().is_empty() {
            return Err(ReportError::EmptyFullText);
        }

        Ok(Self {
            project: project.to_owned(),
            error_type: error_type.to_owned(),
            full_text: truncate(full_text),
            observed_at,
            received_at,
        })
    }

    pub fn project(&self) -> &str {
        &self.project
    }

    pub fn error_type(&self) -> &str {
        &self.error_type
    }

    pub fn full_text(&self) -> &str {
        &self.full_text
    }

    pub fn observed_at(&self) -> &Timestamp {
        &self.observed_at
    }

    pub fn received_at(&self) -> &Timestamp {
        &self.received_at
    }
}

/// The project name accepted both as configuration and as reported data, so an
/// ingest token cannot be bound to a project the ingest surface would reject.
pub fn valid_project(project: &str) -> bool {
    !project.is_empty()
        && project.chars().count() <= MAX_PROJECT_CHARS
        && project.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b'@')
        })
}

/// Keeps an oversized dump instead of rejecting it, and says so in the text.
fn truncate(full_text: &str) -> String {
    if full_text.chars().count() <= MAX_FULL_TEXT_CHARS {
        return full_text.to_owned();
    }
    let keep = MAX_FULL_TEXT_CHARS - TRUNCATION_MARKER.chars().count();
    let boundary = full_text
        .char_indices()
        .nth(keep)
        .map_or(full_text.len(), |(index, _)| index);
    format!("{}{TRUNCATION_MARKER}", &full_text[..boundary])
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum ReportError {
    #[error("project must be 1–64 characters of [A-Za-z0-9._/@-]")]
    InvalidProject,
    #[error("type must be 1–128 characters without control characters")]
    InvalidType,
    #[error("full_text must contain the error text")]
    EmptyFullText,
}

#[cfg(test)]
mod tests {
    use super::{ErrorReport, MAX_FULL_TEXT_CHARS, ReportError};
    use crate::time::Timestamp;

    fn instant() -> Timestamp {
        Timestamp::from_unix_seconds(1_800_000_000)
    }

    fn report(
        project: &str,
        error_type: &str,
        full_text: &str,
    ) -> Result<ErrorReport, ReportError> {
        ErrorReport::new(project, error_type, full_text, instant(), instant())
    }

    #[test]
    fn reports_keep_their_text_and_trim_only_incidental_whitespace() {
        let report = report(
            "  nilx-one/web  ",
            "  unhandled_rejection  ",
            "TypeError: x is not a function\n  at boot\n\n",
        )
        .expect("valid report");

        assert_eq!(report.project(), "nilx-one/web");
        assert_eq!(report.error_type(), "unhandled_rejection");
        assert_eq!(
            report.full_text(),
            "TypeError: x is not a function\n  at boot"
        );
    }

    #[test]
    fn oversized_dumps_are_truncated_visibly_rather_than_dropped() {
        let report = report("web", "panic", &"e".repeat(MAX_FULL_TEXT_CHARS * 2))
            .expect("oversized report is still accepted");

        assert_eq!(report.full_text().chars().count(), MAX_FULL_TEXT_CHARS);
        assert!(report.full_text().ends_with("[truncated by error-trash]"));
    }

    #[test]
    fn multibyte_dumps_truncate_on_character_boundaries() {
        let report = report("web", "panic", &"д".repeat(MAX_FULL_TEXT_CHARS + 10))
            .expect("oversized report is still accepted");

        assert_eq!(report.full_text().chars().count(), MAX_FULL_TEXT_CHARS);
    }

    #[test]
    fn invalid_identity_fields_are_named_precisely() {
        assert_eq!(
            report("", "panic", "text"),
            Err(ReportError::InvalidProject)
        );
        assert_eq!(
            report("web project", "panic", "text"),
            Err(ReportError::InvalidProject)
        );
        assert_eq!(
            report(&"p".repeat(65), "panic", "text"),
            Err(ReportError::InvalidProject)
        );
        assert_eq!(report("web", "", "text"), Err(ReportError::InvalidType));
        assert_eq!(
            report("web", "pa\nnic", "text"),
            Err(ReportError::InvalidType)
        );
        assert_eq!(
            report("web", "panic", "   \n "),
            Err(ReportError::EmptyFullText)
        );
    }
}
