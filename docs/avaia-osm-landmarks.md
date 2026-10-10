# Avaia landmarks from OpenStreetMap

This document defines how physical map features from OpenStreetMap (OSM) may become Avaia landmarks.

The `walk_target`, `route_landmark`, and `micro_interest` groups are **0x1 semantic categories**, not OSM categories. OSM is the source of candidate objects. The client maps OSM tags and geometry into the closed `landmark_kind` vocabulary before the result reaches Avaia or any local model.

```text
OpenStreetMap
    │
    ├── OSM tags + geometry
    │
    ▼
OSM → 0x1 mapping
    │
    ▼
normalized landmark_kind
    │
    ├── walk_target
    ├── route_landmark
    └── micro_interest
```

## Source: the Protomaps archive, not raw OSM

The application never reads OSM directly. Its map is a Protomaps Basemap v4 archive built from OSM ([map data](map-data.md)), and the client sees only that archive's source layers and attributes. Two consequences:

- the "OSM candidates" columns below name where a kind comes from upstream. The mapper does **not** read those tags. It reads the archive fields in the table that follows, and many raw tags (`water=lake`, `religion=*`, `building=church`, `access=*`) may not survive into the tiles at all;
- a row is **not enabled** until the archive inspection shows which layer and attribute carry it. A kind whose source field cannot be confirmed stays documented here and disabled in code.

What the repository already confirms about the archive:

| Archive layer | Carries                                     | Attributes confirmed in use |
| ------------- | ------------------------------------------- | --------------------------- |
| `pois`        | point features, including today's landmarks | `kind`, `name`, and others  |
| `landuse`     | parks and green mass                        | `kind`                      |
| `water`       | water bodies and rivers                     | `kind_detail`               |
| `roads`       | road hierarchy and rail (the walking graph) | `kind`                      |
| `buildings`   | footprints and volumes                      | `height`, `min_height`      |

The archive carries no tree points, so `natural=tree` is not a landmark source. Its coverage is Kyiv and the surrounding region; a target outside it simply has no data. `deploy/web/landmark-kinds.mjs` lists the `pois` kinds an archive really contains, and its output is the starting point for enabling rows.

## Rules

1. OSM is a **source of candidates**, not the 0x1 protocol.
2. Raw OSM tags must not become the model's vocabulary.
3. Multiple OSM tag combinations may map to one normalized `landmark_kind`.
4. An OSM object is not automatically an Avaia landmark. It must pass geometry, walkability, significance and deduplication filters.
5. Mapping must be deterministic for the same archived OSM input.
6. If a mapping cannot be established confidently, the object is ignored rather than assigned an invented kind.
7. Existing `pois`/`LANDMARK_KINDS` mappings remain valid; this document describes the extensible OSM source layer around them.

## Normalized vocabulary

### `walk_target`

Objects worth changing the route for.

| 0x1 kind              | OSM candidates                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| `park`                | `leisure=park`, suitable `landuse=recreation_ground`                                 |
| `lake`                | `natural=water` with `water=lake` or equivalent mapped water geometry                |
| `nature_reserve`      | `leisure=nature_reserve`                                                             |
| `viewpoint`           | `tourism=viewpoint`                                                                  |
| `beach`               | `natural=beach`                                                                      |
| `peak`                | `natural=peak`, `natural=hill`                                                       |
| `castle`              | `historic=castle`                                                                    |
| `fort`                | `historic=fort`                                                                      |
| `archaeological_site` | `historic=archaeological_site`                                                       |
| `ruins`               | `historic=ruins`                                                                     |
| `historic_building`   | `historic=building` when significance filtering passes                               |
| `museum`              | `tourism=museum`                                                                     |
| `major_monument`      | significant `historic=monument`, `historic=memorial` or an existing monument mapping |

### `route_landmark`

Objects that can justify a small route deviation.

| 0x1 kind         | OSM candidates                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `artwork`        | `tourism=artwork`                                                                                 |
| `fountain`       | `amenity=fountain`                                                                                |
| `bridge`         | bridge objects represented by `man_made=bridge`, `bridge=*`, or existing bridge geometry          |
| `tower`          | `man_made=tower`                                                                                  |
| `church`         | `amenity=place_of_worship` with Christian religion, `building=church`, or existing church mapping |
| `small_monument` | smaller `historic=monument` / `historic=memorial` after significance filtering                    |
| `shrine`         | `historic=wayside_shrine`                                                                         |
| `cross`          | `historic=wayside_cross`, `man_made=cross`                                                        |
| `spring`         | `natural=spring`                                                                                  |

### `micro_interest`

