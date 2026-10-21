# Ambient animals

The city has its own animals. Like the [ambient drones](ambient-drones.md),
they are scenery: nobody owns them, they are not Bonds or Avaias and they are
not presence. Squirrels live in the parks, piranhas in the water, dogs and
cats along the footways, and now and then an eagle circles overhead. This
page is how Web places them (`features/ambient-animals`). How they are drawn,
and where their models come from, is
`packages/map-maplibre/src/assets/animals/README.md`.

## Who lives where

The world is cut into 40 m cells on a fixed grid. Each cell has two spots,
placed by a hash of the cell alone. What lives at a spot follows from the
ground the map paints under it, read in this order:

| Ground                                    | Lives there, per spot           |
| ----------------------------------------- | ------------------------------- |
| water (the `water` layer)                 | piranha 12 %                    |
| a building footprint                      | nothing                         |
| green landuse (the `parks` layer's kinds) | squirrel 22 %, dog 5 %, cat 3 % |
| within 10 m of a footway or path (`path`) | dog 5 %, cat 4 %                |
| anywhere else                             | nothing                         |

So a squirrel is only ever where there is grass and trees, and a fish only in
a pond or a river. A pond inside a park is water.

Eagles keep cells of their own, 600 m on a side, like the drones'. About
three in ten keep one. It circles a hub in its cell on a ring of 60–120 m, at
35–60 m over the ground, at about 12 m/s.

## A schedule, not a simulation

An animal wanders out from its spot and back, through waypoints that are a
hash of the animal and the slot's number. In each slot it walks from its
waypoint back by its spot and out to the next waypoint, at its own speed,
then rests there for what is left. A slot is long enough for the farthest
such walk, so an animal never moves faster than its speed.

| Animal   | Moves         | Wanders | Slot | Rests                      |
| -------- | ------------- | ------- | ---- | -------------------------- |
| dog      | walk, 1.2 m/s | 10 m    | 24 s | `idle`                     |
| cat      | walk, 0.8 m/s | 7 m     | 24 s | `idle`                     |
| squirrel | run, 2.5 m/s  | 6 m     | 9 s  | `eat` or `idle`, half each |
| piranha  | swim, 0.6 m/s | 5 m     | 24 s | `swim` 70 %, `bite` 30 %   |

A waypoint is kept only when the straight line to it from the spot stays on
the animal's ground: both ends on it, crossing no pond's or building's edge,
and for the green no edge of its own outline or holes. Otherwise the
waypoint is the spot itself. An animal only ever walks along such lines, so
a squirrel never crosses a pond or leaves its park, even in a narrow or
bent one, and a fish never crosses the bank.
Slot `k` ends where slot `k + 1` starts, so the walk is continuous, and
where an animal is at any moment is computed from that moment. Its clip
phase follows the wall clock at the clip's own length.

Two devices with the same tiles loaded see the same animals in the same
places. The ground comes from this device's loaded tiles only
(`obstaclesWithin`, `greenAreasWithin`, `roadsWithin`), so ground the map has
not loaded has no animals rather than guessed ones.

## Only what is on screen costs anything

`useAmbientAnimals` requests animation frames only while all of these hold:

- the page is visible;
- the camera is at zoom 17 or closer, where an animal is more than a dot;
- the map is ready, the world section is open, and no guide scene or system
  informer owns the view;
- the person has not asked for reduced motion.

When any of them stops holding, the animals are taken off the world. While it
runs:

- The ground and the animals around the middle of the view are read again
  every second, and when new tiles arrive.
- At most 24 animals are on the ground at once, the nearest within 220 m.
  Eagles whose ring passes within 450 m are drawn as well.
- Ground still in fog keeps no animal: what this device has not revealed
  stays unknown. Fogged spots are left out before the 24 are chosen, so
  they never take the place of an animal that could be drawn.

Nothing about the animals is sent anywhere. No server knows of them, and no
record is written.
