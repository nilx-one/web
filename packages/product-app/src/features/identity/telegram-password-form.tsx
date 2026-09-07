// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

export function TelegramPasswordForm({
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
      <label className="surface-kicker" htmlFor="telegram-password-username">
        pub_dress
      </label>
      <input
        className="telegram-password-username"
        id="telegram-password-username"
        name="username"
        autoComplete="username"
        readOnly
        value={pubDress}
      />
      <label className="surface-kicker" htmlFor="telegram-new-password">
        Password
      </label>
      <div className="password-field">
        <input
          id="telegram-new-password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          disabled={busy}
          aria-describedby="telegram-password-policy"
          required
          onChange={(event) => onPasswordChange(event.currentTarget.value)}
        />
      </div>
      <p className="password-note" id="telegram-password-policy">
        8–128 Unicode characters · no leading/trailing whitespace · no line
        breaks
      </p>
      <label className="surface-kicker" htmlFor="telegram-confirm-password">
        Confirm password
      </label>
      <div className="password-field">
        <input
          id="telegram-confirm-password"
          name="password-confirmation"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirmation}
          disabled={busy}
          required
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "telegram-password-mismatch" : undefined}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
        />
      </div>
      <button
        className="text-action"
        type="button"
        onClick={() => setVisible(!visible)}
      >
        {visible ? "Hide passwords" : "Show passwords"}
      </button>
      {mismatch ? (
        <p
          className="identity-error"
          id="telegram-password-mismatch"
          role="alert"
        >
          Passwords don’t match.
        </p>
      ) : null}
      {error === undefined ? null : (
        <p className="identity-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="recovery-continue"
        type="submit"
        disabled={busy || !valid || !matches}
      >
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