Small objects that may be noticed along an existing route but normally do not justify a major detour.

| 0x1 kind      | OSM candidates                                     |
| ------------- | -------------------------------------------------- |
| `bench`       | `amenity=bench`                                    |
| `picnic_site` | `tourism=picnic_site`                              |
| `information` | `tourism=information` or mapped information boards |
| `bird_hide`   | `leisure=bird_hide`                                |
| `cairn`       | `man_made=cairn`                                   |
| `camp_site`   | `tourism=camp_site`                                |

`bench` is a mass kind: a city has thousands. It never enters the decision menu, a density cap applies per route segment, and whether the archive carries benches at all is unverified. It is the least certain row in this document.

## What does not become a landmark automatically

The existence of an OSM object alone is insufficient.

- ordinary shops, cafes, offices and other everyday amenities are not landmarks by default;
- `building=*` alone does not make a building a landmark;
- arbitrary roads and paths are routing infrastructure, not landmarks;
- duplicate OSM objects describing the same physical feature must collapse to one normalized object;
- inaccessible, non-walkable or otherwise invalid targets must be filtered before entering the outing decision menu.

A future product surface may use ordinary amenities as a separate POI/infrastructure layer without changing this landmark contract.

## One object, one kind

An object that matches several rows is assigned **one** kind:

1. group order: `walk_target`, then `route_landmark`, then `micro_interest`;
2. inside a group, the order the rows appear in the mapping table (the table order is the constant, and a test asserts it);
3. a more specific row beats a generic one (`castle` beats `historic_building`, `church` beats a generic place of worship).

## Deduplication

Two source objects collapse into one landmark when they have the same normalized kind **and** either one polygon contains the other's point or they lie within 50 m, **and** their names match after normalization or at least one has no name. The survivor is chosen deterministically: polygon over point, then named over unnamed, then the smallest stable source id. Source ids are used inside the mapper only and never leave it.

`major_monument` and `small_monument` count as one kind here. Significance is decided per source object, so one monument read twice, once with a heritage attribute and once without, would otherwise come out as two landmarks. Between them the major one survives, ahead of the rules above.

## Significance

"Significant" must be computable from archive attributes alone and identical on every device. The rule is fixed per kind in the mapping table:

- a `walk_target` must be named. An unnamed object is ignored, not defaulted;
- `major_monument` versus `small_monument`: major requires a name and at least one of a footprint above the per-kind threshold, a heritage-style attribute when the archive carries one, or a co-occurring `attraction`/`landmark` kind. Otherwise the object is `small_monument`;
- `park` requires a name and a minimum area (starting value 1 ha);
- `historic_building` requires a name and an explicit historic attribute. `building=*` alone never qualifies.

The thresholds are starting values. They are set after looking at the real distribution in the Kyiv archive, and they are versioned with the mapping.

## Anchors for area features

A polygon is one landmark, but a walk needs somewhere to arrive. The anchor is never a centroid, because a lake's centroid is in the water.

| Feature                  | Arrival                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| point                    | nearest walking-graph node within 30 m, else a grass connector of at most 30 m, else the object is rejected                      |
| `park`, `nature_reserve` | the cheapest-to-reach graph node inside the polygon or within 30 m of its boundary; wandering inside uses the graph nodes inside |
| `lake`, `beach`          | the cheapest-to-reach graph node outside the polygon and within 30 m of its shore, never into the water                          |
| lines such as rivers     | not a target; only the shore rules above apply                                                                                   |

The 30 m figure is the one in [Avaia walks on its own](avaia-outings.md) §0.2.

Every anchor is checked against what the map draws before a target is offered: an anchor never stands inside a building footprint or a water body, the lake's own polygon included. For an area, the next cheapest node that passes is taken instead; for a point, the target is rejected. An anchor is also reachable over open ground within the walk's budget, by the same routing the walk itself uses, so an accepted target can always be walked to.

## Compatibility with the current `LANDMARK_KINDS`

Existing noticing and studying keep reading `packages/map-maplibre/src/landmark-kinds.json` unchanged. The new layer maps those archive kinds as follows (proposed, to be checked against inspection output):

| Current kind                                                            | New kind                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `monument`, `memorial`                                                  | `major_monument` or `small_monument`, by the significance rule    |
| `statue`, `sculpture`, `artwork`                                        | `artwork`, unless the significance rule promotes it to a monument |
| `museum`, `castle`, `fort`, `ruins`, `archaeological_site`, `viewpoint` | the same name                                                     |
| `attraction`, `landmark`                                                | ignored on their own; they only support significance              |
| `historic`                                                              | ignored unless another attribute resolves `historic_building`     |

## Versioning

