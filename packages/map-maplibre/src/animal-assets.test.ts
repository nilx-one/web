// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";

import {
  AMBIENT_ANIMAL_CLIPS,
  AMBIENT_ANIMAL_KINDS,
  type AmbientAnimalClipId,
  type AmbientAnimalKind,
} from "@nilx-one/map-contract";
import { AnimationMixer, Box3, Vector3, type Mesh } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";

import { ANIMAL_ASSET_URLS } from "./animal-assets";
import { animalSceneHandle, assetUrl, createAvatarLayer } from "./avatar-layer";

async function loadAnimal(kind: AmbientAnimalKind): Promise<GLTF> {
  // Tests run from the repository root, as the other asset tests read theirs.
  const bytes = readFileSync(
    `packages/map-maplibre/src/assets/animals/${kind}.glb`,
  );
  // Copied into this realm's ArrayBuffer: the loader checks `instanceof`.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new GLTFLoader().parseAsync(buffer, "");
}

/** How long each animal is along glTF +Z, in metres. */
const LENGTHS: Readonly<Record<AmbientAnimalKind, [number, number]>> = {
  dog: [0.75, 1.05],
  cat: [0.4, 0.6],
  eagle: [0.5, 1.1],
  piranha: [0.25, 0.35],
};

/** The material that only the head wears; a dog has one material for all. */
const HEAD_MATERIAL: Partial<Record<AmbientAnimalKind, string>> = {
  cat: "Pink",
  eagle: "Beak",
  piranha: "White",
};

function headPoint(gltf: GLTF, kind: AmbientAnimalKind, bounds: Box3): Vector3 {
  const points: Vector3[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as { name?: string };
    const wanted = HEAD_MATERIAL[kind];
    if (wanted !== undefined && material.name !== wanted) return;
    const position = mesh.geometry.attributes.position;
    if (position === undefined) return;
    // Skinned: each vertex where its bones put it, as the layer draws it.
    for (let index = 0; index < position.count; index += 1) {
      points.push(
        mesh
          .getVertexPosition(index, new Vector3())
          .applyMatrix4(mesh.matrixWorld),
      );
    }
  });
  const floor = bounds.max.y - (bounds.max.y - bounds.min.y) * 0.12;
  const head =
    HEAD_MATERIAL[kind] === undefined
      ? points.filter((point) => point.y >= floor)
      : points;
  return head
    .reduce((sum, point) => sum.add(point), new Vector3())
    .divideScalar(Math.max(1, head.length));
}

describe("the city's animals as the layer draws them", () => {
  it("are their own assets, never an avatar study", () => {
    for (const kind of AMBIENT_ANIMAL_KINDS) {
      expect(ANIMAL_ASSET_URLS[kind]).toMatch(new RegExp(`${kind}.*\\.glb`));
      expect(assetUrl(`animal-${kind}`)).toBe(ANIMAL_ASSET_URLS[kind]);
    }
    expect(assetUrl("sky-study")).toBe("/avatars/0.1.0/sky-study.glb");
  });

  it("stand at true size, and a bird flies at its height", () => {
    expect(
      animalSceneHandle({
        id: "a1",
        kind: "eagle",
        lngLat: [30.5, 50.4],
        bearingDeg: 45,
        clipId: "fly",
        clipPhase: 0.3,
        heightMeters: 24,
        visible: true,
      }),
    ).toEqual({
      id: "animal:a1",
      modelId: "animal-eagle",
      lngLat: [30.5, 50.4],
      bearingDeg: 45,
      clipId: "fly",
      clipPhase: 0.3,
      scale: 1,
      visible: true,
      liftMeters: 24,
    });
  });

  it("share the layer with bodies without taking their ids", () => {
    const loadAsset = vi.fn();
    const layer = createAvatarLayer({ loadAsset });
    const dog = {
      id: "bond",
      kind: "dog",
      lngLat: [30.5, 50.4],
      bearingDeg: 0,
      clipId: "walk",
      clipPhase: 0,
      visible: true,
    } as const;
    layer.upsertAnimal(dog);
    layer.remove("bond");
    expect(layer.hasInstances()).toBe(true);
    layer.removeAnimal("bond");
    expect(layer.hasInstances()).toBe(false);
    layer.dispose();
  });
});

describe("the animals' assets", () => {
  it.each(AMBIENT_ANIMAL_KINDS)(
    "%s carries its clips, at metre scale, on the ground, facing +Z",
    async (kind) => {
      const gltf = await loadAnimal(kind);
      expect(gltf.animations.map((clip) => clip.name).sort()).toEqual(
        [...AMBIENT_ANIMAL_CLIPS[kind]].sort(),
      );

      // Measured in its first clip, the way the layer first draws it.
      const mixer = new AnimationMixer(gltf.scene);
      const pose = (name: string) => {
        const clip = gltf.animations.find((entry) => entry.name === name);
        mixer.stopAllAction();
        if (clip !== undefined) mixer.clipAction(clip).play();
        mixer.setTime(0);
        gltf.scene.updateMatrixWorld(true);
        return new Box3().setFromObject(gltf.scene);
      };
      const clips: readonly AmbientAnimalClipId[] = AMBIENT_ANIMAL_CLIPS[kind];
      const bounds = pose(clips[0] ?? "");
      const size = bounds.getSize(new Vector3());
      const [shortest, longest] = LENGTHS[kind];
      expect(size.z).toBeGreaterThan(shortest);
      expect(size.z).toBeLessThan(longest);
      expect(Math.abs(bounds.min.y)).toBeLessThan(0.1);

      // The head lies ahead of the body's middle, towards +Z: the face for a
      // fish and a bird, the ears for a cat, the highest slice for a dog. It
      // is read at rest, where a bird's wings are folded and not swept ahead.
      const rest = pose(clips.includes("idle") ? "idle" : (clips[0] ?? ""));
      const head = headPoint(gltf, kind, rest);
      expect(head.length()).toBeGreaterThan(0);
      expect(head.z).toBeGreaterThan(rest.getCenter(new Vector3()).z);
    },
  );
});
