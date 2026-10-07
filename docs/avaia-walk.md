# Avaia walks the world

The authenticated world opens on the Avaia. The Bond spectates on the right of
the [Dock](bond-dock.md), and the Avaia stands where this device observed
itself. From there it moves the way a character in an isometric game does: a
person taps the ground, the body turns to face it and walks there.

Everything on this page is local presentation. Where an Avaia stands is not
observed, not persisted, not sent anywhere and never presence evidence. It is a
body this device draws, moved by a gesture on this device.

## Tap to walk

A tap on the world reaches the application as a `MapGroundTap`. The renderer
answers what is painted under the tap, and the application decides what that
means:

```text
open       somewhere a body can walk to
building   a building footprint or volume stands there
water      a water body is painted there
fog        this device has not revealed that ground yet
```

A body tap still activates the body, and an open point editor still takes the
tap first. Fog outranks what the basemap paints under it: the host composition
hands the renderer the same lit-cell check the shade layer draws
(`createGroundRevealed`). While the journal is loading, or when it could not
load, no fog is drawn and none is claimed. The ground within 50 m of this
device counts as open even before its cell lights, because the person is
standing on it.

Open ground starts a walk. Anything else is refused, and the Avaia says why.

### The way there

A walk keeps to paths first. The renderer answers `roadsWithin` from the
`roads` tiles already loaded, and from those an outing read ahead
([map data](map-data.md)), and `@nilx-one/walk-graph` turns them into a
pedestrian graph weighted by surface: footways cheapest, then tracks, streets,
and major roads; highways are only crossed. The body steps onto the nearest
line within 30 m, follows the cheapest way along it, and steps off for the last
stretch. Open ground in between is planned around the buildings and water
`obstaclesWithin` reports, and costs four times a footway metre.

Who chose where to go decides how much grass is allowed. A tap may cross the
grass the whole way when that costs less than the paths. Curiosity keeps to
the paths and cuts across only for a real shortcut: at least 35 % shorter and
no longer than 60 m. With no line within reach, or no tiles loaded, either one
crosses open ground as before. A new tap mid-walk plans again from where the
body is.

An Avaia walks on open ground only: revealed cells, the Bond's own cell and
the ground within 50 m of this device, and the cell the body stands in, so it
can always walk out. The graph does not enter a node in the fog, and a planned
walk is checked every 10 m, so a long edge or a step across the grass cannot
cut a corner of a fogged cell. When every way there passes through the fog,
the walk is refused as `fog`, with the same line as a tap into it. Curiosity
passes over landmarks that stand in the fog. Opening the fog stays the
reveal's job, below ([Avaia walks on its own](avaia-outings.md), R1).

Arriving where a tap sent it, the Avaia stands there looking around
(`turn_in_place`) for 20 seconds, then carries on from that point B: it does
not walk back home. A tap during the stand walks on from where it stands.

### Back on its own, and going out

What the Avaia does next on its own is decided by the Avaia drive in Core (`docs/avaia-drive.md` in `nilx-one/core`); this device carries it out ([Avaia walks on its own](avaia-outings.md) §2.4):

- **After a point B** it stands 20 s, then is its own again. It goes to see a landmark its owner walked past, or one it misses. Otherwise it strolls off a few steps (30–120 m) along the paths, never further than 200 m from where it settled, looks around for 8 s, and stands again. The pauses grow while it potters, up to five minutes, and are longer at night. It says so once (`stroll`).
- **On the way anywhere**, a point B included, it may step aside for something it passes: a sight or a lake shore within 25 m of the way, which it looks at and names (`landmark.glanced`), or studies when its owner walked past it before; or a find within 15 m, which it bends for. It does this at most twice a walk, then carries on to where it was going.
- **Going out**: restless after ten minutes, never more than once in four hours, it goes to a target from the outing menu, wanders 150–400 m along the paths, goes home, or stays. In the evening and at night it only takes a near target. Before it plans, this device reads the road and landmark tiles of the area ahead, but not tiles that are all fog.
- **Its needs come first**: hunger and energy are Core's Avaia life (`docs/avaia-life.md` in `nilx-one/core`). While it is at the wheel, this device reports every ten seconds where the body is and whether it walks, and only that time counts: time away from the wheel or with the page closed is never reported. When life says it must go home or rest, the drive takes it home and nothing of its own competes; a point B its owner set is finished first.
- **A choice is the Avaia's**: where to go out to, and whether to step aside, go to the model on this device as a closed numbered menu, once the person has downloaded it ([local models](local-models.md)). Without one, or when it answers late or off the menu, the drive's own pick stands.

