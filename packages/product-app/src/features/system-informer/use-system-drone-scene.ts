// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../shell/motion";
import {
  guideCameraPadding,
  lerpPoint,
  offsetPoint,
} from "../guide/guide-stage";
import { useSystemInformer } from "./system-informer";

/** Camera and temporary prop only. Never moves Bond/Avaia or writes presence. */
export function useSystemDroneScene(
  renderer: MapRenderer,
  anchor: MapPointSelection | undefined,
  ready: boolean,
): void {
  const { activeId, showWorld } = useSystemInformer();
  const latestAnchor = useRef(anchor);
  useEffect(() => {
    latestAnchor.current = anchor;
  });
  const hasAnchor = anchor !== undefined;
  useEffect(() => {
    const drone = renderer.systemDrone;
    const longitude = latestAnchor.current?.longitude;
    const latitude = latestAnchor.current?.latitude;
    if (
      activeId === undefined ||
      !ready ||
      drone === undefined ||
      longitude === undefined ||
      latitude === undefined
    )
      return;
    const id = "system:xPing";
    const you = { longitude, latitude };
    const destination = offsetPoint(you, 0, 2.8);
    const entry = offsetPoint(you, 45, 18);
    let base: MapCamera;
    try {
      base = renderer.getCamera();
    } catch {
      showWorld(false);
      return;
    }
    const reduced = prefersReducedMotion();
    const started = performance.now();
    let frame: number | undefined;
    let failed = false;
    function draw(now: number) {
      const progress = reduced
        ? 1
        : Math.min(1, Math.max(0, (now - started) / 1800));
      const point = lerpPoint(entry, destination, 1 - (1 - progress) ** 3);
      let visible = false;
      try {
        visible =
          drone?.upsert({
            id,
            lngLat: [point.longitude, point.latitude],
            bearingDeg: 180,
            phase: reduced ? 0 : ((now - started) % 2000) / 2000,
            reducedMotion: reduced,
          }) === true;
        showWorld(visible);
      } catch {
        failed = true;
        showWorld(false);
      }
      if (!failed && (!reduced || (!visible && now - started < 2000)))
        frame = requestAnimationFrame(draw);
    }
    try {
      renderer.setCamera(
        {
          center: [destination.longitude, destination.latitude],
          zoom: 20,
          bearing: 0,
          pitch: 60,
        },
        {
          motion: reduced ? "immediate" : "eased",
          durationMs: 900,
          padding: guideCameraPadding(globalThis.innerHeight),
        },
      );
      draw(started);
    } catch {
      showWorld(false);
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      showWorld(false);
      try {
        drone.remove(id);
      } catch {
        /* A broken renderer cannot block the text result. */
      }
      try {
        renderer.setCamera(base, {
          motion: "immediate",
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
        });
      } catch {
        /* Same fallback on context loss. */
      }
    };
  }, [activeId, hasAnchor, ready, renderer, showWorld]);
}
