# xSasha

xSasha is a character who comes to a Bond from time to time and tells it
what to do next. Her first job is onboarding: she introduces herself to a Bond
whose Avaia nobody has configured, sends it to create one, and comes back to
say what that paid.

She is presentation. What she says creates no Interaction, completes no
BondChain and asserts nothing about any Bond. She is not an Avaia, not a
second identity and not evidence that anyone is anywhere. The one thing a
scene with her may pay is an achievement [progression](progression.md) already
priced; she only says it out loud.

Her name is not an address. `xSasha` is neither a Bond's `pub_dress` (those
begin `0x`) nor an Avaia's (an `x`, the owner's hexadecimal discriminator, and
the `ai` ending), so no identity can hold it and she is never mistaken for a
real Bond or someone's Avaia.

## A scene

A scene is played on the world itself, the way a game plays a cutscene in its
own engine:

- the chrome steps aside — header, Dock, toasts and world controls fade out —
  and the frame narrows to letterbox;
- she walks up to the Bond's body in the same renderer that draws it, and
  she is never its twin: Sky meets her as Dasha 2.0, Dasha and Dasha 2.0 meet
  her as Sky, Kai meets her as Dasha — in that study's default appearance
  rather than in what the Bond has on. A Bond this device has no body for
  meets her as Dasha 2.0;
- the camera is staged around the two of them — over the Bond's shoulder
  while she approaches, a two-shot from the side, shot and reverse shot while
  they talk, a slow drift while a line is held — and handed back exactly where
  it was when she leaves. No shot is filmed through a wall: the buildings the
  basemap has already loaded around the Bond, at the height it raises them,
  are read once as a scene starts, and a shot whose eye would stand behind
  one is turned the shortest way round the two of them, lowered towards
  overhead where turning is not enough, and taken from straight above when
  they are walled in on every side;
- what she says is typed out in subtitles under her name, and the replies a
  person can give are listed beneath them. A reply is said back in the Bond's
  own voice, with the camera on the Bond, before she answers it.

She speaks in the voice of the study she is drawn in, and the Bond's own
replies in the voice of its study: Sky in the masculine, both Dashas in the
feminine, and Kai in forms that carry no gender at all — the rule an Avaia's own voice already follows.
Where a language marks it (Ukrainian and Russian do; English does not), a
wording is written once per voice.

A line is written in several wordings that all mean the same thing, and so is
every reply. Each time a scene plays it picks a different wording, so she
never repeats herself word for word. `(skip)` and `(continue)` are stage
directions rather than things a person says, and are never said back.

While a scene plays the camera is hers: the scene covers the world, so a
gesture answers her rather than dragging the world out from under the two of
them. **Continue** hurries the current beat — her walk, the typing, a reply,
her departure. Replies can be chosen by number, and Escape takes the scene's
own way out. A person who asked for reduced motion gets cuts instead of camera
moves, sees each line whole, and finds her already standing there.

Where she stands is the one place this client observed: a couple of metres in
front of the Bond's body, which faces north. A device with no observation
stages the scene wherever the camera already is.

## Onboarding

**Introduction.** Once the world has painted and the first fix has framed the
Bond (or the device has said it cannot locate itself), a Bond whose Avaia is
`unconfigured` is met by her, provided nothing else is open in the Dock:

```text
xSasha   Hi, bunny. The two of us are going to have fun — but I'm busy
           right now. Go create your Avaia.

  1. This is strange. I feel like I've been here before.
  2. Later.
```

- The first reply leads to how: the Avaia waiting in the Dock, and **Create**.
  Going to do it closes the scene and opens the Avaia screen.
- **Later** is answered with a goodbye, and she comes back the next time the
  world opens.

**Reward.** The first save that configures the Avaia brings her back — or
rather, finds her on her way out. She is some twenty metres off, her back to
the Bond, and the camera is on her, close, with the place itself behind her:
the stage turns her the way where the basemap already has buildings standing
past her, never inside one, in water or behind a wall from the Bond, and
where nothing is built (or the renderer cannot say) she is simply the way she
walked off. She turns round and says it:

