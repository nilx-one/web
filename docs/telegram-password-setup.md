# Telegram password setup

Telegram authentication resolves the verified account to its existing Bond. After
confirming an available pub_dress, a new provider registration proceeds to
**Password → Confirm password → Save password → Continue**.
Existing Telegram Bonds without an active native credential start at password setup.
A Telegram Bond with an active password proceeds directly to the shared product;
this flow is initial credential setup, never a password reset.

The confirmation is compared after NFC normalization in the view and never sent
to the server. Passwords remain in component memory, never in URLs or persistent
browser storage. The server applies the existing native password policy, Argon2id
with pepper, and session-activation policy.

## Authority and session

`POST /api/v1/auth/telegram/password` accepts only `{ "password": "..." }`.
It requires the CSRF header and freshly verified Telegram initData. The identity
service resolves the provider binding itself; the request cannot name an owner.
The credential is activated in one transaction without issuing a recovery key or
challenge. An active credential cannot be changed by this endpoint, including
concurrent requests. A verified provider can finish an old pending setup; this
invalidates its old challenge atomically.

The response returns `authenticated`, the existing identity and secure session
cookies through the existing Single Active Client policy. The password is usable
immediately. No recovery acknowledgement step is required.
The provider binding, human address, and owned Avaia remain unchanged. This does
not create any Interaction, BondChain or Relationship fact.

Provider lookup and registration responses include `password_required`, derived
from the server's active native credential. Missing state is treated as requiring
setup by the Telegram client. An occupied address belonging to an unbound account
is shown as unavailable, never as permission to set a password. Attaching Telegram
to an independently created native Bond remains a separate dual-proof operation.

## Deployment

Identity runtime contract **14** provides direct password setup. Web, Telegram
and Discord targets all require contract 14 before activation. The orchestrator
checks this dependency and fails closed without a suitable package.

Migration 0034 preserves legacy recovery verifiers/challenges and allows new
credentials without recovery material. Old unfinished registrations can also
complete after verified password proof. Do not roll back to a contract-13 binary
after creating credentials with nullable recovery verifiers.

No new environment secret is required. Deployment remains a separately authorized
operation; successful CI does not activate a release.

© 2026 aiaiaiai · aiaiaiai.org