The mapping has a version, like the finds pack. Adding a kind or a row raises the minor version. Kind keys are never removed or renamed, because anything a device stores about a landmark, such as the notebook, may refer to one. A change to a threshold, an order or a mapping changes golden output and must raise the version in the same commit.

## Geometry and source handling

OSM objects may be points, lines or polygons. The mapper must preserve enough geometry to determine whether an object can be reached and whether it represents a meaningful target. For large polygons such as parks, lakes and reserves, the normalized landmark represents the physical feature rather than an arbitrary point selected by the model.

The routing layer decides whether and how Avaia can reach the target. The landmark mapper must not invent a route and must not bypass routing constraints.

## Model boundary

Avaia receives normalized semantic labels, not raw OSM data. In particular, the model does not receive raw OSM tags, arbitrary OSM keys, coordinates, private identifiers or source-specific object IDs.

Example:

```text
OSM:
  tourism=viewpoint
  name=...
  lat/lon=...

        ↓ mapper

0x1:
  landmark_kind=viewpoint
  walkability=reachable

        ↓ decision menu

Avaia:
  "viewpoint"
```

A landmark's name never reaches the model either. The interface may show the archive's name verbatim, as [Avaia walks the world](avaia-walk.md) already does, but the decision menu carries only the normalized kind and its reachability.

The extracted landmark set is derived on the device from the tiles it already holds. It is not exported, synced or shared, and the map's OSM attribution stays as it is.

The exact narrative may be generated from the normalized evidence, but the model cannot create a landmark merely by mentioning one.

## Validation

Before enabling a new mapping:

- verify that the relevant OSM tag exists in the actual archived map data used by the application;
- verify the expected geometry type and parser path;
- verify that at least one real fixture contains the mapping;
- add a deterministic fixture/golden test for the normalization;
- verify that inaccessible or malformed objects are rejected;
- verify that duplicate source objects do not produce duplicate landmarks;
- verify that the same input always yields the same kinds in the same order, and that the mapping version is part of the golden snapshot;
- verify that every area-feature anchor lies on or near the walking graph and never in water or inside a building;
- verify that unnamed `walk_target` candidates are rejected.

This keeps OSM extensibility separate from the stable 0x1 landmark vocabulary.

## Implemented

`landmark-normalize.ts` in `product-app` takes the mapper's candidates (the rows each archive object matched, its name, geometry and the attributes significance reads) and applies this document: one kind per object by group and table order, the significance rules, geometry and type checks, and deduplication. The mapping table, its version (`1.0`) and the thresholds (`parkMinAreaM2` 10 000, `majorMonumentMinFootprintM2` 100, `duplicateWithinMeters` 50) are constants, and a golden test pins the output. Landmarks come out with an id derived from the kind and a point of the feature, rounded to about a metre; source ids never leave it. `outingCandidates` passes the `walk_target` group on to the outing menu.

