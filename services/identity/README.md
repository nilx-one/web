# Identity Service

The identity service owns native Web credentials, browser sessions, remembered-Bond
hints and legacy recovery material. New registrations require only a username and password. A user can register and sign
in with only an exact, case-sensitive `pub_dress` and password. Provider
adapters remain isolated for later optional bindings.

The service is an adapter, not protocol authority. Canonical `pub_dress` validation comes from a pinned `nilx-one/core` contract; provider identity, messenger transport, persistence, and provider verification stay outside `nilx-one/0x1`.

Provider accounts are namespaced as `(provider, provider_subject)`. Telegram and Discord IDs therefore never collide merely because their numeric values happen to match. The storage model also permits multiple provider bindings to point at one identity when an explicit account-linking flow is introduced; this PR does not invent such a link without proof from both sides.

## Ecosystem role

This service is the identity authority of the aiaiaiai ecosystem: 0x1, Prism
and every client rely on it for who a person is, and no other service writes
people, provider bindings, credentials or sessions. The full design, including
the stable `subject_id`, signed tokens, SQLite with continuous off-site
replication and the migration phases, is
[ECO-0001: Shared identity and connected providers](https://github.com/aiaiaiai-org/.github/blob/main/ecosystem/identity/DESIGN.md).
It and its machine-readable version are maintained only there.

## Native Web API

- `POST /api/v1/identity/resolve` resolves an exact public `pub_dress` candidate.
- `GET /api/v1/auth/native/context` returns authenticated, remembered, or anonymous context.
- `POST /api/v1/auth/native/registration` atomically claims an address, activates its password and returns an authenticated session (contract 14); no recovery material is generated.
- `POST /api/v1/auth/native/recovery/acknowledgement` finishes legacy registrations that already received a challenge.
- `POST /api/v1/auth/native/session` verifies a password and creates a session.
- `POST /api/v1/auth/native/recovery` rotates the password and recovery key after valid recovery proof.
- `POST /api/v1/auth/native/logout` revokes the active session.
- `POST /api/v1/auth/native/remembered/forget` removes only the remembered hint.

Registration requires an `Idempotency-Key`. State-changing endpoints require
the same-origin `X-0x1-CSRF: 1` header. Session and remembered-Bond cookies
are Secure, HttpOnly, SameSite=Lax; the signed remembered hint is never accepted
as authentication.

Passwords contain 8–128 Unicode scalar values after NFC normalization. Leading
or trailing whitespace and control/line-separator characters are rejected;
ordinary spaces inside the password remain valid. The service blocks known
compromised values and stores versioned Argon2id verifiers with 19 MiB memory,
two iterations, and one lane. Authentication uses generic failures, a dummy
hash path, and source/address/global rate limits.

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

## Bond roles and location modes

All hexadecimal prefixes `0`–`f` are available for new human registrations.
The shared form defaults to `0x0`. Roles are explicitly stored; choosing `0x0`
does not grant administrator rights. Existing explicit grants remain intact.
Human discriminators remain immutable after registration.

Human Bonds default to `user`; known stored roles are `user`, `admin`,
and `business`. Non-reserved roles remain assignable out of band, with no
public role-assignment API:

```sql
INSERT INTO bond_roles (pub_dress, role) VALUES ('0x1example', 'business')
ON CONFLICT(pub_dress) DO UPDATE SET role = excluded.role;
```

### Business stations

A `business` Bond keeps one stationed Avaia per shop. A station never walks:
it stands at its shop's point. It is not the Bond's own Avaia: that one stays
the single Avaia the owner creates, and owner-keyed reads never see a
station. A station leaves with its business.

A business names each station by a caption, kept as written. The station's
address is formed from it once by Core (`StationPubDress::from_caption`,
`docs/business-station.md` in nilx-one/core): the business's own full address,
`-`, then the caption's place transliterated, with no Avaia `ai` ending
(`"xda-market Золоті Ворота"` stations `0xda-market-zoloti-vorota`). This
service only stores what Core forms and allocates it in the global namespace.

A business is its own identity with many points on the map, one per shop,
and no single location of its own: it declares no `bond_locations` row. Its
public card (`GET /api/v1/identity/public`) lists every station it keeps
under `stations`; a person keeps none, and a person's location is never
public.

All of it is out of band, by the service binary against its own database:

```sh
identity-bot business register 0xda-market   # a business Bond, no sign-in yet
identity-bot business grant 0x1shop          # or make an existing Bond a business
identity-bot business station 0xda-market "xda-market Золоті Ворота" 30.5131 50.4489
identity-bot business station 0xda-market "xda-market Батьківщина-Мати" 30.5632 50.4265
```

`register` creates a human Bond with the `business` role and no credential or
provider; its owner signs in later through the ordinary paths. Stationing an
address the business already keeps restates its point (and caption).
`GET /api/v1/identity/stations` answers every station to anyone:
`{ "stations": [{ "pub_dress": "…", "owner_pub_dress": "…", "caption": "…", "coordinate": … }] }`.

`Bond.location` has two modes. Every role may use `live`: it is entered only by an explicit current-location share in the bot, where Telegram asks for the device location. The Mini App's background `POST /api/v1/location-control` only refreshes a location that is already `live` and answers `409` for a `manual` one. `manual` is a declared point and needs `admin`, whose rights are exactly those of `user` plus setting a manual location.

A Bond has exactly one location, whichever host it is set from. `GET /api/v1/location-control` answers it to every host: the Telegram Mini App with `initData`, the website with its `__Host-0x1_session` cookie, and the Discord Activity with `authorization: discord <access token>`. While the location is `manual`, each host stands the Bond at the declared point and never asks its device, so no host draws the same Bond a second time at its own position.

## pub_info

`pub_info` is the public, synced slice of a Bond's `.bnd`. Experience is what it holds: `bond_xp` and `avaia_xp`, one shared total each. Those totals are an owner assertion. The service stores and redistributes them. It does not price an action or attest that the play happened. Every experience object the service writes includes `"authority": "client"`. The client cannot choose that field; a body that tries to is refused.

- `GET /api/v1/identity/pub-info` returns `{ "experience": { "authority": "client", "bond_xp": 0, "avaia_xp": 0 } }` for the authenticated Bond. No stored row is zero.
- `POST /api/v1/identity/pub-info` accepts `{ "carry": { "bond_xp": 0, "avaia_xp": 0 }, "events": [{ "id": "xp:…", "earner": "bond", "amount": 30 }] }`. It requires the CSRF header and an active authenticated Bond. Carry only rises, to the greatest pre-sync total a device reports. An event id is an opaque `xp:` nonce; a repeat does not pay again, and an id that names a subject is refused. Carry is capped, and so is one event amount. The caps are abuse bounds on an untrusted number, not proof the award was earned. Idempotency and the rate limit are not that proof either.
- `POST /api/v1/identity/pub-info/awards` accepts `{ "awards": [{ "id": "xp:<43 base64url>", "parent": "xp:…" | null, "chain": "ch:…", "kind": "zone_walked", "earner": "bond", "tier": 5, "artifact_id": "art:…", "orb": 3 }] }` (R3 in `docs/avaia-outings.md`). The id is the award's commitment, an HMAC of a record that stays on the device. There is no amount: the service prices each award by its kind, earner and tier, and refuses a kind its earner cannot earn. An award is paid only on top of its chain's head, under the week's cap for its kind. Only a pick-up of tier 4 to 6 names a find, and it must: the service rolls the `artifact_id` itself, and the first Bond to pick it up claims it. Each award answers `accepted`, `duplicate`, `behind` (with the chain's `head`), `capped`, `already_yours`, `taken` or `too_many_chains`. Totals stay `authority: "client"`.
- `GET /api/v1/identity/finds/claims?buckets=ab,cd` answers `{ "epoch": 2961, "claims": [{ "sha": "…", "yours": true }] }`: this week's claims in up to sixteen sha buckets (the first byte, as two hex digits), each marked as this Bond's or not. It never names another Bond. Claims are deleted once their week is two weeks old.
- `POST /api/v1/identity/finds/spills` accepts `{ "artifact_id": "art:…" }` from an active Bond (CSRF header required) when a fog cell it opened holds that find: the service rolls the find itself, refuses one not of this week, and counts its orbs itself (5 to 30, Core's `orb_count`, `docs/orb-spills.md` in nilx-one/core). A find spills once a week; the answer is the spill, `{ "sha": "…", "count": 12, "expires_at_ms": …, "taken": [0, 3] }`, which lies for thirty minutes. The service stores the find's sha, the count and the expiry: never who spilled it or where.
- `GET /api/v1/identity/finds/spills?buckets=ab,cd` answers `{ "spills": [ … ] }`: the spills still lying in up to sixteen sha buckets, with the orbs already picked up. It names nobody.
- `GET /api/v1/identity/xping/engine` answers the Bond's server-owned xPing engine (`docs/xping-engine.md` in nilx-one/core) and its Core-calculated repair price. The returned `authority: "identity"` identifies the source of engine state; the old local inventory is not a wallet authority.
- `POST /api/v1/identity/xping/engine` (active Bond, CSRF required) takes `{ "op": "force", "forced_ms": n }` or `{ "op": "repaired", "expected": <state> }`. Force is priced by Core's energy contract; **repair is priced by Core on Identity's clock and debits the Bond's authoritative Identity seeds balance in the same SQLite transaction as the repair**. The `expected` engine state is checked under that lock, as is the active client session / absence of competing activation. Insufficient wallet balance returns `409 not_enough_seeds`; stale engine returns `409 stale_engine`; a superseded client cannot spend. A legacy `paid_seeds` request field is accepted but completely ignored, not a proof of payment. No local inventory write can pay for xPing. The completed response comes from Identity; a second identical repair cannot debit twice.
- An `orb_picked_up` award names its find (`artifact_id`) and which orb (`orb`), from either earner, and pays 10. Like a rare pick-up it is a claim: the first Bond to reach the orb keeps it, a later one gets `taken`, as does an orb whose spill is gone or never fell.
- `POST /api/v1/identity/orbs/cell-spill` accepts `{ "cell": "<H3 index>" }` (resolution 9, lowercase hex) from a signed-in Bond (CSRF header required) when a fog cell opens for it ([Experience Orbs](../../docs/exp-orbs.md), contract 16). It answers the cell's spill in Core's `orb_world` `cells` shape, less the device's own `appeared_at`: `{ "key": "<64 hex>", "center": { "longitude_e7": "…", "latitude_e7": "…" }, "registry": 1, "rated_landmarks": [] }`. The key is the service's keyed digest of the Bond and the cell, so the same cell always answers the same spill. Nothing about the request is stored or logged. No landmark source is wired yet: a spill holds the cell's own five Common orbs.
- A `cell_orb_picked_up` award names Core's rated orb id (`orb_id`) and its `cell`, from either earner, and nothing else. The service remakes the cell's key for this Bond, refuses an id of another key, an unpublished registry or a landmark it cannot place in the cell, and prices the orb by Core's `rated_orb_award` (10 for a Common orb). It has no weekly cap; the same orb pays once, to the Bond or its Avaia, and a second pick-up is `already_yours`. Only a SHA-256 of the orb id is kept, never the cell.
- `GET /api/v1/identity/public` nests the same totals under `pub_info.experience`, with the same `authority: "client"`, and nests the owned Avaia's `configuration_state`, so a public reader can derive the same levels the owner sees from the shared report. The per-device model-download achievement is not part of this projection. The public card says the standing is reported by this Bond.

## Spoken lines

A permitted Bond (`bond_speakers`) can say a short text aloud; Bonds within
earshot hear it on the web and in a Telegram private chat. See
[Spoken lines](../../docs/spoken-lines.md) for the contract.

- `POST /api/v1/speech` ingests one line. It needs a `Bearer` service token (`SPEECH_INGEST_TOKEN`) and refuses any speaker without a `bond_speakers` row.
- `GET /api/v1/speech/nearby` returns what the authenticated Bond can hear now.
  It never returns a coordinate.

`bond_speakers` is set out of band, like `bond_roles`. `0x0sky` and `0xfrSb` are
carried over once when the table is created:

```sql
INSERT OR IGNORE INTO bond_speakers (pub_dress)
SELECT pub_dress FROM identities WHERE identity_kind = 'human' AND pub_dress = '0xfrSb';
```

Optional runtime settings: `SPEECH_INGEST_TOKEN` (at least 32 bytes; without it
the routes are not mounted) and `SPEECH_EARSHOT_METERS` (default `500`, at most
`5000`).

## Partner provider lookup

A partner, such as a business in the 0x1 world, can ask which Bond a provider
account belongs to. The decision is Core's (`provider_lookup_view`, see
`nilx-one/core` `docs/provider-bindings.md`). This service only reads the
binding.

