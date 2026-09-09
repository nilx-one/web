# Bond Dock

The Dock shows two identities and which of them is at the wheel: the Bond, and
the Avaia that Bond owns. The one driving sits on the left, the one spectating
sits on the right, and the pair swaps when the wheel changes hands. Nothing here
writes shared-world state — the wheel is presentation, and the link between the
two identities stays the honest em dash until a Relationship projection exists.

## What each side does

**Left — the identity at the wheel.** Activating it brings the world to that
identity: the camera moves to the closest scale the map policy allows, over the
observation the host already provides. A camera centred on a coordinate is
presentation, never evidence of presence, and with no observation there is
nothing to focus, so the control is inert rather than misleading. An Avaia is
the exception, and says so below: its card opens its own setup, and the world is
recentred from the location control that exists for exactly that.

**Right — the identity spectating.** Activating it hands the wheel over, when
that is possible at all. A Bond can always take the wheel back from its Avaia.
An Avaia can take it only when its runtime is ready on this device.

The Bond reads "You" while it drives and "spectate" while its Avaia does. That
is what spectating means here: watching a world someone else is moving through.

## Avaia availability

The right-hand Avaia states what this device can do about its runtime:

```text
ready        the runtime is loaded and can take the wheel
preparing    the runtime is being fetched or warmed up
download     this device can fetch it, and activating the Dock starts that
unavailable  there is nothing to download, or this device cannot run it
```

No Avaia runtime is published yet, so every host answers `unavailable` — which
is the truth rather than a placeholder: there is nothing to fetch. The other
states exist so the Dock already knows how to say what it will be able to say,
and a host that cannot fetch a runtime never offers a download it could not
perform. WebLLM support is a device capability, not a preference: a device
without accelerated graphics reports `unavailable` even once a runtime exists.

## The Avaia's own card

The Avaia card opens what its owner can decide about it: **Set up** while the
identity service reports nothing configured, **Edit** once it does. Both open
the same screen — see [Avaia setup](avaia-setup.md) — and both are reachable
whichever seat the Avaia is sitting in, because configuring an identity has
nothing to do with who is holding the wheel.

Configuration and runtime are read apart on the card as well. The role beside
the address says `unconfigured` when that is what the service stored, whatever
this device could run, and an Avaia that was configured stays configured on a
device that can run nothing; the status dot keeps stating the runtime, because
that is what a dot about a runtime is for. The one thing that comes before setup
is a runtime that can actually take the wheel — a moment rather than a setting —
which no device can offer while nothing is published.

A client whose identity service has not reached contract 8 reads no profile at
all. It has no configuration to state and no surface to open, so its Dock stays
exactly the runtime-only Dock described above.

## Navigation

The Dock's header names the Bond on the left and carries one action on the
right: **edit ✍️** opens the Bond edit surface at `/identity`. The Bond address
in the app header remains the identity affordance and remains a real link, so
the Dock's pair stays what it should be — the world's focus control and each
identity's own affordance, not a second way to read a Bond profile.

## One window, two screens

A screen change inside the Dock is a from-to pair rather than a replacement. The
screen being left and the screen being entered are both on the surface for the
length of the move: forward arrives from the trailing edge while the previous
screen recedes, back reverses exactly that, and the window travels between the
two heights, so the Dock grows or shrinks into its next screen instead of
jumping to it. It is the platform idiom iOS made familiar, which is the point —
a person reads the direction before they read the screen.

Direction is told, never guessed from a screen's name. The window is given the
screen it presents and how deep that screen sits; deeper is forward, shallower
is back. The stack is three deep: the world, a Bond surface, and a screen that
surface opens.

The screen being left is `aria-hidden` and `inert` while it leaves, so it is out
of reach of both a pointer and assistive technology. Two cases arrive settled
with no move at all: a window with no measurable layout — a test environment, or
a Dock that is not being painted — and a person who asked for reduced motion.
Nothing in the move touches the persistent world; the map is never animated or
remounted by a Dock navigation, and no view transition is taken over the
document to achieve it.

© 2026 aiaiaiai · aiaiaiai.org
