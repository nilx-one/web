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

## Visual language

The published styles carry the first 0x1 map visual language: a near-white
spatial map with restrained cyan accents. The map is the spatial substrate of
0x1, so geography stays readable without competing with Bonds or Avaia.

| Role                 | Light                 | Dark                  |
| -------------------- | --------------------- | --------------------- |
| Background           | `#f7f9fa`             | `#070c0e`             |
| Land                 | `#f3f6f7`             | `#0b1215`             |
| Parks and green mass | `#edf4f1`             | `#0e1a18`             |
| Buildings            | `#e8eef0`             | `#172126`             |
| Primary roads        | `#d5e1e4`             | `#26363c`             |
| Secondary roads      | `#e4ebed`             | `#172126`             |
| Water                | `#dff7fa`             | `#04191f`             |
| Accent               | `#37d7e5`             | `#37d7e5`             |
| Label (reserved)     | `#536166` / `#879399` | `#a8b6bb` / `#6e7d83` |

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
`roads-secondary`, `roads-casing`, `roads-primary`), urban depth (`buildings`),
then minor detail (`boundaries`, `pois`). Buildings hand over from a flat wash
beneath the road network to restrained `fill-extrusion` depth above it around
zoom 15, using OSM `height` where the data has it and a conservative fallback
where it does not.

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

Terrain and hillshade are likewise absent: they need a DEM source, and the
regional bootstrap publishes no same-origin DEM yet.

## TODO — global coverage

The regional bootstrap is not the product target. 0x1 requires global basemap coverage.

Moving from the Kyiv bootstrap to global coverage MUST NOT require a new `MapRenderer` semantic contract merely because coverage expands. Replace the regional data artifact with a global or globally partitioned self-hosted dataset behind the versioned map publication boundary.

Before global publication, replace the one-time server bootstrap with a reproducible data pipeline that pins source provenance, validates the generated archive, publishes atomically, and supports rollback independently of the Web client release.

Close Zoom, terrain, routing, transport, and Avaia world simulation are separate capabilities and must not be smuggled into this basemap bootstrap task.

---

© 2026 aiaiaiai · aiaiaiai.org
