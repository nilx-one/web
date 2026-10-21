# Ambient animals

Low-poly dog, cat, eagle, piranha and squirrel that the map draws as the city's
own scenery (`AmbientAnimalHandle`). They are true to size, like the studies:
about 0.9 m for the dog, 0.5 m for the cat, a 1.9 m wingspan for the eagle,
0.3 m for the piranha and 0.4 m, nose to curled tail, for the squirrel.

## Source

Quaternius, _Animal Pack Vol.2_ (2017): `Animal_Pack_Vol.2_by_Quaternius.zip`,
2 069 972 bytes, SHA-256
`6d8f6789d65dbdb352ebad98a4209f26b41b384e87d81bc05e9ca76139db1248`. The same
pack also carries a wolf, which is not used.

Licence: CC0 1.0 (public domain dedication). The listing this archive is
published under, <https://opengameart.org/content/animated-animales-low-poly>,
reads `License(s): CC0`, author `quaternius`, uploaded 3 November 2017, with the
file `Animal Pack Vol.2 by @Quaternius.zip` (2.1 Mb). Checked on 21 October 2026. The archive carries no licence file of its own, so the dedication is the
listing's. Quaternius's later Quaternius Asset License (QAL 1.0, last updated
28 August 2026, <https://quaternius.com/license.html>) is not what this pack is
published under; the 2017 listing says CC0. Nothing here needs attribution;
Quaternius is credited because it is right to.

The squirrel is not from the pack; see [The squirrel](#the-squirrel).

## Conversion

`tools/animals/build.py`, with Blender's Python module (`bpy` 5.2.2), reads the
pack's FBX files and writes these GLBs. The conversion is deterministic: the
same pack gives the same bytes.

- The pack's colours lived in Blender Internal materials, which neither its FBX
  nor its OBJ files carry. Each material is given the colour of the pack's own
  preview render, by its name.
- Each body is turned to face glTF +Z, scaled to the size above, centred, and
  stood on y = 0, through a root node above its armature: the clips animate the
  armature itself.
- The eagle is reduced from 24 800 to 2 400 triangles.
- The clips keep their motion and take short names: `idle` and `walk` for the
  dog and the cat, `fly` and `idle` for the eagle, `swim` and `bite` for the
  piranha. They walk, fly and swim in place.

| File          | Triangles | Bytes   | SHA-256                                                            |
| ------------- | --------- | ------- | ------------------------------------------------------------------ |
| `dog.glb`     | 602       | 136 264 | `41aec191b36e25ca2511e8a486b354142c5aec4a250253849d357fc8a5e9d26e` |
| `cat.glb`     | 807       | 157 096 | `a1572f6948a4a4d420c108e024bc11feb0dc2bd2cc93b202cb4f535bf40e1515` |
| `eagle.glb`   | 2 400     | 157 276 | `536d7b2d24da3612027a55c20ff55187989eb0a1c8af75795e46085441ba49ae` |
| `piranha.glb` | 1 388     | 145 384 | `d346233f732143da1b2a63183acf3afd34ff9f89c56eb527e43a28cb256121c9` |

## The squirrel

No low-poly, rigged squirrel under a public-domain dedication was found, so
`tools/animals/squirrel.py` builds one from scratch, with the same `bpy` 5.2.2,
and it carries the repository's own licence. It is a red squirrel in the
city's pale palette: fur `#c4622d`, belly and muzzle `#f0dcba`, eyes
`#2a201c`.

- Every part is bound wholly to one bone, so it moves as a few rigid pieces,
  as the pack's animals do; the tail is three pieces curling over its back.
- Metre-scale, Y-up, facing glTF +Z, standing on y = 0, like the others.
- Clips: `idle`, `run` (bounding, in place) and `eat` (sitting up, nibbling).
- Deterministic: a fixed seed gives the same bytes.

| File           | Triangles | Bytes   | SHA-256                                                            |
| -------------- | --------- | ------- | ------------------------------------------------------------------ |
| `squirrel.glb` | 896       | 149 248 | `3b941e99a9f9c0d72f05983a1c0f21d9a596b2868f6f1beddc2c3cc5b9233260` |

Vite bundles them as hashed same-origin assets in all three hosts, the way it
does the backpack.

© 2026 aiaiaiai · aiaiaiai.org
