# Close the finds world loop

This slice closes the product loop that the R1/R2/R3 primitives now make possible.

## Goal

Make the existing pieces run end to end in the product:

```text
walk
  -> deterministic find roll
  -> seen / common pick-up / rare lead
  -> committed award
  -> rare claim when applicable
  -> deterministic server outcome
  -> keep or close local fact
  -> progression + product UI
```

The feature is complete only when the product uses the contracts already merged in
#315, #317, #323, #324–#327 and #329. A contract existing unused is not completion.

## Protocol boundaries

- Finds, outings, leads, awards, and their presentation are **not BondChain** and
  never create Relationship evidence.
- A find claim is authoritative only for that find's rare pick-up.
- The server may hold experience totals, commitment/chain state, and rare claims.
  The award/find history stays on the device.
- The model never receives coordinates, segment ids, artifact ids, claim state,
  provider fields, or server internals.
- Do not invent reciprocity, consent, or a second Bond for a find.

## Required flow

### 1. Walk -> find

Wire the existing `artifact-contract` roll into real product movement.

- Completed Avaia routes use the exact path they actually walked.
- The Bond/device can discover/pick up finds only from firsthand, non-declared
  device movement while the Bond is driving.
- Manual and autonomous Avaia walking use the same roll table and epoch.
- Use one canonical client pack id that matches the identity service.
- Do not make finds outing targets.

Prefer completed/observed movement over predicted movement: no XP for a route that
was planned and then cancelled.

### 2. Local history and leads

Persist the facts needed by the feature.

- A find event is kept only after its award is accepted (or an idempotent retry
  proves it was accepted).
- Rare tier 4–6 sightings by the Avaia become bounded, expiring leads.
- A lead contains no exact coordinate and no real-world/person/business name.
- Leads expire with the epoch and close on a successful pick-up, `already_yours`,
  or a remote claimed-set match.
- The local find/history store must survive reload.
- If the implementation uses the planned `avaia-finds` IndexedDB journal,
  add it to `world-wipe.ts` and the state-placement contract. Do not leave an
  orphaned database after a world wipe.

### 3. Committed awards become the product path

Use `CommittedAwardAccessPort` from #329 for new activity awards.

- Zone reveal/walk and landmark notice/study must stop minting new legacy
  amount-carrying `POST /pub-info` events.
- Legacy progression may remain only as the migration/read path for already
  stored carry/pending data.
- The award record remains local; the request sends only what contract 11
  permits and never sends an amount.
- Preserve R3 order: intent -> server commit -> local keep.
- Offline/service unavailable keeps the same pending commitment for retry.
- If an award is dropped, descendants must not continue with a parent the
  server never accepted. Rebase or otherwise repair the local pending chain
  deterministically.
- `behind` uses the server head rather than guessing one.

### 4. Rare claim outcome

For tier 4–6 pick-up, use the same committed request that performs the claim.

Use #329's deterministic result semantics:

- `accepted` / accepted `duplicate` -> keep;
- `already-yours` -> close quietly;
- `taken` -> close and show the deterministic “oh crap / someone got there
  first” product response;
- invalid/capped/too-many-chains -> drop;
- offline/auth/rate-limit/service unavailable -> keep pending and retry;
- `behind` -> reconcile the chain, not a fake success.

Claim-set reads are bucketed with `claimedLeads`; matching remains local.

### 5. Product surface

The loop must be inspectable without turning it into protocol truth.

- Avaia detail shows current live rare leads next to the existing studied
  landmarks/progression surface.
- A newly kept find/pick-up may use a transient toast/cue.
- `taken` must be visible and deterministic.
- `already-yours` closes quietly.
- Accessibility text must carry the same fact as any visual effect.

Do not add generated voice assets in this slice merely to make “oh crap” audible.
Text/cue is sufficient unless the existing voice asset contract can be preserved.

## Verification

Add tests at the lowest useful layer plus an integration path that proves:

1. completed Avaia walk -> deterministic roll;
2. common find -> seen + Avaia pick-up -> committed experience;
3. rare find -> seen -> lead, but no rare pick-up by Avaia;
4. Bond reaches a live rare lead -> one atomic claim/pick-up;
5. concurrent/taken outcome -> no local keep, lead closes, user-visible response;
6. `already_yours` -> no duplicate XP and quiet close;
7. offline -> pending survives with the same commitment and later retries;
8. rejected/drop -> no local find history and later awards do not retain the
   rejected parent;
9. existing zone/landmark rewards use committed awards;
10. no find path writes BondChain or Relationship state;
11. world wipe removes the find journal if one exists.

Run full repository policy, format, lint, typecheck, tests, and build. For this
application repository, also run deployability validation if the repository's
existing workflow provides a meaningful pre-merge validation.

## Delivery

One task, one branch, one PR. Keep the PR draft until the implementation and full
CI are green. Merge remains a separate, explicitly authorized action.
