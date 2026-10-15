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
