// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type FormEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type ComponentProps,
} from "react";
import {
  parseUsername,
  normalizeCredentialInput,
  type AuthSelection,
} from "./selection";
import { AUTH_COPY_EN, AUTH_COPY_UK, type AuthCopy } from "./copy";
export { AUTH_COPY_EN, AUTH_COPY_UK, type AuthCopy } from "./copy";
export {
  DEFAULT_AUTH_SELECTION,
  normalizeCredentialInput,
  parseUsername,
  type AuthSelection,
} from "./selection";
export type AuthStatus = {
  kind:
    | "idle"
    | "checking"
    | "available"
    | "registered"
    | "unavailable"
    | "invalid"
    | "service-unavailable";
  detail: string;
};
export interface AuthFormState {
  mode:
    | "initial"
    | "resolving"
    | "sign-in"
    | "register"
    | "remembered"
    | "provider-register";
  status: AuthStatus;
  busy: boolean;
  error?: string;
  rememberedUsername?: string;
}

interface FieldRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export function calculateFieldReflection(
  source: FieldRect,
  receiver: FieldRect,
): { energy: number; spread: number; x: number } {
  const sourceX = source.left + source.width / 2;
  const receiverWidth = Math.max(receiver.width, 1);
  const receiverX = Math.min(
    receiverWidth,
    Math.max(0, sourceX - receiver.left),
  );
  const impactX = receiver.left + receiverX;
  const verticalDistance = Math.max(1, receiver.top - source.bottom);
  const horizontalDistance = sourceX - impactX;
  const distance = Math.hypot(horizontalDistance, verticalDistance);
  const incidence = verticalDistance / distance;
  const falloffDistance = Math.max(96, receiver.height * 1.7);
  const inverseSquare = 1 / (1 + (distance / falloffDistance) ** 2);
  const energy = Math.min(1, Math.max(0.12, incidence * inverseSquare));
  const spread = Math.min(
    receiverWidth * 0.78,
    Math.max(72, receiverWidth * (0.28 + (1 - energy) * 0.38)),
  );

  return { energy, spread, x: receiverX };
}

function isBrowserAutofilled(input: HTMLInputElement): boolean {
  try {
    return input.matches(":-webkit-autofill");
  } catch {
    return false;
  }
}

function isCredentialReplacement(
  input: HTMLInputElement,
  nativeEvent: Event,
): boolean {
  const inputType =
    "inputType" in nativeEvent
      ? (nativeEvent as InputEvent).inputType
      : undefined;
  return isBrowserAutofilled(input) || inputType === "insertReplacementText";
}

function StatusGlyph({ status }: { status: AuthStatus }) {
  return (
    <span
      className={`status-glyph status-glyph--${status.kind}`}
      aria-hidden="true"
    >
      {status.kind === "checking" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      ) : status.kind === "available" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12.2 2.6 2.6L16.4 9" />
        </svg>
      ) : status.kind === "registered" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.7" />
          <path d="M9.2 12.2h5.6m-2.8-2.8v5.6" />
        </svg>
      ) : status.kind === "unavailable" ||
        status.kind === "invalid" ||
        status.kind === "service-unavailable" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.8v5.3m0 3.1h.01" />
        </svg>
      ) : null}
    </span>
  );
}

function ActionGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12h9m-3.5-3.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.2 15.8.6-3.1 5.6-5.6 2.5 2.5-5.6 5.6-3.1.6Z" />
    </svg>
  );
}

