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

Three explicit camera modes are selected on the world overlay next to the
location control (`follow-camera.ts`, `use-follow-camera.ts`).

Each identity at the wheel offers its own set of modes (`cameraModesFor`).
Bond and Avaia offer all three and open in Isometric. xPing opens in
Follow alone: Isometric and Free still show in the control, unavailable.
Without a mode, nothing switches into it: its button, a pinch out, Y and
an application release all keep the camera following, and a pinch out
only zooms. When the identity changes and the mode in use is not offered,
the camera returns to Follow.

- **Follow** looks over the head of the body at the wheel. Its
  bearing follows the rendered body's facing, including turns in place; no
  device compass heading is inferred. Pitch is 60° from overhead (30° down
  towards the ground), never wider than the zoom bodies are drawn from (18.5).
  The opening view and the person's closer zoom stay until a distance is chosen
  explicitly with the Follow button.
  The ground target lies about 2.77 m ahead, placing the sight line through a
  nominal 1.6 m head. This is framing, not a change to the body's position.
  Explicit flat/2D mode keeps pitch zero and centres on the body.
  Orbit, tilt and pan gestures pause tracking while in progress, then ease
  back behind the head even if the body is stationary. Free retains arbitrary
  viewing angles. Zoom pivots around the viewport centre while Follow is active.
- **Isometric (Bond/Avaia default)** is a separate tracking mode inspired by the gameplay reference.
  It holds bearing 45° and pitch 50° from overhead, so a body turn does not
  rotate the world. Its ground target lies about 1.91 m along the camera axis.
  Exponential damping (180 ms response) glides after movement and finishes a
  short catch-up after the last body step, independently of frame rate.
  Acquisition, relocations over 60 m and pauses over one second take the target
  directly. Reduced motion also tracks directly; explicit flat mode stays flat.
  Switching to Follow or Free, gestures, focus holds, scene ownership, dimension
  changes and unmount cancel pending tracking frames.
- **Free (Dota-style)** detaches camera position from Bond/Avaia movement.
  Dragging and touch panning explore the map independently; wheel and pinch
  zoom toward the pointer. No body motion recentres it.
- **On a phone two fingers choose the mode**: pinching out by at least 0.35
  zoom levels steps back from the body into Free, pinching in by as much
  returns to the last selected tracking mode (Follow or Isometric) and eases
  onto the body. A smaller pinch, a pinch the way
  the mode already is, a mouse wheel or a trackpad pinch only zoom.
- The on-screen **Follow / Isometric / Free** control is available on mobile and desktop.
  It opens expanded, then collapses to the current mode after three seconds
  without panel interaction. A map gesture or ground tap collapses it at once;
  automatic tracking and camera flights do not count as input. Pressing the
  collapsed chip opens all three choices without consuming a distance step.
  Changing mode reveals the panel again, including Free entered by pinch-out,
  and starts a fresh idle period. Expanded mode buttons retain their selection
  and distance-cycle behavior. Pending timers and subscriptions end on unmount.
  Its selection travels from the mode being left to the one chosen, and the
  panel widens or narrows from one size to the other, on the Dock window's
  420 ms curve; reduced motion moves both without travel.
  The first explicit Follow press, or selecting Follow from Free, chooses
  the closest preset; further presses cycle close → medium → far → close
  (zoom 21.5 → 21 → 20.5 → 21.5). Each preset is applied once on the press.
  Tracking and recentring keep the current zoom down to the normal 18.5 floor.
  A person's zoom replaces the preset, so the next press enters at close again.
  Each Free button press focuses the current driver once and steps through
  zoom offsets −1, −2, −3, −2, −1, 0 relative to the current zoom, or the zoom
  an unfinished camera ease is targeting (not an intermediate eased frame):
  three steps away, three back. Free then remains detached from body motion.
  A manual gesture, mode change or scene handover resets the Free sequence.
  Repeated taps advance from the selected step even during an unfinished ease.
  These button cycles do not change Space/Y or programmatic release semantics.
  **Y** toggles Free and the last tracking mode; **Space** explicitly selects Follow and recentres on
  the body. Repeating a held key never triggers another camera animation.
  Keys inside controls or dialogs, or with modifiers, are left alone.
- A camera focus or wheel handover performs its requested camera move
  without changing the selected mode. Recentring keeps the mode with the Bond
  at the wheel; with the Avaia at the wheel it goes to the Bond's place, away
  from the followed body, so it selects Free. Apart from the pinch above,
  gestures do not change the mode.

The renderer reports gesture start and end (`MapCameraChange.phase`) and
whether a gesture came from a touch screen (`MapCameraChange.touch`). Follow
never fights a gesture in progress, nor one that is only starting: MapLibre
cancels the gesture it is recognising whenever the camera is set, so Follow
moves with `MapCameraOptions.yieldToGesture` and the renderer skips them while
a finger or a mouse button is on the map. Otherwise turning the camera around
a walking body would snap it straight back. Opening flights and focus moves
get time to settle before tracking resumes, including for a stationary body. All three modes stand down during
cutscenes, the system informer, handovers and outside the world. Tracking
takes the driver's independent stance where available, or the observed
device position for a Bond with no declared position or an Avaia with no
independent stance. It does not depend on an avatar study being loaded;
hiding a rendered body does not itself interrupt follow. When an
observed device fix has more than 50 m of uncertainty, Isometric tracking
retains the wider opening zoom instead of forcing the body-visible floor;
this does not make the observation any more precise.
This is presentation only: camera actions never change a body, Bond or
presence state.

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
