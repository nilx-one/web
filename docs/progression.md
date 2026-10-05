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

| Action                                    | Who earns it | Reward |
| ----------------------------------------- | ------------ | -----: |
| A zone (fog cell) revealed by the Avaia   | the Avaia    |      n |
| A zone (fog cell) walked open             | the Bond     |     3n |
| A monument studied, full description kept | the Avaia    |   4.5n |
| A monument noticed in passing             | the Bond     |     2n |

`n` is `EXPERIENCE_UNIT` in `progression.ts`, currently `10`. Walking a zone
open yourself costs more effort than sending the Avaia, so it pays more; the
Avaia's own study is the one that keeps the archive's full description, so it
pays more than a passing notice. How a zone opens and how a landmark gets
noticed or studied are [Avaia walks the world](avaia-walk.md)'s own; this file
only prices what already happens there.

Chance finds, once they are wired into walking, pay the same way: whoever did
it. The rules live in `awardsFor` (`artifact-contract`); see
[Avaia walks on its own](avaia-outings.md) §3.4.

| Action                      | Who earns it                   |     Reward |
| --------------------------- | ------------------------------ | ---------: |
| A find seen, first sighting | the Avaia or the Bond, who saw |         10 |
| A find picked up            | whoever picked it up           | 10 to 1000 |

The Avaia sees what it walks past, on its own or sent by a tap; the Bond sees
what this device walks past. The Avaia picks up tiers 1 to 3 itself and leaves
tiers 4 to 6 as leads, which pay the Bond when the person walks there and picks
them up. Each find pays its sighting once and its pick-up once. "Once" holds
per history: the find journal stays on the device, and the server sees only
each award's commitment (below), never the find.

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

**Committed experience** (decided as R3 in
[Avaia walks on its own](avaia-outings.md), not built yet). The totals are the
only number a device shows; it never computes a standing of its own. Each
award's id becomes its commitment, `xp:` and an HMAC of the local award record
and the previous commitment, under a Bond key the server never sees. The
server keeps the commitments, a head per device chain (fast-forward only), and
prices each award by its kind instead of taking an amount. The record behind a
commitment — which find, which cell, which landmark — stays on the device.
This stops editing the number on the device; it does not stop a rebuilt client
from inventing awards that follow the rules, so the standing stays this Bond's
report, bounded by per-kind caps.

A device still remembers what it has not managed to publish yet, under
`nilx-one.progression.v3.<owner>`, the same way fog reveals
(`nilx-one.fog.reveals.v1.<owner>`) and the landmark notebook
(`nilx-one.avaia.landmarks.v1.<owner>`) stay on the device. That local copy
is transport-eligible — it may follow a Bond between its own devices — and
that copy is not synced state and not service state (see
[State placement](state-placement.md)). An award is an opaque `xp:` nonce
plus an amount. The nonce is how a retry stays idempotent; it is not a cell,
a landmark, or any other place, and it is not part of the public projection.
Only the totals are. Version 2 (`nilx-one.progression.v2.<owner>`) and version
1 (`nilx-one.progression.v1.<owner>`, less the configuration reward it used to
pay) are offered once as carry: the service keeps the greatest such baseline
and does not add it again. Experience earned after that is the event log, so
two devices playing at once both count.

The **Avaia model downloaded** achievement stays on the device that downloaded
it. It is added to that device's own standing and is not part of `pub_info`.

A level is still not a protocol fact: it creates no Interaction and completes
no BondChain. The service stores the totals the client publishes and
redistributes that report; it does not price an action, derive a level, or
attest the play. See [State placement](state-placement.md): the local copy
stays transport-eligible, and `bond_pub_info` is a separate client-asserted
record. Fog reveals and the landmark notebook stay on the device. What left
the device is the experience the owner says those actions paid.

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
