# syntax=docker/dockerfile:1
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

FROM rust:1.98-bookworm AS build

WORKDIR /source
COPY services/identity/Cargo.toml ./Cargo.toml
COPY services/identity/Cargo.lock ./Cargo.lock
COPY services/identity/migrations ./migrations
COPY services/identity/src ./src
# The registry, git-checkout, and target caches are cache mounts: they speed
# up rebuilds across CI runs but never end up in an image layer, so the
# binary has to be copied out to a plain path before this RUN ends — nothing
# under /source/target survives past it.
RUN --mount=type=cache,id=identity-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=identity-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=identity-cargo-target,target=/source/target \
    cargo build --locked --release \
    && cp target/release/identity-bot /tmp/identity-bot

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 identity \
    && install --directory --owner identity --group identity /data

COPY --from=build /tmp/identity-bot /usr/local/bin/identity-bot

USER identity
ENV DATABASE_URL=sqlite:///data/identity.db
ENV HTTP_BIND=0.0.0.0:8080
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=5s \
    CMD curl --fail --silent --show-error http://127.0.0.1:8080/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/identity-bot"]
