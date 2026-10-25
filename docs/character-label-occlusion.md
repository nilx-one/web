# Non-occluding character labels

> Design contract — documentation only. No runtime behavior changes in this PR.

## Problem and scope

On 25 October 2026, in the iPhone Telegram Mini App at building scale,
`x0skai`'s identity/activity/status callout covered most of the visible
3D body. As the Avaia walked, the label moved across the body instead of
making room for it. The tier, walking state, distance and line of speech
were legible; the character and its subscription aura were not.

This document defines **a character versus its own label**. It complements
the shared avatar/landmark/destination collision issue
[web#498](https://github.com/nilx-one/web/issues/498), which owns
**callout versus callout** priority and viewport clipping. Do not build
parallel global placement engines: the character avoidance region and
preferred compact presentation must feed the same eventual collision
policy. The existing body/card handover in
[map-visual-language.md](map-visual-language.md#marker-and-card) remains
normative; this proposal names a new *compact nameplate*, not a second
full observed-position card.

Web presentation only: no Core schema, entitlement, geolocation,
identity, scene-truth, subscription-clock or deployment changes.

## Three presentation states

| State                   | World body                                             | Overlay                                                                                     | Allowed content                                                                         |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Near / body visible** | Draw the real 3D body and depth-tested aura            | **Compact nameplate**, offset outside the body's projected silhouette                       | Identity (pub_dress), effective tier if known, and short activity/distance when it fits |
| **Far / body hidden**   | No world body, as required by `MAP_BODY_HANDOVER_ZOOM` | Existing full position card with one live/still body preview                                | Identity, activity, distance, current speech according to existing card contract        |
| **Focused details**     | Do not cover the world body                            | Separately positioned expanded information surface (Dock/popover with safe-space placement) | Full identity, effective tier, state, distance, speech and appropriate actions          |

A nameplate is *not* a full avatar preview and never creates a second body
or image. The world body's visibility threshold continues to be the
single source of truth shared by map and application. No intermediate
zoom band may render both the full card and the world body, or neither.
When the host cannot render a body, preserve the existing documented
still-image fallback; do not leave an empty preview.

The near nameplate is a **maximum of two compact lines**:

- First: `x0skai · Exclusive` (or `Special` where effective; omit
  tier entirely when unknown, rather than implying `None`).
- Second, only while space permits: `Walking · 10 m` (localized).
  Keep authoritative distance provenance and existing labels such as
  "This device"; never calculate proximity from projected screen pixels.
- At the tightest layout, keep the address alone before hiding the
  whole nameplate. No forced ellipsis that makes distinct addresses
  indistinguishable: reveal the full address in focused details.

Do **not** permanently append multi-sentence speech such as
"Short walk — show the look" or "The podium is there" to the near
nameplate. Speak it as transient non-blocking feedback through the
existing narration/announcement affordance; if a visual bubble is used,
it follows the same collision rules, expires, and does not enlarge the
permanent nameplate. Keep the full accessible announcement and the
existing far-card speech behavior.

## Placement contract

1. Anchor the nameplate to the **actual rendered body handle** and its
   current world position, not to a viewport-fixed `top/left`, a stale
   device GPS coordinate, or the map marker alone. Avaia may have an
   independent stance; do not reintroduce a GPS dependency (see
   [web#559](https://github.com/nilx-one/web/pull/559)).
2. The map renderer projects body bounds into CSS-pixel screen space
   using the **same live camera** (bearing, pitch, zoom) and current
   body transform. Use its projected silhouette/bounding envelope from
   head through feet, not merely the marker point. Include the
   presentation aura's visible envelope when possible. Maintain at
   least **12 CSS px** breathing room outside the avoidance region;
   a bounded conservative fallback is safer than a false precision
   claim when model bounds are unavailable.
3. Measure the **actual** nameplate dimensions (after localization,
   tier/status and font changes) and the usable viewport after Telegram
   host chrome, shell header, toasts, safe areas and live Dock height.
   Never anchor under these regions or beyond the visible edges.
4. Prefer upper-right of the body, then upper-left, then above, then
   another free side. Score candidate rectangles for overlap with the
   character, important callouts and interactive chrome. Use the
   shared #498 collision priority and suppress low-priority detail
   before allowing a label to cross the character's avoidance region.
5. Use a short, subtle connector to the body anchor only when the
   connector is not drawn through the character or mistaken for a
   geographic route. Neither connector nor nameplate modifies its
   true world position.
6. If the viewport is too small for any legal candidate, simplify
   to the address-only chip; if that still cannot fit, suppress the
   near chip until there is room, while keeping identity accessible
   from the Dock/focus action. **Do not center the chip on top of the body**.
7. Recalculate when the camera moves, the character walks/turns,
   viewport/Dock changes, locale or status changes, and when another
   callout enters/leaves the scene. Use hysteresis when changing sides
   and interpolation for within-side tracking, so a walking body
   does not make the label jump or vibrate; do not write identical DOM
   text on every render frame.

The collision system must distinguish an avatar's drawn **screen
silhouette** from its geographic accuracy ring: shrinking or moving
the ring to make the card fit would falsify the observation.

## Interaction, layering and status

- The near chip is legible in light/dark appearance and is not a tap
  shield for map gestures. If it is interactive, expose a deliberate
  accessible hit target for details; other overlay space stays
  pointer-transparent. Never steal ground-tap-to-walk.
- Focused details open where free screen space exists or in the
  established Dock. They are dismissible and do not recenter the
  camera or silently change the wheel.
- Subscription colors come only from the **effective** trusted tier,
  following [subscription-status.md](subscription-status.md).
  Exclusive gold/white and Special violet are already represented
  chiefly by the 3D aura; the label must **not hide that aura**.
  Respect existing acquisition/removal transitions and reduced motion.
- A selected/active character outranks incidental map callouts, but
  landmarks and destinations must remain discoverable under the
  shared #498 priority policy. Flight HUD retains its own context.
- No text, color, distance, aura, focus or screen placement is protocol
  Presence, consent, reciprocity or a new entitlement claim.

## Implementation seams (subsequent code PR)

- `packages/map-maplibre/src/observed-position-label.ts` owns
  the current full card DOM. Preserve its far-card body preview,
  theme, tier transitions and no-redundant-DOM-write behavior.
  Add a distinct compact mode/component, not a CSS width tweak to
  the full card that still overlays the body.
- Reuse map camera/body projection data from the renderer instead of
  adding an independently animated, viewport-anchored React duplicate.
  Keep the handover at `MAP_BODY_HANDOVER_ZOOM` atomic.
- Integrate with `AppShell`'s measured safe areas and shared #498
  callout collision work without changing header or Dock geometry.
- Keep the map rendered by the existing backend; no separate WebGPU
  overlay or second graphics context is required for label layout.

## Acceptance / regression matrix

- iPhone **Telegram Mini App**, narrow viewport, native host header,
  bottom Dock expanded and collapsed: chip never covers the visible
  body, face, torso or effective subscription aura; chip and focused
  details remain inside the usable viewport.
- Walk for at least 30 seconds in **Follow, Free, Isometric**, with
  pan, rotate and pinch-zoom; inspect frame-by-frame for placement
  jumps, flicker and occlusion. Check a long Unicode pub_dress and
  Ukrainian/English strings.
- Toggle **Special → Exclusive → None/unknown**, test interrupted
  transition and reduced motion. Unknown is not mislabeled None; no
  persistent speech line expands the chip over the body.
- Cross the body/card zoom threshold in both directions: one world
  body or one far-card body preview, never duplicated or absent.
  A model-load failure preserves the documented fallback.
- Test an Avaia with an independent stance **without device GPS**.
  Bond/device markers retain accurate anchors and rings.
- Many nearby labels, pinned destinations, tall Dock, toast stack,
  off-screen body and flight HUD: shared #498 priorities still work.
- Automated: unit test candidate rectangles/priority and viewport
  bounds; DOM test compact/full/focused states and accessibility;
  integration test handover, character animation and subscription
  transitions; verify that existing ground-tap routing is unchanged.
- Acceptance needs screenshots/video from a real iPhone/Telegram
  session and the exact revision tested. Local/browser tests and Full
  CI are necessary but **not** substitutes for device evidence.

## Delivery

This PR documents the contract only. A separate small implementation
PR should target this document and cross-reference #498 without closing
that broader issue merely because avatar/body occlusion is solved.
No merge or deployment is part of this documentation request.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
