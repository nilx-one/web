// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
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
  // Permanent repairs remain legible when motion/effects are disabled.
  const patchMaterial = new MeshStandardMaterial({
    color: 0xaa7956,
    roughness: 0.85,
  });
  const tapeMaterial = new MeshStandardMaterial({
    color: 0xc5b58c,
    roughness: 1,
  });
  const patch = new Mesh(new BoxGeometry(0.14, 0.16, 0.025), patchMaterial);
  patch.position.set(0.16, 0, 0.19);
  patch.rotation.y = 0.5;
  body.add(patch);
  for (const y of [-0.045, 0.045]) {
    const tape = new Mesh(new BoxGeometry(0.2, 0.027, 0.012), tapeMaterial);
    tape.position.set(0.16, y, 0.215);
    tape.rotation.z = 0.16;
    body.add(tape);
  }
  const smokeMaterial = new MeshBasicMaterial({
    color: 0x9aa2aa,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const smoke = new Mesh(new SphereGeometry(0.065, 8, 6), smokeMaterial);
  smoke.name = "ping-smoke";
  body.add(smoke);
  const sparkMaterial = new MeshBasicMaterial({
    color: 0xe8b563,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const spark = new Mesh(new BoxGeometry(0.08, 0.008, 0.008), sparkMaterial);
  spark.name = "ping-spark";
  spark.position.set(-0.24, 0.025, 0.12);
  spark.rotation.z = 0.6;
  body.add(spark);
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
      const wobble = moving ? Math.sin(phase * Math.PI * 2) : 0;
      body.rotation.z = wobble * 0.055;
      patch.rotation.z = wobble * 0.07;
      for (const [index, rotor] of rotors.entries()) {
        // One tired bearing, mechanically separate from any reported error.
        rotor.rotation.y = moving
          ? phase * Math.PI * 32 +
            (index === 0 ? Math.sin(phase * Math.PI * 6) * 0.9 : 0)
          : 0;
        rotor.rotation.z = index === 0 ? wobble * 0.12 : 0;
      }
      const puff = moving ? Math.max(0, Math.sin(phase * Math.PI * 2)) : 0;
      smoke.visible = moving && puff > 0;
      smoke.position.set(0.18, 0.16 + (moving ? phase : 0) * 0.3, -0.08);
      smoke.scale.setScalar(1 + puff * 1.2);
      smokeMaterial.opacity = puff * 0.22;
      spark.visible = moving && phase > 0.7 && phase < 0.85;
      sparkMaterial.opacity = spark.visible
        ? Math.sin(((phase - 0.7) / 0.15) * Math.PI) * 0.7
        : 0;
    },
    dispose() {
      root.traverse((node) => {
        if (node instanceof Mesh) node.geometry.dispose();
      });
      shell.dispose();
      trim.dispose();
      lens.dispose();
      patchMaterial.dispose();
      tapeMaterial.dispose();
      smokeMaterial.dispose();
      sparkMaterial.dispose();
      root.removeFromParent();
    },
  };
}
