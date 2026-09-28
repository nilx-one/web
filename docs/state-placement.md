# State placement

Where each piece of persisted state is allowed to live. Three placements;
every stored record belongs to exactly one, and the table that says which is
`STATE_PLACEMENT` in `packages/application/src/state-placement.ts`. An
architecture test reads that table against the source tree, so a storage key
nobody placed is a failing build rather than an unclassified record.

## The three placements

| Placement          | Holds                                                                                                                | Leaves the device                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **server**         | the `pub_dress`; everything a sign-in needs; the 3D-model identifier of a body                                       | yes — it is the identity service's                                                               |
| **device**         | what this device can run and how it is set up: the on-device model and its download, the journal key, work in flight | never                                                                                            |
| **synchronizable** | interface preferences a person expects to follow them, and everything a Bond earned or remembered by playing         | eligible, under the `.bnd` discipline: device to device, end to end, the service at most a relay |

The middle column is exhaustive on purpose. A record that is not one of these
things is not stored.

## Server

The identity service keeps three things and nothing else about a Bond:

- **`pub_dress`** — the Bond's address, its owned Avaia's address, and the
  public label folded from it ([Public Bond address](pub-dress-url.md)).
- **Everything needed for authorization** — provider bindings
  (`identity_providers`), Argon2id verifiers and recovery keys
  (`native_credentials`), sessions and the remembered-Bond hint
  (`native_sessions`, the `__Host-` cookies).
- **The 3D-model identifier** — `identities.avatar_model`, the body a Bond or
  Avaia is drawn in. Today it is a named study (`kai-study`, `dasha-v2-study`).
  Once a body can be customized, the customization — the body and everything
  it wears — hashes to a **digest**: a lowercase hexadecimal string of 16, 32
  or 64 characters (64, 128 or 256 bits), and that digest is what the service
  keeps. It is opaque to the service and to every other Bond: it names an
  appearance without describing it, and two devices that resolve the same
  digest draw the same body. `classifyAvatarModelIdentifier` in
  `packages/application/src/avatar-model-identifier.ts` reads either form;
  which width the hashing side uses is its own choice, and the service accepts
  all three so the width can grow without a migration. The CHECK constraint on
  `identities.avatar_model` is still the named list; widening it to the digest
  form is the migration the customization feature ships with.

`Bond.location` (`bond_locations`, live or manual) is also service state, but
it is a declared, shared fact under the location contract in
[Bond Dock](bond-dock.md) — not the device's observed position, and not the
"position" placed below.

What a body wears (`nilx-one.avatar.wardrobe`) is placed on the server because
it is the customization the digest will name; it stays in local storage only
until the identity contract carries that field, and the editor says so
([Profile editing](profile-editing.md)).

## Device — never leaves

These mean nothing on another device, so they are not carried:

- **the on-device model** — the choice (`nilx-one.localModel.choice`) and the
  downloaded weights. Another device has its own memory, GPU and eligibility
  ([Local models](local-models.md));
- **the presence journal key** — `nilx-presence/keys`, non-extractable, never
  transmitted, never derived from identity
  ([Presence journal lifecycle](presence-journal-lifecycle.md));
- **work this device has in flight** — reveals the Avaia is working on
  (`nilx-one.fog.jobs.v1.<owner>`). The revealed cell is what travels; the
  timer that opens it is this device's;
- **per-device fields of otherwise synchronizable records** — in progression,
  `deviceAchievements` ("Avaia model downloaded" pays once per device by
  definition) and `settingsHintSeen`. They are left behind when the record
  travels.

## Synchronizable

Local-first, and eligible to travel between a Bond's own devices.

**a) Interface preferences** — language (`nilx-one.interface.locale`),
appearance (`nilx-one.interface.appearance`), and whether the map is flat or
volumetric (`nilx-one.interface.dimension`). A person who chose Ukrainian and
dark on their phone expects to find them on their laptop.

**b) What a Bond earned and remembered by playing**

- **progress** — Bond and Avaia experience, and with it their levels
  (`nilx-one.progression.v2.<owner>`; [Progression](progression.md));
- **achievements** — the account achievement ("Avaia configured") is already
  read from the service on every device; per-device ones stay per device;
- **opened cells** — fog reveals (`nilx-one.fog.reveals.v1.<owner>`) and the
  landmark notebook (`nilx-one.avaia.landmarks.v1.<owner>`;
  [Avaia walks the world](avaia-walk.md));
- **position** — where the Bond and its Avaia were last seen
  (`nilx-one.world-memory.v1.<owner>`), and the artificial presentation
  positions an owner declared for counterparts
  (`nilx-one.bond-location-overrides.v1:<owner>`);
- **`bch` & history** — this device's copies of the BondChain histories it is
  a party to, and the sealed visit history (`nilx-presence/visits`,
  `bond.journal`). Both follow [the `.bnd` file](bnd-file-lifecycle.md).

## What "synchronizable" means

It is a statement of eligibility, not of mechanism, and not of what happens
today. Today nothing in this placement leaves the device: a new device starts
a Bond's fog, notebook, progress and position from nothing, exactly as
[Progression](progression.md) and [Avaia walks the world](avaia-walk.md)
describe. When it does travel, it travels under the `.bnd` discipline:

- device to device, end to end. The identity service never holds it in the
  clear and is at most a blind relay; a record in this placement is never
  written to a service table, never read by `identity-http` or
  `services/identity`, and the architecture test checks that;
- sealed history stays sealed. The presence journal travels only as the
  ciphertext its key seals, under the explicit portability contract its
  lifecycle document reserves — never re-encrypted for a server, never
  inferred from the shade cache;
- it never becomes truth. Nothing here is Bond, BondChain, Relationship, Core,
  or identity state on arrival. A synced level creates no Interaction; a
  synced reveal is not presence evidence; a synced position is not a
  `Bond.location`.

Losing local storage before a record travelled is local data loss, not
protocol corruption — the same as before this contract, now stated once.

## Adding a record

A new storage key belongs in `STATE_PLACEMENT` before it is written, with its
placement, its medium today, and what it holds. The architecture test
(`tests/architecture/state-placement.test.ts`) fails on a key that is written
and not placed, on a key that is placed and no longer written, and on any
device-only or synchronizable key read by the network adapters or the service.

---

© 2026 aiaiaiai · aiaiaiai.org
