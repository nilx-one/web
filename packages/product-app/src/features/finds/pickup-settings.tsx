// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useLocalization, type TranslationKey } from "../../shell/localization";
import {
  RARITIES,
  choosePickup,
  pickedUpRarities,
  usePickup,
  type Rarity,
} from "./pickup-preference";

const LABELS: Readonly<Record<Rarity, TranslationKey>> = {
  common: "settings.pickup.common",
  uncommon: "settings.pickup.uncommon",
  rare: "settings.pickup.rare",
  legendary: "settings.pickup.legendary",
};

/** "Pick up": one switch per rarity, as Core groups the tiers. */
export function PickupSettings() {
  const { t } = useLocalization();
  const picked = pickedUpRarities(usePickup());

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{t("settings.pickup.legend")}</legend>
      <small>{t("settings.pickup.detail")}</small>
      {RARITIES.map((rarity) => (
        <label key={rarity} className="interface-settings__option">
          <span>
            <strong>{t(LABELS[rarity])}</strong>
          </span>
          <input
            type="checkbox"
            name="pickup"
            value={rarity}
            checked={picked.has(rarity)}
            onChange={(event) => choosePickup(rarity, event.target.checked)}
          />
        </label>
      ))}
    </fieldset>
  );
}
