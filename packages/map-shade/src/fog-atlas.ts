// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CellIndex } from "@nilx-one/presence-contract";
import { cellToBoundary } from "h3-js";
import { MercatorCoordinate } from "maplibre-gl";

/** A fixed geographic surface. No camera state is accepted by this module. */
export function createFogAtlas(
  anchor: { readonly lng: number; readonly lat: number },
  regionM = 20_000,
  size = 2_048,
  document: Document = globalThis.document,
) {
  if (!Number.isFinite(regionM) || regionM <= 0)
    throw new Error("Invalid fog region");
  if (!Number.isInteger(size) || size < 32 || size > 4_096)
    throw new Error("Invalid fog texture size");
  const center = MercatorCoordinate.fromLngLat(anchor);
  const span = regionM * center.meterInMercatorCoordinateUnits();
  const x0 = center.x - span / 2;
  const y0 = center.y - span / 2;
  const coordinates: [number, number][] = [
    [x0, y0],
    [x0 + span, y0],
    [x0 + span, y0 + span],
    [x0, y0 + span],
  ].map(([x, y]) => {
    const point = new MercatorCoordinate(x!, y!).toLngLat();
    return [point.lng, point.lat];
  });
  const mask = document.createElement("canvas");
  mask.width = mask.height = size;
  // The mask is the only record of coverage between journal reads. Keep it in
  // a software canvas: a failed GPU device can reset the GPU process and wipe
  // accelerated 2D canvases, which would fog every revealed cell over.
  const context = mask.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("Fog mask canvas unavailable");
  const project = (lng: number, lat: number): [number, number] => {
    const point = MercatorCoordinate.fromLngLat({ lng, lat });
    // Pick the world copy nearest this atlas, including cells across ±180°.
    const x = point.x + Math.round(center.x - point.x);
    return [((x - x0) / span) * size, ((point.y - y0) / span) * size];
  };
  const reset = () => {
    context.fillStyle = "black";
    context.fillRect(0, 0, size, size);
  };
  reset();
  return {
    mask,
    size,
    regionM,
    center,
    span,
    project,
    coordinates: coordinates as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ],
    reset,
    add(cell: CellIndex) {
      const points = cellToBoundary(cell, true).map(([lng, lat]) =>
        project(lng, lat),
      );
      context.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.fillStyle = context.strokeStyle = "white";
      context.fill();
      // One texel guard against the compositor's bilinear filtering bringing
      // opaque neighbours back into a revealed cell. Never animate this edge.
      context.lineWidth = 2;
      context.stroke();
    },
  };
}

export type FogAtlas = ReturnType<typeof createFogAtlas>;