```text
xSasha   Almost forgot — here, 0x0sky.
```

— the Bond called by its `pub_dress`, in her voice (_Ледь не забула / забув /
вилетіло з голови — тримай_). What it paid lands beside the line, one entry
at a time, the Bond's first and then its Avaia's: 20 Bond experience and
level 1 for the Avaia, and, where this deployment can download an on-device
model, that the next step waits in Settings. A Bond's gain is **cyan** — the
colour of its frame in the Dock and of its `pub_dress` in the header — and an
Avaia's **violet** (`--guide-xp-bond`, `--guide-xp-avaia`), each number counts
up from nothing, and each subject's first entry goes off in a burst of
confetti in its own colour. A person who asked for reduced motion finds her
already facing them and reads the numbers whole, without the burst.

Once the numbers have counted up, the entries leave the scene: they fly, on
the curve the Dock moves its screens with, to the corner the Dock stands in,
stacked just above it. There the top one stays 3 s, the next 3.5 s and the
bottom one 4 s before each fades — whether the scene is still playing or not.
A scene moved on sooner sends them on their way from where they were.

This is the Avaia configured dialog, said by her. "Here" is how she says it,
not what pays it: the save configured the Avaia and the achievement was
priced before she turned round, so a scene skipped, cut short or never played
pays exactly the same. Thanking her leads to one more line, said to the two
of them: the Avaia walks up from a few steps behind and stands at the Bond's
shoulder, and the shot is taken from her side with the Bond and its Avaia
facing the camera — three on the world, both of them in frame. When she
leaves — further off the way she was going — the camera stays close on the
pair instead of going back to where it was, and the Bond hands the wheel to
its new Avaia: from here it is the two of them. Handing the wheel over this way
fetches nothing — a reply to her is not the gesture that asks a device to
download a model.

## What this is not

xSasha guides and stages; she is not a second protocol. The rules below are
what keeps her that way, and `tests/architecture/guide-boundary.test.ts` and
`tests/integration/guide-onboarding.test.tsx` hold the code to them.

- **Presentation, not protocol truth.** A scene played or skipped, a line
  chosen, the chrome stepping aside, the experience and confetti shown as she
  pays it —
  none of it is an Interaction, BondChain evidence, presence evidence, or a
  change to a Bond, an Avaia or a Relationship.
- **A reply is not reciprocity.** A numbered answer is something a person did
  on this screen and nothing more. It asks the service for nothing, completes
  nothing and consents to nothing. If a reply ever has to mean something
  shared, it will be because it is a real, typed Interaction whose
  counterpart completes it — defined in Core first, and consumed here.
- **The UI does not define semantics.** The guide reads what already exists:
  the Avaia's configuration state as the identity service answered it, the
  achievement progression already priced, the published avatar scene. It adds
  no identifier, no state and no meaning of its own beyond one play record.
- **Bond and Avaia keep their boundaries.** The introduction plays only for an
  Avaia the service called `unconfigured`; a host that cannot read an Avaia
  profile gets no scene rather than one invented for it. The scene may open
  the Avaia screen, but only a person pressing **Create** configures anything.
  Configuration, runtime and identity stay three facts: handing the wheel to
  a new Avaia fetches no runtime and claims no availability.
- **Everything the guide keeps can be lost.** Delete every local record —
  scenes, progress, bodies — and the world opened again against the same
  service is the same world: the Avaia is configured because the service says
  so, and nobody introduces it again. If that ever stops being true, the guide
  has leaked into protocol state.

The only thing a scene ends in is navigation (the Avaia screen, the wheel) and
its own play record. The code that ends a scene is pinned to exactly that.

## What is kept

Whether the introduction was played through or skipped is a play record on
this device, `nilx-one.guide.v1.<owner>`, transport-eligible like the others
([State placement](state-placement.md)). "Later" is kept for the session only.
Nothing she says is sent anywhere.

© 2026 aiaiaiai · aiaiaiai.org
