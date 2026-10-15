// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  MathUtils,
  type Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
  type Bone,
  type Material,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import backpackUrl from "./assets/aiaiaiai-backpack.glb?url";

export const BACKPACK_ASSET_URL = backpackUrl;
const RETRY_AFTER_MS = 30_000;

/** One shared backpack asset per map layer. */
export interface BackpackSource {
  /** The loading or loaded asset, or nothing while a failed fetch cools down. */
  request(): Promise<GLTF> | undefined;
  /** Frees the loaded asset's GPU resources. */
  release(): void;
}

/**
 * Loads the asset once and shares it. A failed fetch (a dropped mobile link,
 * an edge 5xx) is forgotten so the backpack is not lost for the session, but
 * it is retried only after a pause, not on every frame of a walk.
 */
export function createBackpackSource(
  load: () => Promise<GLTF>,
  now: () => number,
): BackpackSource {
  let asset: Promise<GLTF> | undefined;
  let retryAt = Number.NEGATIVE_INFINITY;
  return {
    request() {
      if (asset !== undefined) return asset;
      if (now() < retryAt) return undefined;
      const pending = load();
      asset = pending;
      pending.catch(() => {
        if (asset !== pending) return;
        asset = undefined;
        retryAt = now() + RETRY_AFTER_MS;
      });
      return pending;
    },
    release() {
      void asset
        ?.then((loaded) => {
          loaded.scene.traverse((object) => {
            const mesh = object as Mesh;
            mesh.geometry?.dispose();
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            for (const material of materials) material?.dispose();
          });
        })
        .catch(() => undefined);
      asset = undefined;
    },
  };
}

/** Bones whose skin is the torso: what the bag rests on and the straps wrap. */
const TORSO_BONES = new Set(["hips", "spine", "chest"]);
/** Authored asset: shell top, back panel and strap roots, in its own metres. */
const SHELL_TOP = 0.42;
const SHELL_BACK = 0.072;
/** The shell's top clears the shoulder line by this much, on every study. */
const TOP_OVER_SHOULDERS = 0.06;
/** Air between a surface and what lies on it, so nothing z-fights the cloth. */
const CLEARANCE = 0.006;
const STRAP_WIDTH = 0.042;
const STRAP_THICKNESS = 0.007;
const STRAP_NAME = "aiaiaiai-backpack-strap-";
const UP = new Vector3(0, 1, 0);

/**
 * The torso as it was bound: body-space skin points (Y up, facing +Z, the
 * studies' contract) plus the bind transform of the bones the fit reads.
 */
interface Torso {
  readonly points: readonly Vector3[];
  readonly bind: (name: string) => Matrix4 | undefined;
}

/**
 * Mounts a clone of the backpack on the body's chest bone and fits it to that
 * body. The fit is measured in bind space from the body's own torso skin and
 * converted into the chest's local space through its inverse bind matrix, so
 * a study's proportions and its bone orientation or scale both carry over.
 * A body without a skinned chest gets no backpack rather than a floating one.
 */
export function mountBackpack(
  body: Object3D,
  asset: Object3D,
): Object3D | undefined {
  const chest = body.getObjectByName("chest");
  const torso = chest === undefined ? undefined : readTorso(body, chest);
  const chestBind = torso?.bind("chest");
  const fit = torso === undefined ? undefined : fitTorso(torso);
  if (chest === undefined || chestBind === undefined || fit === undefined)
    return undefined;

  const mount = new Object3D();
  mount.name = "aiaiaiai-backpack";
  // Everything below is authored in body space; this maps it onto the chest.
  chestBind
    .clone()
    .invert()
    .decompose(mount.position, mount.quaternion, mount.scale);

  const bag = asset.clone(true);
  // On a person's back the bag's front faces -Z and its back panel the torso.
  bag.rotation.y = Math.PI;
  bag.position.set(0, fit.bagY, fit.back - CLEARANCE - SHELL_BACK);
  // The authored straps are stubs curling into the back panel; the fitted
  // straps below replace them so they never cut into the torso.
  bag.traverse((object) => {
    if (/^HERO_strap/.test(object.name)) object.visible = false;
  });
  mount.add(bag);

  const fabric = findMaterial(bag, "Fabric_white");
  for (const side of [-1, 1] as const) {
    const strap = new Mesh(
      strapGeometry(strapPath(fit, side), fit),
      fabric ?? ownedFabric(),
    );
    strap.name = `${STRAP_NAME}${side < 0 ? "L" : "R"}`;
    mount.add(strap);
  }

  chest.add(mount);
  return mount;
}

