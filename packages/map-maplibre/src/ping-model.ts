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

/** xPing's cruise: no air gathers ahead of it yet. */
export const PING_AIR_FROM_MPS = 30;
/** xPing's top speed, forced in full: the air is at its thickest. */
export const PING_AIR_TOP_MPS = 90;
/** How many clots of air are shed at once, and how often each comes round. */
const AIR_CLOTS = 4;
const AIR_CYCLES = 4;

/** How thick the air gathers at `speedMps`, from 0 at cruise to 1 at top. */
export function airDensity(speedMps: number) {
  const density =
    (speedMps - PING_AIR_FROM_MPS) / (PING_AIR_TOP_MPS - PING_AIR_FROM_MPS);
  return Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 0;
}

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
  // Clots of compressed air: rings that gather at the nose and are shed
  // back past the body, more of them, wider and denser the faster it flies.
  const airMaterials: MeshBasicMaterial[] = [];
  const airClots: Mesh[] = [];
  for (let index = 0; index < AIR_CLOTS; index += 1) {
    const material = new MeshBasicMaterial({
      color: 0xdff4fa,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const clot = new Mesh(new TorusGeometry(0.3, 0.035, 6, 28), material);
    clot.name = "ping-air";
    clot.visible = false;
    body.add(clot);
    airMaterials.push(material);
    airClots.push(clot);
  }
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
    /**
     * `wear`, 0 to 1, is how much of its engine is spent: the puff grows
     * thicker and darker and the sparks come oftener the more it is.
     * `speedMps` is how fast it flies: above its 30 m/s cruise the air
     * gathers into clots shed past it, thickest at its 90 m/s top.
     */
    sample(phase: number, moving: boolean, wear = 0, speedMps = 0) {
      const worn = Math.min(1, Math.max(0, wear));
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
      smoke.position.set(
        0.18,
        0.16 + (moving ? phase : 0) * (0.3 + worn * 0.5),
        -0.08,
      );
      smoke.scale.setScalar((1 + puff * 1.2) * (1 + worn * 2.5));
      smokeMaterial.opacity = puff * (0.22 + worn * 0.6);
      smokeMaterial.color.setHex(worn > 0.66 ? 0x4a4f55 : 0x9aa2aa);
      // A worn engine sparks in more of each cycle, up to most of it.
      const sparkWindow = 0.15 + worn * 0.45;
      const sparkFrom = 0.7 - worn * 0.45;
      spark.visible =
        moving && phase > sparkFrom && phase < sparkFrom + sparkWindow;
      sparkMaterial.opacity = spark.visible
        ? Math.sin(((phase - sparkFrom) / sparkWindow) * Math.PI) *
          (0.7 + worn * 0.3)
        : 0;
      const density = moving ? airDensity(speedMps) : 0;
      for (const [index, clot] of airClots.entries()) {
        // Each clot comes round AIR_CYCLES times a phase, staggered so they
        // trail one another; a thin air sheds only the first of them.
        const age = (phase * AIR_CYCLES + index / AIR_CLOTS) % 1;
        const shown = density > index / AIR_CLOTS;
        clot.visible = shown;
        clot.position.set(0, 0, 0.32 - age * (0.6 + density * 1.4));
        clot.scale.setScalar(0.7 + age * (0.6 + density * 1.1));
        airMaterials[index]!.opacity = shown
          ? Math.sin(age * Math.PI) * (0.12 + density * 0.38)
          : 0;
      }
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
      for (const material of airMaterials) material.dispose();
      root.removeFromParent();
    },
  };
}
