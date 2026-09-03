# 0x1 Map Visual Language

The geographic map uses a light mineral presentation language: near-white surfaces, cool grey relief and hierarchy, graphite geography, cyan primary light, and orange counterpart light.

This is presentation state only. Cyan and orange do not encode `Bond_0`, `Bond_1`, consent, reciprocity, Relationship state, or any other protocol fact. A concrete view may assign the two accent roles to visible counterparts for contrast, but that assignment is local to presentation and may change between views or interactions.

## Palette

- surface background: `#f7f8f6` — land/background material;
- raised surface: `#eef0ef` — glass and elevated map UI;
- surface shadow: `#c8cdcc` — relief, depth, soft occlusion;
- geography graphite: `#545b5c` — roads, boundaries, labels, neutral geography;
- primary accent: `#00d8f2` — selected/active presentation light;
- counterpart accent: `#ff7a1a` — contrasting counterpart presentation light.

The accents should behave as light rather than broad flat fills: a saturated core may be accompanied by a softer translucent halo or reflected light. Neutral geography should remain visually subordinate to Bonds and Interactions projected from authoritative application state.

## Authenticated shell

The versioned `/map/0.1.0/style.json` contract remains the mineral-light geographic substrate. The authenticated Web home may use a dark host-local shell, glass, typography, and identity accents around or over that substrate. Those shell choices are product presentation and do not replace the versioned geographic palette. In particular, violet and coral used by the authenticated shell are not new map-contract meanings and do not supersede the cyan/orange map accent roles.

The authenticated shell must not turn presentation into protocol truth:

- authentication does not assert spatial Presence;
- browser device geolocation may move the local camera but is not authoritative Bond position;
- an unavailable AI Bond may be shown as an unavailable counterpart candidate, but a separator between two displayed identities must not imply reciprocity, a completed Interaction, BondChain, or Relationship;
- shell colors, glow, proximity on screen, and camera focus remain presentation unless backed by an authoritative projection.

When a dark geographic basemap is needed after the real PMTiles archive is activated, it should be introduced as an explicit versioned map-style variant instead of silently redefining the mineral-light contract through host CSS.

## Scale behavior

At distant zoom levels, the map should remain predominantly monochrome. Cyan and orange should become more visible as the view approaches interaction-relevant human scale. This is visual hierarchy only and must not fabricate density, presence, proximity, or interaction state.

## Basemap activation

The current `0.1.0` style contract records the palette while the geographic `basemap.pmtiles` archive remains unpublished. When the real self-hosted Protomaps archive is activated, roads, buildings, water, land cover, boundaries, labels, and optional hillshade should be mapped onto this palette without changing the semantic boundary: MapLibre renders geography; Core-facing projections remain authoritative for shared world and interaction truth.

---

© 2026 aiaiaiai · aiaiaiai.org
