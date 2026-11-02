<!-- © 2026 aiaiaiai · aiaiaiai.org -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# One sign-in page: `auth.aiaiaiai.org`

Status: v0 contract proposal, nothing implemented yet
Owner: Identity service (`services/identity`)
Parent design: [ECO-0001](https://github.com/aiaiaiai-org/.github/blob/main/ecosystem/identity/DESIGN.md)

This is the executable contract for the shared sign-in page that ECO-0001
left open. It records two owner decisions (2026-11-02):

1. The issuer origin is **`auth.aiaiaiai.org`**. DNS exists. Every product
   signs people in on this one origin and no other.
2. Signing in from a product that already knows a provider account (a
   Telegram bot, a later Discord bot) **connects that account** to the Bond,
   and tells the person the truth when it cannot.

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
is not a game client.

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

| Snapshot                         | Core today                     | Page says                                          | Offers                                                                             |
| -------------------------------- | ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `X` unbound, `B` has no Telegram | `linked`                       | "Telegram connected to `B`"                        | continue                                                                           |
| `X` already on `B`               | `already_linked`               | nothing                                            | continue                                                                           |
| `X` on another Bond `C`          | `provider_already_linked`      | "This Telegram belongs to `C`"                     | sign in as `C` · move it to `B`¹ · continue as `B` without it                      |
| `B` holds another Telegram `Y`   | `provider_type_already_linked` | "`B` is connected to a different Telegram account" | replace `Y` with `X`¹ · open the bot from that other account · continue without it |
| no `B` yet (registration)        | `linked` after registration    | "Account created, Telegram connected"              | continue                                                                           |

"Continue without it" still signs the person in. The product gets
`provider_link: { "state": "refused", "code": "…" }` and may keep its own chat
mapping. Identity stores nothing for `X`, but keeps the refusal it already
remembers (`recent_link_refusal`), so a partner lookup can explain it.

The page never names `Y`. The person did not prove `Y`, and a Telegram id or
username is personal data.

### ¹ Rebinding: needs a Core decision first

Rules 2 and 3 of the 0x1 provider-binding rules **refuse** both conflicts
today. Moving or replacing an account is a new decision, so it lands in Core
before any host offers it. Proposed `decide_rebind(bond, account, snapshot)`:

- **Requires** fresh proof of both sides in the same transaction: the provider
  proof for `X` (not older than its `auth_date` bound) and a password or
  session check for `B` made on this page within the last five minutes.
- **Replace** (`B` holds `Y`): unbind `Y`, bind `X`. The decision is
  `sole_access_path` if `Y` is `B`'s only way in and `B` has no password.
  After a password sign-in that cannot happen, but Core checks it anyway.
- **Move** (`X` on `C`): unbind `X` from `C`, bind it to `B`. Refused with
  `sole_access_path` when `X` is `C`'s only way in, because `C` would be
  locked out forever. The page then offers only "sign in as `C`".
- Never awards anything. ECO-0001's one-time first-provider award is for a
  first connection of a provider type; a rebind is not one.
- Records the rebind with both Bonds and the time, for the owner's audit.
  The record is never served to a partner.

Until Core ships that decision and the 0x1 rules allow it, both rows offer
only the honest refusal and "continue without it".

## Delivery

One PR each, in order:

1. This contract (this PR).
2. `nilx-one/core`: `decide_rebind` and the rule change in the 0x1 identity
   rules.
3. `services/identity`: client registry, pairwise `sub`, signing keys,
   discovery, `/authorize` + `/token` + `/logout`, and the issuer session.
4. `services/identity`: Mini App proof check (Ed25519) and the attach table
   above, with the existing refusals.
5. The page itself: an `apps/auth` host on `@aiaiaiai/auth-view`, deployed
   at `auth.aiaiaiai.org`, plus its public route in infra.
6. First client: the 0x1 site signs in through `auth.aiaiaiai.org`. Its own
   `__Host-0x1_session` stays the product session. The existing native
   endpoints keep working until every 0x1 host is moved.
7. Then `0xda-market`, `prism-hubot`, `mind-web`, and the Prism Hub identity
   migration, each in its own repository.

Deploying any of it is a separate, manually authorized step.

## Not in this contract

Passkeys, email sign-in and transactional email (ECO-0001 §5–6), GitHub
repository access, and any public brand such as "aiaiaiai ID". Products say
"Sign in", never "Sign in with 0x1".
