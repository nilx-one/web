# Map data

The 0x1 Web map uses a versioned, same-origin MapLibre style and a self-hosted PMTiles basemap. Map rendering is a client projection; map data and presentation do not define Bond, BondChain, Relationship, identity, consent, or authority truth.

## Regional bootstrap

The first published basemap is intentionally regional so the real map path can be proven before introducing global-scale storage and refresh infrastructure.

Current bootstrap envelope:

```text
29.75,49.95,31.35,51.15
```

It covers Kyiv and surrounding context, including Vyshcha Dubechnya. The source is an OpenStreetMap-derived Protomaps Basemap v4 daily build. `deploy/web/bootstrap-basemap.sh` extracts the regional archive into the server-owned shared map directory and verifies the resulting PMTiles file before activation.

The runtime contract remains:

```text
/map/0.1.0/style.json
/map/0.1.0/style-dark.json
/map/0.1.0/basemap.pmtiles
```

`basemap.pmtiles` is deployment data and MUST NOT be committed to Git. The Web containers mount the server-owned archive read-only while `style.json` remains part of the immutable client image.

OpenStreetMap attribution must remain visible wherever OSM-derived map data is rendered.

## Source capabilities

The published archive is the authority on what the map can show. A style may
read only source layers and attributes the archive actually declares; imitating
a generic vector-tile schema fails silently, because a filter on a field that
does not exist simply matches nothing and the geography quietly disappears.

`deploy/web/inspect-basemap.sh` prints the header and the archive's own
`vector_layers` declaration — layer names, zoom ranges and attribute types —
from the server-owned archive:

```sh
MAP_BASEMAP_PATH=/srv/nilx-one/map/basemap.pmtiles deploy/web/inspect-basemap.sh
```

The published styles currently rely on exactly this much of the schema:

| Source layer | Used for                        | Attributes read           |
| ------------ | ------------------------------- | ------------------------- |
| `earth`      | land mass                       | —                         |
| `landcover`  | coarse natural cover            | `kind`                    |
| `landuse`    | parks, green mass, urban fabric | `kind`                    |
| `water`      | water bodies and rivers         | `kind_detail`             |
| `roads`      | road hierarchy and rail         | `kind`                    |
| `buildings`  | footprints and extruded volumes | `height`, `min_height`    |
| `boundaries` | administrative edges            | —                         |
| `places`     | locality and district names     | `kind`, `name`, `name:uk` |
| `pois`       | quiet point detail, names       | `name`                    |

`tests/deployment/map-assets.test.ts` keeps the styles inside that list, so
adding an attribute to a style is a deliberate change that has to be verified
against a real archive first.

The renderer itself reads a little more, outside any style, for
[Avaia walks the world](avaia-walk.md): a tap on the ground is classified by
querying the painted `buildings`, `buildings-flat` and `water` layers, and
`landmarksNear` reads `kind`, `name` and every other attribute of `pois`
features from tiles already loaded and from the landmark tiles read ahead
(below). `pointsNear` reads the view's `pois` of the kinds the caller names (repair workshops, [Inventory](inventory.md)). `areasNear` reads the same tiles' named `pois` and `water` points and
the `kind` and `kind_detail` of `landuse` and `water` polygons, to name the
parks, reserves, beaches and lakes an outing may go to. `roadsWithin` reads `kind`, `kind_detail`
and `is_bridge` of `roads` features, from tiles already loaded and from the
road tiles read ahead (below), to build the pedestrian graph a walk follows.
`LANDMARK_KINDS`
(`packages/map-maplibre/src/landmark-kinds.json`) follows the Protomaps schema
the archive is built from. The declaration above names fields, not the values
they take, so `inspect-basemap.sh` ends by reading the `pois` tiles themselves
with `deploy/web/landmark-kinds.mjs`: it lists every `kind` the archive
carries, marks the ones on the list, and fails when none of them occur. It
also fails when any kind the Avaia's landmark mapper reads
(`landmark-mapper-kinds.json` in `product-app`) is absent. It can
also be run on its own with any Node:

```sh
node deploy/web/landmark-kinds.mjs /srv/nilx-one/map/basemap.pmtiles
```

### Reading roads and landmarks ahead

These are the only places the client fetches map data the view did not ask
for.
An Avaia going out on its own ([Avaia walks the world](avaia-walk.md)) walks
up to 2.5 km from where it stands, well past the tiles on screen, so before it
plans the outing the renderer's `preloadRoads` reads the `roads` layer of the
tiles covering that area:

- from the same self-hosted `basemap.pmtiles` the map draws, by HTTP range
  requests to that one file; nothing else is requested and nothing leaves the
  origin;
- at one zoom, 14, and only the `roads` layer of each tile is decoded;
- nearest the outing's centre first, at most 32 tiles per outing, and the
  cache never holds more than 32: the oldest is dropped first. A walk of 2.5 km each way
  needs 16 to 25;
- not a tile with no open ground in it: the Avaia walks only where the fog is
  lifted, so a tile that is all fog is never fetched;
