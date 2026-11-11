<!-- © 2026 aiaiaiai · aiaiaiai.org -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Identity boundary: the identity service leaves the game world

Status: service ownership updated by the owner on 2026-11-06. The historical
2026-11-02/03 proposal is preserved below for context, not as the current
repository or hosting decision. No deployment, data moves or wipe run here.
Parent designs: [ECO-0001](https://github.com/aiaiaiai-org/.github/blob/main/ecosystem/identity/DESIGN.md)
and [`docs/unified-auth.md`](unified-auth.md).

## Current decision (2026-11-06)

The owner chose **`nilx-one/core`** for the 0x1 service logic. This supersedes
the earlier unnamed game repository under `aiaiaiai-org` and the instruction
below that Core should receive removal only.

| Authority                     | Owns                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `aiaiaiai-org/4x-ais`         | Shared identity, unique `pub_dress` and public-label allocation, native credentials, providers and OIDC issuer          |
| `nilx-one/core` (server-side) | 0x1 product profile, public information and shared game behavior; product state stays outside AIS                       |
| `nilx-one/web`                | HTTP/process composition, product-session cookies, request authentication, CSRF/rate limits, host SDKs and presentation |

The product-side contract and first implementation are in
[Core PR #95](https://github.com/nilx-one/core/pull/95), including
`docs/ais-public-info.md`. `PublicInfoService` composes the existing OIDC
verifier with its own product tables. Only a verified `(issuer, sub)`
for client `nilx-one` creates or resolves a profile. A public name never
attaches a pre-existing Bond, and another product's pairwise subject cannot
select a 0x1 row. A rename preserves the product id and its state.

The public DTO contains only a product `profile_id`, optional display name
`pub_dress` and XP with `authority: "client"`. Pairwise subjects, credentials,
provider identifiers, wallet balances, precise locations and internal roles
are excluded. A stored owner assertion creates no BondChain evidence.

This is an opt-in Core path, not a running shared-auth rollout. Existing
`SignInFlow::finish` and `aiaiaiai_accounts` consumers retain the legacy
first-sight address link until their adapter is explicitly moved. A new host
must use the product service and its own checked session binding, not mint a
legacy native session by matching a public address.

`4x-ais/master` has the identity runtime (4x-ais#6): the OIDC issuer with
both skins. It is not deployed. Its prepared `auth.aiaiaiai.org` route is
on edge-prod-2. Existing 0x1 workloads remain on edge-prod-1. Core itself is
a library, not an edge workload. The OIDC browser redirect and server-side
code/JWKS calls use HTTPS and require no cross-server container route or tunnel.

Delivery proceeds through the Core slice, actual AIS runtime, thin HTTP and
session adapter, then remaining product-state moves and authenticated ordered
identity updates/deletion. End-to-end and deploy validation precede separately
authorized activation. No current host is switched by the Core PR.

The thin HTTP and session adapter is `services/identity/src/product_sign_in.rs`
(identity contract 19): the `/api/v1/auth/aiaiaiai/*` routes now go through
Core's `PublicInfoService` and open a product session, `__Host-0x1_product`,
in 0x1's one database. They no longer mint a native session by
matching a public address. It is off until the sign-in settings are carried
into the runtime environment; routes that authenticate by the native session
do not accept the product session until their state moves.

The preserved safety contracts remain: the visit-bound issuer worker is the
only seeds debit until its replacement is implemented; `gm` belongs to the
game. An approved advance Telegram notice and explicit day-of authorization
are still required before any destructive wipe. Neither action runs here.

## Historical proposal (2026-11-02/03)

The sections below record the earlier design and inventory. Their references
to an unnamed repository, Core removal only, identity staying on edge-prod-1,
and their repository/hosting open questions are superseded by the current
decision above. The existing debit contract and protected rollout gates remain.

### Earlier decision

The aiaiaiai identity service keeps only what makes a person one person across
products. Everything that exists because of the 0x1 game moves to 0x1.

- **identity** stays on edge-prod-1, with every other `nilx-one/*` workload.
  `nilxone-identity` is owned by `nilx-one/web` and listed on edge-prod-1
  (`aiaiaiai-org/infra` `contracts/servers/edge-prod-1.yaml`). It is the
  authority for who a person is: the public `pub_dress`, the native password,
  sessions, provider bindings, the pairwise `sub` per client, and the issuer.
  This plan keeps it there.
- **0x1** owns the game state of a Bond: Avaia, locations, xPing, businesses,
  the 0x1 profile, and the single `gm` role. The `nilx-one/*` workloads that
  are 0x1 today stay on edge-prod-1. 0x1 keeps its own database. It knows a
  person by the pairwise `sub` the issuer gave the 0x1 client. That subject is
  the one `aiaiaiai_accounts` stores.
- **The seeds wallet's home is 0x1.** Debiting stays in the identity issuer
  worker, under the visit binding, until a replacement contract names the
  caller, the authentication, and the authorization. Market keeps offers and
  orders. Market's own pairwise `sub` does not name the wallet.
- Other products keep their own databases: 0xda-market (orders, goods),
  prism-\* (their own data).

No product stores the private identifier of identity. A product refers to a
person by the pairwise `sub` issued to that product, or by `pub_dress` for
display. `pub_dress` is never a key. One product's `sub` does not select
another product's row.

## Why

- ECO-0001 §1: one identity, independent products. A product that needs a
  person's game data must not receive identity's internal state.
- Prism and other clients must not carry game concepts (Bond, Avaia, seeds).
  The game does not need to be in identity for them to be well served.
- 0xda-market sits on the same server as today's 0x1 and is part of the game
  economy, so it may call 0x1 for game data. The seeds debit is the issuer
  worker described below, which already runs on that server.

## Where identity runs

`scripts/validate-contracts.rb` in `aiaiaiai-org/infra` places every workload
owned by `nilx-one/*` or `0xda-market/*` on edge-prod-1, and every
`aiaiaiai-org/*` workload other than infra itself on edge-prod-2.
`nilxone-identity` is one of the edge-prod-1 workloads. Its public route is
`nilx.one` `/api/v1/`. edge-prod-2 runs `aiaiaiai-site`, `prism-*`, and
`h-ua-bot`.

An edge route points only at a workload on that edge's own server, in that
edge's own network. That is the cross-server rule: a route on one server
cannot name another server's workload. OIDC sign-in is an ordinary client call
to the issuer origin, as [`docs/unified-auth.md`](unified-auth.md) specifies.
It is not an edge route, so the rule does not apply to it. Identity and
nilx.one are on edge-prod-1, so that call stays on one server. It does not use
a tunnel.

A new repository owned by `aiaiaiai-org` falls under the edge-prod-2 owner
rule. Whether the new game side accepts that placement, or the owner changes
the rule, is the hosting question below. That choice still leaves
`nilxone-identity` on edge-prod-1. A game service on edge-prod-2 would call
the issuer origin; that call remains OIDC, not an edge route.

## What moves out of identity

Current code in `nilx-one/web` `services/identity` and in `nilx-one/core`
`crates/nilxone-identity` (pinned by `services/identity` at `4543b9c`), grouped
by destination. The new game side is the new `aiaiaiai-org` repository. The
copy that exists in `nilx-one/core` today is removed when that repository has
replaced it. `nilx-one/core` does not gain a game boundary or any other new
behavior.

| Area                                                  | Where it lives today                                                                                                              | Destination                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native credentials, sessions, remembered Bond         | `credentials`, `session_activation`, `api.rs` (auth)                                                                              | stays in identity                                                                                                                                                                         |
| Provider bindings, refusals, secrets, GitHub evidence | `provider_link`, `browser_web_auth`, `provider_secret`, `github_evidence`                                                         | stays in identity                                                                                                                                                                         |
| Pairwise `sub` and the issuer                         | `issuer`; `client_pairwise_subject` in `repository_aiaiaiai_accounts.rs` while the issuer shares the database                     | stays in identity                                                                                                                                                                         |
| 0x1 account link                                      | `aiaiaiai_sign_in`, `repository_aiaiaiai_accounts` (`aiaiaiai_accounts`)                                                          | 0x1. Already 0x1's table ([nilx-one/core#91](https://github.com/nilx-one/core/pull/91)), keyed by `(issuer, subject)` for the 0x1 client's pairwise `sub`                                 |
| Public address and labels                             | `identities` table; `PubDressLabel` in `nilxone-contracts`                                                                        | stays in identity                                                                                                                                                                         |
| Game authorization                                    | `bond_roles`, `api_admin_roles`, `repository_admin_roles`, `repository_admin_telegram`, `repository_admin_telegram_confirmations` | 0x1, as the single `gm` role. `gm` replaces `admin` and the per-role inbox. `bond_roles` is not an identity table                                                                         |
| Avaia lifecycle and configuration                     | `api_avaia_lifecycle`, `repository_avaia_lifecycle`                                                                               | 0x1                                                                                                                                                                                       |
| Location control and Bond location                    | `location_control`, `location`                                                                                                    | 0x1                                                                                                                                                                                       |
| pub_info (xp, awards, finds, spills)                  | `api_pub_info`, `api_awards`, `finds`, `cell_orbs`, `repository_pub_info`, `repository_awards`                                    | 0x1                                                                                                                                                                                       |
| xPing engine                                          | `api_xping`, `repository_xping`                                                                                                   | 0x1                                                                                                                                                                                       |
| Seeds wallet, starter credit, Special, subscriptions  | `repository_subscriptions`, `partner_account`, `market_issuer`, `market_visit`, `api_market`                                      | Wallet home is 0x1 when the replacement contract lands. Until then the issuer worker (`market_issuer`) is the only debit. `partner_account` drops `seeds`. Market keeps offers and orders |
| Business membership and stations                      | `api_business_*`, `repository_business_*`, `business_command`                                                                     | 0x1                                                                                                                                                                                       |
| Speech (spoken lines)                                 | `speech`                                                                                                                          | 0x1                                                                                                                                                                                       |
| Telegram message slots                                | `repository_telegram_message_slots`                                                                                               | 0x1. Presentation for the game client, including the admin slot that `gm` replaces                                                                                                        |

`rate_limit` stays with identity. It is not game state.

## Seeds

Today the identity issuer worker is the only debit. With
`MARKET_ISSUER_WORKER=1` it polls Market's issuer API and settles each Special
order in one transaction keyed by the order id: seeds debit, Special grant,
receipt. It authenticates with lowercase hex HMAC-SHA256 of
`nilx-market-issuer-v1`, keyed by `NILX_BROWSER_HANDOFF_TOKEN`.
`POST /api/v1/identity/market-visit` binds a `visit_id` to the Bond and the
session that asked, and that binding is what a new debit requires. A committed
receipt for an order id is confirmed again and never charged twice.
`POST /api/v1/partner/provider-account` is read-only and debits nothing
(`services/identity/README.md`, "Partner account summary" and "Market Special
orders").

That worker remains the debit until a replacement contract exists. The
contract has to name three things before any other caller debits: who calls,
how that caller authenticates, and which Bond the debit is allowed to charge.
The identifier in that contract is the visit or the order, or the pairwise
`sub` of the 0x1 client. Market's pairwise `sub` is a different value.
`client_pairwise_subject` differs per client, and `aiaiaiai_accounts` stores
the subject issued to the 0x1 client (`WHERE issuer = ? AND subject = ?`).
Market's `sub` does not select that row, so Market cannot debit by the `sub`
it received.

While the worker remains:

- **Caller.** The issuer worker inside identity. Market submits orders to its
  issuer API. Market does not debit the wallet.
- **Authentication.** The HMAC above, plus the visit binding.
- **Authorization.** One receipt per order id, under the wallet lock, and only
  for the Bond bound to that visit. A balance read is not permission to debit.

`partner/provider-account` drops the `seeds` field, so a partner cannot treat
a balance as debit authority. The worker still reads the wallet itself.

The wallet, the starter credit, and this same caller, authentication, and
authorization move to 0x1 only inside the replacement contract. Until that
contract is accepted, `services/identity/README.md` stays the description of
the running debit and changes with the code.

## How the two sides meet

- `aiaiaiai_accounts` belongs to 0x1. [nilx-one/core#91](https://github.com/nilx-one/core/pull/91)
  already built it as 0x1's table, keyed by `(issuer, subject)`. The subject
  is the pairwise `sub` of the 0x1 client. The new game side keeps that key.
  The core copy is removed with the rest of the game code. It is not extended.
- A product that needs game data asks 0x1 with an identifier 0x1 can resolve.
  For seeds, that identifier is the visit binding above. It is not the `sub`
  of another OIDC client.
- The link from the 0x1 client's pairwise `sub` to a game row is that row's
  key. The row is created from the `sub`. `pub_dress` in the token is display.
  The link does not look up a Bond by `pub_dress`.
- `resolve_aiaiaiai_account` in `nilx-one/core` still links on first sight from
  the issuer-asserted `pub_dress`, then resolves later sign-ins by
  `(issuer, subject)`. That first-sight link is removed. The wipe leaves no
  pre-existing Bond to attach by address. The new game side links only by the
  pairwise `sub`. The removal of the `pub_dress` branch is part of
  decommissioning that function from `nilx-one/core`, not a new behavior added
  there.

## Decisions that still stand (owner, 2026-11-02)

- **Wipe instead of migration.** The owner authorizes a full wipe of existing
  users. The identity database is not split. Existing users receive a message
  from the Telegram bot beforehand, explaining that the wipe is needed to
  deliver the new large feature in full. The text and the timing are approved
  by the owner before anything is sent, and the wipe itself runs with an
  explicit go-ahead on the day.
- **One admin role: `gm` (game admin).** It replaces `admin` and the per-role
  admin inbox. It belongs to the game and lives with 0x1. `user` and
  `business` in today's `bond_roles` are game facts and move with the game.
  They are not further admin roles, and identity does not keep `bond_roles`.
- **The new system is not in `nilx-one/core`.** It goes into a new repository
  under `aiaiaiai-org`. The repository's name is not chosen yet.

The first draft's placement (identity on edge-prod-2), its per-role admin row,
its Market debit by `sub`, and its first-sign-in link by `pub_dress` are
withdrawn. The sections above replace them.

## Open questions (need an answer before code in the new repository)

1. **What "modern" means for the new feature.** Stack, hosting, and the first
   scope. Hosting includes the infra owner rule: an `aiaiaiai-org/*` workload
   is placed on edge-prod-2 unless that rule changes. `nilx-one/*`, including
   identity, stays on edge-prod-1 either way.
2. **Repository name** under `aiaiaiai-org`, and whether the owner creates it.
   This session cannot create repositories.

## Order of work

1. This document.
2. The new repository under `aiaiaiai-org`, after the two answers above. Its
   first scope is the game side: a row keyed by the 0x1 client's pairwise
   `sub`, and the single `gm` role. No new behavior is added in
   `nilx-one/core`.
3. The seeds debit stays the issuer worker under the visit binding. The
   replacement contract, when it exists, is part of the new game side and
   carries the same caller, authentication, and authorization rules. It is not
   a `nilx-one/core` change.
4. The wipe, with the Telegram message sent first and the owner's go-ahead on
   the day.
5. Remove the game code from identity. This is the only step that edits
   `nilx-one/core`, and it is removal: delete the game modules from
   `nilxone-identity`, including the `pub_dress` first-sight link in
   `resolve_aiaiaiai_account`, once the new repository has replaced them.
   Pairwise `sub` generation stays with the issuer.

Each step is a separate PR. Deploy is separate and needs explicit
authorization.

## Not decided here

The new repository's name, stack, and hosting, the exact fields of the
identity projection, the date of the wipe, and the text of the contract that
replaces the issuer-worker debit.
