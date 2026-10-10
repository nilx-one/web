// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";

/** A procedural 1.2 m drone. It is a system prop, never a selectable Bond body. */
export function createPingModel() {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const shell = new MeshStandardMaterial({
    color: 0x24404e,
    metalness: 0.65,
    roughness: 0.35,
  });
  const trim = new MeshStandardMaterial({
    color: 0x91d5df,
    metalness: 0.5,
    roughness: 0.3,
  });
  const lens = new MeshStandardMaterial({
    color: 0x7ae0f5,
    emissive: 0x4bd4ef,
    emissiveIntensity: 2,
  });
  const hull = new Mesh(new SphereGeometry(0.25, 16, 12), shell);
  hull.scale.set(1, 0.65, 1);
  body.add(hull);
  const eye = new Mesh(new SphereGeometry(0.085, 12, 8), lens);
  eye.position.set(0, 0, 0.22);
  body.add(eye);
  const rotors: Mesh[] = [];
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const arm = new Mesh(new CylinderGeometry(0.025, 0.025, 0.52, 8), trim);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = (-x * z * Math.PI) / 4;
      arm.position.set(x * 0.2, 0, z * 0.2);
      body.add(arm);
      const ring = new Mesh(new TorusGeometry(0.19, 0.018, 6, 24), shell);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x * 0.39, 0.06, z * 0.39);
      body.add(ring);
      const rotor = new Mesh(new BoxGeometry(0.34, 0.012, 0.035), trim);
      rotor.position.copy(ring.position);
      body.add(rotor);
      rotors.push(rotor);
    }
  return {
    root,
    sample(phase: number, moving: boolean) {
      body.position.y =
        1.9 + (moving ? Math.sin(phase * Math.PI * 2) * 0.055 : 0);
      for (const rotor of rotors)
        rotor.rotation.y = moving ? phase * Math.PI * 32 : 0;
    },
    dispose() {
      root.traverse((node) => {
        if (node instanceof Mesh) node.geometry.dispose();
      });
      shell.dispose();
      trim.dispose();
      lens.dispose();
      root.removeFromParent();
    },
  };
}
