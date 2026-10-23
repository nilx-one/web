# Subscription status and presentation

The Bond owns the subscription. Core resolves a trusted entitlement snapshot into
`unknown`, confirmed `none`, or `active` with a tier and deadline. See
[Core #75](https://github.com/nilx-one/core/pull/75). Web does not duplicate the
entitlement policy or infer status from an avatar, local storage or payment UI.

`SubscriptionStatusPort` is the host-injected authority reader and invalidation
stream. One provider reads it and delegates to the Wasm Core runtime. Its result
drives the Bond, currently associated Avaia, profile, inventory, Dock and map
label. Other identities never inherit the local owner's tier. Missing adapters,
old Core bindings, malformed responses and failed reads remain unknown, not an
invented free or paid tier. Deadlines, focus and authority events refresh status;
late responses cannot restore a previous identity's state.

## Transitions

Special uses violet light; Exclusive uses brighter gold with white highlights.
Badges and identity labels use the same tier-specific color families. The body uses one
procedural, depth-tested additive mesh with a halo, rays, ribbons and sparkles.
There are no imported artwork assets or screen-space overlays.

Acquisition fades in over 700 ms. Removal fades out and releases GPU resources.
Special ↔ Exclusive interpolates color and intensity over the same interval;
an interrupted transition starts from its current rendered value. Identity
replacement clears the old body's aura immediately. Badge opacity and text color
also transition on non-body surfaces. Semantic status clears immediately: a
decorative afterimage never grants capabilities. Reduced-motion users receive
instant status transitions and a still aura. Model hydration, map style remount,
hidden bodies and disposal retain the existing renderer lifecycle.

## Activation boundaries

This change supplies a shared status interface and presentation, not billing or
production entitlement fulfillment. Hosts still need a real authority adapter
and rebuilt Core bindings before paid statuses appear in production.

### Requested visual cycle for 0x0sky

For the authenticated owner `0x0sky`, ProductApp explicitly enables a presentation
preview: Special for 60 seconds, Exclusive for 60 seconds, None for 60 seconds,
then repeat while the app is open. Each newly mounted session starts at Special.
The Bond and its current Avaia share the same phase on all existing status
surfaces. Returning from the background catches up to elapsed time; logout or
owner replacement stops the timer and clears the preview. Other owners are
unaffected. The provider defaults to preview disabled for other consumers.

This is a UI override requested for visual inspection. It works without the
authority adapter or a new Wasm export and does not create an entitlement,
modify Core's remaining-time policy, or grant server capabilities. Remove the
explicit `previewCycle` prop in ProductApp to end this temporary testing mode.

Exclusive takes precedence and pauses the remaining Special duration. When
Exclusive ends, Special resumes with that unconsumed duration. The shared Core
clock owns this policy; the entitlement authority must persist its state and
publish the effective period. Web never consumes or extends either duration.

## Verification

Contract decoding, Wasm delegation, owner isolation, revocation, expiry, late
responses, both tier transitions, interrupted transitions, reduced motion and
GPU disposal have focused tests. Full CI remains the delivery gate. Rendering
has been inspected in a local Chromium WebGL scene; physical mobile-device
performance and production authority integration are not yet verified.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
