# Bridge structures

At close zoom the renderer raises the city's bridges into structures. Each one
gets a deck over what it crosses, ramps where it meets the ground, and piers
beneath (`packages/map-maplibre/src/bridge-structures.ts`). At city scale the
published styles' flat bridge deck carries the picture alone.

## What the data gives, and what is made up

The basemap archive marks a bridge only as a `roads` line with `is_bridge`. It
has no bridge outline, no span height and no piers. Everything else is
procedural and presentation only. No 3D model is drawn, so a cable-stayed or
arch bridge reads as the same kind of deck as any other.

| Carries     | Deck width | Height over the water | Pier spacing |
| ----------- | ---------- | --------------------- | ------------ |
| highway     | 26 m       | 16 m                  | 70 m         |
| major road  | 22 m       | 14 m                  | 60 m         |
| medium road | 16 m       | 11 m                  | 50 m         |
| minor road  | 11 m       | 8 m                   | 40 m         |
| railway     | 10 m       | 13 m                  | 55 m         |
| path        | 5 m        | 7 m                   | 35 m         |

## How a bridge is built

- The bridge lines of the loaded tiles are joined into one graph. A vertex
  repeated by neighbouring tiles is one node, and a stretch repeated by them is
  built once.
- A bridge meets the ground where a road that is not a bridge shares one of its
  vertices. From every such point the deck climbs at 7 % until it reaches its
  kind's height. A bridge whose ends the view has not loaded keeps its full
  height there.
- The deck is cut into pieces of about 10 m, each at the height of its middle,
  so the ramp shows as shallow steps. Deck lower than 1 m is left to the flat
  style.
- Piers stand at the kind's spacing under deck at least 4 m high.

## When it is built

Structures are rebuilt from the loaded roads each time the map settles (`idle`)
at zoom 13.5 or closer. They are uploaded only when they differ from what is
already drawn. The source and its two `fill-extrusion` layers are added to the
map only once there is a bridge to show. They sit beneath the building
extrusion, fade in between zoom 14 and 15, follow the light and dark palettes,
and are hidden with the buildings in flat presentation.
