# The .bnd file

## Decision

The `.bnd` file is the client-owned container for everything a Bond keeps that the server never sees and, in some cases, has no right to see. It generalizes the pattern `presence-idb` already implements for the presence journal: local-first, encrypted at rest, and never synced by default. Presence records are one class of entry inside it; a BondChain counterparty's mirrored `content` (see `nilx-one/core/docs/bond-chain.md`) is another. It does not replace `presence-idb`; it is the shared local-container discipline both classes of record follow.

Everything the client does is offline-first. The one structural exception is any operation that inherently involves a second Bond: completing the Interaction that mints a BondChain fact, and a recovery request. Both require the network because they require reaching another device, not because they require the server to hold anything sensitive.

## Key model

Each `.bnd` file's encryption key is generated on the client, stored locally as a non-extractable key, and is not derived from a Bond identity, password, provider credential, Core key, or server secret — the same rule `presence-journal-lifecycle.md` already sets for the presence journal, generalized to the whole container.

There is no recovery phrase, code, or seed, and none is planned. This was considered and explicitly rejected: any such fallback would sit outside the BondChain trust model and reintroduce exactly the server-adjacent secret this design exists to avoid. The only path back to a lost `.bnd` runs through BondChain counterparties, per `nilx-one/core/docs/bond-chain.md`.

## Client capability tiers

A host's relationship to a `.bnd` file falls into one of three postures, and the distinction matters because it is a permission boundary, not just a capability one:

| Posture | Can decode | Needs private values | What it may do |
| --- | --- | --- | --- |
| Official client completing an Interaction | yes | yes | the only posture that may call the BondChain mint port |
| Companion / embedded host (e.g. a home device) | no | — | fails closed on ciphertext; never receives plaintext or an escrow route |
| Client that merely holds the key for an unrelated reason | yes | no | may read; must not mint — decode access is never sufficient authorization |

The third row is the one worth stating explicitly: nothing about holding the decrypt key implies the right to produce a BondChain fact. Minting stays gated by an actual kernel-mediated Interaction with a counterpart, never by client-side discretion.

## Storage loss and device replacement

Losing the local `.bnd` (browser profile wiped, device lost, key deleted) means:

- presence-class records are lost outright, exactly as `presence-journal-lifecycle.md` already describes — the client must not reconstruct them from anywhere else;
- BondChain-class `content` is lost from this device's copy, but is not lost as protocol truth — the counterparty's independently-held mirror and the public `(parties, level, signedAt)` projection both survive, per `nilx-one/core/docs/bond-chain.md`;
- recovering the BondChain-class content (and, through it, account access) requires the recovery flow below — it does not happen automatically and does not happen from any local cache.

## Recovery flow

1. The new device announces the Bond's public identity. This carries no authenticated capability by itself.
2. The client asks the public BondChain projection who this Bond's known counterparties are — this is the step the old device's local counterparty list can no longer provide, and the reason the projection is public in the first place.
3. A contacted counterparty decides, on their own device, using the `content` they already hold, whether to agree. Nothing is transmitted to help them decide beyond identifying who is asking.
4. Agreement restores exactly the `content` shared between the recoverer and that one counterparty — never another counterparty's content, never a key, never blanket account control.
5. There is no quorum requirement. One agreeing counterparty is sufficient to restore that one relationship's content; the account's state accretes as more counterparties, contacted over time, independently agree.
6. A Bond with no BondChain history, or whose counterparties are all unreachable or unwilling, is not recoverable in Phase 1. There is no fallback beneath this.

## Deliberately unresolved

- Whether `level` should ever gate who may be contacted as a counterparty, beyond being a public display attribute.
- What an already-recorded counterparty agreement means once that counterparty has separately lost their own device/key.
- The consent surface a counterparty sees when asked to witness someone else's recovery — this document assumes it exists and is explicit, not that agreement happens silently.
- Whether an agreement, once given, is revocable.
- Rotation of the `.bnd` key follows the same explicit-local-transaction shape `presence-journal-lifecycle.md` already specifies (generate, decrypt-with-old, re-encrypt-with-new, atomic publish); this document does not restate it.

## Invariants

1. one device owns one independent `.bnd` key, non-extractable, never transmitted;
2. no identity credential derives or wraps the key, and no recovery phrase/code/seed exists;
3. presence-class content, once lost locally, is not reconstructed from any other source;
4. BondChain-class content is mirrored, not duplicated — no two devices are expected to hold identical ciphertext, only the same commitment;
5. decode access to a `.bnd` file never implies the right to mint a BondChain fact;
6. a BondChain agreement restores only the content shared with the agreeing counterparty, never another party's content and never blanket account control;
7. recovery has no quorum; it has willingness, per relationship, accreted over time;
8. the public BondChain projection carries only `(parties, level, signedAt)` — never content, commitment, or signatures.
