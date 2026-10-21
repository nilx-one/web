# Experience Orbs

**Status:** decided product rule, **not yet implemented**. The live client
still runs the per-find spill described in Core's
[orb spills](https://github.com/nilx-one/core/blob/master/docs/orb-spills.md)
and [Landmark-directed orbs](landmark-directed-orbs.md). The delivery plan is
[`project/exp-orbs-plan.yaml`](project/exp-orbs-plan.yaml).

Experience Orbs ("Exp Orbs") are the experience a Bond and its Avaia pick up
from ground the Avaia opened. This document records the decided rule and how
it differs from what ships today, so neither the product nor the code
silently drifts from the decision.

## The rule

| Rule              | Decided                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| What spills       | **Every fog cell the Avaia opens** spills Exp Orbs, whether or not a find lies in it                  |
| How many          | `5 + 5 × landmarks`: 5 orbs for the cell, plus 5 for each landmark (Pamiatka) in that cell            |
| Who picks up      | Both the Bond and its Avaia, each where it actually is                                                |
| Who earns         | Whoever picks the orb up: the Bond's pick-up pays the Bond, the Avaia's pays the Avaia                |
| What one orb pays | Unchanged: Core's `ORB_EXPERIENCE` (10)                                                               |
| First wins        | Unchanged: the claiming service keeps an orb for whoever reaches it first; a later pick-up is `taken` |

A cell with no landmark spills 5 orbs; a cell with two spills 15.

## What changes against today

Today, a spill belongs to a **find**: any cell the Bond or Avaia opens spills
only the finds inside it, each with 5 to 30 orbs (`orb_count(artifact_id)`),
on a trail toward the find. A cell with no find spills nothing.

The decided rule makes the spill belong to the **cell the Avaia opened**:

- a cell without a find still spills its 5 orbs;
- the count comes from the cell's landmarks, not from a hash of an artifact
  id;
- a cell opened by the Bond on foot or by approach is not an Avaia-opened
  cell and spills no Exp Orbs;
- finds stay what they are: rolled, seen and picked up under their own
  rules. An orb is not a find and does not claim one.

## Ownership

Every orb rule stays Core's, as today. Web only draws Core's answer, reports
where its Bond and Avaia are, and asks the identity service who was first.

- **Core** (`nilx-one/core`): the per-cell spill, `5 + 5 × landmarks`, which
  landmark kinds count, the orb identities, where each orb lies, reach and
  lifetime. A versioned change to `orb_world`, exported through Wasm and
  UniFFI, with the per-find v1/v2 wire kept readable for older hosts.
- **Identity service** (`services/identity`): accepts a cell spill from an
  active Bond, counts its orbs through the same Core rule, stores no more
  than today (no who, no where), and prices `orb_picked_up` for either
  earner first-wins.
- **Web**: spills only on an Avaia reveal, reads the cell's archived
  landmarks, and passes them to Core. It never computes a count itself.

## Open questions

These need an answer before Core fixes the rule; until then they are open,
not implied by this document.

- **Which landmarks count as a Pamiatka.** Proposed: archived `MapLandmark`
  features of the heritage kinds Web already prefers for orb waypoints
  (`monument`, `memorial`, `artwork`, `museum`, `historic`,
  `archaeological_site`).
- **A cap.** A dense city-centre cell can hold dozens of heritage features;
  without a cap one cell could spill hundreds of orbs.
- **Who vouches for the landmark count.** The service cannot see the map
  archive. Either it reads the same published archive, or it accepts a
  host-reported count within a bound; a client-asserted count alone is not
  enough to price experience.
- **Where the orbs lie.** Proposed: the cell's 5 around its centre, each
  landmark's 5 around that landmark, all inside the cell and within reach.
- **How often a cell spills.** Today a find spills once a week. Proposed:
  an Avaia-opened cell spills once per epoch, shared by everyone in it.

## Privacy

Unchanged from today. A spill names a cell and a count, never who opened it
or where anyone stood. An orb is a pick-up intent and presentation, never a
`BondChain` interaction, a Relationship, or proof of presence. Landmarks
guide where orbs lie; reaching one is not evidence of a visit.

---

© 2026 aiaiaiai · aiaiaiai.org
