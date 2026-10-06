# Avaia walks on its own: outings and chance finds

Implementation plan, version 2. It replaces `avaia_finds — phase 1`, in which walking only served the finds and the finds came first. Here it is the other way round: **first the Avaia learns to walk around the city, and only then, along the way, does it find things.** Its walking today is described in [Avaia walks the world](avaia-walk.md): moving on a tap and curiosity about landmarks already noticed. This document adds outings of its own, routes and finds.

Status: **plan**, partly built. The walking graph and router (§0.6), walking along paths (§0.7), the outing menu (§1.3), the drive (§2.4), the find rolls (§3.3a), reading road tiles ahead (§0.5) and the landmark mapper for the archive's confirmed kinds (§1) are implemented, and R1 and R2 are decided; the rest is not yet. The values in the tables are starting values, tuned on live walking.

## Goal

- The Avaia decides on its own "I'll go for a walk" and actually leaves home for the city, rather than just showing a line about it.
- It walks through parks, along lake shores, past churches and monuments. These are **outing targets**.
- Along the way it "happens" upon small things. These are **finds**, and they are secondary. They are not on the map; they appear when the Avaia comes close.
- The person can point at a point B at any moment. The Avaia goes there, stands, and then carries on walking by itself.

## Invariants

Kept from phase 1:

- The Avaia does not write `bch`. No find, outing or line becomes a chain record.
- The model has no write tools. Only the engine writes.
- The model does not see lat/lon, `pub_dress`, `private_id`, or cell and segment ids. It sees only labels from a closed vocabulary.
- There is no chat: the person acts by tapping.
- Inference is local, the weights are served from `nilx.one`, and there is no telemetry.
- The finds pack has no brands, and no names or addresses of real people or businesses. Every name is invented or generic.
- Walking does not move the camera. [Camera coordination](camera-coordination.md) hands the camera to the person after any gesture, and an outing does not change that.

Changed:

| Was                                   | Becomes                                                     | Why                                                                                        |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| the Avaia walks only on lit cells     | **kept** (R1 decided, see below)                            | a target behind the fog is a reason to open it, not cross it                               |
| finds are local only, with no server  | local, except a claim for tiers 4–6 and the experience (R3) | a rare find is one for the whole city; a server-held number cannot be edited on the device |
| the Avaia walks on a fake `WorldPort` | it walks on a pedestrian graph built from tiles             | without a route, an outing cuts through buildings                                          |

## §0 How the Avaia walks: paths by default, grass when needed

This is the foundation of everything. The other sections build on it.

### 0.1 The rule

The Avaia **keeps to a pedestrian line whenever it can** (a footway, a trail, a pedestrian street). Grass is not forbidden. It is an allowed but dearer choice. With no pedestrian line nearby, the Avaia walks on the grass.

### 0.2 When it steps off the path

Exactly four cases:

| Reason                   | Condition                                                                           | Limit                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **no line**              | the nearest graph node is more than 30 m from the target, or there is none          | walk to the target by the shortest passable way                        |
| **an artifact on grass** | the Avaia noticed a find within its perception radius (15 m)                        | leave the path by up to 25 m to the side, then return to the same line |
| **it is easier**         | a cut across the grass shortens the route by at least 35 % and is at most 60 m long | only for a cut between two graph nodes                                 |
| **the person tapped**    | a tap on a point B                                                                  | anywhere passable, see §0.4                                            |

### 0.3 Edge weights

The router is a pure function over the graph, not state. The weight is the cost of one metre:

| Surface                        | Weight                       |
| ------------------------------ | ---------------------------- |
| pedestrian, footway, path      | 1.0                          |
| track, park service road       | 1.3                          |
| street with a sidewalk         | 1.5                          |
| carriageway without a sidewalk | 3.0                          |
| grass (a cut between nodes)    | 4.0                          |
| arterial road                  | only at a crossing           |
| steps, bridges                 | allowed, weighted separately |
| building, water, fog (see R1)  | impassable                   |

Grass is dear, so the Avaia does not go onto it without a reason, and the four reasons in 0.2 are that same weight, outweighed by a local gain (an artifact, a shortcut) or switched off by hand (a tap).

### 0.4 Point B: the person's tap

- A tap on passable ground gives the Avaia a target B. It goes there by the cheapest way, and grass is allowed the whole way, because the person decided.
- On arrival the Avaia **stands** for about 20 s (`turn_in_place`, looking around), and then **returns to autonomy from point B**, not from home. Whether to go home is the drive's decision (§2).
- A new tap while walking or standing picks the movement up from wherever the Avaia is now. This matches the current rule in [Avaia walks the world](avaia-walk.md).
- A tap on a building, water or fog is refused the same way as today (`building`, `water`, `fog`), with the same refusal line.
- During a walk the person sent it on, finds are rolled the same way as on its own (§3). Manual walking does not get round the rarity rules.

### 0.5 What this needs from the infrastructure

