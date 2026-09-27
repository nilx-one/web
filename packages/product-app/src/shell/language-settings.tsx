// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

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
      {options.map((preference) => (
        <label key={preference} className="interface-settings__option">
          <span>
            <strong>{optionLabel(preference)}</strong>
            {preference === "auto" ? (
              <small>
                {localization.t(DETECTED_KEYS[localization.resolved])}
              </small>
            ) : null}
          </span>
          <input
            type="radio"
            name="language"
            value={preference}
            checked={localization.preference === preference}
            aria-label={
              preference === "auto"
                ? localization.t("settings.language.autoAction")
                : undefined
            }
            onChange={() => chooseLocale(preference)}
          />
        </label>
      ))}
    </fieldset>
  );
}
