// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { SettingsSlider } from "./settings-slider";
import {
  chooseLocale,
  useLocalization,
  type LocalePreference,
  type TranslationKey,
} from "./localization";

const DETECTED_KEYS = {
  en: "settings.language.detected.en",
  "uk-UA": "settings.language.detected.uk",
  "ru-RU": "settings.language.detected.ru",
} as const satisfies Record<string, TranslationKey>;

/** Local interface language choice. This never enters identity or Core state. */
export function LanguageSettings() {
  const localization = useLocalization();
  const options: readonly LocalePreference[] = [
    "auto",
    ...localization.offered,
  ];

  function optionLabel(preference: LocalePreference): string {
    switch (preference) {
      case "auto":
        return localization.t("settings.language.auto");
      case "en":
        return localization.t("settings.language.english");
      case "uk-UA":
        return localization.t("settings.language.ukrainian");
      case "ru-RU":
        return localization.t("settings.language.russian");
    }
  }

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{localization.t("settings.language.legend")}</legend>
      <SettingsSlider
        id="language-level"
        label={localization.t("settings.language.legend")}
        options={options.map((preference) => ({
          value: preference,
          label: optionLabel(preference),
          ...(preference === "auto"
            ? { detail: localization.t(DETECTED_KEYS[localization.resolved]) }
            : {}),
        }))}
        value={localization.preference}
        onChange={chooseLocale}
      />
    </fieldset>
  );
}
