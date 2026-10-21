# Landmark-directed Experience Orbs

**Status:** shipped with Core orb spill v2 ([core#64](https://github.com/nilx-one/core/pull/64),
[core#65](https://github.com/nilx-one/core/pull/65)); the pinned and deployed runtime
answers `orb_spill_version() = 2`. Real-device inspection (step 3 below) is not
recorded. The per-find spill this document extends is being replaced by
[Experience Orbs](exp-orbs.md) per opened cell.

When a fog cell is opened, the existing artifact roll and the existing
first-wins spill service continue to decide which finds drop Experience Orbs.
The Web host looks for actual archived `MapLandmark` features in the **same
cell as the find**, within the local archive cache. It prefers monument,
memorial, artwork, museum, archaeological and historic features; then the
nearest valid feature to the find; ties are resolved by stable feature id.

The host passes a waypoint only when the loaded Core runtime advertises
`orb_spill_version() >= 2`. Version 1 gets the exact legacy JSON wire,
without `via`: old `KnownSpill` decoders reject unknown fields.
Core, not Web, decides the waypoint's impact on the generated orbit positions;
the existing actual find remains the sole final `goal` and the same
`artifact_id` is claimed.

The map preloads already-published archived POI tiles inside the opened cell.
A network error, no available landmark, or an older runtime results in the
original direct-to-find trail. The host does not invent a monument, alter a
find's coordinates, fabricate attendance or create a BondChain interaction.

## Verification / rollout

1. Merge and ship the reviewed Core v2 runtime, with its Wasm capability
   export, before enabling waypoint-bearing inputs.
2. Validate Web's v1 fallback, same-cell landmark selection and guided v2 wire
   against the deployed runtime.
3. Inspect on real iPhone Safari and Telegram Mini App: a monument-bearing
   cell should contain an orb trail that bends toward the monument then ends
   at the unchanged find. Empty archived cells must retain a direct trail.

The 15 m Bond fog-auto-reveal change is separately delivered in
[Web PR #478](https://github.com/nilx-one/web/pull/478), which uses the same
`onRevealed -> orbSpills.spill` entry point as Avaia; it does not mint orbs
from arbitrary client-visible markers.

© 2026 aiaiaiai · aiaiaiai.org
