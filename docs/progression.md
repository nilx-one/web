# Progression

A Bond and its Avaia level up by playing: revealing fog, studying what the
Avaia notices along the way, and a few one-time achievements. The activity
experience that pays for it is `pub_info` on the Bond's `.bnd`: the owner's
report, synced and readable with the public Bond. The service labels every
total `authority: "client"`. Core is not asked to price it, and the service
does not attest that the play happened.

## Two earners

The Bond and its Avaia keep separate experience. What the owner did
themselves pays the Bond; what the Avaia did pays the Avaia.

| Action                                    | Who earns it |                  Reward |
| ----------------------------------------- | ------------ | ----------------------: |
| A zone (fog cell) revealed by the Avaia   | the Avaia    |                       n |
| A zone (fog cell) walked open             | the Bond     |                      3n |
| A monument studied, full description kept | the Avaia    |                    4.5n |
| A monument noticed in passing             | the Bond     |                      2n |
| A repair or a craft finished              | the Bond     | its recipe's, 15 to 500 |

`n` is `EXPERIENCE_UNIT` in `progression.ts`, currently `10`. Walking a zone
open yourself costs more effort than sending the Avaia, so it pays more; the
Avaia's own study is the one that keeps the archive's full description, so it
pays more than a passing notice. How a zone opens and how a landmark gets
noticed or studied are [Avaia walks the world](avaia-walk.md)'s own; this file
only prices what already happens there.

Chance finds, once they are wired into walking, pay the same way: whoever did
it. The rules live in `awardsFor` (`artifact-contract`); see
[Avaia walks on its own](avaia-outings.md) §3.4.

| Action                      | Who earns it                   |                  Reward |
| --------------------------- | ------------------------------ | ----------------------: |
| A find seen, first sighting | the Avaia or the Bond, who saw |                      10 |
| A find picked up            | whoever picked it up           | by the item, 10 to 1000 |

The Avaia sees what it walks past, on its own or sent by a tap; the Bond sees
what this device walks past. The Avaia picks up tiers 1 to 3 itself and leaves
tiers 4 to 6 as leads, which pay the Bond when the person walks there and picks
them up. A pick-up pays what the item is worth, not its tier: Core's catalog (`docs/find-items.md` in `nilx-one/core`) decides which item a find is and what it pays. A rare CD radio (tier 5) pays 25, and a rare CD player 400. The service prices it the same way. A claimed pick-up (tiers 4 to 6) names its find, so the service asks Core which item that is. A common pick-up names nothing and needs nothing, because every item of a common tier pays that tier's amount, and a test in the service holds Core's catalog to that. Each find pays its sighting once and its pick-up once. "Once" holds
per history: the find journal stays on the device, and the server sees only
each award's commitment (below). A rare find (tiers 4 to 6) is also claimed:
the first Bond to pick it up keeps it.

## Achievements

An achievement pays once. Where "once" is counted depends on what it is about:

| Achievement            | Counted          | Bond | Avaia |
| ---------------------- | ---------------- | ---: | ----: |
| Avaia configured       | once per account |   20 |     — |
| Avaia model downloaded | once per device  |   50 |   100 |

**Avaia configured** is read from what the identity service already keeps:
an Avaia whose stored state is `configured` has earned it, on every device
that reads it, and none of them has to remember having paid it. It is also
what takes the Avaia to level 1. On the device that saves the setup,
[xSasha](guide.md) says so — see [Avaia setup](avaia-setup.md).

**Avaia model downloaded** is something this device did for this Bond, so the
web, Telegram and Discord hosts each earn it on their own. It pays the moment
Settings finds the on-device model present — downloaded there with "Download
now", or already cached. Until then, once the Avaia is configured, a blue dot
marks the way: on the control that reaches Settings (the overflow `•••` on a
narrow screen, the gear or `/settings` on wider ones) until Settings has been
opened, and on "Download now" until the model is here. Blue because red
already means something failed and amber already means a runtime is working;
this is neither, only an invitation.

## Levels

The two curves are deliberately different.

**The Avaia climbs linearly.** Level 1 is being configured. After that every
150 experience is a level, with no ceiling: level 2 at 150, level 3 at 300,
level 100 at 14,850. A level in the hundreds is ordinary. Experience an
unconfigured Avaia earns is kept and counts once it is configured.

**The Bond climbs steeply.** Level `L` costs `50 · L³` in total: 50, 400,
1,350, 3,200, 6,250… Level 1 is one or two actions away — configuring the
Avaia and walking one zone open, say — while level 4 already takes a hundred
zones walked open.

