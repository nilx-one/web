<!-- © 2026 aiaiaiai · aiaiaiai.org -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# One sign-in page: `auth.aiaiaiai.org`

Status: v1 issuer and the 0x1 client routes implemented (contract 17), not deployed
Owner: Identity service (`services/identity`)
Parent design: [ECO-0001](https://github.com/aiaiaiai-org/.github/blob/main/ecosystem/identity/DESIGN.md)

This is the executable contract for the shared sign-in page that ECO-0001
left open. It records three owner decisions (2026-11-02):

1. The issuer origin is **`auth.aiaiaiai.org`**. DNS exists. Every product
   signs people in on this one origin and no other.
2. Signing in from a product that already knows a provider account (a
   Telegram bot, a later Discord bot) **connects that account** to the Bond,
   and tells the person the truth when it cannot.
3. **Every Bond has a password.** Identity hosts the identity; a provider is
   only an account connected to it, never its only way in.

Wire names below are the proposal. Each implementation PR states the exact
contract it ships.

## Why one origin

Password managers key a saved credential by origin. If every product shows
its own form, the person gets one saved password per product. They forget
which one they used and end up with a second account. With one origin there
is one saved `pub_dress` + password, and the browser offers it in every
product: the 0x1 site, a Prism web UI, or a bot's Mini App.

The browser's suggestion is a hint the server never sees. Identity adds two
hints of its own that work without a password manager:

- **Remembered Bond.** After a sign-in, `auth.aiaiaiai.org` keeps a signed
  `__Host-aiaiaiai_bond` hint (like today's `__Host-0x1_bond`): "You already
  have an account: `0x0sky`". It is a hint, never authentication.
- **Known provider.** When a bot sends a person whose Telegram account is
  already connected, the page says so: "This Telegram is already connected to
  `0x0sky`. Sign in." The person proved that Telegram account, so naming its
  Bond reveals nothing new to them.

The form uses `autocomplete="username"` for `pub_dress`, plus
`current-password` or `new-password`, so managers save and fill one entry.

Known limit: passwords already saved for `nilx.one` are not offered on
`auth.aiaiaiai.org`. Browsers do not share credentials across registrable
domains. The first sign-in on the new origin saves the entry again. The page
tells the person this once instead of letting the credential look lost.

## Shape

Standard OpenID Connect, authorization code flow with PKCE (S256). No session
cookie, password or provider token crosses between products.

| Endpoint                                | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `GET /.well-known/openid-configuration` | discovery                                             |
| `GET /.well-known/jwks.json`            | public signing keys, rotated with overlap             |
| `GET /authorize`                        | the sign-in page; starts or reuses a session          |
| `POST /token`                           | code → `id_token` (confidential clients authenticate) |
| `POST /logout`                          | ends the issuer session                               |

The issuer session is `__Host-aiaiaiai_session` on `auth.aiaiaiai.org`. A
person signed in for one product signs in to the next with one click.
Single Active Client still applies to 0x1 game sessions; the issuer session
is not a game client. The first release has no issuer session and no
`/logout`: every product sign-in asks for the password, which the password
manager fills. The session comes with the second client, when there is
something to skip.

### Who talks to Identity

Identity is the authority; a product is a client of it and talks to it only
over this protocol. For 0x1 the client is **`nilx-one/core`**: its
`nilxone-identity` crate holds the relying-party side (authorization request,
PKCE, code exchange, `id_token` verification) and the 0x1 table that maps an
Identity `sub` to a Bond. The 0x1 host routes in `services/identity` only
carry cookies and redirects and call Core. They never read the issuer's
state, even while both run in one process on one database.

That process sharing is history, not design: the Identity service grew out
of 0x1. The protocol boundary is what lets the issuer move to its own
deployment later without touching 0x1.

### Clients

A server-side registry, not a request parameter, says what a client may do:

| Field             | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `client_id`       | `nilx-one`, `0xda-market`, `prism-hub`, `prism-hubot`, `mind-web`, …  |
| `redirect_uris`   | exact-match allowlist, HTTPS only                                     |
| `kind`            | `confidential` (has a server secret) or `public` (PKCE only)          |
| `presentation`    | product name, skin, featured methods; presentation only (ECO-0001 §4) |
| `telegram_bot_id` | the bot whose Mini App proofs this client may present (optional)      |
| `scopes`          | which claims the client may ask for                                   |

`presentation` never changes which methods exist, the security rules, or the
redirects. Unknown `client_id` or an unlisted `redirect_uri` stops on an error
page and never redirects.

### The `id_token`

| Claim                       | Meaning                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sub`                       | **pairwise**: a keyed digest of (`client_id`, private subject). Stable for one product, unlinkable across products, never the private identifier |
| `pub_dress`                 | only with scope `pub_dress`; it is public and mutable, so never a key                                                                            |
| `amr`, `auth_time`, `nonce` | as OIDC defines                                                                                                                                  |
| `provider_link`             | the result of the entry-provider attach below, when there was one                                                                                |

That is the "product-scoped opaque reference" ECO-0001 §1 asked for. Rotating
the pairwise key rotates every product's reference at once, so the key is
versioned and the issuer answers both versions during a migration.

## The password is the baseline

`pub_dress` + password is the identity's own credential. Telegram, Discord
and GitHub are connected accounts: they can make signing in faster, but
they never hold the identity.

- **Registration always sets a password**, whatever the entry. A bot-first
  registration verifies the provider, asks for the `pub_dress` and then the
  password, and only then creates the Bond. There is no provider-only
  registration.
- **A Bond without an active password is unfinished.** Older Telegram
  registrations may still have none (`docs/telegram-password-setup.md`). The
  issuer issues no `id_token` to any product for such a Bond. Its provider
  sign-in leads straight to password setup, and the sign-in completes only
  after setup.
- **Provider sign-in is a shortcut**, available only to a Bond that has a
  password. It never replaces the password, and changing or disconnecting a
  provider never touches the password.
- Disconnecting any provider is therefore always allowed for a finished
  Bond. Core's `sole_access_path` refusal stays only as a guard for
  unfinished legacy Bonds until none remain.

## Entering with a provider account

A product that came from a provider passes **proof** of that account, not a
claim about it:

| Entry                           | Proof                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram bot (`prism-hubot`, …) | The bot opens `/authorize` as a **Mini App** (`web_app` button). The page sends `Telegram.WebApp.initData`; Identity checks its Ed25519 `signature` against Telegram's public key for the client's `telegram_bot_id` (Telegram's third-party validation), so Identity needs no bot token. `auth_date` is bounded as today |
| Discord bot or Activity         | Discord OAuth on the page, as the browser flow does today                                                                                                                                                                                                                                                                 |
| Plain web                       | none; the person may still choose "Connect Telegram" (`oauth.telegram.org`)                                                                                                                                                                                                                                               |

A plain link to `/authorize`, even one sent by a bot, **carries no provider
proof**. A forwarded link must not let a stranger attach the sender's
Telegram to the stranger's Bond. That is why the bot entry is a Mini App and
never a URL with a Telegram id in it.

### What happens after the password

The person proved Telegram account `X` and signed in to Bond `B`. Identity
loads the snapshot and asks Core (`decide_link`, `docs/provider-bindings.md` in
`nilx-one/core`):

| Snapshot                         | Core today                     | Page says                                               | Offers                                                                             |
| -------------------------------- | ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `X` unbound, `B` has no Telegram | `linked`                       | "Telegram connected to `B`"                             | continue                                                                           |
| `X` already on `B`               | `already_linked`               | nothing                                                 | continue                                                                           |
| `X` on another Bond `C`          | `provider_already_linked`      | "This Telegram belongs to `C`"                          | sign in as `C` · move it to `B`¹ · continue as `B` without it                      |
| `B` holds another Telegram `Y`   | `provider_type_already_linked` | "`B` is connected to a different Telegram account"      | replace `Y` with `X`¹ · open the bot from that other account · continue without it |
| no `B` yet (registration)        | `linked` after registration    | "Account created with its password, Telegram connected" | continue                                                                           |

"Continue without it" still signs the person in. The product gets
`provider_link: { "state": "refused", "code": "…" }` and may keep its own chat
mapping. Identity stores nothing for `X`, but keeps the refusal it already
remembers (`recent_link_refusal`), so a partner lookup can explain it.

The page never names `Y`. The person did not prove `Y`, and a Telegram id or
username is personal data.

### ¹ Rebinding: switching the client you play from

The identity is the person, authenticated by their password on this page.
A provider account is only the client they reach it through, so replacing
`Y` with `X`, or moving `X` from `C` to `B`, loses nothing: every finished
Bond keeps its password. It is an ordinary owner action with one explicit
confirmation ("`B` uses a different Telegram account. Use this one
instead?"), and no second password prompt, because the person just entered
it.

- **Replace** (`B` holds `Y`): unbind `Y`, bind `X`.
- **Move** (`X` on `C`): unbind `X` from `C`, bind it to `B`. `C` keeps its
  password and only loses a connected client.
- An **unfinished** `C` (an older registration with no password) is
  reachable only through `X`, so whoever proved `X` is `C`'s owner. Instead
  of a move the page offers "finish `C`": set its password, then sign in.
- Never awards anything: ECO-0001's one-time first-provider award is for a
  first connection of a provider type, not a switch.

Rules 2 and 3 of the 0x1 provider-binding rules refuse both conflicts today,
so the switch is a new Core decision (`decide_rebind`) that lands before any
host offers it. Until then both rows offer only the honest refusal and
"continue without it".

## Delivery

One PR each, in order:

1. This contract (this PR).
2. `nilx-one/core`: the 0x1 relying party in `nilxone-identity` (authorization
   request, code exchange, EdDSA `id_token` verification, the `sub` → Bond
   table) and the issuer's pairwise-subject digest.
3. `services/identity`: the issuer (client registry, signing key, discovery,
   JWKS, a server-rendered `/authorize` page for sign-in and registration,
   `/token`) and the 0x1 routes that call Core's client. Off unless
   configured.
4. The 0x1 site sends "Sign in" to `auth.aiaiaiai.org`. Its own
   `__Host-0x1_session` stays the product session; the existing native
   endpoints keep working until every 0x1 host is moved.
5. Public route for `auth.aiaiaiai.org` in infra, then a manually authorized
   deploy.
6. `nilx-one/core`: `decide_rebind` and the password-baseline rule;
   `services/identity`: the Mini App proof check and the attach table above.
7. Then the issuer session, `0xda-market`, `prism-hubot`, `mind-web`, and the
   Prism Hub identity migration, each in its own repository.

Deploying any of it is a separate, manually authorized step.

## Not in this contract

Passkeys, email sign-in and transactional email (ECO-0001 §5–6), GitHub
repository access, and any public brand such as "aiaiaiai ID". Products say
"Sign in", never "Sign in with 0x1".
