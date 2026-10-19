// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  FLIGHT_LOOT_COLORS,
  type FlightLootRarity,
} from "@nilx-one/map-contract";
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  ConeGeometry,
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
/** A small, fixed pool of world-space speed trails, not a screen-space blur. */
const SPEED_STREAKS = 8;

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
  // The forcing engine reuses the flyover's measured speed. Jets and
  // streaks are model-local props, so a turn banks them with xPing; none
  // changes a flight path, map position, or the renderer's camera.
  const boostFlameMaterial = new MeshBasicMaterial({
    color: 0x369fff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const boostCoreMaterial = new MeshBasicMaterial({
    color: 0xedffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const boostFlames: Mesh[] = [];
  const boostCores: Mesh[] = [];
  for (const x of [-0.13, 0.13]) {
    for (const [name, radius, material, collection] of [
      ["ping-boost-flame", 0.105, boostFlameMaterial, boostFlames],
      ["ping-boost-core", 0.045, boostCoreMaterial, boostCores],
    ] as const) {
      // Cone tip points down -Z: behind xPing, whose nose faces +Z.
      const jet = new Mesh(new ConeGeometry(radius, 1, 8, 1, true), material);
      jet.name = name;
      jet.rotation.x = -Math.PI / 2;
      jet.position.x = x;
      jet.position.y = -0.035;
      jet.visible = false;
      jet.scale.setScalar(0);
      body.add(jet);
      collection.push(jet);
    }
  }
  const streakMaterials: MeshBasicMaterial[] = [];
  const speedStreaks: Mesh[] = [];
  for (let index = 0; index < SPEED_STREAKS; index += 1) {
    const material = new MeshBasicMaterial({
      color: 0xb6e9ff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const streak = new Mesh(new BoxGeometry(0.012, 0.012, 1), material);
    streak.name = "ping-speed-streak";
    const angle = (index * Math.PI * 2) / SPEED_STREAKS;
    streak.position.set(Math.cos(angle) * 0.62, Math.sin(angle) * 0.3, -0.6);
    streak.visible = false;
    streak.scale.setScalar(0);
    body.add(streak);
    speedStreaks.push(streak);
    streakMaterials.push(material);
  }
  const auraMaterial = new MeshBasicMaterial({
    color: FLIGHT_LOOT_COLORS.common,
    transparent: true,
    opacity: 0.22,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lootAura = new Mesh(new SphereGeometry(0.65, 16, 12), auraMaterial);
  lootAura.visible = false;
  body.add(lootAura);
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
    sample(
      phase: number,
      moving: boolean,
      wear = 0,
      speedMps = 0,
      rarity?: FlightLootRarity,
    ) {
      lootAura.visible = rarity !== undefined;
      // Three.js bounds include invisible meshes. Keep the dormant aura out
      // of the drone's unpowered geometry bounds until it is actually earned.
      lootAura.scale.setScalar(rarity === undefined ? 0 : 1);
      if (rarity !== undefined) {
        auraMaterial.color.setHex(FLIGHT_LOOT_COLORS[rarity]);
        auraMaterial.opacity = moving
          ? 0.22 + 0.05 * Math.sin(phase * Math.PI * 2)
          : 0.22;
      }
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
      // Ignition and release follow actual speed, not pointer state: these
      // effects also fade naturally when forcing runs out or the leg changes.
      const flameLength = 0.25 + density * 1.7;
      boostFlameMaterial.opacity =
        density * (0.58 + 0.08 * Math.sin(phase * Math.PI * 24));
      boostCoreMaterial.opacity = density * 0.84;
      for (const flame of boostFlames) {
        flame.visible = density > 0;
        flame.scale.set(
          density > 0 ? 1 + density * 0.25 : 0,
          density > 0 ? flameLength : 0,
          density > 0 ? 1 + density * 0.25 : 0,
        );
        flame.position.z = -0.22 - flameLength / 2;
      }
      for (const core of boostCores) {
        const length = flameLength * 0.72;
        core.visible = density > 0;
        core.scale.set(
          density > 0 ? 1 : 0,
          density > 0 ? length : 0,
          density > 0 ? 1 : 0,
        );
        core.position.z = -0.22 - length / 2;
      }
      for (const [index, streak] of speedStreaks.entries()) {
        const age = (phase * 8 + index / SPEED_STREAKS) % 1;
        const shown = density > (index + 0.25) / SPEED_STREAKS;
        streak.visible = shown;
        streak.scale.set(
          shown ? 1 : 0,
          shown ? 1 : 0,
          shown ? 0.5 + density * 2.5 : 0,
        );
        streak.position.z = -0.6 - age * density * 3.2;
        streakMaterials[index]!.opacity = shown
          ? Math.sin(age * Math.PI) * (0.16 + density * 0.48)
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
      auraMaterial.dispose();
      for (const material of airMaterials) material.dispose();
      boostFlameMaterial.dispose();
      boostCoreMaterial.dispose();
      for (const material of streakMaterials) material.dispose();
      root.removeFromParent();
    },
  };
}
