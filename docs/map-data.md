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

| Source layer | Used for                        | Attributes read        |
| ------------ | ------------------------------- | ---------------------- |
| `earth`      | land mass                       | —                      |
| `landcover`  | coarse natural cover            | `kind`                 |
| `landuse`    | parks, green mass, urban fabric | `kind`                 |
| `water`      | water bodies and rivers         | `kind_detail`          |
| `roads`      | road hierarchy and rail         | `kind`                 |
| `buildings`  | footprints and extruded volumes | `height`, `min_height` |
| `boundaries` | administrative edges            | —                      |
| `pois`       | quiet point detail              | —                      |

`tests/deployment/map-assets.test.ts` keeps the styles inside that list, so
adding an attribute to a style is a deliberate change that has to be verified
against a real archive first.

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
