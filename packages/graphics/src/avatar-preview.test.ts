// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import {
  AnimationClip,
  Box3,
  NumberKeyframeTrack,
  Mesh,
  Object3D,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

import {
  applyPreviewVisibility,
  createAvatarPreview,
  framePreviewCamera,
  heldAvatarAssets,
  rememberGltfNodeNames,
  type AvatarPreviewStatus,
} from "./avatar-preview";

function character(): Object3D {
  const root = new Object3D();
  root.name = "dasha-v2-study";
  for (const name of [
    "body:head",
    "body:torso",
    "wear:top/tee-black",
    "wear:dress/shift-indigo",
  ]) {
    const mesh = new Mesh(new SphereGeometry(0.2, 4, 3));
    mesh.name = name;
    mesh.position.set(0, name === "body:head" ? 1.6 : 1.1, 0);
    root.add(mesh);
  }
  const bone = new Object3D();
  bone.name = "hips";
  root.add(bone);
  return root;
}

function asset(): GLTF {
  return {
    scene: character(),
    animations: [
      new AnimationClip("idle", 1, []),
      // A clip whose pose is readable: the body slides 10 m along x over 2 s.
      new AnimationClip("walk", 2, [
        new NumberKeyframeTrack(".position[x]", [0, 2], [0, 10]),
      ]),
    ],
  } as unknown as GLTF;
}

function fakeRenderer() {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
    setClearAlpha: vi.fn(),
    dispose: vi.fn(),
  };
}

