# Geographic fog rendering

`map-shade` renders coverage from H3 membership into a fixed, north-up Mercator
atlas. A native MapLibre canvas/raster source projects this atlas and drapes it
onto the DEM terrain used by the streets. There is no independent sea-level
quad or camera matrix in the fog renderer.

WebGPU is preferred for the fog material. Missing adapters, rejected devices,
pipeline failures, initialization timeouts and device loss select a fresh WebGL2
canvas. Both consume the same mask, world distances and palette parameters. A
stable presentation canvas keeps the MapLibre source intact across fallback.
MapLibre's basemap compositor itself still uses WebGL; this does not migrate the
whole map engine to WebGPU.

Coverage never depends on zoom, pitch, bearing, viewport or animation time. The
material is clipped out of revealed cells before any colour/noise calculation.
A one-atlas-texel guard keeps compositor filtering from bleeding into open
cells. This is a raster representation of H3, not a change to H3 membership.
The inherited 20 km region and 2048-square texture limit geographic extent and
edge precision; tiling/streaming beyond that region is not implemented here.

The Bond's occupied cell is temporarily open in the same presentation source.
Moving removes the previous transient opening unless a real visit or completed
reveal already opened it. Occupancy never writes a presence record or a saved
reveal. Owner changes replace mask membership and invalidate in-flight frames.

Material updates are capped at eight per second by default, stop while hidden,
and do not run for reduced motion. Each update requires a canvas copy into the
MapLibre raster texture. Camera changes reproject the existing texture without
regenerating the mask or material. Rendering failure is reported through the
map's error event. Native terrain draping covers the ground surface; it is not
volumetric occlusion of building roofs or other elevated objects.

## Verification

- `pnpm exec vitest run packages/map-shade packages/product-app/src/features/map/use-fog-reveal.test.tsx tests/architecture/presence-privacy.test.ts`
- `pnpm exec playwright install --with-deps chromium`
- `node scripts/check-fog-browser.mjs`

The browser check compiles and runs both GPU shaders, compares their coverage
and colour, checks that animation cannot change alpha, and projects revealed
and unrevealed cell centres through 32 camera/terrain configurations over a
local 200 m DEM. It runs in the `Fog renderer browser checks` CI job. It uses a
software GPU and does not replace the real iPhone Safari acceptance check.

For manual inspection, run `pnpm exec vite --host 127.0.0.1` and open
`/packages/map-shade/tests/browser.html`. No external tile service is used.
Before release, pan/zoom/rotate on iPhone Safari with terrain on and off; confirm
that the H3 frontier remains attached to streets and the occupied Bond cell
stays clear, then change appearance and switch owners.

© 2026 aiaiaiai · aiaiaiai.org
