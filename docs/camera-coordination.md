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

A new map instance first frames geographic countries at zoom 3.3, backed by a genuine low-resolution global source. When the map becomes ready, the first observed position triggers a single 2.3-second MapLibre flight: accurate GPS (up to 50 m uncertainty) lands at the established local-cell zoom 18.5, coarser GPS observations progressively widen the view (one zoom step per uncertainty doubling, no farther out than neighborhood zoom 13), and manually declared positions land at zoom 20.25 to make the driver readable without claiming a device observation. Invalid sensor accuracy conservatively uses neighborhood zoom. Reduced motion skips the animation. A remembered on-device position can serve as the first flight target while current geolocation resolves; a nearby live fix must not restart the flight. This is camera presentation, not a Bond location mutation. A direct gesture claims camera ownership immediately, and a Telegram viewport resize refreshes the renderer without changing geography.

## Follow and Free camera

Two explicit camera modes are selected on the world overlay next to the
location control (`follow-camera.ts`, `use-follow-camera.ts`).

- **Follow (default)** tracks the body at the wheel while it moves, retaining
  the person's zoom, bearing and pitch. Orbit, tilt and zoom gestures pause
  tracking while in progress. A drag that leaves the body out of frame (the
  48 px "centred" tolerance) eases straight back to it when the gesture ends.
  Zoom pivots around the viewport centre while Follow is active.
- **Free (Dota-style)** detaches camera position from Bond/Avaia movement.
  Dragging and touch panning explore the map independently; wheel and pinch
  zoom toward the pointer. No body motion recentres it.
- **On a phone two fingers choose the mode**: pinching out by at least 0.35
  zoom levels steps back from the body into Free, pinching in by as much
  returns to Follow and eases onto the body. A smaller pinch, a pinch the way
  the mode already is, a mouse wheel or a trackpad pinch only zoom.
- The on-screen **Follow / Free** control is available on mobile and desktop.
  **Y** toggles modes; **Space** explicitly selects Follow and recentres on
  the body. Repeating a held key never triggers another camera animation.
  Keys inside controls or dialogs, or with modifiers, are left alone.
- A camera focus or wheel handover performs its requested camera move
  without changing the selected mode. Recentring keeps the mode with the Bond
  at the wheel; with the Avaia at the wheel it goes to the Bond's place, away
  from the followed body, so it selects Free. Apart from the pinch above,
  gestures do not change the mode.

The renderer reports gesture start and end (`MapCameraChange.phase`) and
whether a gesture came from a touch screen (`MapCameraChange.touch`). Follow
never fights a gesture in progress. Opening flights and focus moves
get time to settle before tracking resumes. Both modes stand down during
cutscenes, the system informer, handovers and outside the world. This is
presentation only: camera actions never change a body, Bond or presence state.

Camera readback into React is throttled until the centre moves 8 px or zoom,
bearing or pitch changes, to avoid 60 view rerenders per second.

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
