# Presence Journal Lifecycle

## Decision

The Phase 1 presence journal is **device-local, non-portable evidence**.

Its encryption key is generated on the client, stored locally as a non-extractable Web Crypto key, and is not derived from a Bond identity, password, provider credential, Core key, or server secret.

This is deliberate. A visit record describes what this device observed locally. It is not BondChain evidence, Relationship state, a shared-world assertion, or a recoverable account object.

## Current ownership

The Web client owns the journal lifecycle.

- `presence-idb` owns persistence and encryption.
- `presence-contract` defines the local record shape without network operations.
- `presence-geo` creates local evidence from accepted host observations.
- `map-shade` receives only the lit-cell projection plus the explicit local read path.
- Core does not own, sync, re-key, or recover the journal.
- Identity services do not know that the journal exists.

The privacy architecture test is the executable guard for this boundary.

## Key binding

The journal key is bound to the browser storage context that created it, not to `pk_identity` or `pub_dress`.

Phase 1 therefore has no identity-bound key derivation and no automatic key migration after:

- password changes;
- provider connection or disconnection;
- Bond rename / `pub_dress` change;
- Core key rotation or future `REKEY` operations;
- sign-out and sign-in as the same Bond.

Changing account credentials must not silently make local movement evidence portable.

## Storage loss and device replacement

If the browser profile, IndexedDB database, or stored CryptoKey is deleted, the affected local history is lost or becomes unreadable on that device.

The client must not reconstruct missing visits from server data, analytics, BondChain, Relationship state, map caches, or another device.

A new device starts with a new local journal and a new local key.

This is data loss in a local optional feature, not protocol corruption. Bond, Avaia, BondChain, and Relationship state remain unchanged.

## Ciphertext without its key

If encrypted visit records exist but the journal key cannot be loaded, the client must fail closed:

1. do not treat the ciphertext as valid presence;
2. do not generate a replacement key and attempt to read old records with it;
3. do not send ciphertext, cell indexes, or recovery metadata to a server;
4. do not infer visits from the shade presentation cache;
5. report only a local generic journal-unavailable state if the product later exposes one.

Recovery of those records is unavailable in Phase 1. A later destructive reset may explicitly discard unreadable local journal data, but must not pretend to recover it.

## Rotation

Phase 1 has no scheduled key rotation because there is no portable key hierarchy to rotate under.

If a future local-only implementation needs key rotation, it must use an explicit local transaction:

1. generate a new non-extractable local key;
2. decrypt each readable record locally with the old key;
3. re-encrypt locally with the new key;
4. atomically publish the new key/database generation only after the rewrite succeeds;
5. never upload plaintext, ciphertext, H3 membership, or key material.

Partial rotation must remain distinguishable and recoverable locally; deleting the old key before a completed rewrite is not acceptable.

This paragraph is a constraint on any future rotation implementation, not authorization to implement one now.

## Deletion

Deleting the local presence journal means deleting both its encrypted records and its local key material.

Deletion must not:

- delete or rewrite BondChain facts;
- modify Relationship state;
- send a movement-history deletion request to a backend that never stored the data;
- affect identity credentials;
- imply that other devices contained the same journal.

## REKEY boundary

A protocol or identity `REKEY` operation must not implicitly re-key the presence journal.

The two concepts have different ownership:

- identity/Core re-keying changes cryptographic authority for protocol or account state;
- presence-journal encryption protects device-local evidence at rest.

Coupling them would turn local movement evidence into identity-owned portable state without an explicit product and privacy decision. That is forbidden by the current contract.

## Cross-device and export gate

Cross-device sync, backup, export, import, identity binding, escrow, recovery, or training egress are **not Phase 1 capabilities**.

Any proposal for one of them requires a separate approved contract that defines at minimum:

- the user-visible purpose and explicit action that authorizes movement of the data;
- whether raw visits, H3 cells, or a derived projection may leave the device;
- encryption and recipient/key ownership;
- revocation and deletion semantics;
- conflict handling across independent device journals;
- how provenance remains device-specific;
- why the feature does not manufacture BondChain facts, reciprocity, consent, or Relationship state;
- how the existing privacy architecture guard changes.

Until such a contract lands, the correct implementation is no transport at all.

## UI contract

Phase 1 should remain quiet when the journal is healthy.

If journal storage is unavailable, the map continues without local Shade capture rather than blocking the world. If a future UI exposes the failure, it must describe only the local capability, for example that local visit history is unavailable on this device. It must not claim account-history loss or server recovery.

## Invariants

The following are normative for the current implementation:

1. one device/storage context owns one independent journal key;
2. the key is non-extractable and never transmitted;
3. no identity credential derives or wraps the key;
4. no journal data is synced, exported, backed up, analyzed, logged, or trained on;
5. local storage loss does not mutate protocol truth;
6. encrypted records without their key do not become evidence;
7. Core/identity `REKEY` does not imply journal re-keying;
8. future portability requires a separate explicit contract and implementation slice.
