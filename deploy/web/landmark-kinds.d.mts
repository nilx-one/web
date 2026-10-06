// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface DecodedFeature {
  readonly id: number | undefined;
  /** 1 point, 2 line, 3 polygon; 0 when the tile does not say. */
  readonly type: number;
  readonly properties: Record<string, string | number | boolean | undefined>;
}

export interface KindSummary {
  count: number;
  readonly attributes: Set<string>;
}

export function decodeLayerFeatures(
  tileBytes: Uint8Array,
  layerName: string,
): DecodedFeature[];
export function countKinds(
  featureLists: readonly (readonly DecodedFeature[])[],
): Map<string, KindSummary>;
export function compareKinds(
  kinds: ReadonlyMap<string, KindSummary>,
  landmarkKinds: readonly string[],
  required?: readonly string[],
): { present: string[]; absent: string[]; missing: string[]; ok: boolean };
export function mapperKinds(mapper: {
  readonly rows: Readonly<Record<string, readonly string[]>>;
  readonly significance: readonly string[];
}): string[];
export function mapperAreaKeys(mapper: {
  readonly areas?: Readonly<Record<string, readonly string[]>>;
}): string[];
export function createAreaKeyCheck(required: readonly string[]): {
  add(tile: {
    readonly pois?: readonly DecodedFeature[];
    readonly landuse?: readonly DecodedFeature[];
    readonly water?: readonly DecodedFeature[];
  }): void;
  readonly found: Set<string>;
};
export function zoomOfTileId(tileId: number): number;
