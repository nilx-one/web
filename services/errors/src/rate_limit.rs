// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

/// A fixed-window request limiter.
///
/// The trash accepts unattended machine traffic, so a broken reporter loop is
/// the expected failure mode rather than an attack. The window keeps one noisy
/// source from filling the table before an operator notices.
#[derive(Clone, Debug, Default)]
pub struct RequestLimiter {
    entries: Arc<Mutex<HashMap<String, WindowState>>>,
}

#[derive(Clone, Copy, Debug)]
struct WindowState {
    requests: u32,
    window_started_at: u64,
}

impl RequestLimiter {
    /// Counts one request, returning the retry delay in seconds once the
    /// window is exhausted.
    pub fn consume(
        &self,
        key: impl Into<String>,
        now: u64,
        maximum: u32,
        window_seconds: u64,
    ) -> Result<(), u64> {
        let mut entries = self.entries.lock().expect("request limiter lock poisoned");
        let state = entries.entry(key.into()).or_insert(WindowState {
            requests: 0,
            window_started_at: now,
        });
        let elapsed = now.saturating_sub(state.window_started_at);
        if elapsed >= window_seconds {
            *state = WindowState {
                requests: 0,
                window_started_at: now,
            };
        }

        state.requests = state.requests.saturating_add(1);
        if state.requests > maximum {
            return Err(window_seconds - now.saturating_sub(state.window_started_at));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::RequestLimiter;

    #[test]
    fn a_window_bounds_one_source_and_then_reopens() {
        let limiter = RequestLimiter::default();

        assert_eq!(limiter.consume("ingest:source", 100, 2, 60), Ok(()));
        assert_eq!(limiter.consume("ingest:source", 100, 2, 60), Ok(()));
        assert_eq!(limiter.consume("ingest:source", 130, 2, 60), Err(30));
        assert_eq!(limiter.consume("ingest:source", 160, 2, 60), Ok(()));
    }

    #[test]
    fn windows_are_independent_per_key() {
        let limiter = RequestLimiter::default();

        assert_eq!(limiter.consume("ingest:first", 100, 1, 60), Ok(()));
        assert_eq!(limiter.consume("ingest:first", 100, 1, 60), Err(60));
        assert_eq!(limiter.consume("ingest:second", 100, 1, 60), Ok(()));
    }
}
