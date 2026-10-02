# Sound

The world can be heard. A short sound marks what just happened — the Avaia
setting off, a landmark going into the notebook, fog lifting — and, when a
person asks for it, the world in view is heard under the cues: wind over open
ground, water, a street.

Sound is presentation and nothing else. Every line a cue goes with is still
written on the card and announced in a live region, so a person who hears
nothing loses nothing they need. Nothing about sound is sent anywhere, and
the bed under the cues says nothing about where any Bond is.

## Who decides what

```text
product-app        names the moment            "walk", "reveal", …
host-contract      SoundCapability             play · setAmbience · setEnabled
host-browser       decides what it sounds like  Web Audio, synthesised
```

The product names a moment and the host decides what it sounds like, the
same way the host decides what an `impact` feels like. `HostPort.sound` is a
host capability like geolocation: a host without sound composes
`SILENT_SOUND`, so its absence is an answer rather than a branch in a feature.
Telegram and Discord have no sound primitive of their own; their embedded
browsers play Web Audio, so their compositions hand over the same
`createBrowserSound()` the site uses. An architecture test keeps
`AudioContext` and Safari's `audioSession` inside `host-browser`.

## Cues

| Cue           | When                                          | What it sounds like                         |
| ------------- | --------------------------------------------- | ------------------------------------------- |
| `tap`         | a press on the Dock                           | a soft glass click                          |
| `step`        | every 600 ms while the Avaia walks            | a scuff and a low thump, never twice alike  |
| `walk`        | it sets off, or heads for a cell to reveal    | a rising fourth                             |
| `refuse`      | building, water, fog, or already revealing    | "uh-uh": two muffled falling notes          |
| `spot`        | it noticed a landmark it wants to see         | three notes up, the last one a bell         |
| `study`       | a landmark went into the notebook             | a warm chord that blooms and lingers        |
| `reveal`      | fog lifted from a cell, whoever lifted it     | a filter opening over noise, then two bells |
| `achievement` | an achievement paid, or xSasha's reward flies | a bell arpeggio up an octave, chord held    |
| `heard`       | a nearby Bond's spoken line arrived           | two soft, slightly distant notes            |
| `failure`     | a failure notice opened                       | low, short, not alarming                    |

Cues that go with a line follow the line (`lineCue` in `avaia-lines.ts`): the
line is the fact, the cue only marks that it was said. A revealed cell has
its own cue wherever the reveal came from, so the Avaia's "revealed" line
adds none. With reduced motion a walk arrives without walking, and makes no
footfall.

Every cue is synthesised: a few oscillators, two-operator FM for the bells,
and a little filtered noise. There is no asset to fetch, license, or keep in
step with a locale. The palette is tuned to one pentatonic family, so cues
that overlap never clash, and it is quiet: everything is mixed under a
limiter, and no cue peaks above about −14 dBFS.

## The world in view

The bed is one noise source shaped three ways: a drifting band of wind, low
rounded water that comes and goes, and dark traffic with a faint hum. Its
listener is the camera, the way it is in a game (`world-ambience.ts`):

- **presence** — zoom 12 is a city and silent; from zoom 16 the ground is
  heard in full.
- **water** and **city** — the share of a 240 m square under the middle of the
  view that the basemap paints as water or buildings, read from tiles already
  loaded (`obstaclesWithin`). A courtyard inside a block is open ground.
  Streets and water take the place of wind rather than stacking on it.
- **clarity** — the share of that square this device has revealed. The whole
  bed runs through one lowpass filter, and that filter is the fog: unrevealed
  ground is heard as if through a wall (280 Hz), revealed ground plainly
  (7.2 kHz).

It is listened to again once the camera settles (400 ms), when more tiles
land, and when fog lifts, and every change is followed smoothly.

## The choice

Settings offers **Off**, **Effects**, and **Effects and world**. The default
is Effects. The choice is stored on this device (`nilx-one.interface.sound`,
device-resident in [State placement](state-placement.md)): unlike language or
appearance it does not follow a Bond, because another device has its own
speakers and stands somewhere else. A host that cannot make a sound does not
show the choice.

## Browsers

- **Gesture first.** A browser opens audio only from a gesture. No audio
  device is opened while sound is off; otherwise it opens on the first press,
  key or touch after sound is wanted, and the Settings choice is itself that
  gesture. A cue that cannot play yet is dropped, not queued: a sound late is
  a sound about something else. Older iOS releases also play one silent
  sample inside the gesture.
- **Ambient session.** Where Safari exposes `navigator.audioSession`, it is
  declared `ambient`: cues mix with whatever the person already listens to
  and respect the ringer switch, the way a game's effects should.
- **Hidden pages** are suspended, and resume when shown.
- **Repeats** — the same cue twice within 60 ms (150 ms for a footfall) is
  heard once.

## Not yet

- **Recorded or generated signature sounds.** A cue could be backed by a
  sample generated offline and curated into the repository; the capability
  already hides how a cue is made. No sample exists yet.
- **Speech on the device.** The Avaia's fixed lines are recorded
  ([Avaia's voice](avaia-voice.md)). Lines about a landmark, and lines a
  [local model](local-models.md) rephrases, need speech in the browser.
- **Spatial cues.** A landmark or a nearby Bond could be panned by bearing
  from the camera.

---

© 2026 aiaiaiai · aiaiaiai.org
