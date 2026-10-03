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

## Open items

- which `pois` kinds, `landuse` kinds and `water` attributes the Kyiv archive actually carries for each row. Nothing here is enabled until `landmark-kinds.mjs` and a fixture say so;
- whether the archive carries benches, camp sites, peaks and shrines at all; rows that it does not support are dropped rather than faked;
- the numeric significance thresholds, once the real distribution is known;
- whether the walking graph can be built from `roads` alone for parks, which decides if `park` is a place to wander in or only to reach ([Avaia walks on its own](avaia-outings.md) §0.5).
