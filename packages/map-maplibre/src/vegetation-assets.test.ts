// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";

import { Box3, Vector3, type Mesh } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

/** Height in metres and a triangle budget, as `assets/vegetation/README.md` lists them. */
const MODELS = {
  "tree-round": { height: [7, 9], triangles: 400 },
  "tree-tall": { height: [11, 13.5], triangles: 400 },
  "tree-pine": { height: [8, 10], triangles: 400 },
  bush: { height: [0.8, 1.5], triangles: 300 },
  hedge: { height: [0.7, 1.3], triangles: 400 },
} as const satisfies Record<
  string,
  { height: readonly [number, number]; triangles: number }
>;

async function load(name: string): Promise<GLTF> {
  // Tests run from the repository root, as the other asset tests read theirs.
  const bytes = readFileSync(
    `packages/map-maplibre/src/assets/vegetation/${name}.glb`,
  );
  // Copied into this realm's ArrayBuffer: the loader checks `instanceof`.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new GLTFLoader().parseAsync(buffer, "");
}

describe("the map's vegetation", () => {
  it.each(Object.entries(MODELS))(
    "%s is one still mesh, at true height, standing at the origin",
    async (name, { height, triangles }) => {
      const gltf = await load(name);
      // Drawn by the thousand, instanced: no clip, no rig, one mesh.
      expect(gltf.animations).toHaveLength(0);
      const meshes: Mesh[] = [];
      gltf.scene.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.isMesh) meshes.push(mesh);
      });
      expect(meshes.length).toBeGreaterThan(0);
      expect(meshes.some((mesh) => "isSkinnedMesh" in mesh)).toBe(false);
      const count = meshes.reduce((sum, mesh) => {
        const index = mesh.geometry.index;
        return sum + (index === null ? 0 : index.count / 3);
      }, 0);
      expect(count).toBeLessThanOrEqual(triangles);

      gltf.scene.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(gltf.scene);
      const size = bounds.getSize(new Vector3());
      expect(size.y).toBeGreaterThan(height[0]);
      expect(size.y).toBeLessThan(height[1]);
      expect(Math.abs(bounds.min.y)).toBeLessThan(0.05);
      // Centred on its trunk: it stands where it is put.
      const centre = bounds.getCenter(new Vector3());
      expect(Math.abs(centre.x)).toBeLessThan(size.x / 4);
      expect(Math.abs(centre.z)).toBeLessThan(size.z / 4);
    },
  );
});
