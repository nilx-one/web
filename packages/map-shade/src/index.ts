// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export {
  cellAtLngLat,
  createTapHandler,
  formatRecords,
  type CellTap,
} from "./pick";
export {
  createShadeLayer,
  type ShadeLayer,
  type ShadeLayerOptions,
} from "./shade-layer";
export {
  createGroundRevealed,
  createShadeMapFactory,
  type ShadeMapFactoryOptions,
  type ShadeRuntime,
} from "./map-factory";
export {
  DARK_FOG_PALETTE,
  DEFAULT_FOG_ZONE_FEATHER_M,
  FOG_PALETTES,
  LIGHT_FOG_PALETTE,
  MAX_FOG_ZONES,
  fogColor,
  type FogColor,
  type FogPalette,
  type FogZone,
} from "./fog-palette";
export {
  createFogField,
  readFogReveals,
  FOG_REVEAL_LIMIT,
  type FogFieldComposition,
  type FogRevealStorage,
} from "./fog-field";
export {
  createRawJournalPresenter,
  type RawJournalPresenter,
} from "./presenter";
