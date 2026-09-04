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
/map/0.1.0/basemap.pmtiles
```

`basemap.pmtiles` is deployment data and MUST NOT be committed to Git. The Web containers mount the server-owned archive read-only while `style.json` remains part of the immutable client image.

OpenStreetMap attribution must remain visible wherever OSM-derived map data is rendered.

## TODO — global coverage

The regional bootstrap is not the product target. 0x1 requires global basemap coverage.

Moving from the Kyiv bootstrap to global coverage MUST NOT require a new `MapRenderer` semantic contract merely because coverage expands. Replace the regional data artifact with a global or globally partitioned self-hosted dataset behind the versioned map publication boundary.

Before global publication, replace the one-time server bootstrap with a reproducible data pipeline that pins source provenance, validates the generated archive, publishes atomically, and supports rollback independently of the Web client release.

Close Zoom, terrain, routing, transport, and Avaia world simulation are separate capabilities and must not be smuggled into this basemap bootstrap task.

---

© 2026 aiaiaiai · aiaiaiai.org
