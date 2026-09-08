# Shared study avatars

Web owns the procedural asset pipeline; Core remains free of scene libraries,
animation data and authoring geometry. The supplied Sky and Dasha studies are
artistic interpretations, not biometric measurements or evidence of presence.

Three studies are published: **Sky** (masculine), **Dasha** (feminine) and
**Kai** (non-binary). Kai is built from the same helper library and the same
skeleton as the other two, with a shoulder-to-hip ratio between them, a
straight torso and no feature exaggerated toward either. All three are
artistic studies: none of them is a claim about any person's body, gender or
presentation, and a person chooses which represents them rather than being
assigned one (`docs/profile-editing.md`).

## Asset contract 0.1.0

`tools/avatars/{sky,dasha}/build_model.py` preserves the supplied geometry and
palette; `tools/avatars/kai/build_model.py` composes a third study from the same
vocabulary. The shared rig reads its landmarks by garment family, so the third
study registers `{side}_leg`, `{side}_boot_upper`, `{side}_sleeve`,
`overshirt_shell` and `neck`, and derives the same 22-node skeleton. The shared `rig.py` captures loft sections and sleeve paths while that
geometry is built, then derives each bind pose. The topology contains **21
deforming bones plus a ground root: 22 nodes**, resolving the supplied draft's
ambiguous “21 bones” count without removing a named joint.

Positions, normals, joints and inverse bind matrices are converted together
from Z-up authoring to Y-up glTF. A single mesh has one primitive per material;
part names, groups and vertex ranges remain in each generated manifest.
Exported floating-point buffers use seven decimal places and canonical positive
zero to remove CPU/libm rounding noise (position precision: 0.1 micrometre).
Weights come from final vertex positions and semantic part families. Hard
parts use one bone per part. Dasha's boot shafts/rims/back seams use the shin;
boot feet and shoes use the foot. Neither foot planting nor boot/cloth physics
is implemented. Material boundaries still require visual inspection.

All five clips (`idle`, `walk`, `turn_in_place`, `wake`, `quiesce`) contain shared
local rotations and return to rest at their endpoints. They are **in-place**:
neither hips translation nor geographic displacement is baked into the asset.
This resolves the cross-model translation mismatch without promising foot
planting or locomotion-speed synchronization. Turn is an anticipatory gesture;
the caller supplies actual bearing. Mode names select presentation clips only;
they do not activate AI authority or create interactions.

## Build and verification

Use Python 3.12 and the pinned requirements:

```sh
python -m pip install -r tools/avatars/requirements.txt
sh tools/avatars/build.sh
python tools/avatars/test_rig.py
```

`python tools/avatars/preview.py --thumbnails deploy/web/avatars/0.1.0` writes
the still each study shows in the picker; the build does this after exporting
the GLBs, and the hashes are pinned like every other output.

`python tools/avatars/preview.py sheet.png` rasterises the exported studies to a
single PNG — front and three-quarter views, flat-shaded from the material
palette — so a change can be looked at without a device or a scene editor. It is
a check on geometry, not the runtime renderer, and not a substitute for Blender.

Outputs live in `deploy/web/avatars/0.1.0/`. Generated GLBs and manifests are
excluded from Git; reproducible sources and SHA-256 expectations are versioned.
CI generates and validates them once, then passes the verified assets to deploy
validation. Release packaging reproduces the same hashes. A geometry, rig,
material or clip change after publication requires a new asset version/path.

The runtime serves `/avatars/0.1.0/{modelId}.glb` — `sky-study`, `dasha-study`
and `kai-study` — from its own static origin,
independently of the selected Web host, with immutable caching and real 404s.
No decoder, texture, animation, photograph or reference image is downloaded from
an external origin. Source archives were provided by the user; their existing
artistic-study descriptions are retained in the generators.

Tests reconstruct global bind matrices and prove inverse-bind cancellation,
normalized weights, valid indices, rigid-part binding, unchanged geometry counts,
identical cross-model rotation tracks and clip endpoints — the last across all
three studies, so choosing a body never changes how it moves. These checks do not
substitute for Blender inspection or measurements on a physical phone.

## Performance evidence

| Model | Vertices | Triangles | Material primitives |
| ----- | -------: | --------: | ------------------: |
| Sky   |  160,341 |   314,792 |                  23 |
| Dasha |  175,410 |   345,530 |                  21 |

Uncompressed rigged assets are approximately **11.5 MB and 12.6 MB**, exceeding
the draft's 6 MB transfer target. Skin attributes and normals add bytes; retaining
geometry does not make the original static transfer estimate valid. Manifests
record exact bytes and hashes. Double-sided materials are unchanged.

The draft's 8 avatars / 30 fps mobile and 32 / 60 fps desktop remain unmeasured
targets. Do not enable a crowd by default or describe these studies as production
LODs. Device benchmarks, deformation review, LOD and compression decisions remain
tracked in [#95](https://github.com/nilx-one/web/issues/95).

Delivery: [asset pipeline #93](https://github.com/nilx-one/web/issues/93),
[local render integration #94](https://github.com/nilx-one/web/issues/94).

## Drawing one avatar

After a Bond chooses a study this client can render, the client draws at most one
avatar: the signed-in Bond's own, standing where this device observed itself, and
only while that observation exists. With no recorded choice, no body is drawn. A
newer explicit model id remains an explicit unsupported choice instead of being
replaced by another study. The avatar is presentation — never evidence of
presence, never a claim about who is nearby, and never a second identity. The
application chooses the body and the moment (`createSelfAvatarHandle`), the
renderer owns playback, and the ambient clip is resampled once per slot rather
than per frame. A person who asked for reduced motion is left standing still.

© 2026 aiaiaiai · aiaiaiai.org
