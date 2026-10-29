// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from "react";

import { useLocalization } from "../../shell/localization";

export interface UnsavedPromptProps {
  readonly message: string;
  readonly onStay: () => void;
  readonly onDiscard: () => void;
}

/**
 * Asked at the top, right under the way back a person just reached for, and
 * focused on staying: the answer that loses nothing is the one a stray tap
 * lands on.
 */
export function UnsavedPrompt({
  message,
  onStay,
  onDiscard,
}: UnsavedPromptProps): React.ReactElement {
  const { t } = useLocalization();
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
  }, []);

  return (
    <div className="avatar-editor__leave">
      <p role="alert">{message}</p>
      <div className="avatar-editor__actions">
        <button type="button" onClick={onDiscard}>
          {t("dock.discardChanges")}
        </button>
        <button
          type="button"
          className="avatar-editor__save"
          ref={stay}
          onClick={onStay}
        >
          {t("dock.keepEditing")}
        </button>
      </div>
    </div>
  );
}
