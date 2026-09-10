// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AnimationMixer,
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

/**
 * A body standing still, off the map.
 *
 * The settings field and the wardrobe editor look at the same thing the world
 * draws, so neither of them owns a second idea of what a person looks like.
 * This surface takes a resolved body and nothing else: it is told which nodes
 * to draw and never works out what an outfit is.
 */
export interface AvatarPreviewBody {
  /** Stable identity of this resolved body; equal keys draw the same thing. */
  readonly key: string;
  readonly assetUrl: string;
  /** Nodes this appearance draws. Empty means the asset as it was authored. */
  readonly visibleNodes: readonly string[];
}

/** How much of the body is in frame. */
export type AvatarPreviewFraming = "full-body" | "head-and-shoulders";

export type AvatarPreviewStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface AvatarPreviewOptions {
  readonly framing?: AvatarPreviewFraming;
  /** A person who asked for reduced motion is left standing still. */
  readonly reducedMotion?: boolean;
  readonly clipId?: string;
  readonly background?: string;
  readonly onStatus?: (status: AvatarPreviewStatus) => void;
  readonly loadAsset?: (url: string, signal: AbortSignal) => Promise<GLTF>;
  readonly createRenderer?: (canvas: HTMLCanvasElement) => WebGLRenderer;
  readonly schedule?: (draw: () => void) => () => void;
}

export interface AvatarPreview {
  show(body: AvatarPreviewBody): void;
  setFraming(framing: AvatarPreviewFraming): void;
  resize(width: number, height: number): void;
  getStatus(): AvatarPreviewStatus;
  dispose(): void;
}

interface CachedAsset {
  readonly asset: Promise<GLTF>;
  holders: number;
}

/**
 * One load per asset for the whole application.
 *
 * Opening the editor after looking at the settings field must not fetch the
 * same body again, and closing the editor must give its memory back. The cache
 * counts who is holding an asset rather than keeping every study ever looked
 * at: a person who tried all four models does not keep paying for three of
 * them.
 */
const assets = new Map<string, CachedAsset>();

function defaultLoadAsset(url: string, signal: AbortSignal): Promise<GLTF> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("Avatar preview load aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    loader.load(
      url,
      (gltf) => {
        signal.removeEventListener("abort", onAbort);
        resolve(gltf);
      },
      undefined,
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function retain(
  url: string,
  load: (url: string, signal: AbortSignal) => Promise<GLTF>,
  signal: AbortSignal,
): Promise<GLTF> {
  const cached = assets.get(url);
  if (cached !== undefined) {
    cached.holders += 1;
    return cached.asset;
  }
  const asset = load(url, signal).catch((error: unknown) => {
    assets.delete(url);
    throw error;
  });
  assets.set(url, { asset, holders: 1 });
  return asset;
}

function release(url: string): void {
  const cached = assets.get(url);
  if (cached === undefined) return;
  cached.holders -= 1;
  if (cached.holders > 0) return;
  assets.delete(url);
  void cached.asset
    .then((gltf) => disposeTree(gltf.scene))
    .catch(() => undefined);
}

/** Give the GPU back everything this tree took. */
export function disposeTree(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<{
      geometry: { dispose(): void };
      material: { dispose(): void } | { dispose(): void }[];
    }>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose();
  });
}

/**
 * Show what this body is wearing, and only that. Namespaced nodes belong to
 * the application; a bare name is the asset's own and is never touched.
 */
export function applyPreviewVisibility(
  root: Object3D,
  visibleNodes: readonly string[],
): void {
  if (visibleNodes.length === 0) return;
  root.traverse((object) => {
    if (!object.name.includes(":")) return;
    object.visible = visibleNodes.includes(object.name);
  });
}

/**
 * How the camera stands in front of a body, measured from the body itself
 * rather than from numbers tuned per study. Every study clears a different
 * height, and a preset that framed one of them would crop another.
 */
