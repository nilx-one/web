// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { existsSync, readFileSync } from "node:fs";

import {
  Box3,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import {
  createBackpackSource,
  disposeBackpack,
  mountBackpack,
} from "./backpack-model";

const ASSET = "packages/map-maplibre/src/assets/aiaiaiai-backpack.glb";
const STUDIES = [
  "deploy/web/avatars/0.1.0/sky-study.glb",
  "deploy/web/avatars/0.1.0/dasha-study.glb",
  "deploy/web/avatars/0.1.0/kai-study.glb",
  "deploy/web/avatars/0.3.0/dasha-v2-study.glb",
];

function parse(path: string): Promise<GLTF> {
  const bytes = readFileSync(path);
  // Copied into this realm's ArrayBuffer: the loader checks `instanceof`.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new GLTFLoader().parseAsync(buffer, "");
}

/** A box torso on the shared bone names, skinned to its spine and chest. */
function syntheticBody(): { body: Object3D; chest: Bone } {
  const root = new Bone();
  root.name = "root";
  const spine = new Bone();
  spine.name = "spine";
  spine.position.y = 1.1;
  const chest = new Bone();
  chest.name = "chest";
  chest.position.y = 0.25;
  const arms = (["L", "R"] as const).map((side) => {
    const arm = new Bone();
    arm.name = `upperarm_${side}`;
    arm.position.set(side === "L" ? 0.16 : -0.16, 0.08, 0);
    return arm;
  });
  root.add(spine);
  spine.add(chest);
  chest.add(...arms);
  const geometry = new BoxGeometry(0.34, 0.6, 0.22, 6, 12, 4);
  geometry.translate(0, 1.2, 0);
  const count = geometry.getAttribute("position").count;
  const joints = new Uint16BufferAttribute(new Uint16Array(count * 4), 4);
  const weights = new Float32BufferAttribute(new Float32Array(count * 4), 4);
  for (let i = 0; i < count; i += 1) {
    joints.setX(i, geometry.getAttribute("position").getY(i) > 1.35 ? 2 : 1);
    weights.setX(i, 1);
  }
  geometry.setAttribute("skinIndex", joints);
  geometry.setAttribute("skinWeight", weights);
  const torso = new SkinnedMesh(geometry, new MeshStandardMaterial());
  const body = new Object3D();
  body.add(root, torso);
  body.updateMatrixWorld(true);
  torso.bind(new Skeleton([root, spine, chest, ...arms]));
  return { body, chest };
}

function authoredBag(): Object3D {
  const bag = new Object3D();
  const strap = new Mesh(new BoxGeometry(0.04, 0.3, 0.01));
  strap.name = "HERO_strap_1";
  bag.add(new Mesh(new BoxGeometry(0.3, 0.42, 0.14)), strap);
  return bag;
}

function worldBox(object: Object3D): Box3 {
  object.updateWorldMatrix(true, true);
  return new Box3().setFromObject(object, true);
}

describe("backpack asset", () => {
  it("ships a self-contained model without studio lights or a camera", () => {
    const bytes = readFileSync(ASSET);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    const gltf = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    ) as {
      cameras?: unknown;
      extensionsUsed: string[];
      meshes: unknown[];
      buffers: { uri?: string }[];
    };
    expect(gltf.cameras).toBeUndefined();
    expect(gltf.extensionsUsed).not.toContain("KHR_lights_punctual");
    expect(gltf.meshes.length).toBeGreaterThan(0);
    expect(gltf.buffers.every((buffer) => buffer.uri === undefined)).toBe(true);
  });
});

