# Profile editing

A Bond profile presents facts the identity service owns. Most of them are
consequences — the discriminator chosen at registration, the provider bindings,
the projections that do not exist yet. Three of them are choices their owner may
revisit: the Bond's own slug, the slug of the Avaia it owns, and the avatar study
that represents the Bond.

There is one profile surface. Reading the profile and changing it are the same
screen, because a screen that only shows what a second screen would let you
change is a detour, not a step. It carries those three choices. Rows that could
only ever read "Not set" are gone rather than presented as fields no one can
fill, and the providers row is what it says: the providers this Bond is
connected through, each its own mark and nothing more. What follows a rename —
the discriminator and the provider connections — is a consequence, never an
input.

## Providers

A provider account is an external identity a Bond points at. The pointing is
what this client owns: which providers a Bond carries, that it carries at most
one account of each, and where an attached account opens. None of that is
decided by a screen. `packages/application/src/bond-providers.ts` answers it,
and a second Telegram or Discord account offered to a Bond that already carries
one is refused there rather than merged or counted by whatever happens to be
rendering the list.

The Bond edit surface stays compact about this: it shows a mark per connected
provider and an `add +`, and no account text at all — a provider handle is not a
profile field. Management is its own screen, which `add +` opens. That screen
lists Telegram and Discord whether or not they are attached; a connected
provider offers **Open** and a disconnect control, an unconnected one offers
**Connect**, which is the provider authorization route the rest of the product
already uses.

Disconnecting is a detachment, and the delete glyph carrying it says so in its
accessible name: it removes this Bond's pointer at the account. It does not
delete the account on the provider, and nothing in this repository can.

A connected mark opens the account where the domain resolved it, best target
first: the provider's own URL scheme where the host can follow one — a host that
is itself that provider — then the account's canonical web address, and finally
the provider's own entry point. That last one is not a placeholder. This client
is told which provider a session was proved through and not the account behind
it, so an attachment whose external address it does not know still opens
somewhere rather than nowhere.

## Authority

`POST /api/v1/identity/pub_dress` accepts only `{ "slug": "..." }`. It requires
the CSRF header and an authenticated Bond: a native session cookie in the
browser, or a verified Telegram or Discord proof on a provider host. The service
resolves the Bond itself; the request cannot name an owner, and it cannot name a
discriminator — the address is rebuilt from the discriminator the Bond
registered under, so a slug that begins with a hexadecimal digit becomes part of
the slug rather than a new discriminator.

The requested slug is validated by the same canonical `pub_dress` contract that
registration uses: 2–32 Unicode scalars from the canonical allowlist, preserved
exactly, with no case folding or normalization. Renames are rate limited per
Bond and globally.

## What moves with the Bond

The rename happens in one transaction. The identity row moves to the new
address, and every reference — provider bindings, native credentials, recovery
challenges, and live sessions — moves with it, so a signed-in person stays
signed in and the same password signs in under the new address. The previous
address becomes available to anyone again.

The owned Avaia address is a derivation of its owner's address, so it is
re-derived in the same transaction rather than outliving the name it came from.
A Bond that predates the Avaia amendment gains the Avaia its new address derives.
If either the requested address or the Avaia address it derives belongs to
another identity, the rename is refused with `pub_dress_unavailable` or
`avaia_unavailable` and nothing is written.

A remembered-Bond hint names an address, so a request that carried one receives a
refreshed hint for the new address. Renaming creates no Interaction, BondChain or
Relationship fact, and it is not a credential operation: passwords, recovery keys
and sessions are untouched.

## Naming the owned Avaia

`POST /api/v1/identity/avaia/pub_dress` names the Avaia a Bond owns, under the
same authority and the same limits. An Avaia address carries its owner's
discriminator and always ends in `ai`; both belong to the contract, so only the
name in between is accepted, and a name that drops the suffix is refused rather
than repaired.

Deriving is the default, not a rule. A Bond that has never named its Avaia keeps
an address derived from its own, and that derivation follows the owner through a
rename. An Avaia its owner named is not a derivation, so it stays exactly as it
was named — the shared discriminator, which a slug rename never changes, keeps it
canonical. A Bond that predates the Avaia amendment names one here instead of
waiting for a derivation it has already replaced.

## Choosing an avatar

`POST /api/v1/identity/avatar` records which published study a Bond is
represented by, under the same authority, CSRF requirement and rate limits as
the renames. The service accepts only a published model id and stores nothing
else; the choice is identity state, so it follows the Bond to every host rather
than living in one device's interface preferences.

A new Bond is offered a body once, right after its address, its password and
its recovery key — the first moment there is a Bond to represent. The three
studies are shown as themselves: each card is a still generated from that very
study, so a picker can never promise a figure the world would not draw.
"Decide later" is a real answer, and the profile keeps the same picker.

No body is assigned to anyone. An identity with no choice recorded carries no
model at all, and the world draws no avatar until a person chooses. A client that
reads a newer explicit model id it cannot render keeps that choice distinct from
"not chosen" and reports it as unsupported instead of substituting another body.
The published studies share one skeleton and one set of clips, so choosing
changes the body a person is represented by and nothing about how it moves. See
`docs/avatar-rendering.md` for the asset pipeline and what the studies are.

## The 3D model field, and the editor behind it

Bond settings and Avaia settings each carry a **3D model** field: the name of
the study that subject is represented by, a small preview of the body as it is
actually saved, and a disclosure. The whole field opens the editor — a person
reaching for the little figure is reaching for the body, not for a picture
beside a separate control.

The editor shows a large live preview, the four-model picker, and, for a study
that publishes a wardrobe, controls for what that body wears. Choosing a model
updates the preview at once; nothing reaches the service until **Save**, and
**Cancel** puts back exactly what was there. Moving between studies keeps what
each one was wearing, so coming back to a body finds it as it was left. An
appearance is never carried across: what one study wears means nothing to
another, and a silent translation would put a person in clothes they never
chose.

**Only Dasha 2.0 is editable.** Sky, Dasha and Kai are single sculpted
studies: they publish no slots and no items, and the editor says so rather
than offering controls that would change nothing.

The body is identity state and goes to the service. What the body wears does
not: the identity contract publishes no field for an appearance, so this client
keeps it on the device, per study, and the editor says so. A model the service
refuses leaves the outfit unwritten too — a half-saved body is not what anyone
asked for. It follows that an outfit does not travel between devices yet.

An Avaia's body is its own. Where nothing has been chosen for it, it is derived
from its address so that an Avaia never wears the study of the Bond that owns
it; a choice made in the editor is kept on the device, because the contract has
no field for an Avaia's body either.

Settings, the editor and the world all resolve a body through one resolver, so
the same saved state cannot look like one person in a preview and another one
standing on the map.

## Deployment

Identity runtime contract **5** provides both rename endpoints and the avatar
choice. Profile editing is
part of the shared product surface, so every client target requires contract 5.
After merge, package the identity service at contract 5 before activating any
client; the production orchestrator checks this dependency and fails closed
without a suitable package. The avatar choice adds one nullable column to
`identities` (migration `0005_avatar_model.sql`, applied on start like every
earlier one); no new environment secret is required.

© 2026 aiaiaiai · aiaiaiai.org
