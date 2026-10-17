// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import type {
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
  core: Pick<CoreRuntimePort, "planCourier"> | undefined;
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
      (!core?.planCourier && !directory.previewPlan)
    ) {
      setError(true);
      return;
    }
    const ticket = ++generation.current;
    requesting.current = true;
    setBusy(true);
    setError(false);
    try {
      const projection = await directory.destinations();
      if (ticket !== generation.current) return;
      const request = {
        ...projection,
        tier: offer,
        origin: courierCoordinate(origin),
        started_at_ms: String(Date.now()),
      };
      let next: CourierPlan;
      try {
        if (!core?.planCourier) throw new CourierCapabilityUnavailable();
        next = await core.planCourier(request);
      } catch (failure) {
        if (
          !(failure instanceof CourierCapabilityUnavailable) ||
          !directory.previewPlan
        )
          throw failure;
        next = directory.previewPlan(request);
      }
      if (ticket !== generation.current) return;
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
  useEffect(() => {
    if (!offer || input.suspended || !input.origin) return;
    let restore: ReturnType<MapRenderer["getCamera"]>;
    try {
      restore = input.renderer.getCamera();
      input.renderer.setCamera(
        {
          center: [input.origin.longitude, input.origin.latitude],
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
        input.renderer.setCamera(restore, {
          motion: prefersReducedMotion() ? "immediate" : "eased",
        });
      } catch {
        /* context loss */
      }
    };
  }, [offer, input.renderer, input.suspended, input.origin]);
  useEffect(() => {
    return input.renderer.systemDrone?.subscribeActivation?.((id) => {
      if (id === FLYOVER_DRONE_ID && flyover.active) setFollowing(true);
    });
  }, [flyover.active, input.renderer, setFollowing]);
  useEffect(() => {
    const drone = input.renderer.systemDrone;
    if (!drone || input.suspended || !offer || flyover.active) return;
    const id = "system:xPing:courier";
    let frame: number | undefined;
    const draw = () => {
      const now = Date.now();
      const point = input.origin;
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
  }, [input.renderer, input.origin, input.suspended, offer, flyover.active]);
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
