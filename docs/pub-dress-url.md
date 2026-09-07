# Public Bond address

A Bond's public address is `https://<label>.nilx.one`, where the label is
derived from its `pub_dress`.

## Why the address is stored, not computed

`pub_dress` is case-sensitive (`identities.pub_dress TEXT PRIMARY KEY COLLATE
BINARY`, and the identity form says so: _Case-sensitive · 2–32 characters_). A
DNS label is not case-sensitive.

The fold is therefore **not injective**: `0x0Sky` and `0x0sky` are two
legitimate, distinct identities that produce one label. Two things follow, and
they shape the whole feature:

- a label cannot be resolved back to a `pub_dress` by computation, only by
  lookup, so the allocated address is a stored field with its own uniqueness,
  never a derived view of the identity column;
- the first Bond to claim a label owns it, and every later Bond folding onto the
  same label chooses a distinguishing part instead.

Only the slug is ever folded. The discriminator is already constrained to
lowercase hexadecimal, so `0xDsky` is not a `pub_dress` at all.

## What the Bond sees

The address surface has exactly two shapes, both in
`packages/product-app/src/features/identity/pub-dress-url-field.tsx`:

| Situation                | Surface                                                     |
| ------------------------ | ----------------------------------------------------------- |
| the folded label is free | one read-only line, plus a before/after when case was lost  |
| another Bond holds it    | the folded stem stays fixed; a second part becomes editable |

The fold is never silent. Losing case is a fact about the identity's public URL,
so a Bond registering `0xdA-Sha` reads `0xdA-Sha → 0xda-sha` before committing
rather than discovering it afterwards.

The editable part behaves like the slug during registration: typed input is
folded the same way, a suggestion control proposes random digits, and the stem
is presented as a prefix rather than a disabled input so it never reads as
something the Bond failed to fill in.

## Derivation rules

`packages/application/src/pub-dress-url.ts` is the client-side derivation.

- ASCII case fold only. `String.prototype.toLowerCase` also folds scalars this
  module refuses, which would hide a rejection behind a silent rewrite.
- The label must be LDH (`a-z`, `0-9`, `-`), must not end on a hyphen, and must
  fit the 63-octet label limit.
- Non-ASCII is refused with its own reason rather than transliterated. Choosing
  an IDNA mapping is a normative decision: a fold invented in the Web client
  could land one Bond's identity on another Bond's label, permanently. That
  mapping belongs in the pinned `nilx-one/core` contract next to `PubDress`.

Every stem keeps the `0x` prefix. That is what keeps the user namespace disjoint
from service hosts — no Bond can fold onto `www`, `api`, or `_acme-challenge` —
so no reserved-name blocklist has to be maintained alongside it.

## Allocation stays a server transaction

`ResolvePubDressLabel` is advisory in exactly the way `ResolvePubDress` is. The
identity service's allocating insert remains the only collision boundary, so a
label may still be taken between the answer and registration, and the client
must handle that.

## Security boundary

A subdomain is a separate origin on the same registrable domain. Two properties
already hold in `services/identity/src/api.rs` and must keep holding:

- session and remembered-Bond cookies use the `__Host-` prefix and set no
  `Domain` attribute, so no subdomain can read or shadow them;
- one wildcard certificate for `*.nilx.one`, issued over ACME DNS-01. Per-label
  certificates would publish every registered nickname in Certificate
  Transparency logs permanently.

If Bond addresses ever serve Bond-controlled JavaScript, `__Host-` alone stops
being sufficient and the addresses need their own registrable domain plus a
Public Suffix List entry.

## Not yet implemented

- the normative fold in `nilx-one/core`, including the IDNA decision;
- `POST /api/v1/identity/url/resolve`, and label allocation inside the
  registration transaction, with `pub_dress_url` on the identity projection;
- the migration adding the stored label with a `UNIQUE COLLATE NOCASE` index;
- wildcard DNS and TLS, which `deploy/web/README.md` places in `0x0sky/infra`.

Until label resolution exists, `IdentityFoundationView` receives no
`pubDressUrlResolution` and the address surface stays in its read-only preview:
the Bond still sees the fold, and only a real collision answer opens the
editable part.

---

© 2026 aiaiaiai · aiaiaiai.org
