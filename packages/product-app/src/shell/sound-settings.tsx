// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCapability } from "@nilx-one/host-contract";

import { useLocalization, type TranslationKey } from "./localization";
import { SettingsSlider } from "./settings-slider";
import {
  chooseSoundPreference,
  chooseVoicePreference,
  useSoundPreference,
  useVoicePreference,
  type SoundPreference,
  type VoicePreference,
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

/** The voice slider's stops, quietest first. */
const VOICE_LEVELS: readonly (readonly [
  VoicePreference,
  TranslationKey,
  TranslationKey,
])[] = [
  ["off", "settings.voice.off", "settings.voice.offDetail"],
  ["cutscenes", "settings.voice.cutscenes", "settings.voice.cutscenesDetail"],
  ["all", "settings.voice.all", "settings.voice.allDetail"],
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
      <SettingsSlider
        id="sound-level"
        label={t("settings.sound.legend")}
        options={OPTIONS.map(([value, label, detail]) => ({
          value,
          label: t(label),
          detail: t(detail),
        }))}
        value={preference}
        onChange={choose}
      />
      <VoiceSlider muted={preference === "off"} />
    </fieldset>
  );
}

/**
 * Which characters speak aloud, as one slider of three stops. With sound off
 * nobody can be heard, so the slider rests at its first stop and waits.
 */
function VoiceSlider({ muted }: { readonly muted: boolean }) {
  const { t } = useLocalization();
  const voice = useVoicePreference();
  const level = muted
    ? 0
    : VOICE_LEVELS.findIndex(([preference]) => preference === voice);
  const [, label, detail] = VOICE_LEVELS[level] ?? VOICE_LEVELS[0]!;

  return (
    <div className="interface-settings__slider" data-muted={muted}>
      <label htmlFor="voice-level">
        <strong>{t("settings.voice.legend")}</strong>
        <small>{t(detail)}</small>
      </label>
      <input
        id="voice-level"
        type="range"
        name="voice"
        min={0}
        max={VOICE_LEVELS.length - 1}
        step={1}
        value={level}
        disabled={muted}
        aria-valuetext={t(label)}
        onChange={(event) => {
          const next = VOICE_LEVELS[Number(event.target.value)];
          if (next !== undefined) chooseVoicePreference(next[0]);
        }}
      />
      <span className="interface-settings__slider-stops" aria-hidden="true">
        {VOICE_LEVELS.map(([preference, stop], index) => (
          <span key={preference} data-current={index === level}>
            {t(stop)}
          </span>
        ))}
      </span>
    </div>
  );
}
