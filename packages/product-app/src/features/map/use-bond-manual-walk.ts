// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { quantizeDeclaredPoint } from "@nilx-one/host-contract";
import type { MapPointSelection, MapRenderer } from "@nilx-one/map-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { openGround, planWalk } from "./avaia-path";
import { routeBounds } from "./avaia-route";
import {
  startWalk,
  walkPosition,
  walkStance,
  type AvaiaWalk,
} from "./avaia-walk";
import type { BodyStance } from "./avatar-presence";

type Point = MapPointSelection;
export type ManualMoveOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly current?: Point };
type ManualMove = (expected: Point, target: Point) => Promise<ManualMoveOutcome>;
interface Rest {
  readonly point: Point;
  readonly bearingDeg: number;
}

export interface BondManualWalkInput {
  readonly renderer: MapRenderer;
  readonly owner: string;
  /** Only the service-declared manual point; never device GPS. */
  readonly declared: Point | undefined;
  readonly active: boolean;
  readonly commit?: ManualMove | undefined;
  readonly zoom: number;
}

export interface BondManualWalk {
  /** Presentation-only position until the service confirms arrival. */
  stance(nowMs: number): BodyStance | undefined;
  point(nowMs: number): Point | undefined;
  readonly moving: boolean;
  readonly failed: boolean;
  stop(): void;
}

/**
 * Point-and-walk for a manually located Bond. Reuses Avaia's physical route,
 * gait and obstacle rules, but never uses Avaia's location, life or drive.
 * Animation is local. The location-control service remains authoritative;
 * one compare-and-set write at the end is the only mutation.
 */
export function useBondManualWalk({
  renderer,
  owner,
  declared,
  active,
  commit,
  zoom,
}: BondManualWalkInput): BondManualWalk {
  const [walk, setWalk] = useState<AvaiaWalk | undefined>();
  const [rest, setRest] = useState<Rest | undefined>(
    declared === undefined ? undefined : { point: declared, bearingDeg: 0 },
  );
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const expected = useRef<Point | undefined>(declared);
  const observed = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const ownerRef = useRef(owner);

  // A newer server declaration overrides this device's uncommitted drawing.
  const longitude = declared?.longitude;
  const latitude = declared?.latitude;
  useEffect(() => {
    const fingerprint =
      longitude === undefined || latitude === undefined
        ? undefined
        : `${longitude}:${latitude}`;
    if (observed.current === fingerprint && ownerRef.current === owner) return;
    ownerRef.current = owner;
    observed.current = fingerprint;
    epoch.current += 1;
    expected.current =
      longitude === undefined || latitude === undefined
        ? undefined
        : { longitude, latitude };
    setWalk(undefined);
    setSaving(false);
    setFailed(false);
    setRest(
      expected.current === undefined
        ? undefined
        : { point: expected.current, bearingDeg: 0 },
    );
  }, [latitude, longitude, owner]);

  const point = useCallback(
    (nowMs: number) =>
      walk === undefined ? rest?.point : walkPosition(walk, nowMs),
    [walk, rest],
  );
  const stance = useCallback(
    (nowMs: number): BodyStance | undefined =>
      walk === undefined ? rest : walkStance(walk, nowMs),
    [walk, rest],
  );

  const finish = useCallback(
    (completed: AvaiaWalk, at: number) => {
      // Commit and remember the arrival on the service's E7 grid: the service
      // stores integer E7 and compares the next move against it, so an
      // off-grid animation coordinate would persist one value yet expect
      // another and lose the following move to a false conflict.
      const target = quantizeDeclaredPoint(walkPosition(completed, at));
      const from = expected.current;
      if (from === undefined || commit === undefined) {
        setWalk(undefined);
        return;
      }
      const generation = ++epoch.current;
      setRest({ point: target, bearingDeg: completed.arrivalBearingDeg });
      setWalk(undefined);
      setSaving(true);
      void commit(from, target)
        .then((outcome) => {
          if (generation !== epoch.current) return;
          if (outcome.kind === "accepted") {
            expected.current = target;
            setFailed(false);
          } else {
            // On a CAS conflict the service's current point wins, not the
            // locally remembered starting point from a different device.
            const authoritative = outcome.current ?? from;
            expected.current = authoritative;
            setRest({ point: authoritative, bearingDeg: 0 });
            setFailed(true);
          }
        })
        .catch(() => {
          if (generation !== epoch.current) return;
          setRest({ point: from, bearingDeg: 0 });
          setFailed(true);
        })
        .finally(() => {
          if (generation === epoch.current) setSaving(false);
        });
    },
    [commit],
  );

  useEffect(() => {
    if (walk === undefined) return;
    const now = globalThis.performance.now();
    const remaining = Math.max(0, walk.startedMs + walk.durationMs - now);
    const timer = globalThis.setTimeout(
      () => finish(walk, globalThis.performance.now()),
      remaining,
    );
    return () => globalThis.clearTimeout(timer);
  }, [finish, walk]);

  const stop = useCallback(() => {
    if (walk !== undefined) finish(walk, globalThis.performance.now());
  }, [finish, walk]);

  // The tap belongs to the driver, never to the other side of a handover.
  useEffect(() => {
    if (!active || declared === undefined || commit === undefined) return;
    const subscribe = renderer.subscribeGroundTap;
    if (subscribe === undefined) return;
    return subscribe.call(renderer, (tap) => {
      // Fog taps remain with the reveal flow. Buildings and water are not
      // destinations; they are not a command to move the Bond.
      if (tap.ground !== "open" || saving) return;
      const now = globalThis.performance.now();
      const from = point(now);
      if (from === undefined) return;
      const to = { longitude: tap.longitude, latitude: tap.latitude };
      const bounds = routeBounds(from, to);
      const planned = planWalk({
        from,
        to,
        roads: renderer.roadsWithin?.(bounds) ?? [],
        obstacles: renderer.obstaclesWithin?.(bounds) ?? [],
        chooser: "tap",
        open: openGround({
          fog: renderer.fog,
          device: undefined,
          body: from,
          nearDeviceMeters: 0,
        }),
      });
      if (planned.kind !== "route") return;
      epoch.current += 1;
      setFailed(false);
      setWalk(
        startWalk({
          from,
          to: planned.path.at(-1) ?? to,
          path: planned.path,
          nowMs: now,
          zoom,
          maxLocomotion: planned.maxLocomotion,
        }),
      );
    });
  }, [active, commit, declared, point, renderer, saving, zoom]);

  // Do not leave a half-walk running invisibly when the wheel changes hands.
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);

  return {
    stance,
    point,
    moving: walk !== undefined,
    failed,
    stop,
  };
}
