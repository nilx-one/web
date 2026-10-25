// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createSubscriptionAura,
  createSubscriptionAuraWithMaterial,
} from "../../src/subscription-aura";
import type { SubscriptionAuraTier } from "@nilx-one/map-contract";

const status = document.querySelector<HTMLDivElement>("#status")!;
const canvas = document.querySelector("canvas")!;
const params = new URLSearchParams(location.search);
async function start() {
  const gpu = params.get("backend") === "webgpu";
  // No silent WebGL fallback: this is an explicit WebGPU experiment.
  if (gpu && (!navigator.gpu || !(await navigator.gpu.requestAdapter()))) {
    throw new Error("WebGPU adapter unavailable; use the WebGL2 link.");
  }
  const renderer = gpu
    ? new (await import("three/webgpu")).WebGPURenderer({
        canvas,
        antialias: true,
      })
    : new WebGLRenderer({
        canvas,
        antialias: true,
        preserveDrawingBuffer: true,
      });
  if ("init" in renderer) await renderer.init();
  if (
    "backend" in renderer &&
    !(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
  ) {
    renderer.dispose();
    throw new Error(
      "WebGPU initialization fell back to WebGL2; not a WebGPU result.",
    );
  }
  renderer.setPixelRatio(1);
  const scene = new Scene();
  scene.background = new Color(0x10211e);
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  const body = new Group();
  const gltf = await new GLTFLoader().loadAsync(
    "/deploy/web/avatars/0.1.0/sky-study.glb",
  );
  const bounds = new Box3().setFromObject(gltf.scene);
  const height = bounds.getSize(new Vector3()).y;
  gltf.scene.scale.setScalar(1.8 / height);
  gltf.scene.position.y = (-bounds.min.y * 1.8) / height;
  body.add(gltf.scene);
  const aura = gpu
    ? createSubscriptionAuraWithMaterial(
        "exclusive",
        (await import("./node-material")).createAuraNodeMaterial,
      )
    : createSubscriptionAura("exclusive");
  body.add(aura.root);
  scene.add(body, new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(3, 4, 4);
  scene.add(sun);
  const ground = new Mesh(
    new PlaneGeometry(100, 100),
    new MeshStandardMaterial({ color: 0x22362e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.13;
  scene.add(ground);
  const wall = new Mesh(
    new BoxGeometry(1.3, 2.8, 0.25),
    new MeshStandardMaterial({ color: 0x53625b }),
  );
  wall.position.set(0.5, 1.2, 1.1);
  wall.visible = false;
  scene.add(wall);
  let frozen = params.has("still");
  let seconds = 0;
  let last = performance.now();
  let view = "front";
  let tier: SubscriptionAuraTier | undefined = "exclusive";
  const pose = () => {
    if (view === "side") camera.position.set(4.5, 1.7, 0.2);
    else if (view === "isometric") camera.position.set(3.4, 4.3, 3.4);
    else camera.position.set(0, 1.5, 4.7);
    camera.lookAt(0, 1.05, 0);
  };
  pose();
  document.querySelector<HTMLSelectElement>("#tier")!.onchange = (event) => {
    const value = (event.target as HTMLSelectElement).value;
    tier = value === "none" ? undefined : (value as SubscriptionAuraTier);
    aura.setTier(tier, seconds, frozen);
  };
  document.querySelector<HTMLSelectElement>("#view")!.onchange = (event) => {
    view = (event.target as HTMLSelectElement).value;
    pose();
  };
  document.querySelector<HTMLButtonElement>("#wall")!.onclick = () => {
    wall.visible = !wall.visible;
  };
  document.querySelector<HTMLButtonElement>("#motion")!.onclick = (event) => {
    frozen = !frozen;
    (event.target as HTMLButtonElement).textContent = frozen
      ? "Resume motion"
      : "Pause motion";
  };
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);
  status.textContent = `${gpu ? "WebGPU / TSL" : "WebGL2 / GLSL"} · shared geometry and transitions · isolated scene`;
  if ("compileAsync" in renderer) await renderer.compileAsync(scene, camera);
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (!frozen) seconds += Math.min((now - last) / 1000, 0.1);
    last = now;
    aura.sample(seconds, frozen);
    renderer.render(scene, camera);
    document.documentElement.dataset.ready = gpu ? "webgpu" : "webgl";
  });
  window.addEventListener(
    "pagehide",
    () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      aura.dispose();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
      renderer.dispose();
    },
    { once: true },
  );
}
void start().catch((error: unknown) => {
  status.textContent = String(error);
  document.documentElement.dataset.error = String(error);
});