export function framePreviewCamera(
  camera: PerspectiveCamera,
  bounds: Box3,
  framing: AvatarPreviewFraming,
): void {
  const size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3());
  const height = Math.max(size.y, Number.EPSILON);
  const target =
    framing === "full-body"
      ? centre
      : new Vector3(centre.x, bounds.max.y - height * 0.11, centre.z);
  const framed = framing === "full-body" ? height * 1.12 : height * 0.26;
  const radians = (camera.fov * Math.PI) / 180;
  const distance =
    framed / 2 / Math.tan(radians / 2) / Math.max(camera.aspect, 0.35);
  camera.position.set(target.x, target.y, target.z + distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 8;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

/**
 * Stand one body in a canvas.
 *
 * Only the selected study is ever fetched: a picker that loaded all four to
 * show one would spend a person's data on bodies they did not ask to see.
 * A load that is overtaken — a person moving through the catalog faster than
 * the network answers — is abandoned rather than allowed to arrive late and
 * replace the body they settled on.
 */
export function createAvatarPreview(
  canvas: HTMLCanvasElement,
  options: AvatarPreviewOptions = {},
): AvatarPreview {
  const loadAsset = options.loadAsset ?? defaultLoadAsset;
  const makeRenderer =
    options.createRenderer ??
    ((target: HTMLCanvasElement) =>
      new WebGLRenderer({ canvas: target, antialias: true, alpha: true }));
  const schedule =
    options.schedule ??
    ((draw: () => void) => {
      let frame = globalThis.requestAnimationFrame(function step() {
        draw();
        frame = globalThis.requestAnimationFrame(step);
      });
      return () => globalThis.cancelAnimationFrame(frame);
    });

  const scene = new Scene();
  const ambient = new HemisphereLight(0xffffff, 0x6e665e, 2.1);
  ambient.position.set(0, 1, 0);
  const key = new DirectionalLight(0xfff1df, 2.1);
  key.position.set(0.6, 1.1, 1.4);
  scene.add(ambient, key);
  const camera = new PerspectiveCamera(32, 1, 0.05, 40);

  let framing: AvatarPreviewFraming = options.framing ?? "full-body";
  let renderer: WebGLRenderer | undefined;
  let stopLoop: (() => void) | undefined;
  let status: AvatarPreviewStatus = { kind: "idle" };
  let body: AvatarPreviewBody | undefined;
  let root: Object3D | undefined;
  let mixer: AnimationMixer | undefined;
  let clips: readonly AnimationClip[] = [];
  let held: string | undefined;
  let generation = 0;
  let disposed = false;
  let lastFrame = 0;
  const aborts = new AbortController();

  function announce(next: AvatarPreviewStatus): void {
    status = next;
    options.onStatus?.(next);
  }

  function ensureRenderer(): WebGLRenderer | undefined {
    if (disposed) return undefined;
    if (renderer !== undefined) return renderer;
    try {
      renderer = makeRenderer(canvas);
      renderer.setClearAlpha(0);
      return renderer;
    } catch {
      // A host with no usable WebGL is answered with a still, not a blank box.
      announce({ kind: "unavailable", reason: "graphics-unavailable" });
      return undefined;
    }
  }

  function draw(): void {
    const target = ensureRenderer();
    if (target === undefined || root === undefined) return;
    const now = globalThis.performance?.now?.() ?? 0;
    if (mixer !== undefined && options.reducedMotion !== true) {
      const delta = Math.min(0.1, Math.max(0, now - lastFrame) / 1000);
      mixer.update(delta);
    }
    lastFrame = now;
    target.render(scene, camera);
  }

  function startLoop(): void {
    if (stopLoop !== undefined || disposed) return;
    if (options.reducedMotion === true) {
      // Standing still is one frame, not a loop that redraws the same pose.
      draw();
      return;
    }
    lastFrame = globalThis.performance?.now?.() ?? 0;
    stopLoop = schedule(draw);
  }

  function clearBody(): void {
    if (root !== undefined) {
      mixer?.stopAllAction();
      root.removeFromParent();
      disposeTree(root);
    }
    root = undefined;
    mixer = undefined;
    clips = [];
  }

  function stand(gltf: GLTF, next: AvatarPreviewBody): void {
    clearBody();
    const instance = cloneSkeleton(gltf.scene);
    applyPreviewVisibility(instance, next.visibleNodes);
    scene.add(instance);
    root = instance;
    clips = gltf.animations;
    const clip =
      options.clipId === undefined
        ? undefined
        : clips.find((entry) => entry.name === options.clipId);
    if (clip !== undefined) {
      mixer = new AnimationMixer(instance);
      mixer.clipAction(clip).reset().play();
    }
    instance.updateMatrixWorld(true);
    framePreviewCamera(camera, new Box3().setFromObject(instance), framing);
    announce({ kind: "ready" });
    startLoop();
    draw();
  }

  return {
    show(next) {
      if (disposed) return;
      // Changing clothes on a body already standing here is a change of
      // visibility, never a reload: the identity underneath does not move.
      if (body?.key === next.key) return;
      if (body?.assetUrl === next.assetUrl && root !== undefined) {
        body = next;
        applyPreviewVisibility(root, next.visibleNodes);
        draw();
        return;
      }
      const local = ++generation;
      body = next;
      announce({ kind: "loading" });
      const previous = held;
      held = next.assetUrl;
      retain(next.assetUrl, loadAsset, aborts.signal)
        .then((gltf) => {
          if (disposed || local !== generation) {
            release(next.assetUrl);
            return;
          }
          if (previous !== undefined) release(previous);
          stand(gltf, next);
        })
        .catch(() => {
          if (disposed || local !== generation) return;
          held = previous;
          clearBody();
          announce({ kind: "unavailable", reason: "asset-unavailable" });
        });
    },

    setFraming(next) {
      framing = next;
      if (root === undefined) return;
      framePreviewCamera(camera, new Box3().setFromObject(root), framing);
      draw();
    },

    resize(width, height) {
      if (disposed || width <= 0 || height <= 0) return;
      camera.aspect = width / height;
      if (root !== undefined) {
        framePreviewCamera(camera, new Box3().setFromObject(root), framing);
      }
      camera.updateProjectionMatrix();
      ensureRenderer()?.setSize(width, height, false);
      draw();
    },

    getStatus() {
      return status;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      aborts.abort();
      stopLoop?.();
      stopLoop = undefined;
      clearBody();
      if (held !== undefined) release(held);
      held = undefined;
      renderer?.dispose();
      renderer = undefined;
      announce({ kind: "idle" });
    },
  };
}

/** How many assets the preview cache is holding. Released bodies are gone. */
export function heldAvatarAssets(): number {
  return assets.size;
}
