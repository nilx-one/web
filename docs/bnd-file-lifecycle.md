# The .bnd file

## Decision

The `.bnd` file is the client-owned container for everything a Bond keeps that the server never sees and, in some cases, has no right to see. It generalizes the pattern `presence-idb` already implements for `bond.journal` (the canonical term, per `nilx-one/0x1` `documents/02-glossary.md`, for what this repo's `presence-idb`/`presence-journal.md` implements): local-first, encrypted at rest, never synced by default. It holds two structurally different classes of content, and the difference matters for everything below:

- **`bond.journal` entries** — single-owner, local-only, never relationship truth. Presence records are the existing instance.
- **locally-held `bond.chain` copies** — this device's encrypted copy of BondChain histories it is a genuine party to, per `nilx-one/0x1` `documents/06-cryptography-and-wire-protocol.md`.

It does not replace `presence-idb`; it is the shared local-container discipline both classes of record follow.

Everything the client does is offline-first. The one structural exception is any operation that inherently involves a second Bond: completing the Interaction that establishes a `bch`, and a recovery request. Both require the network because they require reaching another device, not because they require the server to hold anything sensitive.

## Key model — two different keys, not one

An earlier version of this document used one key model for everything: independent, non-extractable, never leaves the device. That is correct for `bond.journal` and wrong for `bond.chain`.

**`bond.journal` key.** Generated on the client, stored as a non-extractable key, never derived from Bond identity, password, provider credential, Core key, or server secret. No recovery phrase, code, or seed, and none is planned — considered and rejected, per `presence-journal-lifecycle.md`.

**`bond.chain` key.** Not a local secret at all. Per 0x1's Pairwise Key Derivation, `k = HKDF(ECDH || H(head))`: both parties to one `bch` independently derive the same key from their own long-term key material (X25519 ECDH) and the hash of the current chain head. The `.bnd` file stores the *inputs* this device needs to re-derive `k` — its own long-term key material, the chain head — not an independent per-party secret. This is why an untrusted party can hold or transfer an encrypted `bond.chain` file without learning its meaning: possession of ciphertext is not possession of the ECDH private key needed to derive `k`.

There is still no recovery phrase, code, or seed for the underlying long-term identity key. The only path back to a lost `.bnd` runs through `REC-REQ`, per `nilx-one/0x1` `documents/15-devices-and-recovery.md`.

## Client posture

0x1 already defines the authority split this section used to invent independently:

- `sk_bond` — human-gated, may sign commitment-bearing records.
- `sk_ack` — derived engine authority; cannot manufacture a human commitment.

A host's relationship to a `.bnd` file follows the same split, restated for storage rather than signing:

| Posture | Holds `sk_bond` / can derive `k` | What it may do |
| --- | --- | --- |
| Official client completing an Interaction | yes | may sign commitment-bearing records under `sk_bond`; the only posture that can establish or continue a `bch` |
| Companion / embedded host (e.g. a home device) | no | fails closed on ciphertext; never receives plaintext, `sk_bond`, or an escrow route |
| Client holding only `sk_ack` | derived only | may acknowledge/automate within its owning contract; cannot mint or continue a `bch` |

## Storage loss and device replacement

Losing the local `.bnd` (browser profile wiped, device lost, key deleted) means:

- `bond.journal` content is lost outright, exactly as `presence-journal-lifecycle.md` already describes — not reconstructed from anywhere else;
- `bond.chain` content: a lost terminal history is recoverable only from a counterparty who independently still holds it — the other party deriving the same `k` from their own long-term key does not by itself restore *this* device's identity key;
- Single Active Device (0x1 `documents/15-devices-and-recovery.md`) means a lost device's signing authority does not simply sit idle — it must be explicitly revoked and replaced through `DEVICE-REVOKE`, not silently superseded by a new local key.

## Recovery flow

This section previously described a no-quorum "content accretes as counterparties agree" model and a public counterparty-lookup projection. Neither exists in 0x1. The actual flow, per `documents/15-devices-and-recovery.md`:

1. The new, empty `.bnd` generates `pk_new`. It has no authenticated capability yet.
2. The person supplies `counterpart_hint` from their own memory or records — there is no protocol-level lookup of "who are my counterparties"; 0x1's Relationship projection is explicit that no such shared graph exists.
3. `REC-REQ = { counterpart_hint, bch_id, pk_new }` — `bch_id` is required, not a hint. The assisting Bond locates that exact `bch_id` in their own already-held `bond.chain` and verifies the requester's identity against that BondChain's genesis before anything else.
4. Only then does out-of-band authentication happen: a six-digit code derived from `pk_new`, read through a live channel or verified in person.
5. If the target's old device is still `active`, `DEVICE-REVOKE` does not finalize immediately — a live-device objection window gives that device a chance to object first. A `dormant`/`dead` device finalizes without delay.
6. Recovered content is scoped: a terminal `bch` is copied and verified as an immutable history; a non-terminal `bch` whose lifecycle permits it may `CONTINUE` under the new key epoch. Neither merges into a fabricated single relationship chain.
7. A Bond with no `bch` history, or whose counterparties are all unreachable or unwilling, is not recoverable in Phase 1. There is no fallback beneath this.

## Deliberately unresolved

- How a client surface helps a person remember `counterpart_hint` without inventing the public graph 0x1 forbids — a product problem, not a protocol one.
- Local `.bnd` schema/versioning for holding `sk_bond`-rooted long-term key material alongside `bond.journal` entries in one container.
- Rotation of the `bond.journal` key follows the same explicit-local-transaction shape `presence-journal-lifecycle.md` already specifies; this document does not restate it.

## Invariants

1. one device owns one independent `bond.journal` key, non-extractable, never transmitted;
2. no identity credential derives or wraps the `bond.journal` key, and no recovery phrase/code/seed exists for it;
3. `bond.journal` content, once lost locally, is not reconstructed from any other source;
4. `bond.chain` content is decrypted with `k = HKDF(ECDH || H(head))`, a pairwise-derivable key, not an independent per-device secret;
5. holding a derivable `k` or `sk_ack` does not imply `sk_bond` — reading is never sufficient authorization to sign or mint;
6. recovery has no public counterparty lookup; `counterpart_hint` and a verified `bch_id` come from the requester and the assisting Bond respectively, never from a registry;
7. `DEVICE-REVOKE` reached through `REC-REQ` does not finalize against an `active` old device without the live-device objection window elapsing;
8. a `bch` is recovered as an independent, immutable (if terminal) or continuable (if non-terminal and eligible) history — never concatenated into a fabricated relationship chain.
