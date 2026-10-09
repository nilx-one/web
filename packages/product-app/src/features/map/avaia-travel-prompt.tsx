// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useLocalization } from "../../shell/localization";
import "./fog-reveal-prompt.css";

export function AvaiaTravelPrompt({
  avaia,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  readonly avaia: string;
  readonly busy: boolean;
  readonly error: boolean;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="fog-reveal avaia-travel-prompt">
      <section
        className="fog-reveal__prompt"
        role="dialog"
        aria-labelledby="avaia-travel-title"
        aria-describedby="avaia-travel-description"
      >
        <h2 className="fog-reveal__title" id="avaia-travel-title">
          {t("avaia.travel.title")}
        </h2>
        <p className="fog-reveal__detail" id="avaia-travel-description">
          {t("avaia.travel.description").replace("{avaia}", avaia)}
        </p>
        {error ? <p className="profile-edit__error" role="alert">{t("avaia.travel.error")}</p> : null}
        <div className="fog-reveal__actions">
          <button
            className="fog-reveal__cancel"
            type="button"
            disabled={busy}
            onClick={onDismiss}
          >
            {t("avaia.travel.no")}
          </button>
          <button
            className="fog-reveal__confirm"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t("avaia.travel.busy") : t("avaia.travel.yes")}
          </button>
        </div>
      </section>
    </div>
  );
}
