// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapFogMark } from "@nilx-one/map-contract";

export const FOG_MARKS_SOURCE_ID = "fog-marks";
export const FOG_MARKS_FILL_LAYER_ID = "fog-marks-fill";
export const FOG_MARKS_OUTLINE_LAYER_ID = "fog-marks-outline";

const ACCENT = "#37d7e5";

/** One full breathe — current tint down to plain fog and back — every 1.8s. */
export const FOG_PULSE_PERIOD_MS = 1_800;

function clampUnit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Where a cell being worked open sits in its breathing cycle: 1 at its own
 * tint, 0 faded all the way back to plain, untouched fog, a smooth sine
 * between. A cell that is only in reach, not yet being revealed, never asks.
 */
export function fogPulseLevel(nowMs: number): number {
  const phase = (nowMs % FOG_PULSE_PERIOD_MS) / FOG_PULSE_PERIOD_MS;
  return (1 + Math.sin(phase * Math.PI * 2)) / 2;
}

/**
 * One polygon per marked cell. Its properties are presentation only: the
 * state a person reads it in, how far a reveal has come, and where its
 * breathe sits right now — never who sent an Avaia there, and never a claim
 * that anyone was.
 */
export function fogMarksData(
  marks: readonly MapFogMark[],
  pulse = 1,
): Record<string, unknown> {
  const level = clampUnit(pulse);
  return {
    type: "FeatureCollection",
    features: marks.map((mark) => {
      const ring = mark.cell.boundary.map(([longitude, latitude]) => [
        longitude,
        latitude,
      ]);
      const first = ring[0];
      if (first !== undefined) ring.push([...first]);
      return {
        type: "Feature",
        properties: {
          state: mark.state,
          progress: mark.state === "revealing" ? clampUnit(mark.progress) : 0,
          pulse: mark.state === "revealing" ? level : 1,
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      };
    }),
  };
}

export function fogMarksSource(
  marks: readonly MapFogMark[],
): Record<string, unknown> {
  return { type: "geojson", data: fogMarksData(marks) };
}

/**
 * A cell a Bond can send its Avaia into is outlined in the spatial accent and
 * barely tinted, so it reads as "reachable" over the fog without lifting it.
 * A cell being revealed fills in as the reveal goes, and breathes: its tint
 * and edge fade all the way back to plain fog and rise again, on repeat,
 * for as long as its Avaia is still working it open.
 */
export function fogMarksLayers(): readonly Record<string, unknown>[] {
  return [
    {
      id: FOG_MARKS_FILL_LAYER_ID,
      type: "fill",
      source: FOG_MARKS_SOURCE_ID,
      paint: {
        "fill-color": ACCENT,
        "fill-opacity": [
          "case",
          ["==", ["get", "state"], "revealing"],
          ["*", ["+", 0.12, ["*", 0.3, ["get", "progress"]]], ["get", "pulse"]],
          0.06,
        ],
      },
    },
    {
      id: FOG_MARKS_OUTLINE_LAYER_ID,
      type: "line",
      source: FOG_MARKS_SOURCE_ID,
      paint: {
        "line-color": ACCENT,
        "line-opacity": [
          "case",
          ["==", ["get", "state"], "revealing"],
          ["*", 0.95, ["get", "pulse"]],
          0.6,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 2],
        "line-dasharray": [2, 1.5],
      },
    },
  ];
}
