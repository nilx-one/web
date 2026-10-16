# Hoodie wardrobe compatibility gate (P0)

First small PR of the aiaiaiai hoodie plan: two reusable garment meshes
(`hoodie_zip`, `hoodie_pullover`) and two print lines (`ai_v1`, `emblem_v1`),
four wearable variants in all. This PR adds no geometry, material or runtime
code. It records which avatar the garments can be worn by, how they bind to
it, and what is still undecided, so the following PRs build on checked facts.

Inspected Web baseline: `da50813`. `tools/avatars/dasha2/build_model.py`
was rebuilt with the pinned requirements and reproduced
`dasha-v2-study.glb` byte for byte (`60c8ee1b…`, as pinned in
`tools/avatars/SHA256SUMS`); every number below comes from that build's
manifest and GLB header.

The garments are game items. Changing clothes is presentation: it creates no
Intent, Interaction or BondChain entry, says nothing about a Relationship, and
needs no Core change while wardrobe choice stays device-local
(`avatar-wardrobe-store.ts`).

## Decision: embedded wardrobe nodes, not external garment GLBs

For the first release both hoodies ship as `wear:` nodes inside a new
Dasha 2.0 asset version, bound to the same skin as everything she already
wears. Separately fetched skinned garment GLBs are not used yet.

Evidence:

- Every Dasha 2.0 wearable is already its own mesh node with `skin: 0`
  (`export_modular_avatar` in `tools/avatars/rig.py`). Both renderers change
  clothes only by node visibility — `applyAvatarNodeVisibility` in
  `packages/map-maplibre/src/avatar-layer.ts` and `applyPreviewVisibility` in
  `packages/graphics/src/avatar-preview.ts`. No runtime code rebinds a
  `SkinnedMesh` to another skeleton.
- The bind pose is derived from the landmarks of the same build
  (`Landmarks.skeleton()`), so it is per-study. A garment authored outside
  that build has no guaranteed shared bind pose; an embedded one has it by
  construction.
- The only external body asset today, the backpack, is a rigid mount on the
  `chest` bone (`mountBackpack` in `backpack-model.ts`), not a skinned
  garment. It proves nothing about external skinning.
- External garments would need a second loader path in both renderers,
  bone-name rebinding and a per-study bind-pose equality check — new runtime
  surface with no measured benefit yet. Revisit only if device measurements
  (P6) show the embedded wardrobe is too heavy (plan risk R2).

Consequences:

- `0.3.0` bytes stay immutable. The hoodies arrive with `0.4.0`; the model id
  stays `dasha-v2-study`. The version is pinned in `tools/avatars/build.sh`,
  `tools/avatars/dasha2/{build_model.py,wardrobe.json}`,
  `tools/avatars/SHA256SUMS`, `tools/avatars/test_rig.py`,
  `packages/application/src/avatar-appearance.ts`,
  `packages/map-contract/src/index.ts` and the renderer and identity view
  tests; the bump touches all of them at once.
- `build_model.py` refuses a `wardrobe.json` item without geometry and
  geometry routed to no item, and `avatar-asset-contract.test.ts` compares
  `WARDROBE_ITEMS` with the same file. The first hoodie geometry therefore
  lands together with its wardrobe entry and catalog item.

## Rig the garments bind to

| Property   | Value                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skin       | `shared-study-rig`, `rig_version` `study-rig-1`                                                                                                                                 |
| Nodes      | 22: `root`, `hips`, `spine`, `chest`, `neck`, `head`, `shoulder_{L,R}`, `upperarm_{L,R}`, `forearm_{L,R}`, `hand_{L,R}`, `thigh_{L,R}`, `shin_{L,R}`, `foot_{L,R}`, `toe_{L,R}` |
| Bind pose  | Landmark-derived translations; inverse bind matrices carry translation only                                                                                                     |
| Axes       | Authored Z-up, exported Y-up (positions, normals, joints and bind matrices together)                                                                                            |
| Influences | 4 per vertex, assigned from final positions and a semantic family per part (`weights_for`)                                                                                      |
| Clips      | `idle`, `walk`, `turn_in_place`, `wake`, `quiesce`; in place, no root motion                                                                                                    |

Side suffixes are named from a viewer facing the character, not from the
character. The exported body faces +Z (`toe_L` rests at +Z from `foot_L`) and
`shoulder_L` rests at −X, which is the character's own right. The shoulder
mark belongs on the character's own left, so it sits on geometry weighted to
`shoulder_R`/`upperarm_R`. In the mockups it is on the image's left in back
views and on the image's right in front views — the same shoulder.

## Slot, regions and layering

- **Slot:** `outerwear`. It is declared in `wardrobe.json` and in
  `DASHA_2_SCHEMA` (`zero-or-one`, no conflicts) and holds no item today.
- **Hides:** `torso`, `upper_arms`, `lower_arms`. A hoodie is the first
  long-sleeved item, so it is the first to hide the arm regions that were
  published for exactly this. `hips` is added only if the fitted hem
  encloses it.
- **Never hidden:** `head` and `hands`. The hood is down and the cuffs end
  above the hand region.
- **Garment over garment:** covering hides body regions, never other
  garments, and `outerwear` conflicts with nothing. A tee or shell stays
  visible under the hoodie. The hoodie must therefore enclose
  `top/tee-black` (the bulkiest top, short sleeves included) with clearance
  in every clip, instead of a new "outerwear hides top" rule. A dress may
  show below the hem.