## Where it lives

Activity experience is part of `pub_info`, the public slice of a Bond's
[`.bnd`](bnd-file-lifecycle.md). There is one total per Bond and one per its
Avaia. Those totals are an owner assertion. The identity service stores them
and answers them with the public Bond, so every host — the web, Telegram,
Discord, and anyone opening the public address — reads the same report.
Every experience object, authenticated and public, carries
`authority: "client"`, written by the service. A request cannot set it, and
a reader does not adopt a total that arrives without it. Publishing is
`GET`/`POST /api/v1/identity/pub-info`. The public projection nests the same
totals under `pub_info.experience`. A carry total is capped, and so is one
event; the caps bound an untrusted number. They are not proof the award was
earned, and neither is an idempotent id or the rate limit. The public card
says the standing is reported by this Bond.

**Committed experience** (R3 in
[Avaia walks on its own](avaia-outings.md)) is the path for new world awards.
The totals are the number a device shows. Each award id is its commitment,
`xp:` plus an HMAC of the local award record and the previous commitment,
under a history key the service never sees. The server stores the commitment,
a fast-forward head per device chain and bounded per-kind counts; it prices the
award from its kind/earner/tier instead of accepting an amount. The record
behind the commitment — cell, landmark or find history and its time — stays
in the encrypted `avaia-finds` journal on the device. A rare tier 4–6 pick-up
is the exception that also sends its `artifactId` so the service can validate
and atomically arbitrate the first claim.

The order is intent -> server commit -> local keep. Offline or an unanswered
service leaves the exact commitment pending for an idempotent retry. A refused
award is not kept; descendants are re-committed on the last accepted/server
head. The server can therefore protect the number from a simple local edit,
but it still cannot prove a person physically performed an allowed action. The
standing remains this Bond's report.

`nilx-one.progression.v3.<owner>` is now the **legacy migration path**:
pre-R3 carry/pending events are published before a device starts flushing R3
awards. Version 2 (`nilx-one.progression.v2.<owner>`) and version 1
(`nilx-one.progression.v1.<owner>`, less the old configuration reward) are
still offered once as carry and never written again. New zone, landmark and
find awards are pending/kept in `avaia-finds`; fog reveals and the landmark
notebook remain their separate local world records. See
[State placement](state-placement.md).

The **Avaia model downloaded** achievement stays on the device that downloaded
it. It is added to that device's own standing and is not part of `pub_info`.

A level is still not a protocol fact: it creates no Interaction and completes
no BondChain. The service redistributes the client-authority standing and, for
R3 awards, prices a closed bounded kind; it still does not derive a
Relationship, prove the physical play, or make the resulting level an
attestation. Ordinary award records remain local. A rare claim reveals only
the find needed for first-claim arbitration, under the disclosure documented
in [Avaia walks on its own](avaia-outings.md).

## What this is not

This is not a badge shop or a quest system. It is not evidence of presence or
attendance. The published totals are how much this Bond reports, not where
it was earned and not a rank nilx attested. Losing local storage loses the
device achievement and any award that had not reached `pub_info` yet; the
shared report remains.

## Not yet

None of this is scheduled. It is written down so it is not lost before it is.

- **Interaction as the main path.** Two Bonds actually meeting — a chat, any
  other interaction between them — is meant to become the main way a Bond
  levels up, ahead of fog and landmarks. That is a boundary this file
  currently draws hard, twice over: "creates no Interaction, completes no
  BondChain" (here and in `avaia-setup.md`). The day an Interaction starts
  paying experience, that boundary has to move on purpose, with its own
  contract for what counts as one and who attests it — not as a quiet
  addition to the events table above.
- **Commerce.** A first purchase at a partner venue, settled through
  0xda-market, is meant to be a landmark achievement of its own — likely the
  biggest single one yet. That needs its own contract too: what (if anything)
  the identity service is told, what stays 0xda-market's alone, and what
  "the owner asserts this" even means once real money moved.
- **AI achievements.** Using the on-device model, or whatever AI surface
  comes after it, is meant to earn its own way in — a sibling to "Avaia model
  downloaded", not folded into it.

All three cross into territory this file currently rules out (Interaction,
BondChain, money, a second service). Getting there is deliberate, one
contract at a time — not a fast follow.

© 2026 aiaiaiai · aiaiaiai.org
