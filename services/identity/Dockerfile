# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

FROM rust:1.98-bookworm AS build

WORKDIR /source
COPY services/identity/Cargo.toml ./Cargo.toml
COPY services/identity/migrations ./migrations
COPY services/identity/src ./src
RUN cargo generate-lockfile \
    && cargo build --locked --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 identity \
    && install --directory --owner identity --group identity /data

COPY --from=build /source/target/release/identity-bot /usr/local/bin/identity-bot

USER identity
ENV DATABASE_URL=sqlite:///data/identity.db
ENV HTTP_BIND=0.0.0.0:8080
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=5s \
    CMD curl --fail --silent --show-error http://127.0.0.1:8080/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/identity-bot"]
