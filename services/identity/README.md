# Identity Service

The identity service is the server-side provider integration for Stage 1 registration in the canonical 0x1 Web product. It binds one immutable canonical `pub_dress` to a verified provider account without claiming native cryptographic identity or custodial recovery.

The service is an adapter, not protocol authority. Canonical `pub_dress` validation comes from a pinned `nilx-one/core` contract; provider identity, messenger transport, persistence, and provider verification stay outside `nilx-one/0x1`.

Provider accounts are namespaced as `(provider, provider_subject)`. Telegram and Discord IDs therefore never collide merely because their numeric values happen to match. The storage model also permits multiple provider bindings to point at one identity when an explicit account-linking flow is introduced; this PR does not invent such a link without proof from both sides.

## Telegram bot commands

- `/start` opens the canonical 0x1 Telegram Mini App registration surface at `https://nilx.one/telegram/`.
- `/whoami` returns the stored provider-backed identity record.
- `/recover` explains the current Telegram recovery boundary.

The bot does not accept a `pub_dress` candidate as chat text. Telegram chat is an entry point, not a second registration implementation.

## Provider API

- `GET /api/v1/identity` returns the registered public identity projection for the authenticated provider account.
- `GET /api/v1/identity/availability?discriminator=0&slug=sky` checks exact, case-sensitive availability for the authenticated provider without reserving the address.
- `POST /api/v1/identity/registration` accepts `{"discriminator":"0","slug":"sky"}` and registers `0x0sky`.
- `GET /api/v1/auth/discord/config` exposes only the public Discord application/client ID required by the Activity SDK.
- `POST /api/v1/auth/discord/token` exchanges a Discord Activity authorization code server-side; the Discord client secret never reaches JavaScript.
- `GET /health` reports process health without identity state.

Telegram identity requests use `Authorization: tma <Telegram.WebApp.initData>`. The service verifies the Telegram HMAC, rejects duplicate fields, enforces a bounded `auth_date`, and derives the provider subject only from the verified `user` object.

Discord identity requests use `Authorization: discord <access_token>`. The Activity obtains its authorization code through Discord's Embedded App SDK, exchanges that code through the server endpoint, and then the identity service resolves the provider subject from Discord's authenticated `/users/@me` response. A collision response never discloses another provider binding.

Availability is advisory. The database insert remains the only collision boundary, so a client must still handle a candidate becoming unavailable between the check and registration.

## Secret boundary

`TELOXIDE_TOKEN` and `DISCORD_CLIENT_SECRET` are server-only runtime secrets. They belong in the `nilx-one/web` production GitHub Environment and are delivered only to this service. Neither may be exposed through Vite, browser configuration, repository files, build output, Telegram Mini App JavaScript, or Discord Activity JavaScript.

`DISCORD_CLIENT_ID` is public OAuth configuration and is intentionally exposed through the bounded config endpoint so the Activity and service cannot drift between application IDs.

## Run

Set `TELOXIDE_TOKEN`. To enable Discord Activity authentication, set both `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. Optional runtime settings:

- `DATABASE_URL` — default `sqlite://identity.db`;
- `HTTP_BIND` — default `0.0.0.0:8080`;
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` — default `300`.

Then run:

```bash
cargo run --manifest-path services/identity/Cargo.toml
```

If neither Discord environment value is present, Discord authentication remains unavailable while Telegram continues to operate. Supplying only one Discord credential is a configuration error.

## Runtime package

[`Dockerfile`](Dockerfile) builds the combined Telegram bot and identity API. [`deploy/compose.yaml`](deploy/compose.yaml) persists SQLite state in a named volume and exposes only the private `ox1-identity:8080` edge alias. The canonical Web runtime proxies the bounded `/api/v1/identity*` and `/api/v1/auth/*` surfaces to that alias.

CI validates the service and deployment contract. Packaging publishes an immutable GHCR image. Production activation is a separate manual workflow.

Before activation commits a release, it verifies the public Telegram shell and the provider-neutral unauthenticated `401` identity boundary. A proxy `502` fails activation and enters the existing rollback path.

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
