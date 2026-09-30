// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

import { translateCopy, useLocalization } from "../../shell/localization";

export function ProviderPasswordForm({
  pubDress,
  password,
  busy,
  error,
  onPasswordChange,
  onSubmit,
}: {
  pubDress: string;
  password: string;
  busy: boolean;
  error?: string;
  onPasswordChange(password: string): void;
  onSubmit(): void;
}) {
  const { t } = useLocalization();
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const normalized = password.normalize("NFC");
  const length = [...normalized].length;
  const valid =
    length >= 8 &&
    length <= 128 &&
    normalized.trim() === normalized &&
    !/[\p{Cc}\u2028\u2029]/u.test(normalized);
  const matches = normalized === confirmation.normalize("NFC");
  const mismatch = confirmation.length > 0 && !matches;

  return (
    <form
      className="identity-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && valid && matches) onSubmit();
      }}
    >
      <label className="surface-kicker" htmlFor="provider-password-username">
        pub_dress
      </label>
      <input
        className="provider-password-username"
        id="provider-password-username"
        name="username"
        autoComplete="username"
        readOnly
        value={pubDress}
      />
      <label className="surface-kicker" htmlFor="provider-new-password">
        {t("identity.form.password")}
      </label>
      <div className="password-field">
        <input
          id="provider-new-password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          disabled={busy}
          aria-describedby="provider-password-policy"
          required
          onChange={(event) => onPasswordChange(event.currentTarget.value)}
        />
      </div>
      <p className="password-note" id="provider-password-policy">
        {t("identity.form.passwordRules")}
      </p>
      <label className="surface-kicker" htmlFor="provider-confirm-password">
        {t("identity.password.confirm")}
      </label>
      <div className="password-field">
        <input
          id="provider-confirm-password"
          name="password-confirmation"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirmation}
          disabled={busy}
          required
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "provider-password-mismatch" : undefined}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
        />
      </div>
      <button
        className="text-action"
        type="button"
        onClick={() => setVisible(!visible)}
      >
        {visible ? t("identity.password.hide") : t("identity.password.show")}
      </button>
      {mismatch ? (
        <p
          className="identity-error"
          id="provider-password-mismatch"
          role="alert"
        >
          {t("identity.password.mismatch")}
        </p>
      ) : null}
      {error === undefined ? null : (
        <p className="identity-error" role="alert">
          {translateCopy(t, error)}
        </p>
      )}
      <button
        className="recovery-continue"
        type="submit"
        disabled={busy || !valid || !matches}
      >
        {busy ? t("identity.password.saving") : t("identity.password.save")}
      </button>
    </form>
  );
}

/**
 * Password setup on a host whose origin the product does not own. The form
 * would work here, but the password manager would file the password under the
 * host's origin, so setup is handed to the origin that should own it.
 */
export function ProviderPasswordHandoff({
  pubDress,
  onHandoff,
  onReturn,
}: {
  pubDress: string;
  onHandoff(): void;
  onReturn(): void;
}) {
  const { t } = useLocalization();
  return (
    <div className="identity-form">
      <p className="surface-kicker">pub_dress</p>
      <p className="provider-password-username">{pubDress}</p>
      <p className="password-note">{t("identity.password.handoff")}</p>
      <button className="recovery-continue" type="button" onClick={onHandoff}>
        {t("identity.password.handoffOpen")}
      </button>
      <button className="text-action" type="button" onClick={onReturn}>
        {t("identity.password.handoffDone")}
      </button>
    </div>
  );
}
