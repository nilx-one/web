# xPing flyover

The contract is core's [xPing flyover](https://github.com/nilx-one/core/blob/master/docs/xping-flyover.md):
what starts it, where it goes and what it may never do. This page is how
Web carries it out (`features/flyover`).

## Starting

`useFlyover(renderer, ready).start({ from, to })` starts a flight: `from` is
where the Bond and its Avaia stand, `to` the business station the
subscription concerns. Only Agreed in the Exclusive or Special subscription
cutscene may call it. That cutscene is not built yet, so nothing in the
product calls `start` today.

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
