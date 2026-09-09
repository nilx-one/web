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

A published avatar study stands 1.80 m to 1.89 m tall, which is nothing on a map. At building scale — where focusing an identity lands — one metre is about half a pixel, so an unscaled person is roughly three pixels: present in the scene, invisible to the eye.

So a body carries a presentation size of its own, and it is **one size at every scale it appears on**. It does not grow into true scale as the camera comes in: a body is who is standing there, and how close the camera happens to be must not change what it is.

Two rules bound it:

- **Apparent size only.** The multiplier changes how tall a body is drawn and nothing else. It never moves the body, never widens the accuracy it stands in, and never survives into shared state.
- **A body withdraws before it can lie.** Further out than street scale no body is drawn at all — it would be too small to read. What is left is the marker and the card, and the card carries a still of the same study so the identity survives the distance.

One body is drawn — the identity at the wheel — and only while this device holds an observation of itself. A body on the map is never evidence of presence, proximity, or that anyone else is nearby.

## Marker and card

The marker is always drawn. It is three restrained circles — the accuracy the host reported, a pale edge, and the exact coordinate — and **all three lie flat on the ground**. A body stands on the marker rather than in front of it: pitched into the viewport the circles would tilt up into the figure and read as a disc pasted across its middle.

The accuracy halo is what the observation actually knows. A body stands inside it, not instead of it.

The **card** and the body take turns. Closer than street scale the body is on the world and speaks for itself, and a card over its head would only repeat it. Further out the body is gone, and the card is what is left — the identity, "this device", and a still of the study beside the text, so who is standing there is still legible when it is too far to draw.

One number decides which of the two is on the world, and the map contract publishes it. The renderer hides the card by it and the application draws the body by it, so the turn is a single fact rather than two that could drift into a width showing both or neither.

## Reaching for a body

A body is the most direct thing on the screen, so activating it means what a person means by pointing at it: bring the world to that identity. The camera goes to the closest scale the policy allows, and the Dock returns to the pair — a body belongs to that screen, not to whatever surface happened to be open.

What answers the reach is a target around the body rather than the pixels it covers: a body is drawn about as tall as a fingertip is wide, and a person aiming at one is not aiming at 24 pixels. Where two bodies overlap — which is what a handover looks like while it runs — the nearer one answers.

Pointing is not the only way there. The Dock offers the same two outcomes from controls a keyboard can reach, so nothing that can only be done by pointing at a canvas is the only way to do it.

## Who is drawn

One body: the identity at the wheel. The Dock already names it — one identity drives, the other spectates — and the world is that same statement drawn on the ground. Two bodies standing as peers would say something the Dock does not.

The world opens on the **Avaia**, in a study the Bond is not wearing. The Bond spectates on the right of the Dock until he takes the wheel.

Where a body stands is the one thing this client actually observed: its own device position. An Avaia is not there in any sense the protocol asserts — an Avaia may be anywhere, on an errand or a walk or at home, and where it is will come from an integration that knows. Until one does, the world can only draw it at the client's own anchor, and that is a limit of what is known rather than a claim about where it is.

An Avaia's runtime has nothing to do with whether it has a body. A body is the identity; the Dock's status dot is the machinery behind it, and the two are reported separately.

## Handing the wheel over

Taking the wheel is not one model replacing another at the same instant. The body that is leaving plays `quiesce` and goes; the body arriving plays `wake` and comes out onto the world. These are the two non-looping clips every published study carries, and the ambient sampler deliberately never reaches for them — they exist for this.

The two halves run in sequence, not overlapped, so the two identities are never both standing on the same spot. Each holds its own handle for as long as the handover runs, which is what lets the arriving study load while the other one is still settling.

Taking the wheel also brings the camera in far enough to see the body that arrived, and no further: a camera already closer than the scale a body is drawn from is where a person put it, and is left there.

An Avaia takes the wheel whatever this device can run. The runtime is a fact about the device, stated by the Dock's status dot; it is not a gate on which body the world draws, and an Avaia with no runtime is still an identity its Bond owns and can watch the world as. Where a runtime could be fetched and the host can fetch one, taking the wheel is also what asks for it — one gesture, not two.

Who is at the wheel is presentation. It moves nobody, asserts nothing about where anyone is, and is never written back.

No other identity is drawn. Nothing in the client carries a position for another Bond, and a body invented for one would be a presence claim the protocol never made.

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