`landmark-mapper.ts` in `product-app` is the mapper (#306). It reads the landmark points the renderer already reads, `pois` features whose `kind` is in `LANDMARK_KINDS`, and only their `kind` and `name`: no raw OSM tag and no other attribute. Its rows are `landmark-mapper-kinds.json`, the compatibility table above and nothing more:

| Archive `pois` kind                 | Row                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `monument`, `memorial`              | `major_monument`, small unless significance promotes                     |
| `artwork`, `sculpture`, `statue`    | `artwork`                                                                |
| `museum`, `castle`, `fort`, `ruins` | the same name                                                            |
| `archaeological_site`, `viewpoint`  | the same name                                                            |
| `attraction`, `landmark`            | none; a named one marks a same-named monument within 50 m as significant |

These rows are **not yet confirmed against the deployed archive.** They follow the Protomaps schema `LANDMARK_KINDS` already follows, and that is all. What holds them to the archive is the inspection: `landmark-kinds.mjs` reads `landmark-mapper-kinds.json` and fails `inspect-basemap.sh` when any kind in it, the significance kinds included, does not occur in the archive's full-detail `pois` tiles. Until someone runs that against the deployed archive and records the output, this part of #306 stays open with #309 and #311, and a failing kind is disabled in the JSON rather than kept. A deployment test also fails if the mapper reads a kind outside `LANDMARK_KINDS`, which the renderer would never hand it. Peaks, churches and the `micro_interest` rows stay disabled. The mapper has its own version (`1.1`) beside the normalization's, and a golden test pins both.

### Areas: parks, reserves, beaches, lakes

An area is drawn and named in two places in the archive, and the renderer joins them (`areasNear`, `landmark-areas.ts` in `map-maplibre`). It reads only the polygon's `kind` and `kind_detail` and the label's `name`:

| Area                 | Polygon                                                      | Label                                      | Joined by                                                               |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| park, reserve, beach | `landuse`, `kind` `park`, `nature_reserve` or `beach`        | the named `pois` point of the same feature | the feature id the schema gives both                                    |
| lake                 | `water`, `kind` `lake`, or `kind` `water` with detail `lake` | the named `water` point                    | the label lies inside the polygon (the schema places it on the surface) |

The mapper's `areas` rows in `landmark-mapper-kinds.json` decide which joined areas are walk targets, keyed `layer:kind` or `layer:kind:kind_detail`: `landuse:park`, `landuse:nature_reserve`, `landuse:beach`, `water:lake`, `water:water:lake`. A park still needs a name and a hectare; anchors follow the table below, inside a park or reserve and on the shore of a lake or beach.

A large area arrives in pieces, one per tile. A park's pieces share its id and come together whole. Each tile carries its piece past its own edge, into a buffer, and the view may hold tiles of more than one zoom, so an area keeps only the pieces of its deepest zoom, each cut back to its own tile, and a tile both the view and the read-ahead hold is read from the read-ahead: no ground is counted twice towards a park's hectare. An area's landmark id comes from its label, not from its pieces, so it holds while more of them load. A lake's pieces have no id: the ones that overlap the piece around its label, through the tiles' buffers, come with it, and a piece in a tile not held is missing. The cut edge of a missing piece is not a shore anyone walks to, since no path runs across the water, and an anchor in the water is still refused.

Like the point rows, these are **not yet confirmed against the deployed archive.** They follow the Protomaps schema, read from its source. The inspection holds them to the archive: `landmark-kinds.mjs` reads the `landuse` and `water` layers of the full-detail tiles too, and fails when any `areas` key does not occur on a polygon the renderer can join: a `landuse` polygon whose id a named `pois` point carries, or a `water` polygon with a named `water` point of the same `kind` and `kind_detail` in its tile. The renderer decodes only the polygon kinds on `landmark-area-kinds.json`, and a deployment test keeps every `areas` row on it.

The drive maps what the renderer holds within the outing's budget at the moment it plans: the view's tiles and the `pois` tiles it reads ahead at the archive's last zoom ([map data](map-data.md)). So an Avaia goes out to the parks, reserves, beaches and lakes, and the museums, viewpoints, castles, forts, ruins and significant monuments within its reach, not only those on screen. A tile it did not read, because it is all fog or past the cap, has no targets for it.

### Kyiv's archive, inspected

`landmark-kinds.mjs` was run against the deployed archive (`nilx.one/map/0.1.0/basemap.pmtiles`). It carries every required point row and the lakes as `water:water:lake` (1,208 named). It does **not** carry `sculpture`, `statue`, `fort` or `landmark` as kinds, and its named lakes never come as `water:lake`. The schema folds statues and sculptures into `memorial` (2,141), `artwork` (753) and `attraction` (369) points with no detail, and Kyiv's fortress is a `castle` («Київська фортеця») with towers that are `ruins` and `attraction`s.

So those rows stay, under `optional` in `landmark-mapper-kinds.json`. They are read when an archive carries them, as another city's may, and are not required of this one. Two **name rules** (`names`, mapper 1.2) find what Kyiv's archive holds:

| Rule             | Kinds                                       | Name matches                                       | Also matches |
| ---------------- | ------------------------------------------- | -------------------------------------------------- | ------------ |
| statue/sculpture | `memorial`, `monument`, `attraction`        | статуя, скульптур, statue, sculpture               | `artwork`    |
| fort             | `castle`, `ruins`, `attraction`, `historic` | фортец, бастіон, редут, fortress, bastion, redoubt | `fort`       |

A rule only adds rows to a point the renderer already hands over (every kind it names is on `LANDMARK_KINDS`, which a deployment test checks), and the archive's own name decides. `landmark` as a significance kind has no counterpart in the schema: `attraction` carries significance alone in Kyiv.

## Open items

- which `landuse` kinds and `water` attributes the Kyiv archive actually carries for parks, lakes, reserves and beaches, and which further `pois` kinds it carries. Beyond the rows above nothing is enabled until `landmark-kinds.mjs` and a fixture say so (#309, #311);
- whether the archive carries benches, camp sites, peaks and shrines at all; rows that it does not support are dropped rather than faked;
- the numeric significance thresholds, once the real distribution is known;
- whether the walking graph can be built from `roads` alone for parks, which decides if `park` is a place to wander in or only to reach ([Avaia walks on its own](avaia-outings.md) §0.5).

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