function readTorso(body: Object3D, chest: Object3D): Torso | undefined {
  let skeleton: SkinnedMesh["skeleton"] | undefined;
  const points: Vector3[] = [];
  body.traverse((object) => {
    if (!(object instanceof SkinnedMesh) || !object.visible) return;
    const bones = object.skeleton.bones;
    if (!bones.includes(chest as Bone)) return;
    skeleton = object.skeleton;
    const position = object.geometry.getAttribute("position");
    const joints = object.geometry.getAttribute("skinIndex");
    const weights = object.geometry.getAttribute("skinWeight");
    if (joints === undefined || weights === undefined) return;
    for (let i = 0; i < position.count; i += 1) {
      let dominant = 0;
      for (let k = 1; k < 4; k += 1)
        if (weights.getComponent(i, k) > weights.getComponent(i, dominant))
          dominant = k;
      const bone = bones[joints.getComponent(i, dominant)];
      if (bone === undefined || !TORSO_BONES.has(bone.name)) continue;
      points.push(
        new Vector3()
          .fromBufferAttribute(position, i)
          .applyMatrix4(object.bindMatrix),
      );
    }
  });
  if (skeleton === undefined || points.length === 0) return undefined;
  const found = skeleton;
  return {
    points,
    bind(name) {
      const index = found.bones.findIndex((bone) => bone.name === name);
      const inverse = found.boneInverses[index];
      return inverse === undefined ? undefined : inverse.clone().invert();
    },
  };
}

interface TorsoFit {
  /** Height of the shoulder joints. */
  readonly shoulders: number;
  /** Height of the top of the shoulders where a strap passes over them. */
  readonly shoulderTop: number;
  /** Strap centre line, distance from the body's midline. */
  readonly strapX: number;
  /** The back's surface behind the shoulder blades. */
  readonly back: number;
  /** Where the bag's origin (its base) sits. */
  readonly bagY: number;
  readonly frontAt: (y: number) => number;
  readonly backAt: (y: number) => number;
  readonly sideAt: (y: number) => number;
  /** A point the torso wraps around, for laying straps flat on it. */
  readonly axis: Vector3;
}

function fitTorso(torso: Torso): TorsoFit | undefined {
  const left = torso.bind("upperarm_L");
  const right = torso.bind("upperarm_R");
  if (left === undefined || right === undefined) return undefined;
  const l = new Vector3().setFromMatrixPosition(left);
  const r = new Vector3().setFromMatrixPosition(right);
  const shoulders = (l.y + r.y) / 2;
  const strapX = Math.abs(l.x - r.x) * 0.3;
  const points = torso.points;

  const extreme = (
    pick: (p: Vector3) => number,
    keep: (p: Vector3) => boolean,
    sign: 1 | -1,
  ): number | undefined => {
    let best: number | undefined;
    for (const p of points)
      if (keep(p) && (best === undefined || sign * pick(p) > sign * best))
        best = pick(p);
    return best;
  };
  const back = extreme(
    (p) => p.z,
    (p) =>
      Math.abs(p.x) < 0.08 && p.y > shoulders - 0.4 && p.y < shoulders - 0.05,
    -1,
  );
  if (back === undefined) return undefined;
  // A hood or a collar can rise well above the shoulder; a strap lies on the
  // shoulder itself, so the measured top is kept within a believable band.
  const measuredTop =
    extreme(
      (p) => p.y,
      (p) => Math.abs(Math.abs(p.x) - strapX) < 0.025 && Math.abs(p.z) < 0.05,
      1,
    ) ?? shoulders + 0.04;
  const shoulderTop = Math.min(
    Math.max(measuredTop, shoulders + 0.02),
    shoulders + 0.07,
  );
  const band = (y: number) => (p: Vector3) =>
    Math.abs(p.y - y) < 0.02 && Math.abs(Math.abs(p.x) - strapX) < 0.025;
  const frontAt = (y: number) => extreme((p) => p.z, band(y), 1) ?? -back;
  const backAt = (y: number) => extreme((p) => p.z, band(y), -1) ?? back;
  const sideAt = (y: number) =>
    extreme(
      (p) => Math.abs(p.x),
      (p) => Math.abs(p.y - y) < 0.02,
      1,
    ) ?? strapX * 1.8;
  return {
    shoulders,
    shoulderTop,
    strapX,
    back,
    bagY: shoulders + TOP_OVER_SHOULDERS - SHELL_TOP,
    frontAt,
    backAt,
    sideAt,
    axis: new Vector3(
      0,
      shoulders - 0.12,
      (back + frontAt(shoulders - 0.12)) / 2,
    ),
  };
}

