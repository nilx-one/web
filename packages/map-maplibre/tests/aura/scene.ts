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
  RenderTarget,
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
import type { WebGPURenderer } from "three/webgpu";

const status = document.querySelector<HTMLDivElement>("#status")!;
const canvas = document.querySelector("canvas")!;
const params = new URLSearchParams(location.search);

// A submitted WebGPU frame is not evidence that the aura shader actually drew.
// Compare GPU readbacks with the aura hidden and visible (128px aligns RGBA rows
// to WebGPU's 256-byte copy pitch). This is a one-shot study check, not a
// production rendering path.
async function verifyWebGPUAura(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  aura: Mesh,
): Promise<number> {
  const size = 128;
  const target = new RenderTarget(size, size, { depthBuffer: true });
  const wasVisible = aura.visible;
  try {
    const capture = async (visible: boolean) => {
      aura.visible = visible;
      renderer.setRenderTarget(target);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(null);
      }
      return renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
    };
    const withoutAura = await capture(false);
    const withAura = await capture(true);
    let changed = 0;
    // The readback target defaults to 8-bit RGBA, so compare RGB only.
    for (let i = 0; i + 3 < withoutAura.length; i += 4) {
      const difference =
        Math.abs(Number(withAura[i]) - Number(withoutAura[i])) +
        Math.abs(Number(withAura[i + 1]) - Number(withoutAura[i + 1])) +
        Math.abs(Number(withAura[i + 2]) - Number(withoutAura[i + 2]));
      if (difference > 4) changed += 1;
    }
    if (changed < 8) {
      throw new Error(
        "WebGPU submitted a frame, but the aura did not change rendered pixels.",
      );
    }
    return changed;
  } finally {
    renderer.setRenderTarget(null);
    aura.visible = wasVisible;
    target.dispose();
  }
}

async function start() {
  const gpu = params.get("backend") === "webgpu";
  if (gpu && !navigator.gpu) {
    throw new Error("WebGPU unavailable; use the WebGL2 link.");
  }
  const gpuRenderer = gpu
    ? new (await import("three/webgpu")).WebGPURenderer({
        canvas,
        antialias: true,
      })
    : undefined;
  const renderer =
    gpuRenderer ??
    new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  let failed = false;
  let tearingDown = false;
  const fail = (error: unknown) => {
    if (tearingDown || failed) return;
    failed = true;
    status.textContent = String(error);
    document.documentElement.dataset.error = String(error);
    delete document.documentElement.dataset.ready;
    renderer.setAnimationLoop(null);
  };
  if (gpuRenderer) {
    const defaultDeviceLost = gpuRenderer.onDeviceLost.bind(gpuRenderer);
    const describe = (error: unknown) =>
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
    gpuRenderer.onDeviceLost = (error) => {
      defaultDeviceLost(error);
      fail(`WebGPU device lost: ${describe(error)}`);
    };
    gpuRenderer.onError = (error) =>
      fail(`WebGPU backend error: ${describe(error)}`);
    await gpuRenderer.init();
    if (
      !(gpuRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ) {
      gpuRenderer.dispose();
      throw new Error(
        "WebGPU initialization fell back to WebGL2; not a WebGPU result.",
      );
    }
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
  status.textContent = `${gpu ? "WebGPU / TSL" : "WebGL2 / GLSL"} · initializing comparison`;
  if (gpuRenderer) {
    // Do not trust the first compositor screenshot or a compiled shader alone.
    // A full-intensity probe ensures TSL changes actual pixels on the GPU.
    aura.sample(0, true);
    const pixels = await verifyWebGPUAura(
      gpuRenderer,
      scene,
      camera,
      aura.root,
    );
    if (failed) return;
    status.textContent = `WebGPU / TSL · aura verified in ${pixels} pixels · isolated scene`;
  } else {
    await renderer.compileAsync(scene, camera);
    status.textContent = "WebGL2 / GLSL · isolated scene";
  }
  let firstFrame = true;
  renderer.setAnimationLoop(() => {
    if (failed) return;
    try {
      const now = performance.now();
      if (!frozen) seconds += Math.min((now - last) / 1000, 0.1);
      last = now;
      aura.sample(seconds, frozen);
      renderer.render(scene, camera);
      if (firstFrame) {
        firstFrame = false;
        // Allow the canvas to be presented before screenshot automation starts.
        requestAnimationFrame(() => {
          if (!failed && !tearingDown) {
            document.documentElement.dataset.ready = gpu ? "webgpu" : "webgl";
          }
        });
      }
    } catch (error) {
      fail(error);
    }
  });
  window.addEventListener(
    "pagehide",
    () => {
      tearingDown = true;
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