describe("backpack attachment", () => {
  it("clones the asset and follows the animated chest rather than the map origin", () => {
    const { body, chest } = syntheticBody();
    const asset = authoredBag();
    const mounted = mountBackpack(body, asset)!;
    expect(mounted.parent).toBe(chest);
    expect(mounted.children[0]).not.toBe(asset);
    expect(asset.parent).toBeNull();
    const before = mounted.children[0]!.getWorldPosition(new Vector3());
    chest.rotation.x = 0.4;
    chest.updateMatrixWorld(true);
    expect(
      mounted.children[0]!.getWorldPosition(new Vector3()).distanceTo(before),
    ).toBeGreaterThan(0.05);
  });

  it("rests on the back and puts straps over both shoulders", () => {
    const { body } = syntheticBody();
    const mounted = mountBackpack(body, authoredBag())!;
    const [bag, ...straps] = mounted.children;
    // The torso's back is z = -0.11; the bag sits just behind it, not in it.
    expect(worldBox(bag!).max.z).toBeCloseTo(-0.11 - 0.006, 2);
    expect(bag!.getObjectByName("HERO_strap_1")!.visible).toBe(false);
    expect(straps.map((strap) => strap.name).sort()).toEqual([
      "aiaiaiai-backpack-strap-L",
      "aiaiaiai-backpack-strap-R",
    ]);
    for (const strap of straps) {
      const box = worldBox(strap);
      // Over the top of the shoulder (1.50) and down in front of the chest.
      expect(box.max.y).toBeGreaterThan(1.5);
      expect(box.max.z).toBeGreaterThan(0.11);
      expect(box.min.z).toBeLessThan(-0.11);
    }
  });

  it("does not float an item on an unsupported rig", () => {
    const body = new Object3D();
    const chest = new Bone();
    chest.name = "chest";
    body.add(chest);
    expect(mountBackpack(body, new Object3D())).toBeUndefined();
    expect(chest.children).toHaveLength(0);
  });

  it("releases the straps it built", () => {
    const { body, chest } = syntheticBody();
    const mounted = mountBackpack(body, authoredBag())!;
    disposeBackpack(mounted);
    expect(chest.children).not.toContain(mounted);
  });
});

describe("backpack asset source", () => {
  it("shares one fetch and retries a failed one only after a pause", async () => {
    let clock = 0;
    let calls = 0;
    const loaded = { scene: new Object3D() } as GLTF;
    const source = createBackpackSource(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(loaded);
      },
      () => clock,
    );
    await expect(source.request()).rejects.toThrow("offline");
    expect(source.request()).toBeUndefined();
    clock = 29_999;
    expect(source.request()).toBeUndefined();
    clock = 30_000;
    await expect(source.request()).resolves.toBe(loaded);
    await source.request();
    expect(calls).toBe(2);
  });
});

// The studies are built by tools/avatars/build.sh, which Full CI runs before
// these tests; a checkout without them skips rather than guesses.
describe.skipIf(!STUDIES.every((path) => existsSync(path)))(
  "backpack on every published study",
  () => {
    it.each(STUDIES)("fits %s", async (path) => {
      const [study, backpack] = await Promise.all([parse(path), parse(ASSET)]);
      const body = study.scene;
      body.updateMatrixWorld(true);
      const mounted = mountBackpack(body, backpack.scene)!;
      expect(mounted).toBeDefined();
      const shoulder = body
        .getObjectByName("upperarm_L")!
        .getWorldPosition(new Vector3());
      const bag = worldBox(mounted.getObjectByName("HERO_shell")!);
      // The shell's top clears the shoulder line on every study, whatever
      // its chest height, and the bag hangs on the back.
      expect(bag.max.y - shoulder.y).toBeCloseTo(0.06, 2);
      expect(bag.max.z).toBeLessThan(-0.06);
      expect(bag.max.z).toBeGreaterThan(-0.14);
      for (const side of ["L", "R"]) {
        const strap = worldBox(
          mounted.getObjectByName(`aiaiaiai-backpack-strap-${side}`)!,
        );
        expect(strap.max.y).toBeGreaterThan(shoulder.y);
        expect(strap.max.z).toBeGreaterThan(0.05);
      }
    });
  },
);
