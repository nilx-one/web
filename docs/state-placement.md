# State placement

Where each piece of persisted state lives today. `placement` is that
residence, and it agrees with `medium`: a record in local storage is never
`server`, because the service does not hold it. The table is
`STATE_PLACEMENT` in `packages/application/src/state-placement.ts`. An
architecture test reads it against real `setItem` call sites, so a key the
client writes and nobody placed fails the build.

## Residence and mobility

| Placement          | The bytes live                                                                                                                  | Mobility                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **server**         | in the identity service: identity/sign-in records, reported experience, committed-award chain bookkeeping, and rare-find claims | resident. Residence does not make every field protocol truth: experience remains `authority: client`; a rare claim is authoritative only for first-claim ownership of that find. |
| **device**         | on this device: the on-device model and its download, the journal key, work in flight, an outfit, the `__Host-` cookies         | resident. It does not travel, because it would mean nothing on another device, or because no contract holds it.                                                                  |
| **synchronizable** | on this device, today                                                                                                           | transport eligibility. Not a third store.                                                                                                                                        |

Synchronizable is not shared state, not protocol state, and not synced
state. Nothing in that column leaves the device. `mobility` splits the
eligibility so it cannot be read as one layer:

- **`transport`** — an interface preference or a play record a Bond may one
  day find on its other device: language, appearance, 2D/3D depth; Bond and
  Avaia experience and levels; opened cells and the landmark notebook; the
  last position and declared counterpart overrides. Fog reveal jobs stay
  on the device that started them.
- **`sealed-transport`** — a different class. BondChain copies (`bch`) and the
  sealed visit history already have their own lifecycle, the
  [`.bnd` file](bnd-file-lifecycle.md) and the
  [presence journal](presence-journal-lifecycle.md). They are not the same
  kind of record as a chosen language, and this table does not give them a
  second one. Eligibility means they may move only under that lifecycle,
  still sealed, device to device, the service at most a blind relay.
  The finds journal, its leads and the key behind committed experience
  (R3 in [Avaia walks on its own](avaia-outings.md)) are stricter still: they
  move only directly, device to device without the service, not even as a
  blind relay. Until a host has a direct transport (a native app over AirDrop,
  Bluetooth LE or the local network), they stay where they are.

## Server

The identity service keeps identity state plus the bounded service-side state
needed by committed experience and rare claims:

- **`pub_dress`** — the Bond's address, its owned Avaia's address, and the
  public label folded from it ([Public Bond address](pub-dress-url.md)).
- **The server-side records a sign-in needs** — provider bindings
  (`identity_providers`), Argon2id verifiers and recovery keys
  (`native_credentials`), and session rows (`native_sessions`). The
  `__Host-` cookies that carry a session or a remembered Bond are not in
  this list: the browser holds those bytes.
- **The named study** — `identities.avatar_model`, one of the studies this
  runtime publishes (`kai-study`, `dasha-v2-study`, and the others the column
  allows). That is the identifier the service stores today.

`Bond.location` (`bond_locations`, live or manual) is also service state, but
it is a declared, shared fact under the location contract in
[Bond Dock](bond-dock.md) — not the device's observed position, and not the
position placed below.

`bond_pub_info` and `bond_experience_events` hold the activity totals a Bond
reports for itself and its Avaia plus the opaque legacy ids / R3 commitments
already paid. The service answers the standing, including on the public Bond,
with `authority: "client"`: server pricing, caps and idempotency bound the
report, but do not attest that physical play happened.

R3 adds two more kinds of service residence:

- `experience_chains` and `experience_kind_counts` hold per-device heads and
  weekly bounded counts. They make committed awards ordered/idempotent; they
  are progression bookkeeping, not BondChain;
- `find_claims` holds only a rare tier 4–6 artifact hash, epoch, tier and the
  winning Bond. It is authoritative for “who got this find first”, and for
  nothing about consent, reciprocity, Interaction or Relationship.

## Device — resident

These are not carried:

- **the `__Host-` cookies** — `__Host-0x1_session` (the session credential;
  the row it names stays in `native_sessions`), `__Host-0x1_bond` (the
  signed remembered-Bond hint, which is not a server table and not itself
  authentication), and the short-lived `__Host-0x1_oauth` and
  `__Host-0x1_provider` transactions. The service mints them. The browser
  stores them. They are HttpOnly, so page script does not read them;
- **what a body wears** (`nilx-one.avatar.wardrobe`), and which body an Avaia
  chose when the contract has no field for it. The editor says so
  ([Profile editing](profile-editing.md)). It is device-resident because that
  is where the bytes are. A future identity contract may give a customization
  its own identifier; this repository does not define that form, and it does
  not classify a local outfit as server state in the meantime;
- **the on-device model** — the choice (`nilx-one.localModel.choice`) and the
  downloaded weights. Another device has its own memory, GPU and eligibility
  ([Local models](local-models.md));
- **how much this device sounds** (`nilx-one.interface.sound`) — off, effects,
  or effects and the world in view. Unlike language or appearance it does not
  follow a Bond: another device has its own speakers and stands somewhere else
  ([Sound](sound.md)), and which characters speak aloud: nobody, others in
  cutscenes, or the Avaia as well (`nilx-one.interface.voice`,
  [Character voices](avaia-voice.md));
