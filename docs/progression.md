# Progression

A Bond and its Avaia level up by playing: revealing fog, studying what the
Avaia notices along the way, and a few one-time achievements. This is
"прокачка" from what is already local presentation — nothing new asked of
Core or the identity service.

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

## Achievements

An achievement pays once. Where "once" is counted depends on what it is about:

| Achievement            | Counted          | Bond | Avaia |
| ---------------------- | ---------------- | ---: | ----: |
| Avaia configured       | once per account |   20 |     — |
| Avaia model downloaded | once per device  |   50 |   100 |

**Avaia configured** is read from what the identity service already keeps:
an Avaia whose stored state is `configured` has earned it, on every device
that reads it, and none of them has to remember having paid it. It is also
what takes the Avaia to level 1. The device that saves the setup says so in a
dialog — see [Avaia setup](avaia-setup.md).

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

Progression is device-local, the same way fog reveals
(`nilx-one.fog.reveals.v1.<owner>`) and the landmark notebook
(`nilx-one.avaia.landmarks.v1.<owner>`) are. It is kept under
`nilx-one.progression.v2.<owner>`, one Bond's alone. Nothing sends it
anywhere today. The experience is transport-eligible — it may follow a Bond
between its own devices, and that is not synced state and not service state
(see [State placement](state-placement.md)). Version 1
(`nilx-one.progression.v1.<owner>`) carries over as the Bond's own activity,
less the configuration reward it used to pay — that is now the account
achievement above. Reaching a level is not a protocol fact: it creates no
Interaction, completes no BondChain, and Core and the identity service know
nothing about activity experience. Until progression travels, a new device
starts a Bond's activity experience at zero, the same way it starts a new
local fog field and a new local notebook; account achievements are read again
from the service.

## What this is not

This is not a badge shop or a quest system. It is not evidence of presence or
attendance, and it asserts nothing about any Bond. Losing local storage loses
activity experience the same way it loses fog reveals — that is local data
loss, not protocol corruption.

© 2026 aiaiaiai · aiaiaiai.org
