// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { SettingsSliderStops } from "../../shell/settings-slider-stops";
import { useLocalization, type TranslationKey } from "../../shell/localization";
import {
  choosePickupThreshold,
  pickupThresholdLevel,
  usePickup,
} from "./pickup-preference";

/** Special is reserved until Core can classify and pick up special finds. */
const STOPS: readonly {
  readonly key: TranslationKey;
  readonly color: string;
}[] = [
  { key: "settings.pickup.legendary", color: "#e8b84c" },
  { key: "settings.pickup.special", color: "#9b6cfa" },
  { key: "settings.pickup.rare", color: "#358ff0" },
  { key: "settings.pickup.uncommon", color: "#00bfd4" },
  { key: "settings.pickup.common", color: "#899199" },
  { key: "settings.pickup.off", color: "#899199" },
];

/** Core has five thresholds; the sixth visual stop is intentionally inactive. */
function displayIndex(level: number): number {
  return level === 0 ? 5 : level === 1 ? 0 : level;
}

export function PickupSettings({
  onExclusive,
}: {
  readonly onExclusive: () => void;
}) {
  const { t } = useLocalization();
  const stored = usePickup();
  const level = pickupThresholdLevel(stored);
  const selectedIndex = displayIndex(level ?? 4);
  const selected = STOPS[selectedIndex]!;
  const currentLabel =
    level === null ? t("settings.pickup.custom") : t(selected.key);
  const progress = (selectedIndex / (STOPS.length - 1)) * 100;

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{t("settings.pickup.legend")}</legend>
      <small className="interface-settings__note">
        {t("settings.pickup.detail")}
      </small>
      <div className="interface-settings__slider interface-settings__pickup-spectrum">
        <label htmlFor="pickup-level">
          <strong>{currentLabel}</strong>
          {level === null ? (
            <small>{t("settings.pickup.customDetail")}</small>
          ) : null}
        </label>
        <div className="interface-settings__range-control interface-settings__pickup-spectrum-control">
          <span
            className="interface-settings__pickup-spectrum-track"
            aria-hidden="true"
          >
            <span
              className="interface-settings__pickup-spectrum-fill"
              style={{
                clipPath: `inset(0 ${100 - progress}% 0 0 round 999px)`,
              }}
            />
          </span>
          <input
            id="pickup-level"
            type="range"
            name="pickup"
            min={0}
            max={STOPS.length - 1}
            step={1}
            value={selectedIndex}
            style={{ color: selected.color }}
            aria-label={t("settings.pickup.legend")}
            aria-valuetext={currentLabel}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (next < 2) {
                onExclusive();
                // A locked stop never writes a threshold or claims a purchase.
                event.currentTarget.value = String(selectedIndex);
              } else {
                choosePickupThreshold(next === 5 ? 0 : next);
              }
            }}
          />
          <SettingsSliderStops
            labels={STOPS.map(({ key }) => t(key))}
            colors={STOPS.map(({ color }) => color)}
            current={selectedIndex}
            pending={2}
          />
        </div>
      </div>
    </fieldset>
  );
}
