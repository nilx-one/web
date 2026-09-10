// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { chooseLocale, useLocalization, type LocalePreference } from "./localization";

const LANGUAGE_OPTIONS: readonly LocalePreference[] = ["auto", "en", "uk-UA"];

/** Local interface language choice. This never enters identity or Core state. */
export function LanguageSettings() {
  const localization = useLocalization();

  function optionLabel(preference: LocalePreference): string {
    switch (preference) {
      case "auto":
        return localization.t("settings.language.auto");
      case "en":
        return localization.t("settings.language.english");
      case "uk-UA":
        return localization.t("settings.language.ukrainian");
    }
  }

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{localization.t("settings.language.legend")}</legend>
      {LANGUAGE_OPTIONS.map((preference) => (
        <label key={preference} className="interface-settings__option">
          <span>
            <strong>{optionLabel(preference)}</strong>
            {preference === "auto" ? (
              <small>
                {localization.resolved === "uk-UA"
                  ? localization.t("settings.language.detected.uk")
                  : localization.t("settings.language.detected.en")}
              </small>
            ) : null}
          </span>
          <input
            type="radio"
            name="language"
            value={preference}
            checked={localization.preference === preference}
            onChange={() => chooseLocale(preference)}
          />
        </label>
      ))}
    </fieldset>
  );
}
