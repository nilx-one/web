# Identity Service

The identity service is the server-side Telegram integration for Stage 1 registration in the canonical 0x1 Web product. It binds one immutable canonical `pub_dress` to one verified Telegram user ID without claiming native cryptographic identity or custodial recovery.

The service is an adapter, not protocol authority. Canonical `pub_dress` validation comes from a pinned `nilx-one/core` contract; provider identity, Telegram transport, persistence, and Mini App signature verification stay outside `nilx-one/0x1`.

## Bot commands

- `/start` opens the canonical 0x1 Telegram Mini App registration surface at `https://nilx.one/telegram/`.
- `/whoami` returns the stored provider-backed identity record.
- `/recover` explains the current Telegram recovery boundary.

The bot does not accept a `pub_dress` candidate as chat text. Mini App and browser registration share the HTTP identity boundary; Telegram chat is an entry point, not a second registration implementation.

Registration is the database insert performed through that authenticated API. Exact-handle uniqueness and one-handle-per-Telegram-account are enforced by SQLite constraints.

## Telegram Mini App API

- `GET /api/v1/identity` returns the registered public identity projection.
- `POST /api/v1/identity/registration` accepts `{"discriminator":"0","slug":"sky"}` and registers `0x0sky`.
- `GET /health` reports process health without identity state.

Identity endpoints require `Authorization: tma <Telegram.WebApp.initData>`. The service verifies the Telegram HMAC, rejects duplicate fields, enforces a bounded `auth_date`, and derives the provider ID only from the verified `user` object. A collision response never discloses the existing provider binding.

## Secret boundary

`TELOXIDE_TOKEN` is a server-only runtime secret. It belongs in the `nilx-one/web` production GitHub Environment and is delivered only to this service. It must never be exposed through Vite, browser configuration, repository files, build output, or Telegram Mini App JavaScript.

## Run

Set `TELOXIDE_TOKEN` and optionally:

- `DATABASE_URL` — default `sqlite://identity.db`;
- `HTTP_BIND` — default `0.0.0.0:8080`;
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` — default `300`.

Then run:

```bash
cargo run --manifest-path services/identity/Cargo.toml
```

The bot accepts identity actions only in private chats. The HTTP API accepts identity actions only after server-side Telegram Mini App authentication.

## Runtime package

[`Dockerfile`](Dockerfile) builds the combined Telegram bot and identity API. [`deploy/compose.yaml`](deploy/compose.yaml) persists SQLite state in a named volume and exposes only the private `ox1-identity:8080` edge alias. The canonical Web runtime proxies the bounded `/api/v1/identity*` surface to that alias.

CI validates the service and deployment contract. Packaging publishes an immutable GHCR image. Production activation is a separate manual workflow.

Before activation commits a release, it verifies both public halves of registration: the Mini App shell must return `200`, and an unauthenticated identity lookup must reach the service and return the expected `401` boundary. A proxy `502` fails activation and enters the existing rollback path.

## Verify

```bash
cargo generate-lockfile --manifest-path services/identity/Cargo.toml
cargo fmt --manifest-path services/identity/Cargo.toml --all -- --check
cargo clippy --manifest-path services/identity/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path services/identity/Cargo.toml --locked --all-features
```

The normative identity contract remains in [`nilx-one/0x1`](https://github.com/nilx-one/0x1/blob/master/documents/04-identity.md).

---

© 2026 aiaiaiai · aiaiaiai.org
