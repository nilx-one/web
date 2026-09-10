// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { Object3D } from "three";

import {
  AVATAR_ASSET_URLS,
  AVATAR_LAYER_ID,
  applyAvatarNodeVisibility,
  createAvatarLayer,
  sampleAmbientAvatar,
} from "./avatar-layer";

describe("avatar presentation contract", () => {
  it("keeps every model asset on the versioned same-origin path", () => {
    expect(AVATAR_ASSET_URLS["sky-study"]).toBe("/avatars/0.1.0/sky-study.glb");
    expect(AVATAR_ASSET_URLS["dasha-study"]).toBe(
      "/avatars/0.1.0/dasha-study.glb",
    );
    expect(AVATAR_ASSET_URLS["dasha-v2-study"]).toBe(
      "/avatars/0.3.0/dasha-v2-study.glb",
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