- at most once per outing, and outings come at most once in four hours. A tile
  already held is not fetched again; one that failed is tried at the next.

At the same moment `preloadLandmarks` reads the `pois` layer of the same area,
so the outing knows the landmarks it could walk to, not only those on screen:

- from the same archive, by the same range requests. Three layers of each tile
  are decoded: `pois` into the points whose kind is on `LANDMARK_KINDS` and
  the named points that label areas; `landuse` polygons (`kind`, `kind_detail`
  and the feature id) and `water` polygons, only of the kinds on
  `landmark-area-kinds.json`, and named points (`kind`,
  `kind_detail`, `name`), for the areas `areasNear` joins;
- at zoom 15, the archive's last. The basemap schema gives every point a zoom
  range ending at 15 and thins the zooms below it to a label grid, so a museum
  or a viewpoint is only certain to be in the tiles at 15. A walk of 2.5 km
  each way covers about 49 of them; the same caps and rules as the roads apply,
  so at most 32 are fetched, nearest the centre first, never one that is all
  fog, and the cache never holds more than 32;
- once per outing, beside the roads, never on its own.

Each preload answers what it did (`covering`, `refused`, `skipped`, `cached`,
`fetched`, `failed`), so what it cost is observable. What it reads stays on the
device and never reaches a model: the roads feed the walking graph, the
landmarks the outing menu, and the decision menu carries closed labels, not
roads or names.

Elements the reference imagery shows but the archive does not support are
omitted rather than invented. In particular, individual street trees are not
placed: the archive carries no tree points, and drawing them at made-up
coordinates would be the renderer manufacturing geography. Terrain and
hillshade remain absent for the same reason — the bootstrap publishes no
same-origin DEM.

Building heights come from OpenStreetMap `height` where the data has it. Where
it does not, the style falls back to a single conservative value declared in
metadata as `presentation-only-7m`. That fallback is presentation, never
geographic data, and it is never surfaced as a property of the building.

## Labels

Street, water, district and landmark names are drawn by MapLibre `symbol`
layers from same-origin glyph ranges at `/map/0.1.0/fonts/{fontstack}/{range}.pbf`
(Noto Sans Regular and SemiBold, ranges 0–8447: Latin, Cyrillic, punctuation;
OFL-1.1, see `deploy/web/third_party/noto-sans`). Names read `name:uk` first and
fall back to `name`. Appearance in zoom follows the scale ladder:

| Layer                 | Kind filter                          | From zoom |
| --------------------- | ------------------------------------ | --------- |
| `place-locality`      | `locality`                           | 6         |
| `place-district`      | `macrohood`, `borough`, `localadmin` | 10–15     |
| `water-labels`        | named water                          | 11        |
| `road-labels-major`   | `highway`, `major_road`              | 13        |
| `place-neighbourhood` | `neighbourhood`                      | 13–17.5   |
| `road-labels-minor`   | `medium_road`, `minor_road`          | 15        |
| `poi-labels`          | any named `pois` point               | 16.5      |

Districts hand over to neighbourhoods as the camera closes in, and streets
appear before neighbourhood names fade. The `kind` values are Protomaps v4's;
verify against a real archive with `inspect-basemap.sh` before relying on a new one.

## Visual language

The published styles carry the first 0x1 map visual language: a near-white
spatial map with restrained cyan accents. The map is the spatial substrate of
0x1, so geography stays readable without competing with Bonds or Avaia.

| Role                 | Light                 | Dark                  |
| -------------------- | --------------------- | --------------------- |
| Background           | `#f7f9fa`             | `#070c0e`             |
| Land                 | `#f1f4f5`             | `#0c1417`             |
| Parks and green mass | `#eaf2ef`             | `#10201d`             |
| Building footprints  | `#d8e2e5`             | `#203036`             |
| Building faces       | `#eef3f4`             | `#26383f`             |
| Primary roads        | `#bccfd4`             | `#344a52`             |
| Secondary roads      | `#cedcdf`             | `#26383e`             |
| Water                | `#d9f4f7`             | `#05222a`             |
| Accent               | `#37d7e5`             | `#37d7e5`             |
| Label (reserved)     | `#536166` / `#7d8a90` | `#a8b6bb` / `#78898f` |

Each row is the value the published style metadata carries, and
`tests/deployment/map-assets.test.ts` locks the palette against this table.

Cyan is an accent, not a global fill. In the map it is spent only on water
outlines and river lines, which is what makes the Dnipro read as the dominant
element of the Kyiv basin. Everywhere else in the authenticated shell it marks
activity, focus, and living system state — the 0x0sky focus transition being the
first use — and never map-derived truth.

Both appearances publish the same layer list, in the same order, over the same
source layers. Appearance is therefore a palette swap, not a second map design,
and `tests/deployment/map-assets.test.ts` keeps the two documents structurally
identical.

