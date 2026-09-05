// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

use std::{env, net::SocketAddr, time::Duration};

use error_trash::{
    Clock, ErrorTrashRepository, IngestTokens, ReadToken, RetentionPolicy, SystemClock, api,
};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

const PRUNE_INTERVAL: Duration = Duration::from_secs(3_600);

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("error_trash=info")),
        )
        .init();

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://error-trash.db".to_owned());
    let http_bind = env::var("HTTP_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
        .parse::<SocketAddr>()
        .expect("HTTP_BIND must be a socket address");
    let ingest_tokens = IngestTokens::parse(
        &env::var("ERROR_TRASH_INGEST_TOKENS")
            .expect("ERROR_TRASH_INGEST_TOKENS must be configured as project:token entries"),
    )
    .expect("ERROR_TRASH_INGEST_TOKENS must contain valid project:token entries");
    let read_token = env::var("ERROR_TRASH_READ_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
        .map(|token| {
            ReadToken::parse(&token).expect("ERROR_TRASH_READ_TOKEN must be at least 32 characters")
        });
    let retention = retention_from_environment();

    let repository = ErrorTrashRepository::connect(&database_url)
        .await
        .expect("error trash database must initialize");
    let listener = tokio::net::TcpListener::bind(http_bind)
        .await
        .expect("error trash HTTP listener must bind");
    let api = api::router(repository.clone(), ingest_tokens, read_token.clone());

    info!(
        %http_bind,
        reads_enabled = read_token.is_some(),
        retention_days = retention.retention_days,
        max_rows = retention.max_rows,
        "starting the 0x1 error trash"
    );

    tokio::spawn(prune_periodically(repository, retention));

    axum::serve(listener, api)
        .await
        .expect("error trash HTTP server must remain available");
}

/// Applies retention on a schedule rather than on the ingest path, so a burst
/// of dumps is never slowed down by housekeeping.
async fn prune_periodically(repository: ErrorTrashRepository, retention: RetentionPolicy) {
    if retention.retention_days.is_none() && retention.max_rows.is_none() {
        info!("retention is unbounded; the error trash keeps every dump");
        return;
    }

    let clock = SystemClock;
    let mut ticker = tokio::time::interval(PRUNE_INTERVAL);
    loop {
        ticker.tick().await;
        match repository.prune(&retention, &clock.now()).await {
            Ok(0) => {}
            Ok(removed) => info!(removed, "retention removed expired error dumps"),
            Err(storage_error) => error!(%storage_error, "retention pass failed"),
        }
    }
}

fn retention_from_environment() -> RetentionPolicy {
    RetentionPolicy {
        retention_days: bounded_setting(
            "ERROR_TRASH_RETENTION_DAYS",
            RetentionPolicy::DEFAULT_RETENTION_DAYS,
        ),
        max_rows: bounded_setting("ERROR_TRASH_MAX_ROWS", RetentionPolicy::DEFAULT_MAX_ROWS),
    }
}

/// Reads an optional numeric bound where `0` means "no bound".
fn bounded_setting<T>(variable: &str, default: T) -> Option<T>
where
    T: Copy + Default + PartialEq + std::str::FromStr,
    <T as std::str::FromStr>::Err: std::fmt::Display,
{
    let configured = match env::var(variable) {
        Ok(value) => value
            .trim()
            .parse::<T>()
            .unwrap_or_else(|error| panic!("{variable} must be a non-negative integer: {error}")),
        Err(_) => default,
    };
    (configured != T::default()).then_some(configured)
}
