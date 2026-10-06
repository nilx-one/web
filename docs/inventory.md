# Inventory

What the Bond and its Avaia carry, and the Bond's Seeds ₴€£. Every rule is Core's (`docs/economy.md` and `docs/find-items.md` in `nilx-one/core`): what a find is, what fits where, what sells for what, what a craft takes. This client stores Core's answer and shows it.

## Two grids

The Bond and the Avaia each carry a S.T.A.L.K.E.R.-style grid: pockets (5 cells), a backpack (40) or a bag (120). Every thing takes its own rectangle. Both start with a backpack. On screen the Bond's grid is marked blue and the Avaia's purple, the colours of their experience.

## How things get in

A find goes into its finder's grid when its pick-up award is **kept**, that is, when the service has accepted it (R3 in [Avaia walks on its own](avaia-outings.md)). It goes in once: the journal remembers which finds are already in, however often the award is seen kept. A find that fits nowhere stays where it lay, and a toast says so. Small change is money: it is credited to the Bond, whoever picked it up.

## What a person does with them

**Inventory** (Ukrainian: «Рюкзак»), on the Bond's screen in the Dock, shows both grids and the balance. Tap a thing to:

- **sell** it from the Bond's grid, for Core's price. Things nobody buys say so;
- **hand it across**: from the Avaia to the Bond, or back.

A change Core refuses (no room, not for sale) changes nothing, and the screen says why.

## Where it lives

In the sealed `avaia-finds` journal, as `inventory.state` events: Core's whole stored inventory after each change, plus the find a pick-up put in. The journal's own AES-GCM key seals them, and the wipe that deletes the journal deletes them. Nothing about the inventory reaches the service yet: the Seeds balance and craft times held against a commitment come next.