A tap always comes first, and nothing walks while the page is closed. Without a Core runtime that carries the drive, the Avaia only walks where it is tapped.

### Pace

Locomotion is measured against the ground, never the camera. Zoom changes only
how much world is visible; it never changes how quickly the body crosses
physical distance.

A route starts from three physical gaits:

- up to 400 m: walk at 1.4 m/s;
- over 400 m: jog/cross at 2.4 m/s when the route allows at least a jog;
- over 1.2 km: run at 3.6 m/s only when the actual route is made entirely of
  runnable path/track ground.

The route is allowed to cap that choice. Footways and tracks allow a run;
ordinary streets allow a jog but not a run; steps and carriageways stay a walk.
A connector over unspecified open ground is treated as cross-country ground:
it may jog, but is not enough evidence to claim a full running surface. Thus a
long distance never makes the Avaia sprint up stairs or along a major road.

The authored in-place `walk` clip is paced to the selected gait rather than
moving the body by screen pixels: 1.2 s per walking cycle, 0.9 s while jogging,
0.72 s while running, with two footfalls per cycle. That corresponds to about
0.84 m, 1.08 m and 1.30 m per footfall respectively. World translation remains
continuous in metres, so the feet and the ground stay in the same scale instead
of the body sliding over the map. The body faces the compass bearing it is
moving along. A new tap in the middle of a route picks it up from wherever the
body is. With reduced motion the body arrives where it was sent without moving
through the intermediate animation.

## What it says

Each tap gets a line the Avaia says to itself. The line opens beneath the
address and "this device" on the position card, the same way the Dock opens
into its next screen, and stays for ten seconds. While it talks, the card
stays shown at every scale, the body's own included. The map is hidden from
assistive technology, so the same line is announced in a polite live region.

The voice belongs to the study, not the address. Each of the four studies has
its own voice (`avaia-lines.ts`), in English and Ukrainian. Each voice has
eight walking lines, three for strolling off on its own and three for each
refusal, plus four lines for spotting a landmark, three for stopping to look at
one on the way, and four for having studied one. Ukrainian keeps the grammatical
gender of whoever is speaking:

| Study     | Voice                               | Ukrainian forms   |
| --------- | ----------------------------------- | ----------------- |
| Sky       | calm, laconic, skies and courses    | masculine         |
| Dasha     | lively, curious, warm               | feminine          |
| Kai       | wry, self-aware, deadpan            | no gendered forms |
| Dasha 2.0 | the upgraded one, looks and outfits | feminine          |

The fixed lines can also be heard, when Character voices is at Everything:
each study says them aloud in a recorded voice of its own, in English and Ukrainian ([Character voices](avaia-voice.md)). Lines
about a landmark carry its name and stay written only. The strolling lines are
not recorded yet, so they are written only too.

A line is never the one said just before it when another is available.

Once an Avaia has walked off, the card goes with it. The card then says how
far it is from this device ("70 m from this device"), so it never claims a
position it does not have.

## Landmarks

The second half is curiosity, and it runs in two steps.

1. **The person notices.** Whoever is at the wheel, when this device observes
   itself within 40 m of a landmark the basemap draws, that landmark goes into
   a local notebook. Observations less accurate than 50 m are ignored. The
   renderer answers `landmarksNear` from the tiles it has already loaded, and
   never makes a request for it. A landmark is a `pois` feature whose `kind`
   is on the list in `LANDMARK_KINDS` (monument, memorial, artwork, statue,
   museum, ruins and so on).
2. **The Avaia studies.** An Avaia at the wheel with nothing to do goes to the
   nearest noticed landmark it has not studied, within 3 km. That happens 1.5 s
   after it takes the wheel, or after 15 s idle once it has been doing things.
   It says something about what it saw, walks up to a spot 4 m in front of the
   landmark, and looks it over (`turn_in_place`, 3.2 s). Then it says what it
   learned. A tap always outranks curiosity.