Layer order follows the visual priority of the map: geography (`earth`,
`landcover`, `parks`, `landuse-urban`), water (`water`, `water-accent`,
`rivers`), urban mass (`buildings-flat`), movement (`roads-rail`,
`roads-minor-casing`, `roads-secondary`, `roads-casing`, `roads-primary`),
urban depth (`buildings`), then minor detail (`boundaries`, `pois`). Buildings
hand over from a flat wash beneath the road network to restrained
`fill-extrusion` depth above it between street and building scale, using OSM
`height` where the data has it and a conservative fallback where it does not.
The footprints stay painted past the handover, so hiding the extrusion is all
explicit 2D has to do.

### Scale progression

City, neighbourhood, street and building scale are named once, in
`MAP_SCALE_ZOOM` on `@nilx-one/map-contract`, and mirrored into each published
style's metadata as `nilx-one:zoom-*`. The camera policy and the style read the
same ladder, and a deployment test keeps them equal.

```text
city (11)          geography, water, major roads, coarse built fabric
neighborhood (13)  street network and building footprints
street (15)        minor-road casing, footprints at full presence
building (16.5)    extruded volumes over the same footprints
```

Zooming is one continuous world, not a second screen: layers hand over through
interpolated ramps, the same source layers stay mounted, and nothing is
recreated as the camera closes in.

At building scale the style aims at a lightweight physical model rather than a
navigation map. Buildings are near-white volumes (`#eef3f4` in light) standing
on a slightly deeper footprint wash (`#d8e2e5`), which is what gives them
ground contact without a shadow pass. Depth comes from
`fill-extrusion-vertical-gradient` and one soft directional `light` — the depth
treatment MapLibre 6 supports without a second renderer or a stricter WebGL
baseline. Ambient occlusion is not available in this MapLibre version and is
not imitated.

### Presentation depth

`MapRenderer.setDimension` selects how the same geography is presented.
`volumetric` lets the extrusion layer rise at building scale; `flat` hides it,
leaving the footprints that paint beneath it at every zoom. There is one
geographic truth and two presentations of it, so explicit 2D is never
overridden by close-zoom behaviour and the camera policy holds pitch at zero
while it is selected.

### Observed device position

The renderer draws the current client's observed position as a cyan point, a
pale edge that keeps it legible over near-white buildings, and a translucent
halo whose radius is the reported accuracy in ground metres — interpolated on
base 2 so it tracks the ground rather than the screen. The layers are appended
above the published style, so the marker stays above buildings at every close
zoom, and they are restored after an appearance swap.

The optional close-zoom callout carries application-supplied text. It means
"this client's observed device position" and never asserts that a Bond is
present at that coordinate. Because MapLibre renders text only from glyph
ranges, the callout is a DOM marker rather than a symbol layer.

### Renderer worker

MapLibre parses tiles in a Web Worker and, by default, resolves that worker
from its own module URL. An application build inlines MapLibre into an
application chunk, so the default resolves to a file no client image publishes:
the worker never starts, every source waits behind it, and the map fails on the
load timeout without an error of its own. Because the site handler answers an
unknown path with `index.html`, that missing worker is even served as HTML with
`200`, which is why the failure looked like a client capability problem.

The renderer therefore binds a worker URL the application build emits
(`maplibre-gl-worker-<hash>.js`, published beside the application chunk) before
it creates the first map, and `tests/deployment/map-worker-asset.test.ts` keeps
every Web client publishing and referencing that asset. A host that already
configured its own MapLibre worker URL keeps it.

### Appearance selection

`MapRenderer.setAppearance` selects the published variant. It is renderer
presentation state: the authenticated map home resolves the local light / dark /
auto preference and forwards the result, and a camera or appearance change never
writes Bond, BondChain, or Relationship truth.

A style swap on a mounted map reuses the map instance and its camera. A failure
during the swap is reported as `style-load-failed` rather than leaving a blank
map behind.

### Not in this style yet

Text labels are deliberately absent. MapLibre renders text only from glyph
ranges, and 0x1 serves map data same-origin, so labels wait on a same-origin
glyph payload under `/map/<version>/`. The label palette is already reserved in
each style's metadata so that work is a delivery problem, not a design decision.
Street and place labels at building scale therefore remain blocked on that
payload; the layer order already leaves them room beneath the location overlay.

Terrain and hillshade are likewise absent: they need a DEM source, and the
regional bootstrap publishes no same-origin DEM yet.

## TODO — global coverage

The regional bootstrap is not the product target. 0x1 requires global basemap coverage.

Moving from the Kyiv bootstrap to global coverage MUST NOT require a new `MapRenderer` semantic contract merely because coverage expands. Replace the regional data artifact with a global or globally partitioned self-hosted dataset behind the versioned map publication boundary.

Before global publication, replace the one-time server bootstrap with a reproducible data pipeline that pins source provenance, validates the generated archive, publishes atomically, and supports rollback independently of the Web client release.

Close Zoom, terrain, routing, transport, and Avaia world simulation are separate capabilities and must not be smuggled into this basemap bootstrap task.

---

© 2026 aiaiaiai · aiaiaiai.org