- **what this device picks up** (`nilx-one.finds.pickup`) — which rarities of
  chance finds are picked up on the way, in Core's wire form
  (`common,uncommon,rare,legendary`). A find left behind is still seen. It
  is a choice about what this device carries home, so it stays here, as the
  sound does ([Find items in core](https://github.com/nilx-one/core/blob/master/docs/find-items.md));
- **which wipe this device has applied** (`nilx-one.wipe-epoch`) — the marker
  that makes a full local wipe run once per browser. It says nothing about who
  the person is;
- **the presence journal key** — `nilx-presence/keys`, non-extractable, never
  transmitted, never derived from identity
  ([Presence journal lifecycle](presence-journal-lifecycle.md));
- **work this device has in flight** — reveals the Avaia is working on
  (`nilx-one.fog.jobs.v1.<owner>`). The revealed cell is the part that may
  travel; the timer that opens it is this device's. Beside it,
  `nilx-one.fog.authorized.v1.<owner>` holds the last instant Core allowed a
  reveal to run, which is all a reopened page can go on: time since is never
  worked.

## What may travel

Local-first. Eligible, not transported.

**Interface preferences** — language (`nilx-one.interface.locale`), appearance
(`nilx-one.interface.appearance`), and whether the map is flat or volumetric
(`nilx-one.interface.dimension`).

**What a Bond earned and remembered by playing**

- **legacy progress** — pre-R3 carry/pending activity plus the device-only
  model-download achievement (`nilx-one.progression.v3.<owner>`;
  [Progression](progression.md)). Older keys (`nilx-one.progression.v2` and
  `nilx-one.progression.v1`) are read once as carry and never written. New
  world awards use the sealed committed journal below; the shared totals are
  `bond_pub_info`, above, not either local copy;
- **opened cells** — fog reveals (`nilx-one.fog.reveals.v1.<owner>`) and the
  landmark notebook (`nilx-one.avaia.landmarks.v1.<owner>`;
  [Avaia walks the world](avaia-walk.md)), and the places the Avaia grew
  fond of (`nilx-one.avaia.affinity.v1.<owner>`; same page, "Favourite
  places");
- **position** — where the Bond and its Avaia were last seen, and the
  Avaia's drive as Core last answered it, so a reload does not send it out
  again early (`nilx-one.world-memory.v1.<owner>`), and the artificial presentation
  positions an owner declared for counterparts
  (`nilx-one.bond-location-overrides.v1:<owner>`). A remembered position is
  not a `Bond.location`;
- **needs** — the Avaia's hunger, energy, home and where it stands, as Core's
  Avaia life keeps them (`nilx-one.avaia.life.v1.<owner>.<avaia>`;
  [Avaia walks the world](avaia-walk.md)). Simulated product needs, never
  presence evidence;
- **scenes played** — whether xSasha's introduction was played through or
  skipped, and whether her word on new ground is owed or said (`nilx-one.guide.v1.<owner>`; [xSasha](guide.md)).

**Sealed history**, under its own lifecycle and not under this one:

- **`bch`** — this device's copies of the BondChain histories it is a party
  to ([the `.bnd` file](bnd-file-lifecycle.md));
- **presence history** — the sealed visit journal (`nilx-presence/visits`,
  `bond.journal`). The key stays on the device. The ciphertext moves only
  under the portability slice that lifecycle document reserves;
- **committed award/find history** — `avaia-finds/events`, its direct-transfer
  HMAC history key and device-chain metadata. Award records, finds and leads
  stay here; the service gets only commitments/pricing fields and, for a rare
  claim, the artifact id required by R3. This history moves only directly
  between the Bond's devices, never through the identity service.
  The same journal keeps what the Bond and its Avaia carry and the Seeds
  ([Inventory](inventory.md)), sealed the same way.

## What eligibility does not mean

Today a new device starts a Bond's fog, notebook and position from nothing,
exactly as [Avaia walks the world](avaia-walk.md) describes. Activity totals
are read back from `bond_pub_info` — the owner's report, not a played-out
log — and anything still unsent, plus the device achievement, starts from
nothing ([Progression](progression.md)). When a transport-eligible record
does travel:

- it goes device to device, end to end. The local copy is never written to
  a service table and never read by `identity-http` or `services/identity`.
  The architecture test checks that. `bond_pub_info` is a different record:
  the service holds the owner's asserted totals, and that is not this
  device's progression key traveling through the service;
- it does not become truth on arrival. A transported level creates no
  Interaction; a transported reveal is not presence evidence; a transported
  position is not a `Bond.location`. A published total is the owner's report.
  Nothing here is Bond, BondChain, Relationship, Core, or identity state.

Losing local storage before a record travelled is local data loss, not
protocol corruption.

## Not decided here

A customized body will need an identifier of its own. That identifier is an
identity-contract question: which form, which width, who computes it, and
which column stores it. This repository does not answer it, and application
code does not export a parser for a form the service has not defined.
`identities.avatar_model` remains the named-study column its CHECK constraint
describes.

## Adding a record

A new storage key belongs in `STATE_PLACEMENT` before it is written, with its
residence, its mobility, its medium, and what it holds. Residence and medium
have to agree: `server` is an identity-service table, and a local medium is
not `server`. The architecture test
(`tests/architecture/state-placement.test.ts`) fails when a `setItem` writes
a key that is not placed, when a placed local-storage key is no longer
written, when a `setItem` key cannot be followed, and when any device-resident
or transport-eligible key is read by the network adapters or the service. A
comment that mentions a key is not a write.

---

© 2026 aiaiaiai · aiaiaiai.org
