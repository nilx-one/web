// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface DecodedFeature {
  readonly id: number | undefined;
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
export function areaKeysIn(
  featuresByLayer: readonly (readonly [string, readonly DecodedFeature[]])[],
): Set<string>;
export function zoomOfTileId(tileId: number): number;
