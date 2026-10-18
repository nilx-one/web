// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AnimationMixer,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
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

/**
 * Something the body carries that its own asset does not: a separate asset
 * fitted onto this skeleton. It is mounted the first time it is shown on a
 * body and only shown and hidden after that; a new body mounts it again.
 */
export interface AvatarPreviewAttachment {
  /** One mount per key per body. */
  readonly key: string;
  /** Fit onto the standing body; nothing for a body it does not fit. */
  readonly mount: (root: Object3D) => Promise<Object3D | undefined>;
  /** Give back what the mount made for itself; shared assets stay. */
  readonly dispose: (mounted: Object3D) => void;
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
  /**
   * Stand in this clip at this normalized phase, the way the world seeks its
   * own body on every update; between updates the clip runs on its own clock.
   * No clip stands still.
   */
  setPose(clipId: string | undefined, phase: number): void;
  /** Show or hide something the body carries. */
  setAttachment(attachment: AvatarPreviewAttachment, shown: boolean): void;
  /**
   * Hidden keeps the loaded body, its skeleton and its mixer, and only stops
   * drawing: showing it again is a flag, never a fresh fetch and clone.
   */
  setHidden(hidden: boolean): void;
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

const GLTF_NODE_NAME = "gltfNodeName";

/**
 * Keep each glTF node's own name on the object it became. Three's loader
 * strips `:` and `/` from object names, so `wear:top/tee-black` would arrive as
 * `weartoptee-black`; the map layer records names the same way.
 */
export function rememberGltfNodeNames(gltf: GLTF): void {
  const nodes = (gltf.parser?.json?.nodes ?? []) as readonly {
    name?: string;
  }[];
  for (const [object, reference] of gltf.parser?.associations ?? []) {
    if (!(object instanceof Object3D) || reference.nodes === undefined)
      continue;
    const name = nodes[reference.nodes]?.name;
    if (typeof name === "string") object.userData[GLTF_NODE_NAME] = name;
  }
}

function nodeName(object: Object3D): string {
  const recorded: unknown = object.userData[GLTF_NODE_NAME];
  return typeof recorded === "string" ? recorded : object.name;
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
    const name = nodeName(object);
    if (!name.includes(":")) return;
    object.visible = visibleNodes.includes(name);
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
  let clipId = options.clipId;
  let phase = 0;
  let playing: AnimationClip | undefined;
  let hidden = false;
  interface HeldAttachment {
    attachment: AvatarPreviewAttachment;
    shown: boolean;
    mounted?: Object3D;
    mounting?: Object3D;
  }
  const attachments = new Map<string, HeldAttachment>();
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
    if (hidden || target === undefined || root === undefined) return;
    const now = globalThis.performance?.now?.() ?? 0;
    if (mixer !== undefined && options.reducedMotion !== true) {
      const delta = Math.min(0.1, Math.max(0, now - lastFrame) / 1000);
      mixer.update(delta);
    }
    lastFrame = now;
    target.render(scene, camera);
  }

  function startLoop(): void {
    if (stopLoop !== undefined || disposed || hidden) return;
    if (options.reducedMotion === true) {
      // Standing still is one frame, not a loop that redraws the same pose.
      draw();
      return;
    }
    lastFrame = globalThis.performance?.now?.() ?? 0;
    stopLoop = schedule(draw);
  }

  function releaseAttachments(): void {
    for (const held of attachments.values()) {
      // Detached before the body's tree is disposed: an attachment shares its
      // asset's geometry, which is not this body's to give back.
      if (held.mounted !== undefined) held.attachment.dispose(held.mounted);
      delete held.mounted;
      delete held.mounting;
    }
  }

  function syncAttachment(held: HeldAttachment): void {
    if (held.mounted !== undefined) {
      held.mounted.visible = held.shown;
      draw();
      return;
    }
    const body = root;
    if (!held.shown || body === undefined || held.mounting === body) return;
    held.mounting = body;
    void held.attachment
      .mount(body)
      .then((mounted) => {
        // A mount overtaken by a new body, or by disposal, is given back.
        if (held.mounting !== body || disposed || root !== body) {
          if (mounted !== undefined) held.attachment.dispose(mounted);
          if (held.mounting === body) delete held.mounting;
          return;
        }
        delete held.mounting;
        if (mounted === undefined) return;
        held.mounted = mounted;
        mounted.visible = held.shown;
        draw();
      })
      .catch(() => {
        // A carried item never keeps the body from standing; the next time it
        // is asked for it is tried again.
        if (held.mounting === body) delete held.mounting;
      });
  }

  function clearBody(): void {
    releaseAttachments();
    if (root !== undefined) {
      mixer?.stopAllAction();
      root.removeFromParent();
      disposeTree(root);
    }
    root = undefined;
    mixer = undefined;
    playing = undefined;
    clips = [];
  }

  function playClip(): void {
    if (root === undefined) return;
    mixer?.stopAllAction();
    const clip =
      clipId === undefined
        ? undefined
        : clips.find((entry) => entry.name === clipId);
    playing = clip;
    if (clip === undefined) return;
    mixer ??= new AnimationMixer(root);
    mixer.clipAction(clip).reset().play();
  }

  /** The world's own seek, so a body handed between them keeps its pose. */
  function seek(at: number): void {
    if (mixer === undefined || playing === undefined) return;
    const duration = Math.max(playing.duration, Number.EPSILON);
    mixer.setTime(duration * Math.min(0.999999, Math.max(0, at)));
  }

  function stand(gltf: GLTF, next: AvatarPreviewBody): void {
    clearBody();
    rememberGltfNodeNames(gltf);
    const instance = cloneSkeleton(gltf.scene);
    applyPreviewVisibility(instance, next.visibleNodes);
    scene.add(instance);
    root = instance;
    clips = gltf.animations;
    playClip();
    seek(phase);
    instance.updateMatrixWorld(true);
    framePreviewCamera(camera, new Box3().setFromObject(instance), framing);
    for (const held of attachments.values()) syncAttachment(held);
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

    setPose(next, nextPhase) {
      if (disposed) return;
      phase = nextPhase;
      if (next !== clipId) {
        clipId = next;
        playClip();
      }
      seek(phase);
      draw();
    },

    setAttachment(attachment, shown) {
      if (disposed) return;
      const held = attachments.get(attachment.key);
      if (held === undefined) {
        const fresh: HeldAttachment = { attachment, shown };
        attachments.set(attachment.key, fresh);
        syncAttachment(fresh);
        return;
      }
      if (held.shown === shown && (held.mounted !== undefined || !shown))
        return;
      held.shown = shown;
      syncAttachment(held);
    },

    setHidden(next) {
      if (disposed || next === hidden) return;
      hidden = next;
      if (hidden) {
        stopLoop?.();
        stopLoop = undefined;
        return;
      }
      if (root !== undefined) startLoop();
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
