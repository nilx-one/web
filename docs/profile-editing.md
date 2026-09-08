# Profile editing

A Bond profile presents facts the identity service owns. Most of them are
consequences — the discriminator chosen at registration, the provider bindings,
the projections that do not exist yet. Two of them are choices their owner may
revisit: the Bond's own slug, and the slug of the Avaia it owns.

There is one profile surface. Reading the profile and changing it are the same
screen, because a screen that only shows what a second screen would let you
change is a detour, not a step. It carries three choices: the Bond's slug, its
Avaia's slug, and the avatar study the Bond is represented by. Rows that could only ever read "Not set" are
gone rather than presented as fields no one can fill, and the providers row is
what it says: the hosts this Bond is connected through, each its own control.
What follows a rename — the discriminator and the provider connections — is a
consequence, never an input.

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

No body is assigned to anyone. An identity with no choice recorded carries no
model at all, and the world draws no avatar until a person chooses. A client that
reads a newer explicit model id it cannot render keeps that choice distinct from
"not chosen" and reports it as unsupported instead of substituting another body.
The published studies share one skeleton and one set of clips, so choosing
changes the body a person is represented by and nothing about how it moves. See
`docs/avatar-rendering.md` for the asset pipeline and what the studies are.

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
