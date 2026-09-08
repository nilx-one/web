# Discord password setup

Discord authorization resolves the verified account to its existing Bond, exactly
as Telegram does. After confirming an available pub_dress, a new provider
registration proceeds to **Password → Confirm password → Save password → Save
recovery key → Continue**. Existing Discord Bonds without an active native
credential start at password setup. A Discord Bond with an active password
proceeds directly to the shared product; this flow is initial credential setup,
never a password reset.

The confirmation is compared after NFC normalization in the view and never sent
to the server. Passwords remain in component memory, never in URLs or persistent
browser storage. The server applies the existing native password policy, Argon2id
with pepper, and recovery-key acknowledgement contract. Inside an Activity every
request travels through Discord's proxy prefix, which changes where the request
is addressed and nothing about what it proves.

## Authority and recovery

`POST /api/v1/auth/discord/password` accepts only `{ "password": "..." }`.
It requires the CSRF header and a freshly verified Discord access token. The
identity service resolves the provider binding itself; the request cannot name an
owner, and a Telegram proof is refused here just as a Discord proof is refused at
the Telegram endpoint. Both endpoints are the same operation under a different
verified provider: one handler, one transaction, one set of guarantees.

The credential and recovery challenge are written in one transaction. An active
credential cannot be changed by this endpoint, including concurrent requests.
A pending, unacknowledged setup may be retried by the same verified provider;
retry rotates recovery material and invalidates the preceding challenge atomically.
Setup attempts are rate limited per Discord account and globally, before any
password hashing work is done.

The response returns `recovery_key_required`, the existing identity, a one-time
recovery key, and the acknowledgement challenge. The password becomes usable for
native sign-in only after the existing recovery acknowledgement endpoint succeeds.
The provider binding, human address, and owned Avaia remain unchanged. This does
not create any Interaction, BondChain or Relationship fact.

Provider lookup and registration responses include `password_required`, derived
from the server's active native credential. Missing state is treated as requiring
setup. An occupied address belonging to an unbound account is shown as unavailable,
never as permission to set a password. Attaching Discord to an independently
created native Bond remains a separate dual-proof operation.

## Deployment

Identity runtime contract **3** provides the additive Discord setup endpoint.
Only the Discord target requires contract 3; Telegram retains 2 and the browser
retains 1. Deploy validation must pass before merge. After merge, package the
identity service at contract 3 before activating the Discord client; the production
orchestrator checks this dependency and fails closed without a suitable package.
Discord authentication also requires `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`
in the identity service runtime. No schema migration is required.

© 2026 aiaiaiai · aiaiaiai.org
