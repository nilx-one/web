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
nothing to focus, so the control is inert rather than misleading.

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

## Navigation

The Dock is not the way into the profile. The Bond address in the header is the
identity affordance, and it is a real link to `/identity`, so the Dock's left
side is free to be what it should be: the world's focus control.

© 2026 aiaiaiai · aiaiaiai.org
