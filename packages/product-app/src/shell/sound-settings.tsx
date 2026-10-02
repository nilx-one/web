// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCapability } from "@nilx-one/host-contract";

import { useLocalization, type TranslationKey } from "./localization";
import {
  chooseSoundPreference,
  chooseVoicePreference,
  useSoundPreference,
  useVoicePreference,
  type SoundPreference,
} from "./sound-preference";

const OPTIONS: readonly (readonly [
  SoundPreference,
  TranslationKey,
  TranslationKey,
])[] = [
  ["off", "settings.sound.off", "settings.sound.offDetail"],
  ["cues", "settings.sound.cues", "settings.sound.cuesDetail"],
  ["all", "settings.sound.all", "settings.sound.allDetail"],
];

export interface SoundSettingsProps {
  readonly sound: SoundCapability;
}

/**
 * How much this device sounds. A host that cannot make a sound has nothing
 * to offer here, so the choice is not shown at all.
 */
export function SoundSettings({ sound }: SoundSettingsProps) {
  const { t } = useLocalization();
  const preference = useSoundPreference();
  const voice = useVoicePreference();
  if (!sound.supported) return null;

  function choose(next: SoundPreference): void {
    chooseSoundPreference(next);
    if (next === "off") return;
    // The choice is a gesture, which is what a browser opens audio from: the
    // host is told now rather than on the next render, and the person hears
    // what they just turned on.
    try {
      sound.setEnabled(true);
      sound.play("tap");
    } catch {
      // Sound is presentation; the choice is stored either way.
    }
  }

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{t("settings.sound.legend")}</legend>
      {OPTIONS.map(([mode, label, detail]) => (
        <label key={mode} className="interface-settings__option">
          <span>
            <strong>{t(label)}</strong>
            <small>{t(detail)}</small>
          </span>
          <input
            type="radio"
            name="sound"
            value={mode}
            checked={preference === mode}
            onChange={() => choose(mode)}
          />
        </label>
      ))}
      <label className="interface-settings__option">
        <span>
          <strong>{t("settings.sound.voice")}</strong>
          <small>{t("settings.sound.voiceDetail")}</small>
        </span>
        <input
          type="checkbox"
          name="voice"
          checked={voice && preference !== "off"}
          disabled={preference === "off"}
          onChange={(event) => chooseVoicePreference(event.target.checked)}
        />
      </label>
    </fieldset>
  );
}