- **Backpack:** `readTorso` fits the bag to the visible torso geometry once,
  at mount time. Putting a hoodie on later does not refit it, and the lowered
  hood lies where the bag's back panel sits. Refitting on a wardrobe change
  and the hood/bag overlap belong to integration (P3).

## Materials and prints

The current asset has no `TEXCOORD_0`, no images and no textures: 24 flat
`baseColorFactor` materials, all double-sided. The prints need UVs, so only
the hoodie nodes gain `TEXCOORD_0`; existing nodes keep their geometry.

- The white cloth is a plain material. Each line is a single-channel mask
  (`ai_v1` repeat, `emblem_v1` back panel, the shared 4×`ai` shoulder relief
  as a normal/height map) tinted by one colour uniform at runtime, so one
  colour change recolours print and relief together and no GLB exists per
  colour.
- Masks are versioned static files beside the GLB, fetched only while a
  hoodie of that line is worn, rather than embedded for every viewer.
- `SkeletonUtils.clone` shares materials between clones; a tinted material
  is cloned per avatar instance before the uniform is set.
- `tools/avatars/preview.py` shades flat from the palette and does not read
  UVs, so wardrobe stills of a printed variant need it to learn masks (P4).

### Bond colour source — not found

No per-Bond colour exists in Web, Core or the identity contract. The only
Bond colours are theme tokens for the Bond's experience:

| Token              | Value                      | File                                                              |
| ------------------ | -------------------------- | ----------------------------------------------------------------- |
| `--xp-bond`        | `#2563eb` / `#6ea8ff` dark | `packages/ui/src/styles.css`                                      |
| `--inventory-bond` | `#3d8bfd`                  | `packages/product-app/src/features/inventory/inventory-panel.css` |
| `--guide-xp-bond`  | `#5fe3ee`                  | `packages/product-app/src/features/guide/guide-cutscene.css`      |

None of them matches the mockups' sky blue, and none is per Bond. This
blocks the colour part of P2 (question 1 below), not the geometry of P1.

## Size baseline

Whole asset: 147,374 vertices, 286,310 triangles, 10,567,624 bytes, already
above the draft's 6 MB target. A vertex costs about 72 bytes today (position,
normal, joints, weights, ~2 triangles of indices); `TEXCOORD_0` adds 8.

| Node                        | Vertices | Triangles |   Bytes |
| --------------------------- | -------: | --------: | ------: |
| `body:torso`                |    2,816 |     5,504 | 201,216 |
| `body:upper_arms`           |    1,440 |     2,784 | 102,528 |
| `body:lower_arms`           |    1,248 |     2,400 |  88,704 |
| `wear:top/tee-black`        |    7,540 |    14,784 | 539,328 |
| `wear:top/shell-ecru`       |    2,560 |     4,992 | 182,784 |
| `wear:bottom/trousers-ecru` |   11,094 |    21,480 | 790,272 |
| `wear:dress/shift-indigo`   |    3,840 |     7,552 | 274,944 |

Each hoodie PR reports its exact node bytes and the new whole-asset size from
the manifest. Pass/fail thresholds come from device measurements in P6, as
the plan requires; this PR invents none. Runtime WebGL deformation, phone
frame rate, GPU memory and Telegram Mini App load time were **not measured**
here, and no phone was available.

## Compatibility matrix

| Study            | Asset         | Wardrobe                  | Hoodie                           |
| ---------------- | ------------- | ------------------------- | -------------------------------- |
| `dasha-v2-study` | 0.3.0 → 0.4.0 | Modular, `outerwear` slot | First and only target            |
| `sky-study`      | 0.1.0         | One fixed mesh            | Not offered; individual fit (P5) |
| `dasha-study`    | 0.1.0         | One fixed mesh            | Not offered; individual fit (P5) |
| `kai-study`      | 0.1.0         | One fixed mesh            | Not offered; individual fit (P5) |

The fixed studies share the rig topology but not a bind pose or body regions,
so sharing the skeleton is not evidence that a garment fits them.

## Open questions for the owner

1. **Bond colour.** Which source is authoritative: one brand colour for every
   Bond (which token, or a new one), or a per-Bond colour that does not exist
   yet and would need a Core/identity contract?
2. **Emblem original.** Only rendered mockups were supplied, and the two
   back views differ in the small symbols around the circle. P2 needs the
   source line art and confirmation of the right to use it (risk R4).
3. **Söhne.** Licensed for rendering `ai` into a texture? If not, which
   licensed neo-grotesk replaces it. No font binary is committed either way
   (risk R5).
4. **Shoulder mark.** The plan says four `ai` in about a 2×2 block; all
   mockups show one row, and the zip mockup shows only three. Which layout is
   the contract?

## Next PRs

1. **P1a** — `hoodie_pullover` geometry with UVs, routing, weights and
   enclosure of the tee; `wardrobe.json` and catalog entry; asset `0.4.0`.
   Shipped plain white, which is a complete item on its own.
2. **P1b** — `hoodie_zip` on the same contract.
3. **P2** — line masks and the shoulder relief behind one colour uniform;
   needs answers 1–4.
4. **P3** — variants as (mesh, line) in `wardrobe.json` and the catalog;
   backpack refit and hood overlap.
5. **P4–P6** — preview, map and thumbnails from real assets; fit gates for
   other studies; phone measurements.

© 2026 aiaiaiai · aiaiaiai.org
