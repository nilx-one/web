// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { SettingsSlider } from "../../shell/settings-slider";
import { useLocalization, type TranslationKey } from "../../shell/localization";
import {
  choosePickupThreshold,
  pickupThresholdLevel,
  usePickup,
} from "./pickup-preference";

/** Moving right includes every rarer tier; the last stop picks up all four. */
const STOPS: readonly {
  readonly value: number;
  readonly key: TranslationKey;
}[] = [
  { value: 0, key: "settings.pickup.off" },
  { value: 1, key: "settings.pickup.legendary" },
  { value: 2, key: "settings.pickup.rare" },
  { value: 3, key: "settings.pickup.uncommon" },
  { value: 4, key: "settings.pickup.common" },
];

export function PickupSettings() {
  const { t } = useLocalization();
  const stored = usePickup();
  const level = pickupThresholdLevel(stored);

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{t("settings.pickup.legend")}</legend>
      <small className="interface-settings__note">
        {t("settings.pickup.detail")}
      </small>
      <SettingsSlider
        id="pickup-level"
        label={t("settings.pickup.legend")}
        options={STOPS.map(({ value, key }) => ({ value, label: t(key) }))}
        value={level ?? 4}
        onChange={choosePickupThreshold}
        {...(level === null
          ? {
              titleOverride: t("settings.pickup.custom"),
              detailOverride: t("settings.pickup.customDetail"),
            }
          : {})}
      />
    </fieldset>
  );
}