What an Avaia learns about a landmark is exactly what the archive declares for
that feature: its name, its kind, and every other attribute the tile carries,
verbatim. Nothing is generated, looked up elsewhere, or invented. The studied
entries appear on the Avaia's own screen in the Dock ("Landmarks studied").

The notebook is kept per Bond, and its study notes per Avaia address, in local
storage under `nilx-one.avaia.landmarks.v1.<pub_dress>`. Nothing sends it
anywhere today, and it is never used as training signal. It is
transport-eligible, which is not synced state and not service state (see
[State placement](state-placement.md)). It asserts nothing about presence,
attendance or any Bond, and it is not a landmark projection in the sense of
the map architecture. The Avaia only ever chooses among what its owner already
walked past. It never goes looking beyond that.

The `LANDMARK_KINDS` list (`landmark-kinds.json` in `map-maplibre`) follows the
Protomaps basemap schema the archive is built from. `inspect-basemap.sh` checks
it against the real archive with `landmark-kinds.mjs`, and fails when none of
its kinds occur there, or when any kind the outing mapper reads does not (see
[map data](map-data.md)).

Noticing a landmark and the Avaia studying one each pay their own experience,
priced differently on purpose. That experience is published in `pub_info` as
the owner's report (`authority: client`) — see [progression](progression.md).
The notebook itself stays on this device.

## Favourite places

Every visit leaves a feeling behind: a landmark studied, a park rested in, a
view gazed from. An Avaia grows fond of some places, falls for a few, and
goes back to them on its own. All of it is worked out in code
(`place-affinity.ts`), never by a model, so it means the same on every device
and under every model.

How much one visit was enjoyed, 0 to 1, comes from four things:

| Part        | Weight | What it is                                                                                 |
| ----------- | -----: | ------------------------------------------------------------------------------------------ |
| temperament |    0.4 | what the Avaia's address leans toward: nature, heights, history or art, 0.3–0.9 each       |
| chemistry   |    0.3 | fixed for this Avaia and this one place, so one park is _the_ park and another only a park |
| taste       |    0.2 | learned: every visit moves taste for that family of places a little toward how it went     |
| the hour    |    0.1 | a park by day, a viewpoint at dawn or sunset, a museum in opening hours                    |

Temperament and chemistry are drawn from the Avaia's address, so they never
have to travel: the same Avaia feels the same about the same place anywhere.

- **Fondness** starts as a first impression, 60 % of how the first visit
  went, so a place enjoyed at 0.67 or more is a favourite at once and worth
  coming back to, and a duller one is only known. Each later visit moves it
  40 % of the way from what it was toward that visit's enjoyment. It halves
  over 30 days left alone.
- **Love** happens once: on the first visit, from the third on, that leaves
  fondness at 0.62 or more. Only a place the Avaia really enjoys gets there;
  a lukewarm one never does, however often it is visited. A loved place
  fades no lower than 0.5, and the moment is said aloud (`landmark.loved`).
- **Longing** is fondness grown back over two days away. An idle Avaia with
  nothing new to study goes back to the notebook landmark it longs for most,
  if that longing reaches 0.35, the landmark is within 3 km on open ground,
  and it has been away long enough: about a day from a loved place, three
  days from a favourite (a place its last visit left at fondness 0.4 or
  more, even if it has faded a little since). It never goes back on its own
  to a place that is only known. It says so first (`landmark.longing`).
  Going back pays no experience again and needs no new study line. A place
  an outing found, such as a park, is the drive's to go back to, not
  curiosity's: it is never written into the notebook as studied.
- **Outings** weigh the same feelings. A place it longs for, or a new one its
  temperament leans toward, wins over one a little closer; distance takes
  off up to a quarter. Night still keeps it to near targets, and a tired
  Avaia still goes home. A loved target can be gone back to after a day
  rather than the week other targets wait.
- **Lingering:** a visit lasts by what is done there (resting 90 s, gazing
  45 s, studying 30 s), and up to twice that where the Avaia is fond.
- **A model** reads how the Avaia feels about each outing option as a closed
  label (`new`, `known`, `fond`, `loved`) beside its kind and reach. It reads
  the label, never writes it.

