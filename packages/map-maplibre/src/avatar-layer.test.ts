// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Object3D } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

import {
  AVATAR_ASSET_URLS,
  AVATAR_LAYER_ID,
  applyAvatarNodeVisibility,
  createAvatarLayer,
  rememberGltfNodeNames,
  sampleAmbientAvatar,
} from "./avatar-layer";

describe("avatar presentation contract", () => {
  it("keeps every model asset on the versioned same-origin path", () => {
    expect(AVATAR_ASSET_URLS["sky-study"]).toBe("/avatars/0.1.0/sky-study.glb");
    expect(AVATAR_ASSET_URLS["dasha-study"]).toBe(
      "/avatars/0.1.0/dasha-study.glb",
    );
    expect(AVATAR_ASSET_URLS["dasha-v2-study"]).toBe(
      "/avatars/0.5.0/dasha-v2-study.glb",
    );
  });

  it("samples ambient clips deterministically without inference input", () => {
    expect(sampleAmbientAvatar(42, 12_345)).toEqual(
      sampleAmbientAvatar(42, 12_345),
    );
    expect(sampleAmbientAvatar(42, 12_345, true)).toEqual({
      clipId: "idle",
      clipPhase: 0,
    });
  });

  it("exposes a 3d custom layer while keeping handles explicit", () => {
    const layer = createAvatarLayer({ now: () => 0 });
    expect(layer.id).toBe(AVATAR_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("3d");
    layer.upsert({
      id: "local-study-preview",
      modelId: "sky-study",
      lngLat: [30.5234, 50.4501],
      bearingDeg: 0,
      clipId: "idle",
      clipPhase: 0,
      scale: 1,
      visible: false,
    });
    layer.remove("local-study-preview");
    layer.dispose();
  });
});

describe("drawing what a body is wearing", () => {
  function character(): Object3D {
    const root = new Object3D();
    for (const name of [
      "body:head",
      "body:torso",
      "body:feet",
      "wear:top/tee-black",
      "wear:shoes/loafers-black",
      "wear:dress/shift-indigo",
    ]) {
      const node = new Object3D();
      node.name = name;
      root.add(node);
    }
    return root;
  }

  function drawn(root: Object3D): string[] {
    return root.children
      .filter((child) => child.visible)
      .map((child) => child.name);
  }

  it("shows the nodes it was given names for and hides the rest", () => {
    const root = character();
    applyAvatarNodeVisibility(root, [
      "body:head",
      "body:feet",
      "wear:dress/shift-indigo",
    ]);
    expect(drawn(root)).toEqual([
      "body:head",
      "body:feet",
      "wear:dress/shift-indigo",
    ]);
  });

  it("changes an outfit without touching anything else in the scene", () => {
    const root = character();
    const untouched = new Object3D();
    untouched.name = "Armature";
    root.add(untouched);
    applyAvatarNodeVisibility(root, ["body:head", "wear:top/tee-black"]);
    applyAvatarNodeVisibility(root, ["body:head", "wear:dress/shift-indigo"]);
    expect(drawn(root)).toEqual([
      "body:head",
      "wear:dress/shift-indigo",
      "Armature",
    ]);
  });

  it("draws a sculpted study exactly as it was authored", () => {
    const root = character();
    applyAvatarNodeVisibility(root, undefined);
    applyAvatarNodeVisibility(root, []);
    expect(drawn(root)).toHaveLength(root.children.length);
  });
});

// The asset Full CI builds before these tests; a checkout without it skips
// rather than guesses. Synthetic objects carry `:` in their names, which a
// loaded asset never does: the loader strips it, so only the real asset shows
// that what is worn is what is drawn.
const MODULAR_ASSET = "deploy/web/avatars/0.5.0/dasha-v2-study.glb";

async function loadModular(): Promise<GLTF> {
  const bytes = readFileSync(MODULAR_ASSET);
  // Copied into this realm's ArrayBuffer: the loader checks `instanceof`.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new GLTFLoader().parseAsync(buffer, "");
}

const WORN = [
  "body:head",
  "body:hands",
  "body:upper_arms",
  "body:lower_arms",
  "body:feet",
  "wear:hair/swept-bun",
  "wear:top/tee-black",
  "wear:bottom/trousers-ecru",
  "wear:shoes/sneakers-white",
];

describe.skipIf(!existsSync(MODULAR_ASSET))("a loaded modular asset", () => {
  it("wears exactly what it is told, by the asset's own node names", async () => {
    const gltf = await loadModular();
    expect(gltf.scene.getObjectByName("wear:top/tee-black")).toBeUndefined();
    rememberGltfNodeNames(gltf);
    const root = cloneSkeleton(gltf.scene);
    applyAvatarNodeVisibility(root, WORN);
    const drawn: string[] = [];
    const hidden: string[] = [];
    root.traverse((object) => {
      const name: unknown = object.userData.gltfNodeName;
      if (typeof name !== "string" || !name.includes(":")) return;
      (object.visible ? drawn : hidden).push(name);
    });
    expect(drawn.sort()).toEqual([...WORN].sort());
    expect(hidden).toContain("wear:dress/shift-indigo");
    expect(hidden).toContain("wear:top/shell-ecru");
    expect(hidden).toContain("body:torso");
    expect(root.getObjectByName("chest")?.visible).toBe(true);
  });
});
