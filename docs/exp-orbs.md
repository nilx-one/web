# Experience Orbs

**Status:** decided product rule, **not yet implemented**. The live client
still runs the per-find spill described in Core's
[orb spills](https://github.com/nilx-one/core/blob/master/docs/orb-spills.md)
and [Landmark-directed orbs](landmark-directed-orbs.md). The delivery plan is
[`project/exp-orbs-plan.yaml`](project/exp-orbs-plan.yaml).

Experience Orbs ("Exp Orbs") are the experience a Bond and its Avaia pick up
from ground that has just opened for that Bond. Experience pays for knowing
the place: new ground, and the landmarks on it. This document records the
decided rule and how it differs from what ships today, so neither the product
nor the code silently drifts from the decision.

## The rule

| Rule              | Decided                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| What spills       | **Every fog cell that opens** for the Bond, whether or not a find lies in it                             |
| Who opens it      | Any opening: the Avaia, the Bond standing in it, or the Bond approaching within 15 m of it               |
| When              | Once, at the moment the cell opens for that Bond                                                         |
| How many          | `5 + 5 × landmarks`: 5 for the cell, plus 5 for each landmark (Pamiatka) in it. No cap                   |
| Who counts        | The identity service, from the published archive, on the cell the device sends it. Nothing is stored     |
| Where             | The cell's 5 scattered around its centre; each landmark's 5 around that landmark                         |
| Who picks up      | Both the Bond and its Avaia, each where it actually is, within 15 m of the orb                           |
| How it feels      | Within reach, the orb is drawn to the picker, with a sound and a light haptic tap where the host has one |
| Who earns         | Whoever picks the orb up: the Bond's pick-up pays the Bond, the Avaia's pays the Avaia                   |
| What one orb pays | Unchanged: Core's `ORB_EXPERIENCE` (10)                                                                  |
| Whose orbs        | The Bond's own. Another Bond never sees them, and they are not shared or claimed against anybody         |

A cell with no landmark spills 5 orbs; a cell with two spills 15. Most cells
hold no landmark or one; only a few cells on the map hold several.

### What a landmark is

A Pamiatka is a **landmark**: the same landmarks the Avaia notices and
describes ([Avaia landmarks from OpenStreetMap](avaia-osm-landmarks.md)),
read from the published map archive, deduplicated by the same rules. Ordinary
shops, cafes and buildings are not landmarks. The orbs lying around a
landmark are there to bring the Bond or its Avaia up to it, close enough to
describe it.

### The service counts, and keeps nothing

Experience is not money, so it has no weekly cap. What keeps it honest is
that the device never states the count:

- when a cell opens, the device sends the cell to the identity service;
- the service reads the cell's landmarks from the same published archive,
  counts them by the same rules, and answers the spill: the count, each orb's
  id and place. It verifies by computing, and stores nothing about the
  request;
- each orb id is a keyed digest the service can recompute from the Bond, the
  cell and the orb's index. A pick-up award names that id, so the service
  checks it without having kept the spill, and the Bond's own award chain,
  which already holds every committed award, turns a second pick-up of the
  same orb into a duplicate.

Asking again for the same cell returns the same orbs, already picked or not.
The service learns the cell only for the moment of the answer; it never
writes it, its landmarks or its count, and an award names its kind, earner
and orb id, never a place.

### Reach and pick-up

An orb is in reach within 15 m of the Bond or the Avaia (`ORB_PICKUP_METERS`,
inclusive). In reach, it is drawn toward the picker and collected with a
sound and a light haptic tap: the Telegram Mini App through its haptic
feedback, the browser through the Vibration API where it exists. iPhone
Safari has no web vibration, so there the pick-up is sound only. Between the
Bond and its Avaia, whichever reaches an orb first picks it up, and it is
gone for the other.

## What changes against today

Today, a spill belongs to a **find**: any cell the Bond or Avaia opens spills
only the finds inside it, each with 5 to 30 orbs (`orb_count(artifact_id)`),
on a trail toward the find. The identity service holds each spill for thirty
minutes, and every Bond near the find sees it; the first Bond to reach an orb
keeps it, a later one gets `taken`.

The decided rule makes the spill belong to **the cell, as it opened for the
Bond**:

- a cell without a find still spills its 5 orbs;
- the count comes from the cell's landmarks, counted by the service, not from
  a hash of an artifact id;
- the orbs lie around the cell's centre and its landmarks, not on a trail to
  a find;
- the spill is private to the Bond: no stored spill on the service, no
  first-wins between Bonds, no `taken`;
- `orb_picked_up` has no weekly cap; an orb id pays once;
- finds stay what they are: rolled, seen and picked up under their own
  rules. An orb is not a find and does not claim one.

## Ownership

Every orb rule stays Core's, as today. Web only draws Core's answer and
reports where its Bond and Avaia are.

- **Core** (`nilx-one/core`): the per-cell spill, `5 + 5 × landmarks`, the
  landmark rules over the archive (so the service and the device agree), the
  orb placement, reach, and the pick-up between the Bond and its Avaia. A
  versioned change to `orb_world`, exported through Wasm and UniFFI, with the
  per-find v1/v2 wire kept readable for older hosts.
- **Identity service** (`services/identity`): answers a cell's spill through
  Core over the published archive, without storing it; prices an
  `orb_picked_up` award for either earner by its orb id, once, without a
  weekly cap.
- **Web**: sends the opened cell, draws the answered spill, reports reach,
  and plays the pick-up's pull, sound and haptic tap. It never computes a
  count itself.

## Privacy

The service learns which cell opened, for the length of one request, and
keeps nothing of it. Another Bond never sees the spill. An award names its
kind, earner and orb id, never a place. An orb is a pick-up intent and
presentation, never a `BondChain` interaction, a Relationship, or proof of
presence. Reaching a landmark's orbs is not evidence of a visit.

---

© 2026 aiaiaiai · aiaiaiai.org
