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
  mapDistanceMeters,
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
  visible: boolean,
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
    visible,
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

/**
 * A station is instantiated as a 3D body only once the camera is close enough
 * to draw a person and the shop is within this distance of the camera centre.
 * The world's station list is public and global; what the renderer hydrates
 * is only this neighbourhood of it.
 */
export const STATION_NEAR_METERS = 750;

/**
 * A body already hydrated stays loaded until the camera is this far from its
 * shop, so panning back and forth across the boundary, or zooming out and in,
 * never reloads a study.
 */
export const STATION_RELEASE_METERS = 2 * STATION_NEAR_METERS;

export interface StationCamera {
  readonly center: readonly [longitude: number, latitude: number];
  readonly zoom: number;
}

/**
 * The stations the renderer should hold for this camera, and which of them
 * show. A station enters only near the camera at a body's zoom; one already
 * held stays until it is past the release distance or left the list.
 */
export function stationRenderSet(
  stations: readonly BusinessStationView[],
  camera: StationCamera,
  held: ReadonlySet<string>,
): readonly {
  readonly station: BusinessStationView;
  readonly visible: boolean;
}[] {
  const [longitude, latitude] = camera.center;
  const centre = { longitude, latitude };
  const bodyScale = camera.zoom >= AVATAR_MIN_ZOOM;
  const set: { station: BusinessStationView; visible: boolean }[] = [];
  for (const station of stations) {
    const distance = mapDistanceMeters(centre, station);
    const near = distance <= STATION_NEAR_METERS;
    const kept =
      held.has(stationHandleId(station)) && distance <= STATION_RELEASE_METERS;
    if ((bodyScale && near) || kept) {
      set.push({ station, visible: bodyScale && near });
    }
  }
  return set;
}

export interface BusinessStationsOptions {
  /** Owners currently drawn as map pins rather than stationed bodies. */
  readonly markerOnlyOwners?: readonly string[];
  /** Absent means this host offers no stations, which is a normal state. */
  readonly port?: BusinessStationAccessPort | undefined;
  readonly avatars?: AvatarLayerContract | undefined;
  readonly camera: StationCamera;
  readonly refreshMs?: number;
}

/**
 * Stands the stationed Avaia near the camera on the world, for every Bond.
 *
 * It only reads what businesses published. The list is global; the bodies are
 * local to the camera, so a world of many shops costs only the few in view.
 * A station says nothing about who is there. Every failure is silent and keeps
 * the stations already known.
 */
export function useBusinessStations({
  markerOnlyOwners,
  port,
  avatars,
  camera,
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
      // An unchanged answer keeps the known stations as they are.
      setStations((known) => (sameStations(known, answer) ? known : answer));
    };
    void read();
    const timer = globalThis.setInterval(() => void read(), refreshMs);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [port, refreshMs]);

  // Held bodies and what each was last sent as (shown, and where), so a pan
  // that changes nothing for a station sends the renderer nothing.
  const held = useRef(new Map<string, string>());
  useEffect(() => {
    if (avatars === undefined) return;
    const bodies = held.current;
    return () => {
      for (const id of bodies.keys()) avatars.remove(id);
      bodies.clear();
    };
  }, [avatars]);

  const [longitude, latitude] = camera.center;
  const zoom = camera.zoom;
  useEffect(() => {
    if (avatars === undefined) return;
    const bodies = held.current;
    const wanted = stationRenderSet(
      markerOnlyOwners === undefined
        ? stations
        : stations.filter(
            (station) => !markerOnlyOwners.includes(station.ownerPubDress),
          ),
      { center: [longitude, latitude], zoom },
      new Set(bodies.keys()),
    );
    const ids = new Set<string>();
    for (const { station, visible } of wanted) {
      const id = stationHandleId(station);
      ids.add(id);
      const sent = `${visible}:${station.longitude},${station.latitude}`;
      if (bodies.get(id) === sent) continue;
      avatars.upsert(createStationHandle(station, visible));
      bodies.set(id, sent);
    }
    for (const id of [...bodies.keys()]) {
      if (ids.has(id)) continue;
      avatars.remove(id);
      bodies.delete(id);
    }
  }, [avatars, stations, longitude, latitude, zoom, markerOnlyOwners]);

  return stations;
}
