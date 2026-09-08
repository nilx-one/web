# Profile editing

A Bond profile presents facts the identity service owns. Most of them are
consequences — the discriminator chosen at registration, the provider bindings,
the owned Avaia address, and the projections that do not exist yet. Exactly one
of them is a choice its owner may revisit: the slug.

Profile editing therefore offers the slug and nothing else. Rows that could only
ever read "Not set" are absent from the edit surface rather than presented as
fields no one can fill; the profile view keeps them where they belong, as
projections. What follows a rename — the discriminator, the provider
connections, the owned Avaia — is stated as a consequence, never as an input.

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

## Deployment

Identity runtime contract **4** provides the rename endpoint. Profile editing is
part of the shared product surface, so every client target requires contract 4.
After merge, package the identity service at contract 4 before activating any
client; the production orchestrator checks this dependency and fails closed
without a suitable package. No schema migration and no new environment secret is
required.

© 2026 aiaiaiai · aiaiaiai.org
