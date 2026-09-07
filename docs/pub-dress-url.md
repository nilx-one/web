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

- A label has two forms and both matter. The Bond reads `0x0небо.nilx.one`,
  which is what a browser shows; DNS carries `xn--0x0-dddt1cj`. Composition
  happens on the readable form and encodes once — appending a suffix to an
  already-encoded `xn--` label would produce a string that no longer decodes.
- Case folds across every script, so `0x0Небо` and `0x0небо` collide exactly as
  their ASCII counterparts do.
- ASCII must be LDH (`a-z`, `0-9`, `-`) and must not end on a hyphen. A
  non-ASCII scalar must be a letter, mark, or digit — a conservative stand-in
  for the UTS-46 validity table this package does not carry, biased so it may
  refuse something the contract accepts but never the reverse.
- The 63-octet limit is measured on the encoded form. A 32-scalar slug is a
  valid `pub_dress` and can still reach 105 octets once encoded.
- Non-ASCII is encoded, not refused. `0x0небо` becomes `https://0x0небо.nilx.one`,
  carried by DNS as `xn--0x0-dddt1cj`. The preview reaches the platform's own
  UTS-46 through URL parsing rather than carrying an IDNA table, and applies its
  own charset, boundary and length rules around it — URL parsing deliberately
  relaxes some of them. A symbol is still refused: punycode would encode
  `0x0🌍`, IDNA does not allow it.

Every label begins with `0x` or, once encoded, `xn--`. That is what keeps the
user namespace disjoint from service hosts — no Bond can fold onto `www`, `api`,
or `_acme-challenge` — so no reserved-name blocklist has to be maintained
alongside it. Because an ASCII stem always begins `0x`, no Bond can hand-craft a
label starting `xn--` either, so an ACE prefix cannot be forged.

One consequence of the encoding is worth knowing before it is discovered in
production, and the surface now says it in place rather than leaving an empty
field: **no right-to-left `pub_dress` can have an address.** RFC 5893
requires an RTL label to begin with L, R, or AL, and every label here begins with
the digit `0`. Hebrew and Arabic Bonds are excluded by the `0x` prefix itself,
not by anything about their script.

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

## Handing the fold to core

[`pub-dress-label.contract.yaml`](pub-dress-label.contract.yaml) is the
implementation instruction for `nilx-one/core`: the API surface to add next to
`PubDress`, the rules already settled, the one open decision (the non-ASCII
mapping), and test vectors mirroring
`packages/application/src/pub-dress-url.test.ts` so both sides can be
cross-checked.

## Not yet implemented

- the normative fold in `nilx-one/core`, now specified as UTS-46;
- `POST /api/v1/identity/url/resolve`, and label allocation inside the
  registration transaction, with `pub_dress_url` on the identity projection;
- the migration adding the stored label with a `UNIQUE COLLATE NOCASE` index;
- wildcard DNS and TLS, which `deploy/web/README.md` places in `0x0sky/infra`.

Until label resolution exists, `IdentityFoundationView` receives no
`pubDressUrlResolution` and the address surface stays in its read-only preview:
the Bond still sees the fold and the encoded form, and only a real collision
answer opens the editable part.

The preview's encoder is the platform's UTS-46, which is conformant but not the
revision `nilx-one/core` will pin. Its vectors assert the same encoded values as
the contract, so a divergence fails the Web suite rather than reaching a Bond.

---

© 2026 aiaiaiai · aiaiaiai.org
