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

The versioned `/map/0.1.0/style.json` contract is the geographic substrate and the authenticated shell is designed as chrome over that same world, not as a separate application panel around it.

Light appearance is the primary visual reference: the map stays near-white and the header, Bond context, status and transient feedback use quiet translucent mineral surfaces with restrained cyan focus. The map remains visually dominant. The shell must not apply brightness, saturation, contrast or darkening filters to compensate for the published map style.

Dark appearance is a deliberate mapped variant. It keeps the same layer structure, hierarchy and interaction semantics rather than inverting arbitrary shell colours or creating a second product language.

The authenticated shell must not turn presentation into protocol truth:

- authentication does not assert spatial Presence;
- browser device geolocation may move the local camera but is not authoritative Bond position;
- an unavailable AI Bond may be shown as an unavailable counterpart candidate, but a separator between two displayed identities must not imply reciprocity, a completed Interaction, BondChain, or Relationship;
- shell colors, glow, proximity on screen, and camera focus remain presentation unless backed by an authoritative projection.

Persistent world ownership also remains explicit: `/`, `/identity`, and `/settings` are foreground presentation states over one authenticated world. Route changes must not redefine or replace geographic truth.

## Scale behavior

At distant zoom levels, the map should remain predominantly monochrome. Cyan and orange should become more visible as the view approaches interaction-relevant human scale. This is visual hierarchy only and must not fabricate density, presence, proximity, or interaction state.

City-scale fabric should already read at the bootstrap camera where the published archive supports it. Building footprints and secondary roads may appear before close zoom; volumetric building depth belongs to the later building-scale transition.

## Apparent size of a body

A published avatar study stands 1.80 m to 1.89 m tall, which is nothing on a map. At building scale — where focusing a Bond lands — one metre is about half a pixel, so an unscaled person is roughly three pixels: present in the scene, invisible to the eye. Zoom alone does not fix this without abandoning the scale the published styles are drawn for.

So a body carries a presentation size of its own. It holds a constant readable height on screen while the ground under it is still far away, and gives that up for true scale as soon as geography can carry a person on its own — around zoom 19.5, where 1.8 m first covers the readable minimum. From there the body is exactly as tall as it is.

Two rules bound it:

- **Apparent size only.** The multiplier changes how tall a body is drawn and nothing else. It never moves the body, never widens the accuracy it stands in, and never survives into shared state.
- **A body withdraws before it can lie.** Further out than street scale no body is drawn at all. The observed-position marker already says "here" at those widths, and a figure standing there would read as a person at a spot the observation cannot actually resolve.

One body is drawn: the signed-in Bond's own, and only while this device holds an observation of itself. An avatar on the map is never evidence of presence, proximity, or that anyone else is nearby.

## Known data-bound limits

The visual reference is intent, not evidence. Features are rendered only when the published same-origin map data supports them.

- text labels require a same-origin glyph payload before MapLibre text layers can be enabled;
- terrain or hillshade requires a published DEM source;
- individual vegetation, landmarks or other geometry must not be invented solely to imitate a reference image.

These limits are data/rendering concerns. The shell must stay usable and spatially coherent without fabricating missing geography.

## Basemap activation

The current `0.1.0` style contract maps the self-hosted regional Protomaps archive onto the 0x1 spatial language. Roads, coarse built fabric, buildings, water, land cover, boundaries and supported point detail are presentation over that archive; Core-facing projections remain authoritative for shared world and interaction truth.

---

© 2026 aiaiaiai · aiaiaiai.org
