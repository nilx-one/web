// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { FLIGHT_LOOT_COLORS, type MapFlightLoot } from "@nilx-one/map-contract";
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from "three";

/** A small, recognizable 3D marker for a *proposed* pickup, not inventory. */
export function createFlightLootModel(
  kind: MapFlightLoot["kind"],
  rarity: MapFlightLoot["rarity"],
) {
  const root = new Group();
  const geometries: BufferGeometry[] = [];
  const keep = <T extends BufferGeometry>(geometry: T) => {
    geometries.push(geometry);
    return geometry;
  };
  const material = new MeshStandardMaterial({
    color: FLIGHT_LOOT_COLORS[rarity],
    metalness: 0.25,
    roughness: 0.28,
    emissive: FLIGHT_LOOT_COLORS[rarity],
    emissiveIntensity: 0.18,
  });
  const outline = new MeshBasicMaterial({
    color: FLIGHT_LOOT_COLORS[rarity],
    side: BackSide,
    transparent: true,
    opacity: 0.24,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const shapes = {
    orb: () => keep(new SphereGeometry(0.42, 16, 12)),
    seeds: () => keep(new OctahedronGeometry(0.43)),
    balloon: () => keep(new SphereGeometry(0.57, 16, 12)),
    cell: () => keep(new BoxGeometry(0.55, 0.75, 0.35)),
    cosmetic: () => keep(new TorusGeometry(0.38, 0.13, 8, 20)),
  };
  const geometry = shapes[kind]();
  const item = new Mesh(geometry, material);
  if (kind === "balloon") {
    item.scale.y = 1.25;
    const string = new Mesh(keep(new CylinderGeometry(0.014, 0.014, 0.65, 6)), material);
    string.position.y = -0.94;
    root.add(string);
  }
  root.add(item);
  const glow = new Mesh(keep(new SphereGeometry(0.92, 16, 12)), outline);
  glow.visible = false;
  root.add(glow);
  return {
    root,
    setNear(near: boolean) {
      glow.visible = near;
      material.emissiveIntensity = near ? 1.7 : 0.18;
    },
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      outline.dispose();
    },
  };
}