The record keeps at most 64 places, loved ones first, and is one Bond's own,
kept for its Avaia's address, in local storage under
`nilx-one.avaia.affinity.v1.<pub_dress>`. Nothing sends it anywhere and it is
never training signal. It is transport-eligible, not synced state (see
[State placement](state-placement.md)). It asserts nothing about presence,
attendance or any Bond: it is about where a body this device draws liked to
stand. The Dock lists the favourites on the Avaia's own screen ("Favourite
places"), loved ones first, read at the time the world opens or the last
visit ended; a favourite left alone fades out of the list when its time
comes, while the page is open too.

## Revealing the fog

The fog is lifted in two ways besides the presence journal. Both are local to
this device, kept by the fog field (`createFogField` in `map-shade`) in local
storage under `nilx-one.fog.reveals.v1.<pub_dress>`, one Bond's alone. The
field reads and writes nothing until the product binds it to a Bond
(`MapFogField.bindOwner`), and switching the bound Bond — signing into the
same device as someone else — swaps in that Bond's own reveals rather than
merging with the last one's. A reveal is never written into the journal and
never counts as a visit. Nothing sends it anywhere today. Opened cells are
transport-eligible, not synced state, and the timers of reveals still in flight
(`nilx-one.fog.jobs.v1.<pub_dress>`) stay on the device that started them
(see [State placement](state-placement.md)). The shade layer draws a reveal
alongside what the journal lit.

1. **The Avaia reveals it.** A Bond is never in the fog: the cell it stands
   on is its own ground, whether or not its fog has lifted, and it is never
   offered. The cells a Bond can reach into are marked on the world with a
   dashed outline: every cell within three rings of it that touches open
   ground — revealed, or the Bond's own cell. A tap on one asks first
   (“Reveal this patch of fog?”). A yes sends the Avaia up to the cell's
   edge — just outside it, on open ground, on the side nearest where the
   Avaia stands — never into the fog. It works the cell open from there,
   and the cell opens after a minute, plus a minute for each
   landmark the archive draws inside it, never more than five minutes. An
   Avaia works on at most three cells at once. A fourth tap gets told to
   wait. While a cell is opening it fills in on the world, and a status chip
   says how many cells are opening and when the next one finishes. A reveal
   runs on the wall clock and is kept per Bond under
   `nilx-one.fog.jobs.v1.<pub_dress>`, so reopening the page does not lose
   it. With the Bond at the wheel a tap still asks, and the Avaia still does
   the work, but nothing walks.
2. **The person walks in.** When this device observes itself inside a fogged
   cell, with 50 m accuracy or better, that one cell opens at once. There is
   no Avaia and no wait.

A tap into fog that nobody can reach is refused the way it always was.

Either way a zone opens pays its own experience, priced differently on
purpose. The reveal stays on this device; the experience is published in
`pub_info` as the owner's report (`authority: client`) — see
[progression](progression.md).

## A declared position

A Bond whose owner set a manual `Bond.location` (the Telegram bot's
`/set_position`) stands where it was put. The Telegram host answers that point
through `createDeclaredGeolocation`, marked `declared`, and does not ask the
device for its position at all. The Bond's body, the card, the camera and the
cells in reach all follow the declared point, and the card says “Manual
position” instead of “This device”. A declared point is not an observation:
it never notices a landmark, never reveals a cell by walking into it, and the
presence tracker ignores it.

## Leaving the wheel

Handing the wheel over ends everything the Avaia was doing, including a walk,
a study or a line on the card. A fog reveal is the exception: it is work on a
cell, not a walk, and it finishes on its own clock. An Avaia that takes the wheel starts again from
where its owner is. Nothing walks in the background.

## Not yet

- **Curiosity by model.** Outings and distractions are the model's to choose
  ([local models](local-models.md)); curiosity is still a rule: the nearest
  landmark the person passed, or the dear place the Avaia misses most.
- **The raw presence journal.** A tap now belongs to the Avaia, so the hosts
  no longer open the phase-1 journal panel on a lit cell. The panel itself
  (`createRawJournalPresenter`) and the shade layer's `onCellTap` stay in
  `map-shade` until the journal gets a home of its own.

© 2026 aiaiaiai · aiaiaiai.org
