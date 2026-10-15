# Camera coordination

The camera is presentation state. Moving it never records presence, moves a Bond, creates an Interaction, writes BondChain, or changes Relationship state.

## Ownership

There is one application-level coordinator above renderer implementations. MapLibre remains an adapter and does not decide which product concern owns motion.

The precedence is deterministic:

1. A direct person gesture (`pan`, `zoom`, `rotate`, `pitch`) immediately owns the camera and cancels any in-flight application transition.
2. An explicit product focus action initiated by the person may deliberately hand control back to the application. Location, body, and fragment focus are equal at this tier; the newest explicit action wins.
3. An in-flight application transition is not interrupted by automatic motion.
4. Automatic motion is accepted only while the camera is otherwise free. After a direct gesture, automatic motion remains blocked until an explicit product focus action occurs.

A scene with [xSasha](guide.md) is an explicit product moment rather than
automatic motion. It starts from a world at rest, covers the world while it
plays so no gesture competes with its shots, and hands the camera back to
exactly where it found it. Its shots may name a longer transition than the
renderer's default; that changes how long a move takes, never who owns it.

This keeps a person's camera choice stable while still allowing controls such as “recenter”, body focus, or an explicitly selected cell-bound fragment to work immediately.

## Cancellation boundary

Every accepted application focus gets a monotonically increasing generation. Retargeting cancels the previous transition. A completion callback may release ownership only when its generation still matches the active transition, so a stale animation completion cannot clear a newer request.

## Opening camera

A new map instance first frames geographic countries at zoom 3.3, backed by a genuine low-resolution global source. When the map becomes ready, the first observed position triggers a single 2.3-second MapLibre flight to the usual local-cell camera (zoom 18.5); reduced motion skips the animation. A remembered on-device position can serve as the first flight target while current geolocation resolves; a nearby live fix must not restart the flight. This is camera presentation, not a Bond location mutation. A direct gesture claims camera ownership immediately, and a Telegram viewport resize refreshes the renderer without changing geography.

## Following the body

The camera follows the body at the wheel the way a game camera follows its
character (`follow-camera.ts`, `use-follow-camera.ts`). It opens **locked**:
while the body walks, every frame keeps it in the middle of the world, and the
person's zoom, bearing and pitch stay exactly as they left them.

- **Orbit, tilt and zoom keep the lock** — the Lineage II chase camera. A
  right-drag or a two-finger twist turns the camera around the body, and the
  wheel or a pinch closes in on it: while locked the renderer pivots zoom on
  the viewport centre (`MapRenderer.setZoomPivot`), so the body stays where it
  is instead of sliding toward the pointer.
- **A drag that leaves the body out of frame unlocks it** — the MOBA camera
  unlocked from its hero. "Out of frame" is the same 48 px tolerance that
  separates a centred location control from a displaced one. A walking body
  then never pulls the camera back.
- **Space** brings the camera back onto the body and locks it; **Y** (the
  physical key, on any layout) locks or unlocks it. A key pressed into a
  control, a dialog or with a modifier is left to it.
- Focusing the body at the wheel and taking the wheel lock the camera, since
  both land on the body. Recentring locks it when the Bond is at the wheel
  and releases it when the Avaia is, because it goes to the Bond's place.

A person's gesture still wins at once (rule 1): the renderer reports when a
gesture starts (`MapCameraChange.phase`), and the follow stands still from
then until it settles. An application move — a focus, a handover, the opening
flight — is left to finish before the follow takes the camera again. The
follow stands down entirely while a scene, an informer or a handover has the
camera, and outside the world. It is presentation only: it moves the camera,
never the body.

A followed camera moves every frame by a fraction of a pixel, so the world
reads it again only once it has moved 8 px or changed zoom, bearing or pitch.

## Cell-bound fragments

H3 remains adapter-owned. `presence-geo` converts an opaque `CellIndex` into a `CellCameraAnchor` containing the same cell identifier and only the cell centre needed for presentation. Product code never imports H3 APIs.

A fragment camera target is bounded between neighborhood and street scale. It may centre the viewport on the cell, but it may not infer a more precise position or force a building-level close-up from cell membership alone. Current bearing is preserved. Explicit 2D remains flat. Safe-area padding and reduced-motion behavior continue to use the existing shared camera policy.

## Intended Phase 2 use

A future cell-bound fragment should perform the flow below rather than call a renderer directly:

```text
CellIndex
  -> presence-geo CellCameraAnchor
  -> fragment camera policy
  -> camera coordinator
  -> accepted target / blocked decision
  -> renderer port
```

The fragment never owns a MapLibre instance and never bypasses a person's gesture ownership.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
