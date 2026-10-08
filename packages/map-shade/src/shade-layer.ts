// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, ShadeSource } from "@nilx-one/presence-contract";

import { createFogAtlas, type FogAtlas } from "./fog-atlas";
import {
  createWebGlFog,
  createWebGpuFog,
  type FogBackend,
} from "./fog-backend";
import { fogParameters } from "./fog-material";
import {
  LIGHT_FOG_PALETTE,
  requireFogPalette,
  requireFogZones,
  type FogPalette,
  type FogZone,
} from "./fog-palette";
import type { CellTap } from "./pick";

export interface PageVisibility {
  isVisible(): boolean;
  subscribe(listener: (visible: boolean) => void): () => void;
}

export function documentVisibility(): PageVisibility {
  const page = globalThis.document as Document | undefined;
  const isVisible = () => page?.visibilityState !== "hidden";
  return {
    isVisible,
    subscribe(listener) {
      const changed = () => listener(isVisible());
      page?.addEventListener("visibilitychange", changed);
      return () => page?.removeEventListener("visibilitychange", changed);
    },
  };
}

export interface ShadeLayerOptions {
  readonly source: ShadeSource;
  readonly store: PresenceStore;
  readonly anchor: { readonly lng: number; readonly lat: number };
  readonly id?: string;
  readonly regionM?: number;
  readonly textureSize?: number;
  readonly shadeAlpha?: number;
  readonly palette?: FogPalette;
  readonly zones?: readonly FogZone[];
  readonly motion?: "drift" | "still";
  readonly frameIntervalMs?: number;
  readonly visibility?: PageVisibility;
  readonly onCellTap?: (tap: CellTap) => void | Promise<void>;
  readonly onFrame: () => void;
  readonly onError: (error: Error) => void;
  readonly onBackend?: (backend: FogBackend["kind"]) => void;
}

export interface ShadeLayer {
  readonly id: string;
  readonly canvas: HTMLCanvasElement;
  readonly coordinates: FogAtlas["coordinates"];
  readonly motion: "drift" | "still";
  setPalette(palette: FogPalette): void;
  setZones(zones: readonly FogZone[]): void;
  dispose(): void;
}

/**
 * Generates a geographic canvas, never a screen-space quad. MapLibre's native
 * raster layer owns projection, world copies and DEM draping for both backends.
 */
export function createShadeLayer(options: ShadeLayerOptions): ShadeLayer {
  let palette = options.palette ?? LIGHT_FOG_PALETTE;
  let zones = options.zones ?? [];
  requireFogPalette(palette, "palette");
  requireFogZones(zones);
  const density = options.shadeAlpha ?? 0.97;
  if (!Number.isFinite(density) || density < 0 || density > 1)
    throw new Error("Invalid fog density");
  const interval = options.frameIntervalMs ?? 125;
  if (!Number.isFinite(interval) || interval <= 0)
    throw new Error("Invalid fog frame interval");
  const atlas = createFogAtlas(
    options.anchor,
    options.regionM,
    options.textureSize,
  );
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = atlas.size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Fog presentation canvas unavailable");
  const motion = options.motion ?? "still";
  const visibility = options.visibility ?? documentVisibility();
  let visible = visibility.isVisible();
  let disposed = false;
  let busy = false;
  let revision = 0;
  let maskChanged = true;
  let rebuild = true;
  let pending = new Set(options.source.litCells());
  let backend: FogBackend | undefined;
  let fallback = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seconds = 0;
  let previousTime = performance.now();

  function schedule(delay = 0) {
    if (disposed || !visible || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void draw();
    }, delay);
  }

  function lost() {
    if (disposed) return;
    fallback = true;
    revision += 1;
    schedule();
  }

  async function acquire(): Promise<FogBackend> {
    if (!fallback) {
      // A driver that never resolves requestAdapter must not hide the fallback.
      let expired = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const preferred = createWebGpuFog(atlas.size, lost).then((candidate) => {
        if (expired || disposed) candidate.dispose();
        return candidate;
      });
      try {
        return await Promise.race([
          preferred,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              expired = true;
              reject(new Error("Fog GPU timeout"));
            }, 2_000);
          }),
        ]);
      } catch {
        fallback = true;
      } finally {
        clearTimeout(timeout);
      }
    }
    return createWebGlFog(atlas.size, lost);
  }

  async function draw() {
    if (disposed || busy || !visible) return;
    if (!visibility.isVisible()) {
      visible = false;
      previousTime = performance.now();
      return;
    }
    busy = true;
    const version = revision;
    try {
      if (backend === undefined || (fallback && backend.kind === "webgpu")) {
        backend?.dispose();
        backend = await acquire();
        if (disposed) {
          backend.dispose();
          return;
        }
        maskChanged = true;
        options.onBackend?.(backend.kind);
      }
      if (rebuild) {
        atlas.reset();
        rebuild = false;
      }
      // Bound a cold journal's synchronous work. Do not publish a half-loaded
      // mask; the initial frame appears only after all cells are accounted for.
      let count = 0;
      for (const cell of pending) {
        atlas.add(cell);
        pending.delete(cell);
        count += 1;
        if (count >= 512) break;
      }
      if (pending.size > 0) {
        schedule();
        return;
      }
      if (motion === "drift")
        seconds += Math.max(0, performance.now() - previousTime) / 1_000;
      previousTime = performance.now();
      await backend.render(
        atlas.mask,
        fogParameters(atlas, palette, zones, seconds, density),
        maskChanged,
      );
      if (disposed || version !== revision) {
        schedule();
        return;
      }
      maskChanged = false;
      // Stable canvas identity survives device loss and never shows a frame
      // rendered from an old owner's mask after an asynchronous submission.
      context!.clearRect(0, 0, canvas.width, canvas.height);
      context!.drawImage(backend.canvas, 0, 0);
      options.onFrame();
      if (motion === "drift") schedule(interval);
    } catch (error) {
      if (disposed) return;
      if (backend?.kind === "webgpu") {
        backend.dispose();
        backend = undefined;
        fallback = true;
        schedule();
      } else {
        options.onError(
          error instanceof Error ? error : new Error("Fog renderer failed"),
        );
      }
    } finally {
      busy = false;
    }
  }

  const unsubscribe = options.source.onCellLit((cell) => {
    pending.add(cell);
    maskChanged = true;
    revision += 1;
    schedule();
  });
  const reset = options.source.onReset?.(() => {
    pending = new Set(options.source.litCells());
    rebuild = true;
    maskChanged = true;
    revision += 1;
    // Clear a previous owner's revealed geography immediately, then rebuild.
    context.fillStyle = `rgb(${palette.shadow.map((value) => Math.round(value * 255)).join(" ")})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    options.onFrame();
    schedule();
  });
  const unsubscribeVisibility = visibility.subscribe((next) => {
    visible = next;
    previousTime = performance.now();
    if (!visible) {
      clearTimeout(timer);
      timer = undefined;
    } else schedule();
  });
  schedule();
  return {
    id: options.id ?? "nilx-one-presence-shade",
    canvas,
    coordinates: atlas.coordinates,
    motion,
    setPalette(next) {
      if (next === palette) return;
      requireFogPalette(next, "palette");
      palette = next;
      revision += 1;
      schedule();
    },
    setZones(next) {
      requireFogZones(next);
      zones = next;
      revision += 1;
      schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      reset?.();
      unsubscribeVisibility();
      backend?.dispose();
    },
  };
}