/** Bag top → over the shoulder → down the chest → under the arm → bag base. */
function strapPath(fit: TorsoFit, side: -1 | 1): CatmullRomCurve3 {
  const x = side * fit.strapX;
  const over = fit.shoulderTop;
  const high = over - 0.035;
  const chest = fit.shoulders - 0.12;
  const armpit = fit.shoulders - 0.2;
  const bagBack = fit.back - CLEARANCE;
  const bagBase = fit.bagY + 0.06;
  return new CatmullRomCurve3(
    [
      new Vector3(x, fit.bagY + SHELL_TOP - 0.06, bagBack - STRAP_THICKNESS),
      new Vector3(x, high, fit.backAt(high) - CLEARANCE),
      new Vector3(
        x,
        over + CLEARANCE,
        (fit.backAt(over - 0.01) + fit.frontAt(over - 0.01)) / 2,
      ),
      new Vector3(x * 1.05, high, fit.frontAt(high) + CLEARANCE),
      new Vector3(x * 1.15, chest, fit.frontAt(chest) + CLEARANCE),
      new Vector3(
        side * (fit.sideAt(armpit) + CLEARANCE),
        armpit,
        fit.frontAt(armpit) * 0.2,
      ),
      new Vector3(
        side * (fit.sideAt(bagBase + 0.1) + CLEARANCE),
        bagBase + 0.1,
        fit.back * 0.6,
      ),
      new Vector3(side * 0.112, bagBase, bagBack - STRAP_THICKNESS),
    ],
    false,
    "centripetal",
  );
}

/** A flat webbing band swept along the path, lying on the torso's surface. */
function strapGeometry(path: CatmullRomCurve3, fit: TorsoFit): BufferGeometry {
  const steps = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  const tangent = new Vector3();
  const normal = new Vector3();
  const across = new Vector3();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = path.getPointAt(t);
    path.getTangentAt(t, tangent);
    // Outward from the torso: up where the band crosses the shoulder,
    // horizontal below it, flattened sideways so it lies on the chest and
    // back rather than standing edge-on or flaring out like a wing.
    const lift = MathUtils.smoothstep(
      point.y,
      fit.shoulderTop - 0.07,
      fit.shoulderTop,
    );
    normal
      .set((point.x - fit.axis.x) * 0.35, 0, point.z - fit.axis.z)
      .normalize()
      .lerp(UP, lift);
    normal.addScaledVector(tangent, -normal.dot(tangent));
    normal.normalize();
    across.crossVectors(tangent, normal).normalize();
    for (const [a, n] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const)
      positions.push(
        ...point
          .clone()
          .addScaledVector(across, (a * STRAP_WIDTH) / 2)
          .addScaledVector(normal, (n * STRAP_THICKNESS) / 2)
          .toArray(),
      );
    if (i === steps) continue;
    for (let face = 0; face < 4; face += 1) {
      const a = i * 4 + face;
      const b = i * 4 + ((face + 1) % 4);
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ownedFabric(): Material {
  const material = new MeshStandardMaterial({
    color: 0xf4f4f2,
    roughness: 0.85,
  });
  material.userData.ownedByMount = true;
  return material;
}

function findMaterial(root: Object3D, name: string): Material | undefined {
  let found: Material | undefined;
  root.traverse((object) => {
    const material = (object as Mesh).material;
    for (const candidate of Array.isArray(material) ? material : [material])
      if (found === undefined && candidate?.name === name) found = candidate;
  });
  return found;
}

/** Releases what a mount created for itself; the shared asset stays cached. */
export function disposeBackpack(mount: Object3D): void {
  mount.removeFromParent();
  for (const child of mount.children) {
    if (!child.name.startsWith(STRAP_NAME)) continue;
    const strap = child as Mesh<BufferGeometry, Material>;
    strap.geometry.dispose();
    if (strap.material.userData.ownedByMount === true) strap.material.dispose();
  }
}
