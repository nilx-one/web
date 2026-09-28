# State placement

Where each piece of persisted state lives today. `placement` is that
residence, and it agrees with `medium`: a record in local storage is never
`server`, because the service does not hold it. The table is
`STATE_PLACEMENT` in `packages/application/src/state-placement.ts`. An
architecture test reads it against real `setItem` call sites, so a key the
client writes and nobody placed fails the build.

## Residence and mobility

| Placement          | The bytes live                                                                                                     | Mobility                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **server**         | in the identity service: the `pub_dress`, everything a sign-in needs, the named study in `identities.avatar_model` | resident. This is service authority, not synchronization.                                                       |
| **device**         | on this device: the on-device model and its download, the journal key, work in flight, an outfit                   | resident. It does not travel, because it would mean nothing on another device, or because no contract holds it. |
| **synchronizable** | on this device, today                                                                                              | transport eligibility. Not a third store.                                                                       |

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

## Server

The identity service keeps three things about a Bond's identity:

- **`pub_dress`** — the Bond's address, its owned Avaia's address, and the
  public label folded from it ([Public Bond address](pub-dress-url.md)).
- **Everything needed for authorization** — provider bindings
  (`identity_providers`), Argon2id verifiers and recovery keys
  (`native_credentials`), sessions and the remembered-Bond hint
  (`native_sessions`, the `__Host-` cookies).
- **The named study** — `identities.avatar_model`, one of the studies this
  runtime publishes (`kai-study`, `dasha-v2-study`, and the others the column
  allows). That is the identifier the service stores today.

`Bond.location` (`bond_locations`, live or manual) is also service state, but
it is a declared, shared fact under the location contract in
[Bond Dock](bond-dock.md) — not the device's observed position, and not the
position placed below.

## Device — resident

These are not carried:

- **what a body wears** (`nilx-one.avatar.wardrobe`), and which body an Avaia
  chose when the contract has no field for it. The editor says so
  ([Profile editing](profile-editing.md)). It is device-resident because that
  is where the bytes are. A future identity contract may give a customization
  its own identifier; this repository does not define that form, and it does
  not classify a local outfit as server state in the meantime;
- **the on-device model** — the choice (`nilx-one.localModel.choice`) and the
  downloaded weights. Another device has its own memory, GPU and eligibility
  ([Local models](local-models.md));
- **the presence journal key** — `nilx-presence/keys`, non-extractable, never
  transmitted, never derived from identity
  ([Presence journal lifecycle](presence-journal-lifecycle.md));
- **work this device has in flight** — reveals the Avaia is working on
  (`nilx-one.fog.jobs.v1.<owner>`). The revealed cell is the part that may
  travel; the timer that opens it is this device's.

## What may travel

Local-first. Eligible, not transported.

**Interface preferences** — language (`nilx-one.interface.locale`), appearance
(`nilx-one.interface.appearance`), and whether the map is flat or volumetric
(`nilx-one.interface.dimension`).

**What a Bond earned and remembered by playing**

- **progress** — what this Bond has earned, including the one-time setup
  reward that reaches level 1 (`nilx-one.progression.v1.<owner>`;
  [Progression](progression.md));
- **opened cells** — fog reveals (`nilx-one.fog.reveals.v1.<owner>`) and the
  landmark notebook (`nilx-one.avaia.landmarks.v1.<owner>`;
  [Avaia walks the world](avaia-walk.md));
- **position** — where the Bond and its Avaia were last seen
  (`nilx-one.world-memory.v1.<owner>`), and the artificial presentation
  positions an owner declared for counterparts
  (`nilx-one.bond-location-overrides.v1:<owner>`). A remembered position is
  not a `Bond.location`.

**Sealed history**, under its own lifecycle and not under this one:

- **`bch`** — this device's copies of the BondChain histories it is a party
  to ([the `.bnd` file](bnd-file-lifecycle.md));
- **history** — the sealed visit journal (`nilx-presence/visits`,
  `bond.journal`). The key stays on the device. The ciphertext moves only
  under the portability slice that lifecycle document reserves.

## What eligibility does not mean

Today a new device starts a Bond's fog, notebook, progress and position from
nothing, exactly as [Progression](progression.md) and
[Avaia walks the world](avaia-walk.md) describe. When a transport-eligible
record does travel:

- it goes device to device, end to end. It is never written to a service
  table and never read by `identity-http` or `services/identity`. The
  architecture test checks that;
- it does not become truth on arrival. A transported level creates no
  Interaction; a transported reveal is not presence evidence; a transported
  position is not a `Bond.location`. Nothing here is Bond, BondChain,
  Relationship, Core, or identity state.

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