- `POST /api/v1/partner/provider-lookup` with `Authorization: Bearer <PARTNER_LOOKUP_TOKEN>`
  and body `{"provider": "telegram", "subject": "123456789"}`.
- `200 {"state": "linked", "pub_dress": "…"}`: only the public handle, never an
  internal identifier.
- `200 {"state": "sign_in_required", "provider": "telegram"}`: the account is not
  bound, so the partner asks the person to sign in with 0x1 and connect it.
- `401 unauthorized`, `422` (`unknown_provider`, `malformed_request`, or a
  subject error), `503 unavailable` when the store cannot answer. A `503` is
  never a `sign_in_required`.

Optional runtime setting: `PARTNER_LOOKUP_TOKEN` (at least 32 bytes; without it
the route is not mounted).

## Secret boundary

`NATIVE_AUTH_SECRET`, `PASSWORD_PEPPER`, `TELOXIDE_TOKEN`,
`DISCORD_CLIENT_SECRET`, `SPEECH_INGEST_TOKEN`, and `PARTNER_LOOKUP_TOKEN` are server-only runtime secrets. The native authentication
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
- `HTTP_BIND` — default `0.0.0.0:1927`;
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` — default `300`. This is how long a
  single `initData` proof is accepted, not how long a Mini App stays signed
  in: a successful check mints a native session (`__Host-0x1_session`), and
  later requests present that instead. See `authenticated_bond` in `api.rs`.

Then run:

```bash
cargo run --manifest-path services/identity/Cargo.toml
```

Supplying only one Discord credential is a configuration error. Provider
credentials do not activate a public provider host by themselves.

## Runtime package

[`Dockerfile`](Dockerfile) builds the combined Telegram bot and identity API. [`deploy/compose.yaml`](deploy/compose.yaml) persists SQLite state in a named volume and exposes only the private `nilxone-identity:1927` edge alias. The canonical Web runtime proxies the bounded `/api/v1/identity*` and `/api/v1/auth/*` surfaces to that alias.

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

## Wiping registered users

`deploy/wipe-users.sh` deletes every identity from the SQLite file; all identity-owned tables
cascade. Stop the container first. Dry run unless `WIPE_CONFIRM=wipe-all-identities`; a backup copy is made beside the database. Irreversible.
