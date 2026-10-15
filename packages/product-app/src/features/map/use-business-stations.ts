// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  resolveAvatarScene,
  type AVATAR_MODELS,
  type BusinessStationAccessPort,
  type BusinessStationView,
} from "@nilx-one/application";
import {
  AVATAR_MODEL_IDS,
  type AvatarHandle,
  type AvatarLayerContract,
} from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

import {
  AVATAR_MIN_ZOOM,
  AVATAR_PRESENTATION_SCALE,
  DEFAULT_AVAIA_STUDY,
  avatarSeed,
} from "./avatar-presence";

/** Stations change when a business opens a shop, not while anyone watches. */
export const STATIONS_REFRESH_MS = 10 * 60_000;

const STATION_HANDLE_PREFIX = "station:";

/** A station's handle id never meets the wheel's own `bond` and `avaia`. */
export function stationHandleId(station: BusinessStationView): string {
  return `${STATION_HANDLE_PREFIX}${station.pubDress}`;
}

/**
 * A station standing at its shop. It never walks, so it never takes a walking
 * clip: it idles where the business put it. Its body is chosen from its own
 * address, so the same shop keeps the same Avaia on every device.
 */
export function createStationHandle(
  station: BusinessStationView,
  zoom: number,
): AvatarHandle {
  const modelId =
    AVATAR_MODEL_IDS[avatarSeed(station.pubDress) % AVATAR_MODEL_IDS.length] ??
    DEFAULT_AVAIA_STUDY;
  const scene = resolveAvatarScene(
    modelId as (typeof AVATAR_MODELS)[number],
    undefined,
  );
  return {
    id: stationHandleId(station),
    modelId,
    lngLat: [station.longitude, station.latitude],
    bearingDeg: 0,
    clipId: "idle",
    clipPhase: 0,
    scale: AVATAR_PRESENTATION_SCALE,
    visible: zoom >= AVATAR_MIN_ZOOM,
    visibleNodes: scene.visibleNodes,
  };
}

function sameStations(
  a: readonly BusinessStationView[],
  b: readonly BusinessStationView[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (station, index) =>
        station.pubDress === b[index]?.pubDress &&
        station.ownerPubDress === b[index]?.ownerPubDress &&
        station.longitude === b[index]?.longitude &&
        station.latitude === b[index]?.latitude,
    )
  );
}

export interface BusinessStationsOptions {
  /** Absent means this host offers no stations, which is a normal state. */
  readonly port?: BusinessStationAccessPort | undefined;
  readonly avatars?: AvatarLayerContract | undefined;
  readonly zoom: number;
  readonly refreshMs?: number;
}

/**
 * Stands every business's stationed Avaia on the world, for every Bond.
 *
 * It only reads what businesses published. A station is drawn at its shop at
 * any distance from this device and says nothing about who is there. Every
 * failure is silent and keeps the stations already drawn.
 */
export function useBusinessStations({
  port,
  avatars,
  zoom,
  refreshMs = STATIONS_REFRESH_MS,
}: BusinessStationsOptions): readonly BusinessStationView[] {
  const [stations, setStations] = useState<readonly BusinessStationView[]>([]);

  useEffect(() => {
    if (port === undefined) return;
    let cancelled = false;
    const read = async (): Promise<void> => {
      if (globalThis.document?.visibilityState === "hidden") return;
      const answer = await port.readBusinessStations().catch(() => undefined);
      if (cancelled || answer === undefined) return;
      // An unchanged answer keeps the drawn stations as they are.
      setStations((drawn) => (sameStations(drawn, answer) ? drawn : answer));
    };
    void read();
    const timer = globalThis.setInterval(() => void read(), refreshMs);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [port, refreshMs]);

  // A zoom only flips visibility: removing would drop a loaded study, so a
  // station leaves the layer only when it leaves the answer or the world goes.
  const drawn = useRef(new Set<string>());
  useEffect(() => {
    if (avatars === undefined) return;
    const ids = drawn.current;
    return () => {
      for (const id of ids) avatars.remove(id);
      ids.clear();
    };
  }, [avatars]);

  useEffect(() => {
    if (avatars === undefined) return;
    const ids = drawn.current;
    const current = new Set<string>();
    for (const station of stations) {
      const handle = createStationHandle(station, zoom);
      current.add(handle.id);
      avatars.upsert(handle);
    }
    for (const id of ids) {
      if (!current.has(id)) {
        avatars.remove(id);
        ids.delete(id);
      }
    }
    for (const id of current) ids.add(id);
  }, [avatars, stations, zoom]);

  return stations;
}
