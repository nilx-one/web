# xPing system informer

xPing is a local system prop, not a Bond, Avaia, identity or Interaction.
It writes no position, progression, consent or BondChain state.

The system informer serializes safe user-facing error reports. Story and
achievement scenes block it until they finish. Both **(skip)** and **Understood**
leave a dismissible toast; Escape has the same result. A burst is limited to
eight queued scenes, with further reports delivered directly as toasts.
State-derived errors are announced once until recovery rearms them. Imperative
failure reports group by kind, opaque code and session while queued or retained;
operation IDs remain diagnostic references, since retries may allocate new ones.
Retry keeps a historical receipt until explicitly dismissed. A repeated failure
updates its reference and action without another flight. The receipt does not
assert that a retry failed or succeeded; only a new report updates it. Dismissing
it rearms that group. Distinct failure kinds/codes/sessions remain separate.

Connected producers: map readiness and operation error toasts, identity errors,
and the existing `usePublishFailure` boundary (including its real retry action).
Inline field errors remain next to their controls. Raw exceptions, stack traces,
credentials and fabricated recovery times must never be passed to the informer.

On a ready MapLibre world with an observed position, the system-drone capability
draws procedural Three.js geometry using the existing 3D custom layer. xPing flies
to a temporary point near the Bond, hovers at terrain-relative height and faces
it. The scene restores its starting camera and captured viewport padding, with an
eased return (immediate for reduced motion), and removes its prop on exit. It never
changes the actual Bond or Avaia position or adds a model to their catalogue.
Reduced motion removes flight, rotor animation and camera easing. A missing or
failed renderer uses the screen-space SVG fallback so a broken map can still
explain the error. A rendered 3D flight still needs browser/GPU visual acceptance.

A future trusted maintenance publisher can use `useSystemInformer().publish`:

```ts
publish({
  id: "maintenance:identity:2026-10-10:v1",
  kind: "maintenance",
  title: "Identity service maintenance",
  description: "Sign-in will be unavailable during this announced window.",
  window: {
    startsAt: "2026-10-10T09:00:00Z",
    endsAt: "2026-10-10T10:00:00Z",
  },
});
```

This example is not an actual maintenance announcement. The window is optional,
validated for order and formatted in the viewer's locale/time zone. The client
never guesses downtime. An authenticated server feed/admin publishing workflow
is future work; this change adds the presentation contract, not such a service.

© 2026 aiaiaiai · aiaiaiai.org

## System characters: non-normative direction

xSasha and xPing are presentation characters. Their narration is neither a new
Bond nor evidence of an Interaction. xSasha's backpack scene reports an already
committed gift; it does not grant inventory. xPing currently reports failures or
announced maintenance and has no grant, quest or progression authority.

Before either character gains new effects, `nilx-one/0x1` must identify the owning
contract, who authorizes the operation, what is committed, and which evidence
completes it. An operator's message must not imply ownership of a person's Bond
or Avaia, or invent consent/reciprocity. This direction note grants no authority.
