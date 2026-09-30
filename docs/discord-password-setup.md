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
manager saves it. After the recovery key is acknowledged, the service issues the
usual native session on this origin. The Activity re-reads its provider identity
through **Password created** and continues once `password_required` is false.

## Deployment

Identity runtime contract **10** adds the `handoff` intent and the hand-off
authorization. The Web and Discord targets require 10, and Telegram keeps 9.

Identity runtime contract **3** provides the additive Discord setup endpoint.
Only the Discord target requires contract 3; Telegram retains 2 and the browser
retains 1. Deploy validation must pass before merge. After merge, package the
identity service at contract 3 before activating the Discord client; the production
orchestrator checks this dependency and fails closed without a suitable package.
Discord authentication also requires `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`
in the identity service runtime. No schema migration is required.

© 2026 aiaiaiai · aiaiaiai.org
