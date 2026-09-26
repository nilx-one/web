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
Stage 1 walks in a straight line; there is no route graph, so a path can cross
a building footprint when only the start and the destination were checked.

### Pace

A body is drawn at one apparent size at every scale, so the pace is measured
against the body, not the ground: 1.1 drawn heights per second, and never
slower than a stroll. The pace is set when the walk starts. The `walk` clip
loops at the 1.2 s the asset authored it at, and the body faces the compass
bearing it is walking along. A new tap in the middle of a walk picks it up
from wherever the body is. With reduced motion the body arrives where it was
sent without walking there.

## What it says

Each tap gets a line the Avaia says to itself. The line opens beneath the
address and "this device" on the position card, the same way the Dock opens
into its next screen, and stays for ten seconds. While it talks, the card
stays shown at every scale, the body's own included. The map is hidden from
assistive technology, so the same line is announced in a polite live region.

The voice belongs to the study, not the address. Each of the four studies has
its own voice (`avaia-lines.ts`), in English and Ukrainian. Each voice has
eight walking lines and three for each refusal, plus four lines for spotting a
landmark and four for having studied one. Ukrainian keeps the grammatical
gender of whoever is speaking:

| Study     | Voice                               | Ukrainian forms   |
| --------- | ----------------------------------- | ----------------- |
| Sky       | calm, laconic, skies and courses    | masculine         |
| Dasha     | lively, curious, warm               | feminine          |
| Kai       | wry, self-aware, deadpan            | no gendered forms |
| Dasha 2.0 | the upgraded one, looks and outfits | feminine          |

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
storage under `nilx-one.avaia.landmarks.v1.<pub_dress>`. It is never synced,
exported or used as training signal. It asserts nothing about presence,
attendance or any Bond, and it is not a landmark projection in the sense of
the map architecture. The Avaia only ever chooses among what its owner already
walked past. It never goes looking beyond that.

The `LANDMARK_KINDS` list (`landmark-kinds.json` in `map-maplibre`) follows the
Protomaps basemap schema the archive is built from. `inspect-basemap.sh` checks
it against the real archive with `landmark-kinds.mjs`, and fails when none of
its kinds occur there (see [map data](map-data.md)).

Noticing a landmark and the Avaia studying one each pay their own local
experience, priced differently on purpose — see [progression](progression.md).

## Revealing the fog

The fog is lifted in two ways besides the presence journal. Both are local to
this device, kept by the fog field (`createFogField` in `map-shade`) in local
storage under `nilx-one.fog.reveals.v1.<pub_dress>`, one Bond's alone. The
field reads and writes nothing until the product binds it to a Bond
(`MapFogField.bindOwner`), and switching the bound Bond — signing into the
same device as someone else — swaps in that Bond's own reveals rather than
merging with the last one's. A reveal is never written into the journal,
never counts as a visit, and is never synced or sent anywhere. The shade
layer draws it alongside what the journal lit.

1. **The Avaia reveals it.** The cells a Bond can reach into are marked on the
   world with a dashed outline: the cell it stands in and its neighbours, and
   every cell within three rings of it that touches ground already revealed.
   A tap on one asks first (“Reveal this patch of fog?”). A yes sends the
   Avaia there, and the cell opens after a minute, plus a minute for each
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

Either way a zone opens pays its own local experience, priced differently on
purpose — see [progression](progression.md).

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

- **Model-driven choice.** Curiosity picks the nearest landmark, which is a
  rule, not a decision. Routing the choice through `DecisionMenu` and the
  loaded model is the next step, and the candidates would stay what they are
  here: landmarks the person already passed.
- **Routes.** Walks are straight lines between checked endpoints.
- **The raw presence journal.** A tap now belongs to the Avaia, so the hosts
  no longer open the phase-1 journal panel on a lit cell. The panel itself
  (`createRawJournalPresenter`) and the shade layer's `onCellTap` stay in
  `map-shade` until the journal gets a home of its own.

© 2026 aiaiaiai · aiaiaiai.org
