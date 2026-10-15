// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { Object3D } from "three";
import backpackUrl from "./assets/aiaiaiai-backpack.glb?url";

export const BACKPACK_ASSET_URL = backpackUrl;

/** All published studies use the shared, metre-scale Y-up chest rig. */
export function mountBackpack(
  body: Object3D,
  asset: Object3D,
): Object3D | undefined {
  const chest = body.getObjectByName("chest");
  if (chest === undefined) return undefined;
  const mount = new Object3D();
  mount.name = "aiaiaiai-backpack";
  // The authored asset stands on Y=0 and faces +Z. On a person's back its
  // front faces -Z; the straps face toward the torso. Follow the chest bone.
  mount.position.set(0, -0.3, -0.14);
  mount.rotation.y = Math.PI;
  mount.add(asset.clone(true));
  chest.add(mount);
  return mount;
}
