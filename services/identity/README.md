# Identity Service

The identity service owns phase-0 native Web credentials, one-time recovery
keys, browser sessions, and remembered-Bond hints. A user can register and sign
in with only an exact, case-sensitive `pub_dress` and password. Provider
adapters remain isolated for later optional bindings.

The service is an adapter, not protocol authority. Canonical `pub_dress` validation comes from a pinned `nilx-one/core` contract; provider identity, messenger transport, persistence, and provider verification stay outside `nilx-one/0x1`.

Provider accounts are namespaced as `(provider, provider_subject)`. Telegram and Discord IDs therefore never collide merely because their numeric values happen to match. The storage model also permits multiple provider bindings to point at one identity when an explicit account-linking flow is introduced; this PR does not invent such a link without proof from both sides.

## Native Web API

- `POST /api/v1/identity/resolve` resolves an exact public `pub_dress` candidate.
- `GET /api/v1/auth/native/context` returns authenticated, remembered, or anonymous context.
- `POST /api/v1/auth/native/registration` atomically claims an address and returns a one-time recovery challenge.
- `POST /api/v1/auth/native/recovery/acknowledgement` acknowledges delivery and creates the session.
- `POST /api/v1/auth/native/session` verifies a password and creates a session.
- `POST /api/v1/auth/native/recovery` rotates the password and recovery key after valid recovery proof.
- `POST /api/v1/auth/native/logout` revokes the active session.
- `POST /api/v1/auth/native/remembered/forget` removes only the remembered hint.

Registration requires an `Idempotency-Key`. State-changing endpoints require
the same-origin `X-0x1-CSRF: 1` header. Session and remembered-Bond cookies
are Secure, HttpOnly, SameSite=Lax; the signed remembered hint is never accepted
as authentication.

Passwords contain 15–128 Unicode scalar values after NFC normalization. The
service blocks known compromised values and stores versioned Argon2id verifiers
with 19 MiB memory, two iterations, and one lane. Authentication uses generic
failures, a dummy hash path, and source/address/global rate limits.

## Inactive provider adapters

- Telegram and Discord code remains buildable for later binding work.
- The Web surface renders both provider controls as visible but disabled.
- No Telegram Mini App or Discord Activity route is published in phase 0.

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

`NATIVE_AUTH_SECRET`, `PASSWORD_PEPPER`, `TELOXIDE_TOKEN`, and
`DISCORD_CLIENT_SECRET` are server-only runtime secrets. The native authentication
secret and password pepper must be independent values of at least 32 bytes. None
may be exposed through Vite, browser configuration, repository files, build
output, Telegram Mini App JavaScript, or Discord Activity JavaScript.

Production keeps `NATIVE_AUTH_SECRET` and `PASSWORD_PEPPER` server-owned. On the
first production activation the deploy layer creates independent random values
inside the persistent identity secrets directory; later activations preserve
those exact values. This prevents a deployment from accidentally rotating the
password pepper or invalidating native authentication state. Provider credentials
remain supplied by the production environment and may be updated independently.

`DISCORD_CLIENT_ID` is public OAuth configuration and is intentionally exposed through the bounded config endpoint so the Activity and service cannot drift between application IDs.

## Run

For local or manual execution, set `NATIVE_AUTH_SECRET` and `PASSWORD_PEPPER`.
Provider credentials may remain unset while phase-0 provider controls are inactive.
Optional runtime settings:

- `DATABASE_URL` — default `sqlite://identity.db`;
- `HTTP_BIND` — default `0.0.0.0:8080`;
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` — default `300`.

Then run:

```bash
cargo run --manifest-path services/identity/Cargo.toml
```

Supplying only one Discord credential is a configuration error. Provider
credentials do not activate a public provider host by themselves.

## Runtime package

[`Dockerfile`](Dockerfile) builds the combined Telegram bot and identity API. [`deploy/compose.yaml`](deploy/compose.yaml) persists SQLite state in a named volume and exposes only the private `ox1-identity:8080` edge alias. The canonical Web runtime proxies the bounded `/api/v1/identity*` and `/api/v1/auth/*` surfaces to that alias.

CI validates the service and deployment contract. Packaging publishes an immutable GHCR image. Production activation is a separate manual workflow. The production deploy composes provider credentials with the persistent server-owned native secrets into a `0600` runtime environment file.

Before activation commits a release, it verifies the public Web shell, the
unpublished provider routes, and the provider-neutral unauthenticated `401`
identity boundary. A proxy `502` fails activation and enters the existing
rollback path.

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
