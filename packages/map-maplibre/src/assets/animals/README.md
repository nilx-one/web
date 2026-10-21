# Ambient animals

Low-poly dog, cat, eagle and piranha that the map draws as the city's own
scenery (`AmbientAnimalHandle`). They are true to size, like the studies:
about 0.9 m for the dog, 0.5 m for the cat, a 1.9 m wingspan for the eagle and
0.3 m for the piranha.

## Source

Quaternius, _Animal Pack Vol.2_ (2017): `Animal_Pack_Vol.2_by_Quaternius.zip`,
2 069 972 bytes, SHA-256
`6d8f6789d65dbdb352ebad98a4209f26b41b384e87d81bc05e9ca76139db1248`. The same
pack also carries a wolf, which is not used.

Licence: CC0 1.0 (public domain dedication), as the pack is listed on
OpenGameArt (<https://opengameart.org/content/animated-animales-low-poly>).
The archive itself carries no licence file, so the dedication is the
listing's, not the archive's. Nothing here needs attribution; Quaternius is
credited because it is right to.

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

Vite bundles them as hashed same-origin assets in all three hosts, the way it
does the backpack.

© 2026 aiaiaiai · aiaiaiai.org
