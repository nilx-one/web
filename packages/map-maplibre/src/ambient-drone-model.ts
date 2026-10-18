// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from "three";

/** The city's ambient drones; xPing has its own model. */
export type AmbientDroneKind = "street" | "yard";

/** One drone built from a kit: the same surface xPing's model offers. */
export interface AmbientDroneModel {
  readonly root: Group;
  /** `phase` loops 0 to 1; still, the drone hangs level with rotors stopped. */
  sample(phase: number, moving: boolean): void;
  /** Takes the drone out of its scene. The kit's shared parts stay. */
  dispose(): void;
}

export interface AmbientDroneKit {
  build(kind: AmbientDroneKind): AmbientDroneModel;
  /** Frees the geometry and materials every drone of this kit shares. */
  dispose(): void;
}

const LIVERIES: Readonly<
  Record<AmbientDroneKind, { shell: number; trim: number }>
> = {
  // A cargo drone in graphite with a yellow trim, carrying a parcel.
  street: { shell: 0x3a3f47, trim: 0xffc94a },
  // A small white scout with an orange trim.
  yard: { shell: 0xf2f4f5, trim: 0xff8a3d },
};

/**
 * The parts every ambient drone is made of, made once.
 *
 * The city may hold a dozen of these at a time, so a drone is a handful of
 * meshes over shared geometry and materials: no per-drone allocation beyond
 * its scene nodes, and nothing to free when one leaves but the nodes
 * themselves. It is simpler than xPing on purpose: no repairs, no smoke, no
 * sparks, which are the informer's own story.
 */
export function createAmbientDroneKit(): AmbientDroneKit {
  const geometries: BufferGeometry[] = [];
  const keep = <T extends BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const hull = keep(new SphereGeometry(0.22, 12, 8));
  const eye = keep(new SphereGeometry(0.07, 8, 6));
  const arm = keep(new BoxGeometry(0.66, 0.03, 0.04));
  const rotor = keep(new BoxGeometry(0.3, 0.01, 0.035));
  const parcel = keep(new BoxGeometry(0.26, 0.2, 0.26));
  const lens = new MeshStandardMaterial({
    color: 0x7ae0f5,
    emissive: 0x4bd4ef,
    emissiveIntensity: 2,
  });
  const cardboard = new MeshStandardMaterial({
    color: 0xc79a62,
    roughness: 0.9,
  });
  const materials: Material[] = [lens, cardboard];
  const paint = (kind: AmbientDroneKind) => {
    const shell = new MeshStandardMaterial({
      color: LIVERIES[kind].shell,
      metalness: 0.45,
      roughness: 0.4,
    });
    const trim = new MeshStandardMaterial({
      color: LIVERIES[kind].trim,
      metalness: 0.3,
      roughness: 0.45,
    });
    materials.push(shell, trim);
    return { shell, trim };
  };
  const livery: Readonly<
    Record<AmbientDroneKind, { shell: Material; trim: Material }>
  > = { street: paint("street"), yard: paint("yard") };

  return {
    build(kind) {
      const { shell, trim } = livery[kind];
      const root = new Group();
      const body = new Group();
      root.add(body);
      const core = new Mesh(hull, shell);
      core.scale.set(1, 0.6, 1);
      body.add(core);
      const lensMesh = new Mesh(eye, lens);
      lensMesh.position.set(0, 0, 0.2);
      body.add(lensMesh);
      for (const turn of [Math.PI / 4, -Math.PI / 4]) {
        const beam = new Mesh(arm, trim);
        beam.rotation.y = turn;
        body.add(beam);
      }
      const rotors: Mesh[] = [];
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          const blade = new Mesh(rotor, trim);
          blade.position.set(x * 0.23, 0.04, z * 0.23);
          body.add(blade);
          rotors.push(blade);
        }
      let box: Mesh | undefined;
      if (kind === "street") {
        box = new Mesh(parcel, cardboard);
        box.position.set(0, -0.26, 0);
        body.add(box);
      }
      return {
        root,
        sample(phase, moving) {
          const wave = moving ? Math.sin(phase * Math.PI * 2) : 0;
          body.position.y = 1.6 + wave * 0.05;
          for (const [index, blade] of rotors.entries())
            blade.rotation.y = moving ? phase * Math.PI * 40 + index : index;
          if (box !== undefined) box.rotation.z = wave * 0.06;
        },
        dispose() {
          root.removeFromParent();
        },
      };
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
