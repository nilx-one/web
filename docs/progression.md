# Progression

A Bond levels up by playing: revealing fog, and studying what its Avaia
notices along the way. This is Phase 1 of "прокачка" — experience earned
from what is already local presentation, nothing new asked of Core or the
identity service.

## What earns experience

| Action                                     | Who did it | Reward |
| ------------------------------------------- | ---------- | -----: |
| Configuring an owned Avaia (one-time)       | the owner  |     40 |
| A zone (fog cell) revealed                  | the Avaia  |      n |
| A zone (fog cell) revealed                  | the owner  |     3n |
| A monument studied, full description kept   | the Avaia  |   4.5n |
| A monument noticed in passing               | the owner  |     2n |

`n` is `EXPERIENCE_UNIT` in `progression.ts`, currently `10`. Walking a zone
open yourself costs more effort than sending the Avaia, so it pays more (`3n`
against `n`); the Avaia's own study is the one that keeps the archive's full
description, so it pays more than a passing notice (`4.5n` against `2n`).
Something is always more worth doing yourself, and something else is always
more worth handing to the Avaia — the table is deliberately asymmetric both
ways.

Configuring an owned Avaia — the explicit setup save described in
[`avaia-setup.md`](avaia-setup.md) — pays exactly what level 1 costs, so it
is what takes a fresh Bond there outright. It pays once: a later save that
only changes the address again does not pay twice.

## Level 0 to 1

A Bond starts at level 0. Forty experience reaches level 1
(`LEVEL_ONE_EXPERIENCE`). **Not yet:** no level past 1 is designed. Total
experience keeps accumulating past 40, but the level stays 1 until a curve
for what comes after is decided — this file does not guess one.

## Where it lives

Progression is device-local, the same way fog reveals
(`nilx-one.fog.reveals.v1.<owner>`) and the landmark notebook
(`nilx-one.avaia.landmarks.v1.<owner>`) are. It is kept under
`nilx-one.progression.v1.<owner>`, one Bond's alone, and it is never synced,
exported, or sent anywhere. Reaching level 1 is not a protocol fact: it
creates no Interaction, completes no BondChain, and Core and the identity
service know nothing about it. A new device starts a new Bond's progression
at zero, the same way it starts a new local fog field and a new local
notebook.

## What this is not

This is not an achievement system with badges, quests, or a shop. It is not
evidence of presence or attendance, and it asserts nothing about any Bond.
Losing local storage loses this the same way it loses fog reveals — that is
local data loss, not protocol corruption.

© 2026 aiaiaiai · aiaiaiai.org
