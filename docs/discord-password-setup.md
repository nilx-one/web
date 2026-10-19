# Discord password setup

Discord authorization resolves the verified account to its existing Bond, exactly
as Telegram does. After confirming an available pub_dress, a new provider
registration proceeds to **Password → Confirm password → Save password → Continue**. Existing Discord Bonds without an active native
credential start at password setup. A Discord Bond with an active password
proceeds directly to the shared product; this flow is initial credential setup,
never a password reset.

The confirmation is compared after NFC normalization in the view and never sent
to the server. Passwords remain in component memory, never in URLs or persistent
browser storage. The server applies the existing native password policy, Argon2id
with pepper, and session-activation policy. Inside an Activity every
request travels through Discord's proxy prefix, which changes where the request
is addressed and nothing about what it proves.

## Authority and session

`POST /api/v1/auth/discord/password` accepts only `{ "password": "..." }`.
It requires the CSRF header and a freshly verified Discord access token. The
identity service resolves the provider binding itself; the request cannot name an
owner, and a Telegram proof is refused here just as a Discord proof is refused at
the Telegram endpoint. Both endpoints are the same operation under a different
verified provider: one handler, one transaction, one set of guarantees.

The credential is activated in one transaction without issuing a recovery key or
challenge. An active credential cannot be changed by this endpoint, including
concurrent requests. A verified provider can finish an old pending setup; this
invalidates its old challenge atomically.

Setup attempts are rate limited per Discord account and globally, before any
password hashing work is done.

The response returns `authenticated`, the existing identity and secure session
cookies through the existing Single Active Client policy. The password is usable
immediately. No recovery acknowledgement step is required.
The provider binding, human address, and owned Avaia remain unchanged. This does
not create any Interaction, BondChain or Relationship fact.

Provider lookup and registration responses include `password_required`, derived
from the server's active native credential. Missing state is treated as requiring
setup. An occupied address belonging to an unbound account is shown as unavailable,
never as permission to set a password. Attaching Discord to an independently
created native Bond remains a separate dual-proof operation.

## Hand-off to the product origin

A password manager files a credential under the origin that shows the form.
Inside the Activity that origin is Discord's proxy
(`<application id>.discordsays.com`), so a password created there would be
offered only there. The Activity therefore does not show the password form. Its
host names a credential hand-off, and the setup step offers **Create on
nilx.one** instead, which opens
`https://nilx.one/auth?provider=discord&intent=handoff` through Discord's
external-link command.

That route runs the same browser Discord OAuth (PKCE, signed transaction) as
browser sign-in. With the `handoff` intent, which only Discord accepts, the
callback mints no session and links no provider. It sets a signed, HttpOnly
`__Host-0x1_discord_handoff` cookie that carries the verified Discord subject for
15 minutes, then lands on `/?host=discord`.

The site confirms the hand-off with `GET /api/v1/auth/discord/handoff` before it
mounts. While the hand-off holds, the page composes the **Discord host**, not the
Web one: it shows "discord host", and it runs the same provider identity and
password setup as the Activity. Its requests carry `Authorization:
discord-handoff`. The cookie is the proof, and the header only opts a request
in, so the ambient cookie never authenticates a request that did not ask. A
stale or forged `?host=discord` falls back to the Web host and is dropped from the
URL.

The password is then created on `nilx.one`, and that is where the password
manager saves it. After password setup succeeds, the service issues the
usual native session on this origin. The Activity re-reads its provider identity
through **Password created** and continues once `password_required` is false.

## Deployment

Identity runtime contract **14** provides direct password setup. Web, Telegram
and Discord targets all require contract 14 before activation. The orchestrator
checks this dependency and fails closed without a suitable package.

Migration 0034 preserves legacy recovery verifiers/challenges and allows new
credentials without recovery material. Old unfinished registrations can also
complete after verified password proof. Do not roll back to a contract-13 binary
after creating credentials with nullable recovery verifiers.

Discord authentication requires `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`
in the identity service runtime.
No new environment secret is required. Deployment remains a separately authorized
operation; successful CI does not activate a release.

© 2026 aiaiaiai · aiaiaiai.org
