# Telegram password setup

Telegram authentication resolves the verified account to its existing Bond. After
confirming an available pub_dress, a new provider registration proceeds to
**Password → Confirm password → Save password → Save recovery key → Continue**.
Existing Telegram Bonds without an active native credential start at password setup.
A Telegram Bond with an active password proceeds directly to the shared product;
this flow is initial credential setup, never a password reset.

The confirmation is compared after NFC normalization in the view and never sent
to the server. Passwords remain in component memory, never in URLs or persistent
browser storage. The server applies the existing native password policy, Argon2id
with pepper, and recovery-key acknowledgement contract.

## Authority and recovery

`POST /api/v1/auth/telegram/password` accepts only `{ "password": "..." }`.
It requires the CSRF header and freshly verified Telegram initData. The identity
service resolves the provider binding itself; the request cannot name an owner.
The credential and recovery challenge are written in one transaction. An active
credential cannot be changed by this endpoint, including concurrent requests.
A pending, unacknowledged setup may be retried by the same verified provider;
retry rotates recovery material and invalidates the preceding challenge atomically.

The response returns `recovery_key_required`, the existing identity, a one-time
recovery key, and the acknowledgement challenge. The password becomes usable for
native sign-in only after the existing recovery acknowledgement endpoint succeeds.
The provider binding, human address, and owned Avaia remain unchanged. This does
not create any Interaction, BondChain or Relationship fact.

Provider lookup and registration responses include `password_required`, derived
from the server's active native credential. Missing state is treated as requiring
setup by the Telegram client. An occupied address belonging to an unbound account
is shown as unavailable, never as permission to set a password. Attaching Telegram
to an independently created native Bond remains a separate dual-proof operation.

## Deployment

Identity runtime contract **2** provides the additive setup endpoint and credential
state. Only the Telegram target requires contract 2; browser and Discord retain
contract 1. Deploy validation must pass before merge. After merge, package the
identity service at contract 2 before activating the Telegram client; the production
orchestrator checks this dependency and fails closed without a suitable package.
No schema migration or new environment secret is required.

© 2026 aiaiaiai · aiaiaiai.org
