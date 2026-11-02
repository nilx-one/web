<!-- © 2026 aiaiaiai · aiaiaiai.org -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Identity boundary: the identity service leaves the game world

Status: accepted direction (owner, 2026-11-02). Plan only: no code, no data
moves. Each step below is its own change and some need separate authorization.
Parent designs: [ECO-0001](https://github.com/aiaiaiai-org/.github/blob/main/ecosystem/identity/DESIGN.md)
and [`docs/unified-auth.md`](unified-auth.md).

## Decision

The aiaiaiai identity service keeps only what makes a person one person across
products. Everything that exists because of the 0x1 game moves to 0x1.

- **identity** (edge-prod-2) is the authority for who a person is: the public
  `pub_dress`, the native password, sessions, provider bindings, the pairwise
  `sub` per client, and the issuer.
- **0x1** (edge-prod-1) owns the game state of a Bond: Avaia, locations, xPing,
  businesses and the 0x1 profile. It keeps its own database and matches people
  to identity by `sub`.
- **the seeds wallet moves to 0x1.** Market and other products do not hold
  seeds. To price a purchase in seeds they read the balance from 0x1 and debit
  it there.
- Other products keep their own databases: 0xda-market (orders, goods),
  prism-\* (their own data).

No product stores the private identifier of identity. Products refer to a
person only by `sub` (or `pub_dress` for display, never as a key).

## Why

- ECO-0001 §1: one identity, independent products. A product that needs a
  person's game data must not receive identity's internal state.
- Prism and other clients must not carry game concepts (Bond, Avaia, seeds).
  The game does not need to be in identity for them to be well served.
- 0xda-market sits on the same server as 0x1 and is part of the game economy,
  so it may call 0x1 directly. It must not need identity's game tables.

## What moves out of identity

Current code in `nilx-one/web` `services/identity` and in `nilx-one/core`
`crates/nilxone-identity`, grouped by destination. Not a checklist of files;
the inventory is taken when each step starts.

| Area                                                 | Where it lives today                                                                         | Destination                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Native credentials, sessions, remembered Bond        | `credentials`, `session_activation`, `api.rs` (auth)                                         | stays in identity                                                                  |
| Provider bindings and refusals                       | `provider_link`, `browser_web_auth`                                                          | stays in identity                                                                  |
| Pairwise `sub`, issuer, `aiaiaiai_accounts`          | `aiaiaiai_sign_in`, `issuer`, `repository_aiaiaiai_accounts`                                 | stays in identity (the 0x1 side of `aiaiaiai_accounts` moves to 0x1 with its keys) |
| Public address, labels, roles                        | `identities`, `pub_dress_label`, `bond_roles`                                                | stays in identity                                                                  |
| Avaia lifecycle and configuration                    | `api_avaia_lifecycle`, `repository_avaia_lifecycle`                                          | 0x1                                                                                |
| Location control and Bond location                   | `location_control`, `location`                                                               | 0x1                                                                                |
| pub_info (xp, awards, finds, spills)                 | `api_pub_info`, `api_awards`, `finds`, `cell_orbs`                                           | 0x1                                                                                |
| xPing engine                                         | `api_xping`, `repository_xping`                                                              | 0x1                                                                                |
| Seeds wallet, starter credit, Special, subscriptions | `repository_subscriptions`, `partner_account`, `market_issuer`, `market_visit`, `api_market` | 0x1 (wallet); Market keeps offers and orders                                       |
| Business membership and stations                     | `api_business_*`, `repository_business_*`                                                    | 0x1                                                                                |
| Speech (spoken lines)                                | `speech`                                                                                     | 0x1                                                                                |
| Admin roles that gate game features                  | `api_admin_roles`                                                                            | decided per role; a role that gates 0x1 features goes to 0x1                       |

## Seeds: the one change of ownership to review

Today identity is the issuer of seeds: it debits and grants them, and Market
calls it (`market-visit`, the issuer worker, `partner/provider-account`). Under
this decision:

- 0x1 owns the wallet, the starter credit, the debit and the grant.
- Market calls 0x1 for the balance and for a debit at purchase. Both calls stay
  on the edge-prod-1 side, so they do not cross servers.
- The receipt idempotency that Market relies on today (one debit per order id)
  moves with the wallet to 0x1.
- Identity no longer answers a seeds question. `partner/provider-account` drops
  the `seeds` field, or reads it from 0x1, and that choice is part of the plan.

This reverses what `services/identity/README.md` describes today ("Seeds wallet
and starter credit", "Market Special orders (0x1 issuer)"). Those sections
change when this lands, not before.

## How the two sides meet

- A product that needs a person's game data asks 0x1, identified by the `sub`
  it received from identity. 0x1 keeps `sub` in its own table, the same way it
  keeps `aiaiaiai_accounts` today.
- The link from `sub` to a Bond is created on first sign-in (as now) and never
  by matching `pub_dress`, which is public and mutable.

## Open questions (need an answer before code)

1. **Cross-server path.** nilx.one (edge-prod-1) now calls identity on
   edge-prod-2 at every sign-in. Contracts forbid routes to a workload on
   another server. Options: a private tunnel between the two servers (identity
   is not exposed), or an explicit contract rule for internal links. The tunnel
   is the recommendation.
2. **Data move.** The identity database on edge-prod-1 holds every person. Its
   split between identity and 0x1 is a migration with a backup, a rehearsal on a
   copy, a window and a rollback. It runs only with explicit authorization.
3. **Who owns the 0x1 side of `aiaiaiai_accounts`.** Proposed: 0x1, keyed by
   `(issuer, sub)`, as built in nilx-one/core#91.
4. **Admin roles.** Which roles gate game features and move to 0x1.

## Order of work

1. This document, reviewed.
2. Core: a `game` boundary in the crate layout, so the identity crate stops
   depending on game types. No behavior change.
3. 0x1 gets its own service and database; first its read path to identity by
   `sub`.
4. Seeds to 0x1, with Market calling 0x1. Its own change with its own tests.
5. Data migration, only after 1–4 are verified on a copy and authorized.
6. Remove the game code from identity.

Each step is a separate PR. Deploy is separate and needs explicit
authorization.

## Not decided here

The tunnel's technology, the 0x1 service's name and layout, the exact fields of
the identity projection, and the timing of step 5.
