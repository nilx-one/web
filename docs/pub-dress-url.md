# Public Bond address

A Bond's public address is `https://<label>.nilx.one`, where the label is
derived from its `pub_dress` and allocated as stored identity state.

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

`nilx-one/core` owns derivation and composition.
`packages/application/src/pub-dress-url.ts` is presentation-only: it receives
Core results and never performs Unicode/IDNA mapping itself.

- A label has two forms and both matter. The product presents
  `0x0небо.nilx.one`; DNS carries `xn--0x0-dddt1cj`. Browser chrome is outside
  the product boundary and may choose to display either the Unicode form or the
  A-label/Punycode form. Composition happens on the readable source and encodes
  once — appending a suffix to an already-encoded `xn--` label would produce a
  string that no longer decodes to the intended source.
- The encoder owns the fold. Case folding is part of UTS-46 mapping, so nothing
  here lowercases before encoding: `toLowerCase` applies Final_Sigma and would
  give `0x0ΟΔΟΣ` a different address from the one allocated. A readable form is
  offered only when it corresponds to the stored Core allocation.
- Mapping is wider than case. Fullwidth `0x0ａｂ` reaches the same label as plain
  `0x0ab`, so they are a collision pair with no case variance between them.
- Core validates the LDH A-label boundary, UTS-46 scalar policy, hyphen rules,
  bidirectional-text rules, joiners, and the final DNS length. Web maps Core's
  stable rejection codes into product copy rather than reclassifying Unicode.
- The 63-octet limit is measured on the encoded form. A 32-scalar slug is a
  valid `pub_dress` and can still exceed one DNS label once encoded.
- Non-ASCII is encoded, not refused. `0x0небо` has the product-readable public
  URL `https://0x0небо.nilx.one`, carried by DNS as `xn--0x0-dddt1cj`.

Every label begins with `0x` or, once encoded, `xn--`. That is what keeps the
user namespace disjoint from service hosts — no Bond can fold onto `www`, `api`,
or `_acme-challenge` — so no reserved-name blocklist has to be maintained
alongside it. Because an ASCII stem always begins `0x`, no Bond can hand-craft a
label starting `xn--` either, so an ACE prefix cannot be forged.

One consequence of the encoding is worth knowing before it is discovered in
production, and the surface says it in place rather than leaving an empty field:
**no right-to-left `pub_dress` can have an address.** RFC 5893 requires an RTL
label to begin with L, R, or AL, and every label here begins with the digit `0`.
Hebrew and Arabic Bonds are excluded by the `0x` prefix itself, not by anything
about their script.

## Allocation stays a server transaction

`POST /api/v1/identity/url/resolve` is advisory in exactly the way
`POST /api/v1/identity/resolve` is. The identity service's allocating insert
remains the only collision boundary, so a label may still be taken between the
answer and registration, and the client must handle that.

Human identities now carry `pub_dress_label` plus the selected
`pub_dress_label_suffix`. The label has a `UNIQUE COLLATE NOCASE` index. New
native and provider registrations allocate the default Core-derived label in the
same transaction that creates the human Bond. Renaming a Bond also moves or
releases that stored label in the rename transaction.

Existing human Bonds are backfilled in stable creation order. The first historic
Bond that maps onto a label receives it; a later historic collision remains
unallocated rather than inventing a distinguishing suffix its owner never chose.
A `pub_dress` that Core cannot represent as one DNS label remains a valid Bond
with no public label.

## Public lookup

`GET /api/v1/identity/public` resolves the request host by its stored A-label.
The service validates the hostname as a canonical `PubDressLabel`, then looks up
the allocation. Decoding an A-label is never identity authority: an unallocated
host returns `404` instead of being reverse-computed into a Bond.

On a Bond hostname, `apps/site` renders a public-only surface from that lookup.
It does not start the authenticated world, session flow, geolocation, map, or
Avaia runtime. The response exposes public identity projection only:
`pub_dress`, optional owned Avaia and avatar choice, and the readable public URL.

## Security boundary

A subdomain is a separate origin on the same registrable domain. Session and
remembered-Bond cookies use the `__Host-` prefix and set no `Domain` attribute,
so a Bond subdomain cannot read or shadow the authenticated `nilx.one` cookies.

Production needs one wildcard certificate for `*.nilx.one`, issued through a
DNS-01-capable path. Per-label certificates would publish registered public
labels in Certificate Transparency logs permanently.

If Bond addresses ever serve Bond-controlled JavaScript, `__Host-` alone stops
being sufficient and the addresses need their own registrable domain plus a
Public Suffix List entry.

## Core ownership

[`pub-dress-label.contract.yaml`](pub-dress-label.contract.yaml) mirrors the
Core-owned contract consumed by Web. The normative implementation lives in
`nilx-one/core` and is exposed to Web through the verified Wasm boundary; the
local document remains as a cross-repository compatibility and downstream-work
record.

## Remaining work

- wire the existing distinguishing-suffix editor to Core composition,
  `/api/v1/identity/url/resolve`, and suffix-aware registration allocation. Until
  then a new Bond whose default DNS label is already allocated is rejected at
  the transaction boundary rather than silently receiving another address;
- provision wildcard `*.nilx.one` DNS and DNS-01 TLS at the shared edge in
  `0x0sky/infra`, then route Bond hosts to `ox1-web`;
- activate and publicly verify that edge change. Merge and deployment remain
  separate delivery stages.

The preview and collision composition use the pinned Core runtime directly. If
the Wasm label binding is missing or malformed, Web fails closed instead of
falling back to a second Unicode/IDNA implementation.

---

© 2026 aiaiaiai · aiaiaiai.org
