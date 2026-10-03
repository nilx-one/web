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

| 0x1 kind | OSM candidates |
|---|---|
| `park` | `leisure=park`, suitable `landuse=recreation_ground` |
| `lake` | `natural=water` with `water=lake` or equivalent mapped water geometry |
| `nature_reserve` | `leisure=nature_reserve` |
| `viewpoint` | `tourism=viewpoint` |
| `beach` | `natural=beach` |
| `castle` | `historic=castle` |
| `fort` | `historic=fort` |
| `archaeological_site` | `historic=archaeological_site` |
| `ruins` | `historic=ruins` |
| `historic_building` | `historic=building` when significance filtering passes |
| `museum` | `tourism=museum` |
| `major_monument` | significant `historic=monument`, `historic=memorial` or an existing monument mapping |

### `route_landmark`

Objects that can justify a small route deviation.

| 0x1 kind | OSM candidates |
|---|---|
| `artwork` | `tourism=artwork` |
| `fountain` | `amenity=fountain` |
| `bridge` | bridge objects represented by `man_made=bridge`, `bridge=*`, or existing bridge geometry |
| `tower` | `man_made=tower` |
| `church` | `amenity=place_of_worship` with Christian religion, `building=church`, or existing church mapping |
| `small_monument` | smaller `historic=monument` / `historic=memorial` after significance filtering |
| `shrine` | `historic=wayside_shrine` |
| `cross` | `historic=wayside_cross`, `man_made=cross` |
| `spring` | `natural=spring` |

### `micro_interest`

Small objects that may be noticed along an existing route but normally do not justify a major detour.

| 0x1 kind | OSM candidates |
|---|---|
| `bench` | `amenity=bench` |
| `picnic_site` | `tourism=picnic_site` |
| `information` | `tourism=information` or mapped information boards |
| `bird_hide` | `leisure=bird_hide` |
| `cairn` | `man_made=cairn` |

## What does not become a landmark automatically

The existence of an OSM object alone is insufficient.

- ordinary shops, cafes, offices and other everyday amenities are not landmarks by default;
- `building=*` alone does not make a building a landmark;
- arbitrary roads and paths are routing infrastructure, not landmarks;
- duplicate OSM objects describing the same physical feature must collapse to one normalized object;
- inaccessible, non-walkable or otherwise invalid targets must be filtered before entering the outing decision menu.

A future product surface may use ordinary amenities as a separate POI/infrastructure layer without changing this landmark contract.

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

The exact narrative may be generated from the normalized evidence, but the model cannot create a landmark merely by mentioning one.

## Validation

Before enabling a new mapping:

- verify that the relevant OSM tag exists in the actual archived map data used by the application;
- verify the expected geometry type and parser path;
- verify that at least one real fixture contains the mapping;
- add a deterministic fixture/golden test for the normalization;
- verify that inaccessible or malformed objects are rejected;
- verify that duplicate source objects do not produce duplicate landmarks.

This keeps OSM extensibility separate from the stable 0x1 landmark vocabulary.