- **A pedestrian graph** from the tiles' `roads` layer. A `walk-graph` package (a pure function, zero dependencies, tests on fixed tile fragments). Nodes, edges, the weights from 0.3, snapping a point to the nearest node.
- **Tile boundaries.** `landmarksNear` reads only what is already loaded. For an outing radius of a few km, the renderer reads tiles ahead from our own host (`preloadRoads`, #312). Before an outing it reads the `roads` layer at z14 within the outing's budget. That is at most 32 tiles, and the oldest are dropped first. Tiles with no open ground are not fetched. These network requests are described in [map data](map-data.md) ("Reading roads ahead").
- **Data quality.** The park path layer may be incomplete, and sidewalks along streets are usually not separate lines: on streets the Avaia walks along the centre line. A check on the city's real archive: the share of parks whose paths connect to a street. If it is small, a park becomes a target to "walk up to the edge of" rather than "walk around inside".
- **Tap-to-walk** can use the router too, and straight lines through buildings will go away. This is a separate step after §0, to keep §0 small.

### 0.6 Already built: the `walk-graph` package

`packages/walk-graph` is a pure function with no dependencies. It does not read tiles itself: its input is `roads` features (`kind`, `kind_detail`, `is_bridge`, lines) already read from loaded tiles. The renderer adapter and reading tiles ahead are the next steps (#300, #312).

- `buildWalkGraph`: nodes, edges, lengths, surfaces. The same features in any order give the same graph, numbering included.
- **Tile boundaries.** A line clipped by the buffers of two tiles is stitched back together: a loose end within 1 m of another line merges with its node or splits its segment. A real dead end farther than 1 m stays a dead end.
- **Surfaces.** The archive carries no sidewalks, so the table in 0.3 is approximated: `path` (footway, path, pedestrian) 1.0, track/cycleway 1.3, steps 2.0, minor/medium road 1.5 "street", major road 3.0 "carriageway". A `highway` is never walked along, only crossed at a shared node. Rail and ferries are not walked. Bridges keep the weight of their surface and a `bridge` flag.
- `snapToGraph`: the nearest point **on an edge** (not only on a node) within 30 m, otherwise "no line".
- `routeOnGraph`: Dijkstra over weighted metres. Deterministic, ties broken by node index. `canEnter` cuts off nodes that may not be entered (fog under R1); it is checked per node, not along edges.
- The graph does not build grass connectors (weight `GRASS_WEIGHT`, 4.0): whoever calls the router draws them (#300).
- Coordinates and indices do not leave routing. The model does not see them.

### 0.7 Already built: walking along paths

The renderer answers `roadsWithin(bounds)` from tiles already loaded, and `planWalk` in `product-app` puts the way together: grass to the nearest line (within 30 m), the graph, grass to the target. Grass legs go around buildings and water with the same `planRoute` as before.

- **The person's tap** (`tap`): grass is allowed the whole way, so the cheaper of the two is taken: along the paths or straight across at `GRASS_WEIGHT`.
- **The Avaia on its own** (`own`, curiosity): it keeps to the paths and cuts across the grass only when the cut is at least 35 % shorter and no longer than 60 m. The cut is counted for the whole way, not between two nodes.
- With no line within 30 m, or no tiles yet, the Avaia goes straight across, as before.
- Fog along the way is checked under R1: see "R1: open ground only".
- The "artifact on grass" case arrives with the finds (§3).

## §1 Outing targets

Targets are **what is on the map**: parks, lakes, churches, monuments. Finds from §3 are not targets.

| Kind                              | Source                                 | Missing today                          |
| --------------------------------- | -------------------------------------- | -------------------------------------- |
| monument, memorial, museum, ruins | `pois`, `LANDMARK_KINDS`               | already there                          |
| church, place of worship          | `pois` (check the kind in the archive) | not in `LANDMARK_KINDS`                |
| park, garden                      | `pois` or `landuse` (to check)         | missing                                |
| lake, pond, embankment            | `water` (polygon)                      | missing; landmarks are only pois today |

### 1.1 More OSM landmarks

> The canonical vocabulary of kinds and groups lives in [Avaia landmarks from OpenStreetMap](avaia-osm-landmarks.md). Where the lists below differ from it, it wins. The differences at the moment: there `ruins` and `historic_building` are in `walk_target` and `information` is in `micro_interest`, `shrine` and `cross` stand in place of `wayside_shrine` and `wayside_cross`, and `bench` is added. The application also reads the Protomaps archive's layers, not raw OSM tags, so the tag columns below mean where a kind comes from, not fields to read.

The four base classes are not meant to be the full vocabulary. OpenStreetMap stays the source, but raw OSM tags are normalized into a small closed `landmark_kind` vocabulary. That lets new types be added without the model ever seeing an open set of tags.

#### Outing targets

Objects worth changing the route for:

| Type                  | OSM tags                                 | Role                                       |
| --------------------- | ---------------------------------------- | ------------------------------------------ |
| viewpoint             | `tourism=viewpoint`                      | a strong urban or natural target           |
| nature reserve        | `leisure=nature_reserve`                 | a large natural target                     |
| beach                 | `natural=beach`                          | a natural target                           |
| peak / hill           | `natural=peak`, `natural=hill`           | an outdoor target                          |
| castle                | `historic=castle`                        | a historic target                          |
| fort                  | `historic=fort`                          | a historic target                          |
| archaeological site   | `historic=archaeological_site`           | a historic target                          |
| historic ruins        | `historic=ruins`                         | a historic target                          |
| historic building     | `historic=building`                      | a historic target, when significant enough |
| museum                | `tourism=museum`                         | a cultural target                          |
| theatre / arts centre | `amenity=theatre`, `amenity=arts_centre` | a cultural target                          |

#### Landmarks along the route

Objects that can justify a small deviation, but not necessarily a whole outing:

| Type              | OSM tags                                   | Role                                                  |
| ----------------- | ------------------------------------------ | ----------------------------------------------------- |
| public artwork    | `tourism=artwork`                          | sculpture, mural, installation                        |
| fountain          | `amenity=fountain`                         | an urban landmark                                     |
| tower             | `man_made=tower`                           | a vertical landmark                                   |
| bridge            | `man_made=bridge`                          | a route landmark, especially a historic or iconic one |
| spring            | `natural=spring`                           | a natural micro-landmark                              |
| rock              | `natural=rock`                             | a natural landmark                                    |
| viewpoint         | `tourism=viewpoint`                        | a landmark with raised priority                       |
| wayside shrine    | `historic=wayside_shrine`                  | a small historic landmark                             |
| wayside cross     | `historic=wayside_cross`, `man_made=cross` | a small historic landmark                             |
| information point | `tourism=information`                      | a place to read about the area                        |

#### Small outdoor landmarks

They should not become drive targets automatically, but they can be part of a route's local interest:

- `tourism=picnic_site` — a picnic spot;
- `tourism=camp_site` — a campsite;
- `leisure=bird_hide` — a bird-watching hide;
- `man_made=cairn` — a stone landmark or marker;
- `natural=tree` — a single tree, only with an extra sign of significance.

#### Normalization

Not every OSM object becomes a landmark. The recommended pipeline:

```text
OSM object
  → source-specific tag matching
  → normalized landmark_kind
  → accessibility / walkability filter
  → significance / geometry filter
  → walk target OR route landmark OR micro interest
```

Recommended closed groups:

```text
walk_target
  park
  lake
  nature_reserve
  viewpoint
  beach
  peak
  castle
  fort
  archaeological_site
  museum
  major_monument

route_landmark
  church
  monument
  artwork
  fountain
  bridge
  tower
  ruins
  historic_building
  spring
  wayside_shrine
  wayside_cross
  information

micro_interest
  picnic_site
  camp_site
  bird_hide
  cairn
```

`landmark_kind` is a 0x1 semantic layer, not a copy of the OSM taxonomy. One OSM object may carry several tags, but for the Avaia it has one normalized type with a defined precedence.

- A `walk_target` may enter the `DecisionMenu` as an outing target.
- A `route_landmark` may cause a local route deviation within the rules of §0.2.
- A `micro_interest` does not become a target of its own without extra logic.
- Ordinary shops, cafes, banks, offices and other everyday POIs do not become landmarks just by being in OSM. They are a separate layer of city infrastructure.
- `building=*` alone is not a landmark. Being historic, or any other significance, has to be stated explicitly by the archive's tags or data.

Each new kind is added only after checking that the tag really occurs in the OSM archive in use. `inspect-basemap.sh` has to show the actual kinds and tags, not assumptions about them.

### 1.2 Filtering OSM data

OSM is the source of geometry and semantics, but it does not by itself decide what the Avaia should visit. Before reaching the `DecisionMenu`, an object goes through:

1. tag mapping → `landmark_kind`;
2. a geometry/type check;
3. a pedestrian accessibility check;
4. a check that it connects to the walk graph;
5. a significance check for its group.

A target with no route (more than 30 m from the graph and unreachable across the grass) **is not offered to the drive**. `water` polygons, buildings and other impassable objects do not turn into walking points just because they carry an interesting tag.

- Each target is added only after checking that it is in the real archive. `inspect-basemap.sh` is there for that, and it already fails when no kind occurs at all.
- The "park, lake, church" axis is not fixed. Order, length and number of stops are decided by the drive within its distance budget.
- "Studying" a target keeps today's landmark mechanics: what the Avaia learns is exactly what the archive declares for the object.

### 1.2a Already built: normalization

`landmark-normalize.ts` in `product-app` turns the mapper's candidates into landmarks by the rules in [Avaia landmarks from OpenStreetMap](avaia-osm-landmarks.md): one kind per object, significance (a named walk target, a park of at least 1 ha, a historic building only with an explicit historic attribute, major versus small monuments), malformed geometry rejected, and duplicates collapsed. Its output feeds the outing menu through `outingCandidates`. The mapper itself is #306.

### 1.3 Already built: the outing menu

`outing-targets.ts` in `product-app` is a pure function, `outingMenu`. Its input is normalized candidates from the mapper (#306), the graph, the Avaia's position, open ground (R1) and a budget in metres.

- Only the `walk_target` group from the [mapping](avaia-osm-landmarks.md) enters the menu, and only named targets. A church is a `route_landmark` in the canonical vocabulary, so it does not become an outing target. Finds are never targets.
- Arrival is not a centroid but an anchor, by the mapping's rules. For a point, the nearest place on the graph within 30 m. For a park or a reserve, the cheapest node inside it or within 30 m of its edge. For a lake or a beach, the cheapest node outside the polygon and within 30 m of the shore.
- A target the graph does not reach over open ground, or one beyond the budget, stays off the menu. One `reachFrom` pass in `walk-graph` prices every node. The pass stops at the budget × the dearest surface weight (3.0): no node whose way is shorter than the budget costs more than that.
- The menu is "stay", up to 4 targets, and "wander nearby". Targets go nearest first, one of each kind before a second of any. The same input in any order gives the same menu.
- **Without a model**, `chooseByRule` picks the nearest target, wanders when there are no targets, and stays when there is no graph either. The drive's weights (tiredness, restlessness, time of day) come with #302.
- **With a model**, it sees only `menuForModel`: an index, a closed label (`stay`, `wander` or a target kind) and `near`/`far` (up to 1 km, or farther). It sees no coordinates, names or ids. `chooseByModel` takes only an index on the menu and hands anything else to the rule.

## §2 The drive: "I'll go for a walk"

What the Avaia actually does is decided by **code**. The model only talks and, behind a flag, picks from a ready-made menu.

### 2.1 State

- `restlessness` grows while the Avaia stands still. An outing resets it.
- `curiosity` grows while there are unvisited targets nearby. It drops after a visit.
- `energy` is spent on kilometres and restored at home.
- Time of day and season weigh the choice (a park by day, a short walk in the evening).
- "Home" is the cell where the Avaia rests while it is not going anywhere: by default the cell with the person's longest visits in the journal, and without one, the last observed position. This is computed locally and never leaves the device.

### 2.2 The decision

```text
code computes the menu: [stay, park A, lake B, church C, wander nearby] with weights
        │
        ├─ without a model:  a utility rule picks the highest weight
        └─ with a model:     DecisionMenu, the model picks from the menu, not from open space
                             (an invalid pick → the rule)
```

- The model does not build a route and does not see coordinates. It picks one item from a list already filtered by §1.
- A 0.6b model that picks from 4–6 ready options is realistic. A 0.6b model that builds a route is not.
- Without a model the Avaia walks just the same, only without "character" in its choices. This follows the phase 1 principle: the model is an add-on, not a dependency.
- "I'll go for a walk" and similar lines are templates in the study's voice (`avaia-lines.ts`). A line the model generates stays text and is not voiced: voicing belongs only to the recorded fixed lines ([Character voices](avaia-voice.md)).

### 2.3 When it starts

- Autonomous walking switches on when the Avaia is "at the wheel" and doing nothing (just as curiosity does today), no more often than `AVAIA_OUTING_INTERVAL_MS` (starting value: 4 h).
- A tap always takes priority over the drive.
- **While the page is closed, the Avaia does not walk.** This keeps today's "Nothing walks in the background". An option for later: on opening, run a deterministic route and show the outcome ("it already went out and came back"), the way the fog reveal does on the wall clock. Not part of this plan.
- Each walk starts from where the Avaia is now. If it went to a point B, the next outing starts from there.

### 2.4 Already built: the drive

`outing-drive.ts` in `product-app` is a pure, deterministic state machine. The walk hook feeds it events and asks what to do next.

- **States:** `idle`, `walking` (purpose: `tap`, `curiosity`, `outing`, `wander`, `home`) and `standing` (`point_b` or `visit`).
- **Transitions:**
  - a tap, in any state, starts a walk there from wherever the Avaia is;
  - a drive walk starts only from `idle` and never cuts short a walk, a stand at B or a visit;
  - arriving at B is a 20 s stand, then `idle` at B; the Avaia does not go home;
  - arriving at a target is a 30 s look around and a "visited" mark;
  - arriving home restores full energy;
  - a walk that did not arrive, or a stand cut short because the Avaia left the wheel, becomes `idle` where it stands.
- **When to go out:** `restlessness` builds over 10 min of idling, and an outing comes no more often than once in 4 h (`nextOutingAt`). The time of the last outing is kept in `world-memory`, so a reload does not reset the interval.
- **Energy:** 0.2 per kilometre, so a full charge lasts 5 km. An outing's budget is a there-and-back on what is left, but never beyond 3 km.
- **Choice** (`chooseOuting`): tired and far from home, go home. In the evening and at night (20:00–07:00), only a target within 1 km, or wander. By day, the nearest target, otherwise wander, otherwise stay. A target visited less than a week ago stays off the menu. With the Avaia's feelings at hand, the most wanted target wins instead of the nearest, a loved one waits a day rather than a week, and a visit lasts by what is done there ([Favourite places](avaia-walk.md#favourite-places)).
- **Wandering:** a graph node 150–400 m away along the paths, over open ground. It is picked deterministically per outing window.
- **Home** is, for now, the device's last observed position. The cell with the longest visits from the journal comes separately.
- **Lines:** for an outing the Avaia uses the existing `walk` line. There are no "I'll go for a walk" lines yet, because they need to be recorded.
- The mapper (#306) supplies candidates from the landmarks the map has loaded: museums, viewpoints, castles, forts, ruins, archaeological sites and significant monuments. Parks and lakes wait for their archive source to be confirmed ([Avaia landmarks from OpenStreetMap](avaia-osm-landmarks.md#implemented)).

## §3 Finds

### 3.1 What a find is

A find is a deterministic function of a **route segment** and an epoch, not of a cell. A res 9 cell is ~350 m across, and "came close" does not work there.

- A segment is ~50 m of a graph edge.
- Seed: `xmur3(pack.id + ':' + pack.version + ':' + epoch + ':' + segmentId)`, then `mulberry32`. The hash is not cryptographic, because there is nothing to protect.
- `epoch` changes once a week. Otherwise the street by home could be "solved" for good.
- A candidate lies up to 25 m to the side of the edge, so some finds end up on the grass and justify stepping off the path (§0.2).
- A find is not marked on the map. It appears when the Avaia comes within 15 m.
- **Determinism is a natural anti-farm:** walking the same segment a second time in the same epoch, the Avaia gets nothing new. The planner (§2) gives a small bonus to segments it has not walked for a while, and that alone makes outings more varied.

### 3.2 Tiers and experience

Experience 10–1000. Distance is what the Avaia walked along the graph. Tier 6 drops **once in 100 km**.

| Tier | Experience | Per km | Once in    | Example                          |
| ---- | ---------- | ------ | ---------- | -------------------------------- |
| 1    | 10         | 0.25   | 4 km       | a thrown-away cassette, a record |
| 2    | 25         | 0.12   | 8 km       | an old tape recorder             |
| 3    | 60         | 0.06   | 17 km      |                                  |
| 4    | 150        | 0.03   | 33 km      |                                  |
| 5    | 400        | 0.018  | 55 km      |                                  |
| 6    | 1000       | 0.01   | **100 km** | something truly exclusive        |

Altogether about one find per 2 km and ~30 experience per km. The tiers' combined probability is split into levels, each with its own pool of archetypes in the pack. Tier 6 is not out of reach: the Avaia can come across one on its first day, it is just unlikely.

### 3.3 Pack, vocabulary, placement

The phase 1 mechanics stay: a closed `VOCABULARY`, weighted archetypes, `pick` by vocabulary, a golden test. What changes is the unit of placement (a segment instead of a cell), and archetypes gain a `tier` field. The `artifact-contract` package adds:

```ts
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;
export type ArtifactId = `art:${SegmentId}:${EpochId}:${PackVersion}:${Slot}`;
```

The vocabulary, validator and template narrator from phase 1 are taken unchanged. The pack stays invented and brand-free.

### 3.3a Already built: rolls (`artifact-contract`)

`packages/artifact-contract` is a pure function with no dependencies: `rollSegment`, `rollAlong`, `segmentsAlong`, `epochOf`, and the `ROLL_TABLE` (version 1, the tiers and rates from 3.2).

- **A segment is a cell of a fixed ~50 m grid, not a graph edge.** Edges depend on which tiles are loaded: buffer clipping adds nodes, and the same stretch of street would be cut differently on different devices. The grid is defined in degrees without trigonometry, so every device cuts it the same way. Columns are scaled for Kyiv's latitude.
- One uniform draw per segment, from the rarest tier down: a tier's chance = its rate × 0.05 km. One find per segment, `Slot` = 0.
- `epochOf` turns over on Monday at 00:00 UTC.
- A find has no coordinates: `placement` is a fraction along the walk through the segment and an offset to the side in fractions of 25 m. Whoever draws the walk lays it on the walk.
- `segmentsAlong` walks the grid exactly (Amanatides–Woo): every cell a walk passes through, even for half a metre near a corner, gets its roll. Through an exact corner the walk steps diagonally, and the neighbouring cells it only touches at a point are not counted.
- A tap walk and an autonomous walk go through the same `segmentsAlong`, so manual walking does not get round the rarity.
- Changing the table, the grid or the seed changes the golden test and must raise `ROLL_TABLE.version`.
- The pack (archetypes, names), writing to the journal, and who earns the experience (R2) are not part of this.

### 3.4 "Saw it, but didn't pick it up"

- The Avaia sees a tier 4–6 find and **does not pick it up**. It keeps a **lead**: the segment, the epoch and the tier, without exact coordinates.
- The person sees the lead, takes the wheel, physically walks to the segment and picks the find up. The pick-up experience goes to the Bond (R2).
- **R2, decided: whoever does it gets the experience.** Seeing a find pays 10 experience to whoever saw it first: the Avaia if it was walking on its own or sent by a tap, the Bond if this device walked past. Picking it up pays the tier's experience (10–1000) to whoever picked it up. The Avaia picks up tiers 1–3 itself and leaves tiers 4–6 as leads for the person. Each find pays for being seen and for being picked up exactly once, so repeating an event or the journal does not multiply experience. Picking up a find nobody has seen yet counts as seeing it too. The rules are `awardsFor` and `canPickUp` in `artifact-contract`.
- Tiers 4–6 are **claimed**: the first Bond to pick up a find keeps it, and anyone after gets "oh crap!". Tiers 1–3 stay personal: every Bond picks up its own. See "R3: experience on the server, history on the device".
- Leads, like finds, do not become `bch` and are not written to the presence journal.
- **How a lead lives** (`leads.ts` in `artifact-contract`, #305):
  - only a find the Avaia sees and may not pick up (tiers 4–6) becomes a lead; one it may pick up never does;
  - a lead keeps the minimum: the `artifactId`, its segment, epoch and tier, and when it was seen. No coordinates, no names;
  - seeing the same find again is no new lead: the first sighting stands;
  - a lead lives until its epoch ends, because next week the segment rolls anew and the find is gone;
  - picking the find up closes the lead;
  - at most 12 leads are kept; past that, the oldest sighting goes first.

## §4 The finds journal

Kept from phase 1: an append-only `avaia-finds` store, AES-GCM-256 with a non-extractable key, `resolveJournalKey`, a write after the fact is complete, folding on read (`foldFinds`). `FindRecord` changes:

```ts
export interface FindRecord {
  readonly walkId: string;
  readonly segment: SegmentId;
  readonly epoch: EpochId;
  readonly artifactId: ArtifactId;
  readonly tier: Tier;
  readonly archetype: string;
  readonly noun: { readonly lemma: string; readonly gender: Gender };
  readonly properties: readonly ArtifactProperty[]; // a snapshot, not a reference
  readonly packVersion: number;
  readonly foundAt: number;
  readonly pickedUp: boolean; // false for a lead
}
```

- The new `avaia-finds` database **is added to `world-wipe.ts`**, which today deletes only `nilx-presence`. Otherwise "wipe the world" leaves the finds orphaned.
- `state-placement.ts`: finds and leads are `sealed-transport`: they stay on the device and travel only device to device, directly (R3). They never reach the service.

## §5 Narrative and surface

- The narrative layer **extends the existing** `narration-contract`, `narration-templates` and `narration-webllm` (the model catalogue, mirror, `faithfulness`). The contract adds a new kind of evidence next to `"visit"`. No new `avaia-narrate` and no direct `@mlc-ai/web-llm` are needed.
- Outing lines ("I'll go for a walk", "I'll drop into the park") and find lines ("found a bottle cap") come from the study's voice. The template is the reference: the model only rephrases, and the validator rejects a line that names a property the find does not have.
- **Surface:** a tap on the ground now belongs to the Avaia, and the raw journal panel no longer opens. "The Avaia saw" is not a separate block under the visits but a line on its card. The list of finds and the leads appear on the Avaia's screen in the Dock, next to "Landmarks studied".

## R1: open ground only

Decision: **the Avaia walks only on open ground. The person opens the fog, by tapping a cell that borders open ground.** This is the existing fog reveal mechanic ([Avaia walks the world](avaia-walk.md), "Revealing the fog"): cells at the edge of open ground are marked with a dashed outline, the question "open it?" is asked, and the Avaia walks up to the cell's edge from the open side and opens it. The Avaia neither opens fog by itself nor walks through it.

Open ground:

- cells opened by the presence journal or by a fog reveal;
- the cell the Bond stands in, and the ground within 50 m of the device (a Bond is never in the fog);
- the cell the Avaia stands in now, so it can always walk out of where it is.

While no fog is drawn (the journal is loading or failed to load), everything is open, as today.

What this means for the code:

- **Route** (`planWalk`): the graph does not enter nodes in the fog, and a planned way is checked every 10 m, because a long edge or a grass leg can cut the corner of a fogged cell. If every way passes through fog, the walk is refused as `fog`, with the same line as a tap into the fog.
- **Curiosity** passes over landmarks standing in the fog: they wait until their ground is opened.
- **Outing targets** (§1, #301): only targets with a way over open ground enter the drive's menu. A park behind the fog is not a target but a reason to show the person which cell to open.
- **Reading tiles ahead** (§0.5, #312) is limited to open ground and its edge: an outing does not need tiles behind the fog.
- **The fog reveal** does not change. If the cell's edge cannot be reached over open ground, the Avaia stays put and the reveal runs on its timer, as today.

## R3: experience on the server, history on the device

Decision: **the server holds the experience of the Bond and of its Avaia, a commitment to the history that earned it, and a claim on every rare find picked up. The history itself (finds, leads, opened cells, the notebook) stays on the device, travels only device to device, and never reaches the server.**

The model is a commit and its sha. The record of an award is the commit: it is kept on the device. The server keeps the sha and the number. A rare find is the one exception that is shared: which find it was and who picked it up.

### What the server holds

- per Bond, the two totals (Bond and Avaia), as today in `bond_pub_info`;
- per award, its commitment, the earner, the kind, the tier for a pick-up, and the amount the server priced it at. The commitment is the award's id, so it replaces today's random `xp:` nonce;
- per device chain, the head: the last commitment it accepted and the chain's length;
- per claimed find (tiers 4–6), its `artifactSha`, its epoch and tier, and the Bond that picked it up.

### On the wire

An award is sent as its commitment, its `parent`, its chain, its kind and its earner, and for a pick-up its tier. **It never carries an amount.** The server prices it from its own table (`awardAmount`: a sighting is 10, a pick-up is its tier's amount, a zone or a study is its `progression` price) and refuses a kind the earner cannot earn, such as an Avaia picking up tier 4. A claimed pick-up also carries its `artifactId` (see the claim below).

The amount is not part of the award record either. The record holds what happened (kind, earner, tier, subject, time), and the amount is a function of it, so repricing the table never breaks a chain's replay.

### The commitment

- `commitment = HMAC-SHA-256(historyKey, parent ‖ canonical award record)`, written as `xp:` and 43 base64url characters.
- The award record is the local one: the kind, the earner, the tier for a pick-up, what earned it (a cell, a landmark, an `artifactId`) and when. It never leaves the device. The commitment does, with the fields the server prices by (on the wire, above).
- `historyKey` is a Bond's key that the server never sees. Without it the commitment is useless to the server: a plain hash of a find would not be, because every `artifactId` of an epoch is enumerable and a dictionary over the city grid would give the place back.
- `parent` is the previous commitment of the same device chain. A device keeps its own chain, so two devices playing at once never fork one chain, and the Bond's history is the union of its device chains.
- The server accepts an award only on top of its chain's head (`parent` equals the head, fast-forward only). A repeat of an accepted commitment is idempotent and pays nothing.

### Order: the server first, then the device

Earning experience is an intent to keep what earned it. The order is fixed:

1. **Intent.** The device builds the award record, computes its commitment and keeps both as pending: sealed on the device, outside the history, never shown as kept.
2. **Commit.** It sends the commitment and what the server prices by (on the wire, above). No amount, and no record.
3. **Keep.** Only after the server accepted it does the device write the record into the history (a find into the finds journal, a sighting, a pick-up) and move its chain head.

- The server refuses (a cap reached, a head that moved on): the pending record is dropped. It never enters the history, and there is no experience without a record or a record without experience.
- No network: the record waits as pending and is offered again, under the same commitment, so a retry is idempotent. A pending pick-up is not yet a find kept.
- The server accepted but the device lost the record before writing it (it crashed, it was wiped): the experience stands, and the history is short by one. The device's audit sees a head it cannot replay to and says so; it does not invent the missing record.

### What this protects, and what it does not

- **Protected:** the number. Editing a total, a level or a queued amount on the device (memory, storage, a debugger) changes nothing, because the device shows the totals the server answered (an award not yet accepted shows as pending) and no amount is ever sent: the server prices each award itself. A device cannot rewrite or drop history it already committed without its own audit showing it: replaying the local history must reproduce the head the server holds.
- **Not protected, and accepted:** a rebuilt client can still invent awards that follow the rules. A tier 1–3 pick-up or a sighting names no find on the wire, so the server cannot check that it was rolled. A claimed pick-up names a real find (below), but nothing proves the Bond walked to it. The server bounds both with per-kind caps per Bond and epoch (a week cannot hold more tier 6 pick-ups than a week of walking rolls). It is a bound, not proof of play, and not presence evidence; the published standing is still this Bond's report.
- The server learns how many awards of each kind a Bond earned, and when it published them. Where, it learns only from a claim (below).

### The claim: one rare find, one Bond

A find belongs to the artifact, not to the person: the roll is a public function of the pack, the epoch and the segment, so every client generates the same find on the same segment, and nothing has to be shared to see it. What is shared is who got it.

1. **Generate.** Every client rolls the same find from the same segment and epoch (§3.3a). Its `artifactSha` is `SHA-256("nilx-one.artifact.v1:" ‖ artifactId)`, public by design: anyone can compute it.
2. **Pick up.** The Bond picks the find up (tiers 4–6 are the person's, §3.4). The device sends one request: the `artifactId` and the pick-up award (on the wire, above).
3. **Check.** The server rolls the find itself from the `artifactId`, with the same `rollSegment` and pack (a port with the same golden test). The roll must give a find of the tier the award names, and the epoch must be the current one, or the one before during the first day of a week. The server derives the `artifactSha` and the amount; the client supplies neither.
4. **Claim.** In one transaction the server writes the claim and accepts the award, or does neither. The first Bond wins. Only after that does the device keep the find (the order above).
5. **Oh crap!** A pick-up of the same find by another Bond is refused as `taken`. Its pending record is dropped and the Avaia says "oh crap! someone got there first". A second device of the same Bond gets `already yours` instead: the find was paid once.

Leads hear about it without naming themselves. A device asks for the claimed set of the current epoch by bucket: the first byte of each lead's `artifactSha`, so a question names 1/256 of the week's claims, never a lead. The answer is every claim in those buckets: the `artifactSha`, and whether this Bond is the one that claimed it, never who else. The device matches its leads locally. A lead another Bond claimed closes with "oh crap!"; one this Bond claimed on another device closes quietly. A lead whose epoch ended with nobody picking it up closes quietly: the world rolled anew.

What a claim costs, said plainly, to two readers:

- **The server** learns that this Bond picked up the find on this segment during this epoch. That is a place tied to a Bond, and only a claim reveals it.
- **Every other client** can learn that someone picked up the rare find on this segment this week. An `artifactSha` is not secret: every `artifactId` of a week is enumerable, so a dictionary turns a claimed set back into segments. The set names no Bond and no time, but in a place where only one person plays, "someone" is that person. This disclosure is accepted, not hidden: any representation a client can match its own leads against, a client can also match a dictionary against.

Both are bounded:

- only tiers 4–6 are claimed, about one find per 17 km walked; tiers 1–3 are never sent;
- the claim holds the epoch, not a time; the device, the walk and the rest of the history stay on the device;
- the claimed set a Bond reads names no other Bond, and is answered per bucket, for the current epoch only, under the rate limit, so it is not a feed of the city;
- a claim is deleted once its epoch is two epochs old: the find no longer exists, and the award it paid stands on its own commitment.

### Syncing between devices: directly only

- The history and `historyKey` travel only device to device, directly: in a native app, over AirDrop, Bluetooth LE or the local network, without the internet. The service is not even a blind relay for them.
- The web host and the Telegram and Discord hosts need the internet to run, so they have no direct transport yet. Each of them keeps its own history; its awards still reach the server's totals through its own chain. An encrypted file export is the fallback for moving a web history by hand.
- A history that arrives is checked against the server's heads: every chain it carries must replay to a head the server holds. A history that does not replay is not adopted.

### What this means for the code

- `progression.ts`: an award's id becomes its commitment (`xp:` + HMAC), with `parent` and `kind`. A pending award holds its record until the server accepts it; only then is the record written to its journal and the chain head moved.
- `services/identity`: the event log gains `chain`, `parent`, `kind`, `tier`; a head per `(owner, chain)`; the price table and per-kind caps per epoch. The request has no amount. Totals stay where they are.
- `historyKey` is generated on the device and placed as `sealed-transport`: it leaves a device only wrapped for another device of the same Bond, over the direct transport, and never reaches the service.
- `services/identity`: a port of `rollSegment` with the same golden test; the claim table; `POST` a pick-up (roll check, claim and award in one transaction); `GET` the claimed set of the current epoch by bucket (#304).
- Leads: match the claimed set locally and close with "oh crap!"; a lead whose epoch ended closes quietly.

## Open decisions

| №   | Question                                                           | My option                                                                                                                      |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| R1  | where the Avaia may walk: open ground only (fog) or the whole city | **decided:** open ground only. The person opens cells bordering open ground by tapping. See "R1: open ground only"             |
| R2  | who earns a find's experience: the Avaia or the Bond               | **decided:** whoever saw it gets 10, whoever picked it up gets the tier's experience. See §3.4                                 |
| R3  | what the server holds: a claim registry, experience, or nothing    | **decided:** experience with a commitment, and a claim on tiers 4–6. See "R3: experience on the server, history on the device" |
| R4  | sources for parks, lakes, churches                                 | extend `LANDMARK_KINDS` for pois, read `landuse`/`water` separately. Checked against the archive                               |

## Order of work

Each step builds on the one before.

0. **Pedestrian graph and router** (`walk-graph`): nodes, the weights from §0.3, snapping, tests on fixed tile fragments. The least risky step: a pure function.
1. **Reading tiles ahead** and checking path quality on the archive (§0.5).
2. **City targets** (§1): more kinds, unreachable ones filtered out.
3. **Point B** (§0.4): tap, a 20 s stand, back to autonomy from B. First with straight walking, then with the router.
4. **The drive without a model** (§2): the utility rule, lines, the interval.
5. **Finds, locally** (§3, §4): the pack, segments, tiers 1–6, anti-farm through epochs, the journal, the `world-wipe` entry.
6. **The model in `DecisionMenu`** (§2.2) and the narrator (§5), behind a flag.
7. **Leads, claims and committed experience** (§3.4, R3): leads, the claim for tiers 4–6, "oh crap!", and experience the server holds against a commitment.

After step 5 the feature works completely without a model. The model and the committed experience come last, as add-ons.

## Acceptance

- [ ] Router: the same input and graph give the same way. The way does not cross buildings or water. Soft weights on fixed fragments give the expected routes (path versus grass).
- [ ] The Avaia steps onto grass only in the cases of §0.2: no line, an artifact, a shortcut, a tap. Each case has its own test on test tiles.
- [ ] A tap on a point B: the Avaia arrives, stands, and returns to autonomy from B. A second tap picks the movement up.
- [ ] Over 10k segments the share of tier 6 finds is close to 1 per 100 km (±30 % tolerance). The pack's golden snapshot is committed, and a change without a version bump fails the test.
- [ ] An outing makes no requests other than tiles and (on first load) the weights from `nilx.one`. Every tile request is listed in `map-data.md`.
- [ ] The model flag is off by default. The validator's rejection rate is recorded over at least 50 lines. Above 30 %, the model adds nothing beyond the template.
- [ ] "Wipe the world" deletes `avaia-finds`.

## Not included

- **Animation and the camera during an outing.** An outing does not move the camera. If a follow mode is needed, that is a separate decision in [Camera coordination](camera-coordination.md).
- **The `catalog` source** (virtual shelves in shops) and **`slot-phys`** (needs REG-ATTEST).
- **Moving between devices.** Finds and leads do not survive a change of device.
- **Walking while the page is closed.** Only through a deterministic "catch-up" on opening, separately.
- **qwen3 1.7b.** After the WebGPU trial on mobile Safari.
- **Bond / interaction.** The Avaia's finds never become `bch`.
- **A training signal** from outings.
