# xPing flyover

The contract is core's [xPing flyover](https://github.com/nilx-one/core/blob/master/docs/xping-flyover.md):
what starts it, where it goes and what it may never do. This page is how
Web carries it out (`features/flyover`).

## Starting

`useFlyover(renderer, ready).start({ from, to })` starts a flight: `from` is
where the Bond and its Avaia stand, `to` the business station the
subscription concerns. Only Agreed in the Exclusive or Special subscription
cutscene may call it. The courier offer in Settings calls this same hook
after Core's `courier_destination` has chosen a BusinessPoint. On a runtime
without that export, the built-in Kyiv catalog's explicit preview chooses
instead; malformed Core output and other failures stay failures. External
directories without a preview report route unavailability.

## Courier integration

The offer, activity stack and nearest-destination selection are separate
from this flight engine. They reuse #452's camera controls, #453's drone
and route renderer, and #454's route and motion. There is no second drone
flight or straight-line animation in the courier feature.

`progress` reports the actual route's remaining duration and current point.
Only `arrivedAt`, emitted by the flight reaching its end, enables the
activity's completion mark. Choosing the destination yields no estimate:
nothing but the flight drives the visible progress or completion. Leaving clears progress
without reporting success. During route loading (and the static reduced
motion preview), no arrival is inferred from elapsed wall-clock time.

The activity row tells progress as xPing's ground distance to the
destination, named by the BusinessPoint's localized display name ("150 m to
0xda-market Golden Gate"), rounded up to whole 50 m steps so it changes once
per step rather than every frame.

In flight the Dock and status rail stand down. The bottom of the screen is
the activity row (distance and **↗ xPing**), with the steering right above
it; the location and camera controls are hidden until the flight ends.

Only the flying xPing takes taps, and only while it flies: the renderer
hit-tests a drone just when something has subscribed to that drone's id.
The offer drone parked on the Bond and the hint drones beside it leave
Bond and Avaia their taps. The offer shot reads the latest fix but is
staged once per offer; closing it restores the camera from before it.

Activity overview temporarily releases the chase camera with
`setFollowing(false)` but does not stop the flight or compute another route.
Selecting xPing restores the chase. The courier and cell-opening activities
remain peers even while Avaia's travel prompt is shown.

Commerce is deferred: neither arrival nor agreement grants a subscription.
The default Kyiv map can dispatch to its author-seeded pins without commerce.
A verified business directory remains separate from these game destinations;
see [the catalog and its sources](market-points.md).

## Route

Before the flight, the roads in a box around both ends (400 m of margin) are
read with `preloadRoads` and joined into the light road graph Avaia walks.
`planFlyoverRoute` routes on it from end to end, joining each end within
250 m; without a path it is the straight line. The route is drawn with
`setRoute`, a dash-dot line, and cleared when the flight ends.

## Flight

`flyover-flight.ts` is pure and deterministic. xPing flies the route at
30 m/s on a local metric plane, its corners rounded so it banks through
turns. Five lanes, 14 m apart, lie across the route, its own in the middle.
Every frame it reads the roofs 110 m ahead in each lane (`obstaclesWithin`,
refreshed every 250 ms):

- Its height follows how built up the ground ahead is, from 14 m over open
  ground to 34 m over dense blocks, and clears any roof in its lane by 7 m.
- A roof it would need more than 60 m to clear sends it to the nearest free
  lane, nearer the route on a tie. Once the building is behind it, the
  route pulls it back.
- A lane change is a stiff spring, a climb a brisk one, a descent a glide.
  It banks by its real turn rate (up to 38°) and leans its nose into speed.

At the wheel, a sideways swipe, ←/→, `A`/`D` or the ◀ ▶ buttons step it
one lane aside, at most two either way. The step holds for 1.4 s, then the
route pulls it back. Steering into a building it cannot clear still goes
around it. Escape or the leave button ends the flight.

## Camera and ending

While it flies, the world's own camera stands down (Follow, Isometric and
Free, and the mode panel). It takes off beside the Bond for 1.4 s, then the
chase camera follows from behind at pitch 60°, a little ahead of xPing and
swinging round to its heading, wider the higher it flies. At the station
it hovers for 2 s; then the drone and the route are removed and the camera
eases back to where it was. With reduced motion the route and both ends
are one still view, xPing at the station, until the person leaves.

Presentation only: no body moves and nothing is recorded.

## Forcing and the way back

The steering row holds **push to force** between ◀ and ▶, filled with what
is left of the engine. While it is held, and the engine allows it, xPing
builds up over three seconds (`FLYOVER_FORCE_RAMP_MS`) to 2.5× its speed and
twice its height, and flies straight at the destination: the drawn route
becomes that straight line. Let go, it slows back down over the same three
seconds and joins the road route where it is nearest, the offset pulled back
in like a lane step. The drone smokes and sparks more as the engine empties.

Forcing is counted as it happens and told to the identity service a second at
a time (`features/xping/xping-forcing.ts`); the service runs Core's rules. On
empty, two more seconds of forcing break the engine: the report that crosses
it is sent at once, the service records the breakdown at its own clock, and
the flight is called off ("xPing broke down · flight called off"). A broken
engine keeps xPing in its dock: the offer says so until it mends or is
repaired.

After hovering at the station xPing always flies back to where it set off,
along the same roads and never forced; only then does the world get its
camera back. The activity row tells the way back as the distance to the start.

## Engine, smoke and repair

xPing's engine is Core's rules (`docs/xping-engine.md` in core), stored by the
identity service at its own clock (`/api/v1/identity/xping/engine`). The
Avaia's Dock window has an **xPing** section: the engine's energy and smoke,
when it is full again or, broken, when it mends itself, and a repair priced by
Core (50 Seed ₴€£ for an empty or broken engine, 25 for half).

A repair runs inside the owner's inventory queue (`features/xping`): read the
engine and the service's clock, let Core's `xping_repair` price it against the
inventory, have the service record it on exactly that engine state, and only
then store the inventory. A refusal (`stale`, `underpaid`, not enough Seeds)
stores nothing. Every Bond is given 10,000 starter Seed ₴€£ once, by Core's
`grant_starter_seeds`.
