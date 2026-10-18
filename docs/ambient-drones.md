# Ambient drones

The city has its own drones. They are scenery, like the light on the
buildings: nobody owns them, they are not Bonds or Avaias and they are not
presence. They fly around wherever the camera looks, along streets and
through yards, so the world reads as inhabited. This page is how Web draws
them (`features/ambient-drones`).

## Two kinds

| Kind     | Looks like                           | Flies                                                     | Height  |
| -------- | ------------------------------------ | --------------------------------------------------------- | ------- |
| `street` | graphite, yellow trim, with a parcel | along minor, medium and major roads                       | 16–22 m |
| `yard`   | small, white, orange trim            | paths, footways and courtyard lanes, never roads for cars | 9–13 m  |

Both are drawn at five times the 1.2 m drone, so one reads at street zoom.
They use the system prop surface (`SystemDroneHandle.kind`), never the avatar
catalogue. The renderer builds them from one shared kit of geometry and
materials: a drone is a handful of meshes and nothing more is allocated for
it.

## A schedule, not a simulation

The world is cut into 600 m cells on a fixed grid. A hash of the cell alone
decides whether it keeps no drone, one or two (about a quarter, a half and a
quarter of cells), and what each one is like. Each drone circles its cell's
hub through waypoints that are a hash of the drone and the leg's number.

```text
leg k   = hover 4 s at waypoint k, then fly 32 s to waypoint k + 1
leg     = floor((wall clock + drone's offset) / 36 s)
```

Leg `k` ends where leg `k + 1` starts, so the flight is continuous, and yet
no leg needs the one before it. Where a drone is at any moment is computed
from that moment in constant time. Nothing is simulated in between.

So a drone "keeps flying" while nobody looks at no cost at all. Whenever
someone does look, it is exactly where its schedule has brought it. Two
devices looking at the same cell at the same moment see the same waypoints.
The roads each one follows between them come from that device's loaded
tiles, so two devices can still route the same leg differently.

## Only what is on screen costs anything

`useAmbientDrones` requests animation frames only while all of these hold:

- the page is visible;
- the camera is at street zoom (16) or closer;
- the map is ready, the world section is open, and no guide scene or system
  informer owns the view;
- the person has not asked for reduced motion.

When any of them stops holding, the drones are taken off the world and no
further frame is requested. A camera move or the page becoming visible
wakes the loop again. While it runs:

- At most ten drones are drawn, from the cells nearest the camera, within
  the ground the view spans (at most 1.4 km away).
- A leg is planned once, when it starts, and after that it is only sampled.
  At most two legs are planned per frame, so coming back after a long time
  away never stutters.
- The roads come from the same self-hosted basemap archive the map draws.
  When the drones move to new ground, the roads of the tiles around them are
  read ahead once (`preloadRoads`: zoom 14, through the renderer's own cache
  of at most 32 tiles, oldest dropped first). A request already in flight is
  not made again, and a tile still held is reused, but one dropped from the
  cache is fetched again when needed. A leg waits up to 2.5 s for them,
  then settles for what is loaded. The road graph is rebuilt at most every
  3 s when new tiles arrive.
- A drone keeps low only over the road graph. A waypoint more than 15 m from
  it, the stretch from such a waypoint to the nearest road, and a leg the
  graph cannot carry are flown over the roofs at 46 m. That covers ground the
  map has not loaded and detours longer than 2.4 times the straight line.
  It climbs and descends over 50 m, and settles to its new height while it
  hovers at a waypoint.

Nothing about the drones is sent anywhere. No server knows of them, and no
record is written.

## How a leg flies

The route between two waypoints is rounded at its corners, like the flyover
route. The drone eases out of its hover, crosses and eases in. It banks into
bends from its speed and the bend's curvature and leans into speed. During
the hover it turns from the way it arrived to the way it is about to go,
the short way round.
