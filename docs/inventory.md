# Inventory

What the Bond and its Avaia carry, and the Bond's Seeds ₴€£. Every rule is Core's (`docs/economy.md` and `docs/find-items.md` in `nilx-one/core`): what a find is, what fits where, what sells for what, what a craft takes. This client stores Core's answer and shows it.

## Two grids

The Bond and the Avaia each carry a S.T.A.L.K.E.R.-style grid: pockets (5 cells), a backpack (40) or a bag (120). Every thing takes its own rectangle. Both **start with pockets**. Anything bigger has to be owned before it can be worn:

- **xSasha's gift**: once, a backpack each for the Bond and its Avaia, when the Bond's pockets have 4 of 5 cells taken or by Bond level 3 at the latest. She says so in a scene ([xSasha](guide.md), "Backpacks"), and the gift is given whether the scene plays or not.
- **Buying**, under each grid: a backpack for **1,500** and a bag for **5,000** Seeds ₴€£, from the Bond's Seeds, for either of them. Something owned but not worn can be worn again from there. Real money for them comes later, through 0xda-market. On screen the Bond's grid is marked blue and the Avaia's purple, the colours of their experience.

## How things get in

A find goes into its finder's grid when its pick-up award is **kept**, that is, when the service has accepted it (R3 in [Avaia walks on its own](avaia-outings.md)). It goes in once: the journal remembers which finds are already in, however often the award is seen kept. A find that fits nowhere stays where it lay, and a toast says so. Small change is money: it is credited to the Bond, whoever picked it up.

## What a person does with them

**Inventory** (Ukrainian: «Рюкзак»), on the Bond's screen in the Dock, shows both grids and the balance. Tap a thing to:

- **sell** it from the Bond's grid, for Core's price. Things nobody buys say so;
- **hand it across**: from the Avaia to the Bond, or back.

A change Core refuses (no room, not for sale) changes nothing, and the screen says why.

## Crafting

Under the grids, **Craft** lists Core's recipes: what each uses and needs, how long it takes, what it costs and what it pays. Starting one **asks first**: what it uses goes at once, and the thing comes when its time is up (15 to 45 minutes; a legendary craft takes a week). One craft runs at a time, in the background, like a cell opening: it finishes on its own wherever the person is in the app, the thing goes into the Bond's grid, and a toast says so. A craft with no room to land waits until room is made.

Finishing pays the **Bond** the recipe's experience as a committed `craft_finished` award. It names only its recipe, and the service prices it by Core's recipe ([Progression](progression.md)). Player repairs need a **repair workshop**: see below. A legendary craft finished at once for real money will go through 0xda-market, later.

## Repair workshops

A repair workshop is a real place in the basemap, and the Bond has to walk there. These count:

- every electronics repair shop (`electronics_repair`; about 96 in Kyiv's archive) and radio parts shop (`radiotechnics`, about 10);
- a radio market, by its name: Kyiv's «Радіоринок» is a `marketplace` in the archive, and «Дарницький Радіо ринок» an `electronics` shop.

The rule is `features/inventory/workshops.ts`. The map answers through `pointsNear` (`map-contract`), from the `pois` of the tiles the view has loaded. The Bond is **at** a workshop when a real fix of this device (not a declared position) with accuracy of 50 m or better lies within 40 m of one. The Craft section then names it, and Core accepts the repairs (`Place::RepairWorkshop`). Workshops are already labelled on the map, like any named point.

## Where it lives

In the sealed `avaia-finds` journal, as `inventory.state` events: Core's whole stored inventory after each change, plus the find a pick-up put in. The journal's own AES-GCM key seals them, and the wipe that deletes the journal deletes them. Nothing about the inventory reaches the service yet: the Seeds balance and craft times held against a commitment come next.