function preview(
  overrides: Partial<Parameters<typeof createAvatarPreview>[1]> = {},
) {
  const renderer = fakeRenderer();
  const statuses: AvatarPreviewStatus[] = [];
  const view = createAvatarPreview({} as HTMLCanvasElement, {
    reducedMotion: true,
    loadAsset: () => Promise.resolve(asset()),
    createRenderer: () => renderer as never,
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { view, renderer, statuses };
}

const TEE = {
  key: "dasha-v2-study#tee",
  assetUrl: "/avatars/0.5.0/dasha-v2-study.glb",
  visibleNodes: ["body:head", "wear:top/tee-black"],
};
const DRESS = {
  key: "dasha-v2-study#dress",
  assetUrl: "/avatars/0.5.0/dasha-v2-study.glb",
  visibleNodes: ["body:head", "wear:dress/shift-indigo"],
};
const SKY = {
  key: "sky-study#{}",
  assetUrl: "/avatars/0.1.0/sky-study.glb",
  visibleNodes: [] as readonly string[],
};

describe("drawing a body off the map", () => {
  it("shows only what is worn, and never touches a bone", () => {
    const root = character();
    applyPreviewVisibility(root, ["body:head", "wear:dress/shift-indigo"]);
    expect(
      root.children.filter((child) => child.visible).map((child) => child.name),
    ).toEqual(["body:head", "wear:dress/shift-indigo", "hips"]);
  });

  it("draws a sculpted study exactly as it was authored", () => {
    const root = character();
    applyPreviewVisibility(root, []);
    expect(root.children.every((child) => child.visible)).toBe(true);
  });

  it("frames a body from its own height rather than a tuned number", () => {
    const camera = new PerspectiveCamera(32, 1, 0.05, 40);
    const short = new Box3(
      new Vector3(-0.3, 0, -0.3),
      new Vector3(0.3, 1, 0.3),
    );
    const tall = new Box3(new Vector3(-0.3, 0, -0.3), new Vector3(0.3, 2, 0.3));
    framePreviewCamera(camera, short, "full-body");
    const near = camera.position.z;
    framePreviewCamera(camera, tall, "full-body");
    expect(camera.position.z).toBeGreaterThan(near);
  });

  it("comes closer, and higher, for head and shoulders", () => {
    const camera = new PerspectiveCamera(32, 1, 0.05, 40);
    const bounds = new Box3(
      new Vector3(-0.3, 0, -0.3),
      new Vector3(0.3, 1.8, 0.3),
    );
    framePreviewCamera(camera, bounds, "full-body");
    const whole = { y: camera.position.y, z: camera.position.z };
    framePreviewCamera(camera, bounds, "head-and-shoulders");
    expect(camera.position.z).toBeLessThan(whole.z);
    expect(camera.position.y).toBeGreaterThan(whole.y);
  });
});

describe("what a preview costs", () => {
  it("changes an outfit without fetching the body again", async () => {
    const loadAsset = vi.fn(() => Promise.resolve(asset()));
    const { view } = preview({ loadAsset });
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    view.show(DRESS);
    expect(loadAsset).toHaveBeenCalledTimes(1);
    expect(view.getStatus().kind).toBe("ready");
    view.dispose();
  });

  it("does nothing at all when the same body is shown again", async () => {
    const loadAsset = vi.fn(() => Promise.resolve(asset()));
    const { view, renderer } = preview({ loadAsset });
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    const drawn = renderer.render.mock.calls.length;
    view.show({ ...TEE });
    expect(renderer.render.mock.calls.length).toBe(drawn);
    view.dispose();
  });

  it("loads only the study being looked at", async () => {
    const requested: string[] = [];
    const { view } = preview({
      loadAsset: (url) => {
        requested.push(url);
        return Promise.resolve(asset());
      },
    });
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    expect(requested).toEqual([TEE.assetUrl]);
    view.dispose();
  });

  it("gives the memory back when it is closed", async () => {
    const before = heldAvatarAssets();
    const { view } = preview();
    view.show(SKY);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    expect(heldAvatarAssets()).toBeGreaterThan(before);
    view.dispose();
    expect(heldAvatarAssets()).toBe(before);
  });

  it("stands still for a person who asked for reduced motion", async () => {
    const schedule = vi.fn(() => () => undefined);
    const { view } = preview({ reducedMotion: true, schedule });
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    expect(schedule).not.toHaveBeenCalled();
    view.dispose();
  });
});

describe("hiding a body that already stands here", () => {
  it("stops drawing while hidden and resumes without loading again", async () => {
    const loadAsset = vi.fn(() => Promise.resolve(asset()));
    const stop = vi.fn();
    const schedule = vi.fn(() => stop);
    const { view, renderer } = preview({
      reducedMotion: false,
      clipId: "idle",
      loadAsset,
      schedule,
    });
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    expect(schedule).toHaveBeenCalledTimes(1);

    view.setHidden(true);
    expect(stop).toHaveBeenCalledTimes(1);
    const drawn = renderer.render.mock.calls.length;
    view.setPose("walk", 0.5);
    view.resize(100, 100);
    expect(renderer.render.mock.calls.length).toBe(drawn);

    view.setHidden(false);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(loadAsset).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("loads while hidden and draws only once shown", async () => {
    const { view, renderer } = preview();
    view.setHidden(true);
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    expect(renderer.render).not.toHaveBeenCalled();
    view.setHidden(false);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});

describe("keeping the world's pose", () => {
  function standing(renderer: ReturnType<typeof fakeRenderer>): Object3D {
    const scene = renderer.render.mock.lastCall?.[0] as Object3D | undefined;
    const body = scene?.getObjectByName("dasha-v2-study");
    if (body === undefined) throw new Error("no body drawn");
    return body;
  }

  it("seeks a clip handed over mid-way to the world's own phase", async () => {
    const { view, renderer } = preview();
    view.setPose("walk", 0.25);
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    expect(standing(renderer).position.x).toBeCloseTo(2.5);

    view.setPose("walk", 0.6);
    expect(standing(renderer).position.x).toBeCloseTo(6);
    view.dispose();
  });

  it("changes clip without loading the body again", async () => {
    const loadAsset = vi.fn(() => Promise.resolve(asset()));
    const { view, renderer } = preview({ loadAsset });
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    view.setPose("walk", 0.5);
    expect(standing(renderer).position.x).toBeCloseTo(5);
    view.setPose("idle", 0);
    expect(loadAsset).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});

describe("what the body carries", () => {
  function carried() {
    const mounted: Object3D[] = [];
    const mount = vi.fn((root: Object3D) => {
      const bag = new Object3D();
      bag.name = "bag";
      root.add(bag);
      mounted.push(bag);
      return Promise.resolve(bag);
    });
    const dispose = vi.fn((bag: Object3D) => bag.removeFromParent());
    return { attachment: { key: "backpack", mount, dispose }, mounted };
  }

  it("mounts once on a body and only shows and hides it after that", async () => {
    const { view } = preview();
    const { attachment, mounted } = carried();
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));

    view.setAttachment(attachment, true);
    await vi.waitFor(() => expect(mounted).toHaveLength(1));
    expect(mounted[0]?.visible).toBe(true);
    view.setAttachment(attachment, false);
    expect(mounted[0]?.visible).toBe(false);
    view.setAttachment(attachment, true);
    expect(mounted[0]?.visible).toBe(true);
    expect(attachment.mount).toHaveBeenCalledOnce();
    view.dispose();
    expect(attachment.dispose).toHaveBeenCalledWith(mounted[0]);
  });

  it("is carried by a body that arrives after it was asked for", async () => {
    const { view } = preview();
    const { attachment, mounted } = carried();
    view.setAttachment(attachment, true);
    view.show(TEE);
    await vi.waitFor(() => expect(mounted).toHaveLength(1));
    expect(mounted[0]?.parent?.name).toBe("dasha-v2-study");
    view.dispose();
  });

  it("is mounted again on a new body and given back from the old one", async () => {
    const { view } = preview();
    const { attachment, mounted } = carried();
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    view.setAttachment(attachment, true);
    await vi.waitFor(() => expect(mounted).toHaveLength(1));

    view.show(SKY);
    await vi.waitFor(() => expect(mounted).toHaveLength(2));
    expect(attachment.dispose).toHaveBeenCalledWith(mounted[0]);
    view.dispose();
  });
});

describe("when a body cannot be shown", () => {
  it("says so instead of leaving a blank frame", async () => {
    const { view, statuses } = preview({
      loadAsset: () => Promise.reject(new Error("404")),
    });
    view.show(TEE);
    await vi.waitFor(() =>
      expect(view.getStatus()).toEqual({
        kind: "unavailable",
        reason: "asset-unavailable",
      }),
    );
    expect(statuses.map((status) => status.kind)).toContain("loading");
    view.dispose();
  });

  it("says so when the host has no usable graphics", () => {
    const { view } = preview({
      createRenderer: () => {
        throw new Error("no webgl");
      },
    });
    view.resize(200, 400);
    expect(view.getStatus()).toEqual({
      kind: "unavailable",
      reason: "graphics-unavailable",
    });
    view.dispose();
  });

  it("never lets an overtaken load replace the body settled on", async () => {
    let settle: ((gltf: GLTF) => void) | undefined;
    const { view } = preview({
      loadAsset: (url) =>
        url === SKY.assetUrl
          ? new Promise<GLTF>((resolve) => {
              settle = resolve;
            })
          : Promise.resolve(asset()),
    });
    view.show(SKY);
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    settle?.(asset());
    await Promise.resolve();
    expect(view.getStatus().kind).toBe("ready");
    view.dispose();
  });

  it("draws nothing after it is disposed", async () => {
    const { view, renderer } = preview();
    view.show(TEE);
    await vi.waitFor(() => expect(view.getStatus().kind).toBe("ready"));
    view.dispose();
    const drawn = renderer.render.mock.calls.length;
    view.show(DRESS);
    view.resize(100, 100);
    expect(renderer.render.mock.calls.length).toBe(drawn);
    expect(renderer.dispose).toHaveBeenCalled();
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
    applyPreviewVisibility(root, WORN);
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
