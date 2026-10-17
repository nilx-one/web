// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BusinessPoint,
  CoreRuntimePort,
  CourierDirectoryPort,
  CourierPlan,
} from "@nilx-one/application";
import { CourierCapabilityUnavailable } from "@nilx-one/application";
import type { MapPointSelection, MapRenderer } from "@nilx-one/map-contract";
import { courierCoordinate, courierPoint } from "./courier-map";
import { FLYOVER_DRONE_ID, useFlyover } from "../flyover/use-flyover";
import { prefersReducedMotion } from "../../shell/motion";

export function useCourier(input: {
  renderer: MapRenderer;
  origin: MapPointSelection | undefined;
  core: Pick<CoreRuntimePort, "courierDestination"> | undefined;
  directory: CourierDirectoryPort | undefined;
  suspended: boolean;
}) {
  const [offer, setOffer] = useState<"exclusive" | "special">();
  const [plan, setPlan] = useState<CourierPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const flyover = useFlyover(input.renderer, !input.suspended);
  const { following, setFollowing, active, start } = flyover;
  const generation = useRef(0),
    requesting = useRef(false);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const close = useCallback(() => {
    generation.current++;
    requesting.current = false;
    setBusy(false);
    setOffer(undefined);
  }, []);
  const open = useCallback((tier: "exclusive" | "special") => {
    setError(false);
    setOffer(tier);
  }, []);
  const accept = useCallback(async () => {
    if (requesting.current || offer === undefined) return;
    const { core, directory, origin } = latest.current;
    if (active) {
      close();
      return;
    }
    if (
      !directory ||
      !origin ||
      (!core?.courierDestination && !directory.previewDestination)
    ) {
      setError(true);
      return;
    }
    const ticket = ++generation.current;
    requesting.current = true;
    setBusy(true);
    setError(false);
    try {
      const projection = await directory.points();
      if (ticket !== generation.current) return;
      const from = courierCoordinate(origin);
      let destination: BusinessPoint;
      try {
        if (!core?.courierDestination) throw new CourierCapabilityUnavailable();
        destination = await core.courierDestination(from, projection);
      } catch (failure) {
        if (
          !(failure instanceof CourierCapabilityUnavailable) ||
          !directory.previewDestination
        )
          throw failure;
        destination = directory.previewDestination(from, projection);
      }
      if (ticket !== generation.current) return;
      const next: CourierPlan = {
        origin: from,
        destination,
        started_at_ms: String(Date.now()),
      };
      setPlan(next);
      setOffer(undefined);
      start({
        from: origin,
        to: courierPoint(next.destination.coordinate),
      });
    } catch {
      if (ticket === generation.current) setError(true);
    } finally {
      if (ticket === generation.current) {
        requesting.current = false;
        setBusy(false);
      }
    }
  }, [active, start, close, offer]);
  // Each GPS fix is a new origin object: the shot reads it from the ref so a
  // fix neither re-stages nor restores it, and the camera from before the
  // offer is the one it hands back (as useSystemDroneScene does).
  const hasOrigin = input.origin !== undefined;
  const { renderer, suspended } = input;
  useEffect(() => {
    const origin = latest.current.origin;
    if (!offer || suspended || !origin) return;
    let restore: ReturnType<MapRenderer["getCamera"]>;
    try {
      restore = renderer.getCamera();
      renderer.setCamera(
        {
          center: [origin.longitude, origin.latitude],
          zoom: 20,
          bearing: 0,
          pitch: 55,
        },
        { motion: prefersReducedMotion() ? "immediate" : "eased" },
      );
    } catch {
      return;
    }
    return () => {
      try {
        renderer.setCamera(restore, {
          motion: prefersReducedMotion() ? "immediate" : "eased",
        });
      } catch {
        /* context loss */
      }
    };
  }, [offer, renderer, suspended, hasOrigin]);
  // Only the flying xPing takes taps, and only while it flies: a hint or
  // offer drone parked on the Bond must leave Bond and Avaia their taps.
  useEffect(() => {
    if (!flyover.active) return;
    return renderer.systemDrone?.subscribeActivation?.(FLYOVER_DRONE_ID, () =>
      setFollowing(true),
    );
  }, [flyover.active, renderer, setFollowing]);
  useEffect(() => {
    const drone = renderer.systemDrone;
    if (!drone || suspended || !offer || flyover.active) return;
    const id = "system:xPing:courier";
    let frame: number | undefined;
    const draw = () => {
      const now = Date.now();
      const point = latest.current.origin;
      if (point) {
        try {
          drone.upsert({
            id,
            lngLat: [point.longitude, point.latitude],
            bearingDeg: 0,
            phase: (now % 2000) / 2000,
            reducedMotion: prefersReducedMotion(),
          });
        } catch {
          /* The text status and Follow button survive context loss. */
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      try {
        drone.remove(id);
      } catch {
        /* detached renderer */
      }
    };
  }, [renderer, suspended, offer, flyover.active]);
  return {
    offer,
    plan,
    busy,
    error,
    following: flyover.active && following,
    flyover,
    open,
    close,
    accept,
    setFollowing,
  };
}
