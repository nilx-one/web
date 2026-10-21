# Experience Orbs

**Status:** decided product rule, **not yet implemented**. The live client
still runs the per-find spill described in Core's
[orb spills](https://github.com/nilx-one/core/blob/master/docs/orb-spills.md)
and [Landmark-directed orbs](landmark-directed-orbs.md). The delivery plan is
[`project/exp-orbs-plan.yaml`](project/exp-orbs-plan.yaml).

Experience Orbs ("Exp Orbs") are the experience a Bond and its Avaia pick up
from ground the Avaia opened for that Bond. This document records the decided
rule and how it differs from what ships today, so neither the product nor the
code silently drifts from the decision.

## The rule

| Rule              | Decided                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| What spills       | **Every fog cell the Avaia opens** for its Bond, whether or not a find lies in it                |
| When              | Once, at the moment the cell opens for that Bond                                                 |
| How many          | `5 + 5 × landmarks`: 5 for the cell, plus 5 for each landmark (Pamiatka) in it. No cap           |
| Where             | The cell's 5 scattered around its centre; each landmark's 5 around that landmark                 |
| Who picks up      | Both the Bond and its Avaia, each where it actually is                                           |
| Who earns         | Whoever picks the orb up: the Bond's pick-up pays the Bond, the Avaia's pays the Avaia           |
| What one orb pays | Unchanged: Core's `ORB_EXPERIENCE` (10)                                                          |
| Whose orbs        | The Bond's own. Another Bond never sees them, and they are not shared or claimed against anybody |

A cell with no landmark spills 5 orbs; a cell with two spills 15. Most cells
hold no landmark or one; only a few cells on the map hold several.

### What a landmark is

A Pamiatka is a **landmark**: the same landmarks the Avaia notices and
describes ([Avaia landmarks from OpenStreetMap](avaia-osm-landmarks.md)),
read from the published map archive, deduplicated by the same rules. Ordinary
shops, cafes and buildings are not landmarks. The orbs lying around a
landmark are there to bring the Bond or its Avaia up to it, close enough to
describe it.

### The cell is the Bond's own

Whether a cell is open, and when it opened, is information of that one Bond
only. So the spill is too:

- it happens on the device, when the cell opens for that Bond, once;
- no service learns which cell opened or which landmarks lie in it;
- the Bond and its Avaia share the cell's orbs between them: whichever of the
  two reaches an orb first picks it up, and it is gone for the other.

## What changes against today

Today, a spill belongs to a **find**: any cell the Bond or Avaia opens spills
only the finds inside it, each with 5 to 30 orbs (`orb_count(artifact_id)`),
on a trail toward the find. The identity service holds each spill for thirty
minutes, and every Bond near the find sees it; the first Bond to reach an orb
keeps it, a later one gets `taken`.

The decided rule makes the spill belong to **the cell, as the Avaia opened it
for its Bond**:

- a cell without a find still spills its 5 orbs;
- the count comes from the cell's landmarks, not from a hash of an artifact
  id;
- the orbs lie around the cell's centre and its landmarks, not on a trail to
  a find;
- the spill is private to the Bond: no shared spill on the service, no
  first-wins between Bonds, no `taken`;
- finds stay what they are: rolled, seen and picked up under their own
  rules. An orb is not a find and does not claim one.

## Ownership

Every orb rule stays Core's, as today. Web only draws Core's answer and
reports where its Bond and Avaia are.

- **Core** (`nilx-one/core`): the per-cell spill, `5 + 5 × landmarks`, the
  orb identities, where each orb lies, reach, and the pick-up between the
  Bond and its Avaia. A versioned change to `orb_world`, exported through
  Wasm and UniFFI, with the per-find v1/v2 wire kept readable for older
  hosts.
- **Identity service** (`services/identity`): prices an `orb_picked_up`
  award for either earner, as it prices any committed award: on top of its
  chain, under the week's cap for its kind. It is never told the cell, the
  landmarks or the count.
- **Web**: spills on an Avaia reveal, reads the cell's landmarks from the
  archive it already holds, and passes them to Core. It never computes a
  count itself.

## Open questions

- **Who vouches for the landmark count.** Not decided. Recommended: nobody
  beyond the device. A service that checked the count would have to learn
  the cell, which the rule above forbids. Core derives the count
  deterministically from the published archive; what one Bond can earn
  from orbs stays bounded by the service's weekly cap for `orb_picked_up`.
- **A cell the Bond opens itself.** The rule names cells the Avaia opens.
  Whether a cell the Bond opens on foot or by approach also spills is not
  decided; until it is, it does not.

## Privacy

A spill exists only on the Bond's device. No service learns which cell
opened, which landmarks are in it, or where an orb lay; an award names its
kind and earner, never a place. An orb is a pick-up intent and
presentation, never a `BondChain` interaction, a Relationship, or proof of
presence. Reaching a landmark's orbs is not evidence of a visit.

---

© 2026 aiaiaiai · aiaiaiai.org