function VisibilityGlyph({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 8 9 8a17.4 17.4 0 0 1-2.1 3.3M6.6 6.6C4.2 8.3 3 12 3 12s3.5 8 9 8a9.6 9.6 0 0 0 3.4-.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12s3.5-8 9-8 9 8 9 8-3.5 8-9 8-9-8-9-8Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

export function AuthForm({
  identity,
  copy = AUTH_COPY_EN,
  addressExtension,
  password,
  selection,
  onCredentialAutofill,
  onForgetRemembered,
  onPasswordChange,
  onResolveUsername,
  onSelectionChange,
  onSubmit,
}: {
  identity: AuthFormState;
  copy?: AuthCopy;
  addressExtension?: ReactNode;
  password: string;
  selection: AuthSelection;
  onCredentialAutofill(selection: AuthSelection, password: string): void;
  onForgetRemembered(): void;
  onPasswordChange(password: string): void;
  onResolveUsername(): void;
  onSelectionChange(selection: AuthSelection): void;
  onSubmit(): void;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [availableTransition, setAvailableTransition] = useState<{
    key: string;
    complete: boolean;
    collapsed: boolean;
  }>();
  const passwordRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const credentialUsernameRef = useRef<HTMLInputElement>(null);
  const addressFieldRef = useRef<HTMLElement>(null);
  const passwordFieldRef = useRef<HTMLDivElement>(null);
  const editAddressRequested = useRef(false);
  const focusPasswordAfterResolution = useRef(false);
  const credentialAutofill = useRef(false);
  const credentialAutofillSnapshot = useRef<{
    password?: string;
    username?: string;
  }>({});
  const credentialAutofillTimer = useRef<number | undefined>(undefined);
  const lastAppliedCredential = useRef<string | undefined>(undefined);
  const [credentialSwitchKey, setCredentialSwitchKey] = useState<string>();
  const [confirmedAddressKey, setConfirmedAddressKey] = useState<string>();
  const remembered = identity.mode === "remembered";
  const displayedSelection = remembered
    ? (parseUsername(identity.rememberedUsername ?? "") ?? selection)
    : selection;
  const addressKey = `${displayedSelection.discriminator}\u0000${displayedSelection.slug}`;
  const addressConfirmed = confirmedAddressKey === addressKey;
  const credentialSwitchActive =
    credentialSwitchKey === addressKey &&
    identity.status.kind !== "invalid" &&
    identity.status.kind !== "unavailable" &&
    identity.status.kind !== "service-unavailable";
  const availableKey =
    addressConfirmed &&
    identity.mode === "register" &&
    identity.status.kind === "available"
      ? addressKey
      : undefined;
  const currentAvailableTransition =
    availableTransition?.key === availableKey ? availableTransition : undefined;
  const availablePulseComplete = currentAvailableTransition?.complete ?? false;
  const showsPassword =
    remembered ||
    credentialSwitchActive ||
    (addressConfirmed && identity.mode === "sign-in") ||
    (addressConfirmed &&
      identity.mode === "register" &&
      availablePulseComplete);
  const showsSignInAction = identity.mode === "sign-in";
  const showsPasswordSurface = showsPassword || showsSignInAction;
  const addressCollapsed = showsPassword;
  const providerRegistration = identity.mode === "provider-register";
  const choosesAddress =
    identity.mode === "register" || identity.mode === "provider-register";
  const credentialUsername = `0x${displayedSelection.discriminator}${displayedSelection.slug}`;
  const normalizedPassword = password.normalize("NFC");
  const normalizedPasswordLength = [...normalizedPassword].length;
  const passwordHasForbiddenFormat =
    normalizedPassword.trim() !== normalizedPassword ||
    /[\p{Cc}\u2028\u2029]/u.test(normalizedPassword);
  const slugLength = [...displayedSelection.slug].length;
  const canResolveAddress =
    !identity.busy && slugLength >= 2 && slugLength <= 32;
  const passwordReady =
    normalizedPasswordLength >= 8 &&
    normalizedPasswordLength <= 128 &&
    !passwordHasForbiddenFormat;
  const passwordValidation =
    password.length === 0
      ? "idle"
      : identity.error !== undefined || !passwordReady
        ? "invalid"
        : "valid";
  const resolved =
    remembered ||
    (identity.mode === "register" && identity.status.kind === "available") ||
    (identity.mode === "sign-in" && identity.status.kind === "registered");
  const canSubmit = providerRegistration
    ? identity.status.kind === "available"
    : resolved && showsPassword && passwordReady;
  const canConfirmAddress =
    !providerRegistration &&
    !showsPassword &&
    canResolveAddress &&
    (identity.status.kind === "available" ||
      identity.status.kind === "registered");
  const reflectionTone =
    identity.error !== undefined
      ? "negative"
      : identity.status.kind === "available" ||
          identity.status.kind === "registered"
        ? "positive"
        : identity.status.kind === "unavailable" ||
            identity.status.kind === "invalid" ||
            identity.status.kind === "service-unavailable"
          ? "negative"
          : undefined;

  useEffect(() => {
    if (availableKey === undefined) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAvailableTransition({
        key: availableKey,
        complete: true,
        collapsed: true,
      });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [availableKey]);

  useEffect(
    () => () => {
      if (credentialAutofillTimer.current !== undefined) {
        window.clearTimeout(credentialAutofillTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (showsPassword && focusPasswordAfterResolution.current) {
      focusPasswordAfterResolution.current = false;
      passwordRef.current?.focus({ preventScroll: true });
    }
  }, [showsPassword, identity.mode]);

  useEffect(() => {
    if (
      credentialSwitchKey === undefined ||
      credentialSwitchKey !== addressKey
    ) {
      return;
    }
    if (identity.mode === "initial") {
      onResolveUsername();
      return;
    }
    if (identity.mode === "sign-in" || identity.mode === "register") {
      return;
    }
    if (
      identity.status.kind === "invalid" ||
      identity.status.kind === "unavailable" ||
      identity.status.kind === "service-unavailable"
    ) {
      credentialAutofill.current = false;
      credentialAutofillSnapshot.current = {};
      onPasswordChange("");
    }
  }, [
    addressKey,
    credentialSwitchKey,
    identity.mode,
    identity.status.kind,
    onPasswordChange,
    onResolveUsername,
  ]);

  useEffect(() => {
    if (!showsPassword && !addressCollapsed && editAddressRequested.current) {
      editAddressRequested.current = false;
      slugRef.current?.focus({ preventScroll: true });
    }
  }, [addressCollapsed, showsPassword]);

  useLayoutEffect(() => {
    const addressField = addressFieldRef.current;
    const passwordField = passwordFieldRef.current;
    if (
      addressField === null ||
      passwordField === null ||
      reflectionTone === undefined ||
      !showsPassword
    ) {
      return;
    }

    const updateReflection = () => {
      const reflection = calculateFieldReflection(
        addressField.getBoundingClientRect(),
        passwordField.getBoundingClientRect(),
      );
      passwordField.style.setProperty("--reflection-x", `${reflection.x}px`);
      passwordField.style.setProperty(
        "--reflection-spread",
        `${reflection.spread}px`,
      );
      passwordField.style.setProperty(
        "--reflection-energy",
        reflection.energy.toFixed(3),
      );
    };

    updateReflection();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateReflection);
    observer?.observe(addressField);
    observer?.observe(passwordField);
    window.addEventListener("resize", updateReflection);
    window.addEventListener("scroll", updateReflection, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateReflection);
      window.removeEventListener("scroll", updateReflection, true);
    };
  }, [addressCollapsed, reflectionTone, showsPassword]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canSubmit && !identity.busy) {
      onSubmit();
    }
  }

  function pasteUsername(event: ClipboardEvent<HTMLInputElement>): void {
    const parsed = parseUsername(event.clipboardData.getData("text"));
    if (parsed === undefined) {
      return;
    }
    event.preventDefault();
    changeSelection(parsed);
  }

  function changeSelection(next: AuthSelection): void {
    if (
      next.discriminator === displayedSelection.discriminator &&
      next.slug === displayedSelection.slug
    ) {
      return;
    }
    focusPasswordAfterResolution.current = false;
    credentialAutofill.current = false;
    credentialAutofillSnapshot.current = {};
    lastAppliedCredential.current = undefined;
    setCredentialSwitchKey(undefined);
    setConfirmedAddressKey(undefined);
    setAvailableTransition(undefined);
    onSelectionChange(next);
  }

  function selectionFromCredentialUsername(rawUsername: string): AuthSelection {
    return normalizeCredentialInput(
      {
        discriminator: displayedSelection.discriminator,
        slug: rawUsername,
      },
      displayedSelection,
    );
  }

  function tryApplyAutofilledCredential(): void {
    if (!credentialAutofill.current) {
      return;
    }
    const rawUsername =
      credentialAutofillSnapshot.current.username ??
      credentialUsernameRef.current?.value ??
      displayedSelection.slug;
    const nextPassword =
      credentialAutofillSnapshot.current.password ??
      passwordRef.current?.value ??
      "";
    if (nextPassword.length === 0) {
      return;
    }

    const credentialSelection = selectionFromCredentialUsername(rawUsername);
    const nextCredentialKey = `${credentialSelection.discriminator}\u0000${credentialSelection.slug}`;
    const signature = `${nextCredentialKey}\u0000${nextPassword}`;
    if (lastAppliedCredential.current === signature) {
      return;
    }

    lastAppliedCredential.current = signature;
    setConfirmedAddressKey(nextCredentialKey);
    setAvailableTransition(undefined);
    setCredentialSwitchKey(nextCredentialKey);
    onCredentialAutofill(credentialSelection, nextPassword);
  }

  function recordCredentialAutofill(
    field: "password" | "username",
    value: string,
  ): void {
    credentialAutofill.current = true;
    credentialAutofillSnapshot.current[field] = value;
    if (credentialAutofillTimer.current !== undefined) {
      window.clearTimeout(credentialAutofillTimer.current);
    }
    credentialAutofillTimer.current = window.setTimeout(() => {
      credentialAutofillTimer.current = undefined;
      tryApplyAutofilledCredential();
    }, 50);
  }

  function handleAutofillAnimation(
    field: "password" | "username",
  ): FormEventHandler<HTMLInputElement> {
    return (event) => {
      const animationEvent = event.nativeEvent as AnimationEvent;
      if (animationEvent.animationName !== "credential-autofill-start") {
        return;
      }
      recordCredentialAutofill(field, event.currentTarget.value);
    };
  }

  function manualSelectionFromCanonical(rawUsername: string): AuthSelection {
    const canonical = rawUsername;
    if (canonical.startsWith("0x")) {
      const discriminator = canonical[2];
      return {
        discriminator:
          discriminator !== undefined &&
          "0123456789abcdef".includes(discriminator)
            ? discriminator
            : displayedSelection.discriminator,
        slug: canonical.length > 3 ? canonical.slice(3) : "",
      };
    }
    return {
      discriminator: displayedSelection.discriminator,
      slug: canonical,
    };
  }

  function confirmAddress(): void {
    if (providerRegistration && canSubmit) {
      onSubmit();
      return;
    }
    if (showsPassword) {
      passwordRef.current?.focus({ preventScroll: true });
      return;
    }
    if (canResolveAddress) {
      setConfirmedAddressKey(addressKey);
      focusPasswordAfterResolution.current = true;
      onResolveUsername();
    }
  }

  function confirmAddressFromKeyboard(
    event: KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    confirmAddress();
  }

  function editAddress(): void {
    focusPasswordAfterResolution.current = false;
    credentialAutofill.current = false;
    credentialAutofillSnapshot.current = {};
    lastAppliedCredential.current = undefined;
    setCredentialSwitchKey(undefined);
    editAddressRequested.current = true;
    setConfirmedAddressKey(undefined);
    setAvailableTransition(undefined);
    onPasswordChange("");
    if (remembered) {
      onSelectionChange(displayedSelection);
    }
  }

  const actionLabel =
    identity.mode === "sign-in" || remembered
      ? copy.signIn
      : copy.create.replaceAll("{name}", credentialUsername);

  return (
    <form
      className="identity-form ecosystem-auth-form"
      data-status={identity.status.kind}
      data-submission-error={identity.error !== undefined}
      onSubmit={submit}
      noValidate
    >
      <label className="surface-kicker" htmlFor="auth-username">
        {copy.label}
      </label>
      {addressCollapsed ? (
        <div
          ref={(element) => {
            addressFieldRef.current = element;
          }}
          className="address-field address-field--collapsed"
          data-status={identity.status.kind}
        >
          <input
            ref={credentialUsernameRef}
            key={credentialUsername}
            id="auth-username"
            type="text"
            name="username"
            value={credentialUsername}
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect="off"
            spellCheck={false}
            disabled={identity.busy}
            aria-label={copy.label}
            onAnimationStart={(event) =>
              handleAutofillAnimation("username")(event)
            }
            onInput={(event) => {
              if (
                isCredentialReplacement(event.currentTarget, event.nativeEvent)
              ) {
                recordCredentialAutofill("username", event.currentTarget.value);
              }
            }}
            onChange={(event) => {
              const rawUsername = event.currentTarget.value;
              const typedAddress = parseUsername(rawUsername);
              if (
                typedAddress !== undefined &&
                (event.nativeEvent as InputEvent).inputType === "insertText"
              ) {
                changeSelection(typedAddress);
                return;
              }
              if (
                credentialAutofillSnapshot.current.username === rawUsername ||
                isCredentialReplacement(event.currentTarget, event.nativeEvent)
              ) {
                recordCredentialAutofill("username", rawUsername);
                return;
              }
              editAddress();
              onSelectionChange(manualSelectionFromCanonical(rawUsername));
            }}
          />
          <button
            className="status-action"
            type="button"
            disabled={identity.busy}
            aria-label={copy.edit.replaceAll("{name}", credentialUsername)}
            onClick={editAddress}
          >
            <EditGlyph />
          </button>
        </div>
      ) : (
        <div
          ref={(element) => {
            addressFieldRef.current = element;
          }}
          className="address-field"
          data-status={identity.status.kind}
        >
          <span className="address-prefix" aria-hidden="true">
            0x
          </span>
          <label className="digit-selector">
            <span className="visually-hidden">{copy.discriminator}</span>
            <select
              value={displayedSelection.discriminator}
              aria-label={copy.discriminator}
              onChange={(event) =>
                changeSelection({
                  ...displayedSelection,
                  discriminator: event.currentTarget.value,
                })
              }
              disabled={identity.busy}
            >
              {"0123456789abcdef".split("").map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <svg
              className="selector-chevron"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path d="m2.5 4.5 3.5 3 3.5-3" />
            </svg>
          </label>
          <input
            ref={slugRef}
            id="auth-username"
            name="username"
            value={displayedSelection.slug}
            minLength={2}
            maxLength={32}
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect="off"
            enterKeyHint="go"
            spellCheck={false}
            placeholder={copy.slugPlaceholder}
            disabled={identity.busy}
            aria-busy={identity.status.kind === "checking"}
            aria-invalid={
              identity.status.kind === "unavailable" ||
              identity.status.kind === "invalid" ||
              identity.status.kind === "service-unavailable"
            }
            aria-describedby="auth-username-status"
            onPaste={pasteUsername}
            onKeyDown={confirmAddressFromKeyboard}
            onAnimationStart={(event) =>
              handleAutofillAnimation("username")(event)
            }
            onInput={(event) => {
              const rawUsername = event.currentTarget.value;
              if (
                parseUsername(rawUsername) !== undefined ||
                isCredentialReplacement(event.currentTarget, event.nativeEvent)
              ) {
                recordCredentialAutofill("username", rawUsername);
              }
            }}
            onChange={(event) => {
              const rawUsername = event.currentTarget.value;
              const typedAddress = parseUsername(rawUsername);
              if (
                typedAddress !== undefined &&
                (event.nativeEvent as InputEvent).inputType === "insertText"
              ) {
                changeSelection(typedAddress);
                return;
              }
              if (
                credentialAutofillSnapshot.current.username === rawUsername ||
                parseUsername(rawUsername) !== undefined ||
                isCredentialReplacement(event.currentTarget, event.nativeEvent)
              ) {
                recordCredentialAutofill("username", rawUsername);
                return;
              }
              changeSelection({
                ...displayedSelection,
                slug: rawUsername,
              });
            }}
          />
          {providerRegistration ? (
            <button
              className="integrated-action"
              type="submit"
              disabled={!canSubmit || identity.busy}
              aria-label={actionLabel}
            >
              <ActionGlyph />
            </button>
          ) : canConfirmAddress ? (
            <button
              className="status-action"
              type="button"
              disabled={identity.busy}
              aria-label={copy.continueWith.replaceAll(
                "{name}",
                credentialUsername,
              )}
              onClick={confirmAddress}
            >
              <ActionGlyph />
            </button>
          ) : (
            <StatusGlyph status={identity.status} />
          )}
        </div>
      )}
      <p
        id="auth-username-status"
        className={`identity-status identity-status--${identity.status.kind}${
          identity.status.kind === "available" ? " visually-hidden" : ""
        }`}
        aria-live="polite"
      >
        {identity.status.detail}
      </p>

      {choosesAddress && !addressCollapsed ? addressExtension : null}

      <div
        ref={passwordFieldRef}
        className={`password-field${showsPasswordSurface ? "" : " password-field--autofill-proxy"}`}
        data-reflection={reflectionTone}
        data-validation={passwordValidation}
        aria-hidden={!showsPasswordSurface}
      >
        <input
          ref={passwordRef}
          type={passwordVisible ? "text" : "password"}
          name="password"
          value={password}
          minLength={8}
          maxLength={128}
          autoComplete={
            showsPassword && identity.mode === "register"
              ? "new-password"
              : "current-password"
          }
          placeholder={showsPassword ? copy.passwordPlaceholder : undefined}
          aria-label={showsPassword ? copy.password : undefined}
          aria-hidden={!showsPassword}
          aria-invalid={identity.error !== undefined}
          disabled={identity.busy}
          tabIndex={showsPassword ? undefined : -1}
          style={
            showsSignInAction && !showsPassword
              ? { opacity: 0, pointerEvents: "none" }
              : undefined
          }
          onAnimationStart={(event) =>
            handleAutofillAnimation("password")(event)
          }
          onInput={(event) => {
            if (
              !showsPassword ||
              isCredentialReplacement(event.currentTarget, event.nativeEvent)
            ) {
              recordCredentialAutofill("password", event.currentTarget.value);
            }
          }}
          onChange={(event) => {
            const nextPassword = event.currentTarget.value;
            if (
              credentialAutofillSnapshot.current.password === nextPassword ||
              !showsPassword ||
              isCredentialReplacement(event.currentTarget, event.nativeEvent)
            ) {
              recordCredentialAutofill("password", nextPassword);
              return;
            }
            onPasswordChange(nextPassword);
          }}
        />
        {showsPassword ? (
          <button
            className="visibility-action"
            type="button"
            aria-label={passwordVisible ? copy.hidePassword : copy.showPassword}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            <VisibilityGlyph visible={passwordVisible} />
          </button>
        ) : null}
        {showsPassword || showsSignInAction ? (
          <button
            className="integrated-action"
            type="submit"
            disabled={!canSubmit || identity.busy}
            aria-label={actionLabel}
          >
            <ActionGlyph />
          </button>
        ) : null}
      </div>

      {showsPassword && identity.mode === "register" ? (
        <p className="password-note">{copy.passwordRules}</p>
      ) : null}
      {remembered ? (
        <button
          className="text-action"
          type="button"
          disabled={identity.busy}
          onClick={onForgetRemembered}
        >
          {copy.notYou}
        </button>
      ) : null}
      {identity.error === undefined ? null : (
        <p className="identity-error" role="alert">
          {identity.error}
        </p>
      )}
    </form>
  );
}

/** Product branding is presentation only. The host owns verified sessions and callbacks. */
export function AuthView({
  productName,
  locale = "en",
  ...props
}: ComponentProps<typeof AuthForm> & {
  productName: string;
  locale?: "en" | "uk";
}) {
  const ukrainian = locale === "uk";
  return (
    <section className="ecosystem-auth-panel" aria-label={productName}>
      <p className="auth-product-name">{productName}</p>
      <h1>
        {ukrainian
          ? "Вхід або створення акаунта"
          : "Sign in or create an account"}
      </h1>
      <p>
        {ukrainian
          ? "Залиште префікс 0x0 або виберіть інший. Введіть своє ім’я, щоб продовжити."
          : "Keep the 0x0 prefix or choose another. Enter your name to continue."}
      </p>
      <AuthForm
        {...props}
        copy={props.copy ?? (ukrainian ? AUTH_COPY_UK : AUTH_COPY_EN)}
      />
    </section>
  );
}
