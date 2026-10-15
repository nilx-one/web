# aiaiaiai backpack

White backpack with four coloured raised ai marks, generated for this project
in Higgsfield 3D Jutsu, project `dfe7816f-3d8b-4638-b4ad-af2757e59801`,
revision 3. The user supplied the backpack silhouette and aiaiaiai emblem.

The GLB contains the hero geometry and materials only in its active scene;
studio camera and lights were removed. It is Y-up, metre-scale, facing +Z.
Vite bundles it as a hashed same-origin asset in all three hosts.

This is the approved prototype: the emblem is simplified and the Blender
procedural fabric texture is not baked into the GLB. Its own strap stubs are
hidden at runtime: `backpack-model.ts` fits the bag to each study's torso and
sweeps shoulder straps over it. Everything mounts rigidly to the shared chest
bone; straps do not simulate cloth. It is a carry item, not a free wardrobe
selection or an entitlement source.

© 2026 aiaiaiai · aiaiaiai.org
