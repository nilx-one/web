// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { parsePubDress, type PubDressSelection } from "@nilx-one/application";
import { AppChrome, RuntimeStatus } from "@nilx-one/ui";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type FormEventHandler,
  type KeyboardEvent,
} from "react";

import type {
  IdentityFoundationViewModel,
  IdentityViewState,
  PubDressStatusViewState,
} from "./identity-foundation-view-model";
import { normalizePubDressCredentialInput } from "./pub-dress-credential-input";

export interface IdentityFoundationViewProps {
  password: string;
  selection: PubDressSelection;
  viewModel: IdentityFoundationViewModel;
  onAcknowledgeRecovery(challenge: string): void;
  onCredentialAutofill(selection: PubDressSelection, password: string): void;
  onForgetRemembered(): void;
  onLogout(): void;
  onPasswordChange(password: string): void;
  onResolvePubDress(): void;
  onSelectionChange(selection: PubDressSelection): void;
  onSubmit(): void;
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

function StatusGlyph({ status }: { status: PubDressStatusViewState }) {
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

function heading(identity: IdentityViewState): string {
  switch (identity.kind) {
    case "recovery-key":
      return "Save your recovery key.";
    case "authenticated":
      return "You’re in.";
    case "form":
      switch (identity.mode) {
        case "register":
          return "Create your Bond.";
        case "sign-in":
        case "remembered":
          return "Welcome back.";
        case "provider-register":
          return "Choose your pub_dress.";
        case "initial":
        case "resolving":
          return "Enter your pub_dress.";
      }
      return "Enter your pub_dress.";
    case "loading":
    case "provider-required":
    case "unavailable":
      return "One address. One way in.";
  }
}

function lede(identity: IdentityViewState): string {
  switch (identity.kind) {
    case "recovery-key":
      return "This is the only native recovery proof. It appears once.";
    case "authenticated":
      return `Authenticated as ${identity.pubDress}.`;
    case "form":
      if (identity.mode === "register") {
        return "No provider required. Your exact, case-sensitive address belongs to this Bond.";
      }
      if (identity.mode === "remembered") {
        return `${identity.rememberedPubDress ?? "This Bond"} is remembered on this browser.`;
      }
      if (identity.mode === "provider-register") {
        return "The provider proves who you are; 0x1 still owns the identity.";
      }
      return "The same field resolves registration or sign-in for you.";
    case "loading":
    case "provider-required":
    case "unavailable":
      return identity.detail;
  }
}

function ProviderRow() {
  return (
    <section className="provider-row" aria-labelledby="provider-row-label">
      <span id="provider-row-label">Sign in with</span>
      <div className="provider-buttons">
        <button type="button" disabled aria-label="Telegram — coming next">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 11 15-6-4.7 14-3.6-4.1L8 17l.6-4.1L17 7.4 6.4 12.2 4 11Z" />
          </svg>
          <span>Telegram</span>
          <small>next</small>
        </button>
        <button type="button" disabled aria-label="Discord — coming later">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.2 7.2A14 14 0 0 1 12 6.3a14 14 0 0 1 4.8.9c1.1 1.6 2 4.3 2.2 6.5a12 12 0 0 1-3.2 2.1l-.8-1.1a8.6 8.6 0 0 0 1.4-.7c-2.7 1.2-6.1 1.2-8.8 0 .4.3.9.5 1.4.7l-.8 1.1A12 12 0 0 1 5 13.7c.2-2.2 1.1-4.9 2.2-6.5Z" />
            <circle cx="9.5" cy="11.5" r="1" />
            <circle cx="14.5" cy="11.5" r="1" />
          </svg>
          <span>Discord</span>
          <small>later</small>
        </button>
      </div>
    </section>
  );
}

function RecoveryKeyView({
  state,
  onAcknowledge,
}: {
  state: Extract<IdentityViewState, { kind: "recovery-key" }>;
  onAcknowledge(challenge: string): void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(state.recoveryKey);
    setCopied(true);
  }

  function download(): void {
    const blob = new Blob(
      [
        `0x1 native recovery key\n\nBond: ${state.pubDress}\nKey: ${state.recoveryKey}\n`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.pubDress}-recovery-key.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="recovery-surface" aria-label="Recovery key">
      <span className="surface-kicker">{state.pubDress}</span>
      <code>{state.recoveryKey}</code>
      <div className="recovery-actions">
        <button type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={download}>
          Download
        </button>
      </div>
      <label className="recovery-confirmation">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.currentTarget.checked)}
        />
        <span>I saved this recovery key</span>
      </label>
      {state.error === undefined ? null : (
        <p className="identity-error" role="alert">
          {state.error}
        </p>
      )}
      <button
        className="recovery-continue"
        type="button"
        disabled={!saved || state.busy}
        onClick={() => onAcknowledge(state.challenge)}
      >
        {state.busy ? "Completing…" : "Continue to 0x1"}
      </button>
    </section>
  );
}

function IdentityForm({
  identity,
  password,
  selection,
  onCredentialAutofill,
  onForgetRemembered,
  onPasswordChange,
  onResolvePubDress,
  onSelectionChange,
  onSubmit,
}: {
  identity: Extract<IdentityViewState, { kind: "form" }>;
  password: string;
  selection: PubDressSelection;
  onCredentialAutofill(selection: PubDressSelection, password: string): void;
  onForgetRemembered(): void;
  onPasswordChange(password: string): void;
  onResolvePubDress(): void;
  onSelectionChange(selection: PubDressSelection): void;
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
  const credentialSwitchKey = useRef<string | undefined>(undefined);
  const [confirmedAddressKey, setConfirmedAddressKey] = useState<string>();
  const remembered = identity.mode === "remembered";
  const displayedSelection = remembered
    ? (parsePubDress(identity.rememberedPubDress ?? "") ?? selection)
    : selection;
  const addressKey = `${displayedSelection.discriminator}\u0000${displayedSelection.slug}`;
  const addressConfirmed = confirmedAddressKey === addressKey;
  const credentialSwitchActive = credentialSwitchKey.current === addressKey;
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
  const addressCollapsed = showsPassword;
  const providerRegistration = identity.mode === "provider-register";
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
  const canSubmit = providerRegistration
    ? identity.status.kind === "available"
    : showsPassword && passwordReady;
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
      credentialSwitchKey.current === undefined ||
      credentialSwitchKey.current !== addressKey
    ) {
      return;
    }
    if (identity.mode === "initial") {
      onResolvePubDress();
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
      credentialSwitchKey.current = undefined;
      credentialAutofill.current = false;
      credentialAutofillSnapshot.current = {};
      onPasswordChange("");
    }
  }, [
    addressKey,
    identity.mode,
    identity.status.kind,
    onPasswordChange,
    onResolvePubDress,
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
    if (canSubmit) {
      onSubmit();
    }
  }

  function pastePubDress(event: ClipboardEvent<HTMLInputElement>): void {
    const parsed = parsePubDress(event.clipboardData.getData("text").trim());
    if (parsed === undefined) {
      return;
    }
    event.preventDefault();
    changeSelection(parsed);
  }

  function changeSelection(next: PubDressSelection): void {
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
    credentialSwitchKey.current = undefined;
    setConfirmedAddressKey(undefined);
    setAvailableTransition(undefined);
    onSelectionChange(next);
  }

  function selectionFromCredentialUsername(
    rawUsername: string,
  ): PubDressSelection {
    return normalizePubDressCredentialInput(
      {
        discriminator: displayedSelection.discriminator,
        slug: rawUsername.trim(),
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
    credentialSwitchKey.current = nextCredentialKey;
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

  function manualSelectionFromCanonical(
    rawUsername: string,
  ): PubDressSelection {
    const canonical = rawUsername.trim();
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
      onResolvePubDress();
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
    credentialSwitchKey.current = undefined;
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
      ? "Sign in"
      : `Create 0x${displayedSelection.discriminator}${displayedSelection.slug}`;

  return (
    <form
      className="identity-form"
      data-status={identity.status.kind}
      data-submission-error={identity.error !== undefined}
      onSubmit={submit}
      noValidate
    >
      <label className="surface-kicker" htmlFor="pub-dress-slug">
        pub_dress
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
            id="pub-dress-slug"
            type="text"
            name="username"
            value={credentialUsername}
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect="off"
            spellCheck={false}
            disabled={identity.busy}
            aria-label="pub_dress"
            onAnimationStart={handleAutofillAnimation("username")}
            onInput={(event) => {
              if (
                isCredentialReplacement(event.currentTarget, event.nativeEvent)
              ) {
                recordCredentialAutofill("username", event.currentTarget.value);
              }
            }}
            onChange={(event) => {
              const rawUsername = event.currentTarget.value;
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
            aria-label={`Edit ${credentialUsername}`}
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
            <span className="visually-hidden">
              pub_dress hexadecimal discriminator
            </span>
            <select
              value={displayedSelection.discriminator}
              aria-label="pub_dress hexadecimal discriminator"
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
            id="pub-dress-slug"
            name="username"
            value={displayedSelection.slug}
            minLength={2}
            maxLength={32}
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect="off"
            enterKeyHint="go"
            spellCheck={false}
            placeholder="slug"
            disabled={identity.busy}
            aria-busy={identity.status.kind === "checking"}
            aria-invalid={
              identity.status.kind === "unavailable" ||
              identity.status.kind === "invalid" ||
              identity.status.kind === "service-unavailable"
            }
            aria-describedby="pub-dress-status"
            onPaste={pastePubDress}
            onKeyDown={confirmAddressFromKeyboard}
            onAnimationStart={handleAutofillAnimation("username")}
            onInput={(event) => {
              const rawUsername = event.currentTarget.value;
              if (
                parsePubDress(rawUsername.trim()) !== undefined ||
                isCredentialReplacement(event.currentTarget, event.nativeEvent)
              ) {
                recordCredentialAutofill("username", rawUsername);
              }
            }}
            onChange={(event) => {
              const rawUsername = event.currentTarget.value;
              if (
                credentialAutofillSnapshot.current.username === rawUsername ||
                parsePubDress(rawUsername.trim()) !== undefined ||
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
              aria-label={`Continue with 0x${displayedSelection.discriminator}${displayedSelection.slug}`}
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
        id="pub-dress-status"
        className={`identity-status identity-status--${identity.status.kind}${
          identity.status.kind === "available" ? " visually-hidden" : ""
        }`}
        aria-live="polite"
      >
        {identity.status.detail}
      </p>

      <div
        ref={passwordFieldRef}
        className={`password-field${showsPassword ? "" : " password-field--autofill-proxy"}`}
        data-reflection={reflectionTone}
        data-validation={passwordValidation}
        aria-hidden={!showsPassword}
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
          placeholder={showsPassword ? "password" : undefined}
          aria-label={showsPassword ? "Password" : undefined}
          aria-invalid={identity.error !== undefined}
          disabled={identity.busy}
          tabIndex={showsPassword ? undefined : -1}
          onAnimationStart={handleAutofillAnimation("password")}
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
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            <VisibilityGlyph visible={passwordVisible} />
          </button>
        ) : null}
        {showsPassword ? (
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
        <p className="password-note">
          8–128 Unicode characters · no leading/trailing whitespace · no line
          breaks
        </p>
      ) : null}
      {remembered ? (
        <button
          className="text-action"
          type="button"
          disabled={identity.busy}
          onClick={onForgetRemembered}
        >
          Not you?
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

export function IdentityFoundationView({
  password,
  selection,
  viewModel,
  onAcknowledgeRecovery,
  onCredentialAutofill,
  onForgetRemembered,
  onLogout,
  onPasswordChange,
  onResolvePubDress,
  onSelectionChange,
  onSubmit,
}: IdentityFoundationViewProps) {
  return (
    <AppChrome
      hostLabel={viewModel.hostLabel}
      safeArea={viewModel.safeArea}
      footer={
        <>
          <span>0x1 · pre-alpha</span>
          <span>© 2026 aiaiaiai · aiaiaiai.org</span>
        </>
      }
    >
      <div className="foundation-layout">
        <section className="identity-panel" aria-labelledby="foundation-title">
          <div className="identity-copy">
            <p className="eyebrow">0x1 identity</p>
            <h1 id="foundation-title">{heading(viewModel.identity)}</h1>
            <p className="foundation-lede">{lede(viewModel.identity)}</p>
          </div>

          <div className="identity-surface">
            {viewModel.showProviderRow ? (
              <>
                <ProviderRow />
                <div className="identity-divider" aria-hidden="true">
                  <span>or</span>
                </div>
              </>
            ) : null}
            {viewModel.identity.kind === "form" ? (
              <IdentityForm
                identity={viewModel.identity}
                password={password}
                selection={selection}
                onCredentialAutofill={onCredentialAutofill}
                onForgetRemembered={onForgetRemembered}
                onPasswordChange={onPasswordChange}
                onResolvePubDress={onResolvePubDress}
                onSelectionChange={onSelectionChange}
                onSubmit={onSubmit}
              />
            ) : viewModel.identity.kind === "recovery-key" ? (
              <RecoveryKeyView
                state={viewModel.identity}
                onAcknowledge={onAcknowledgeRecovery}
              />
            ) : viewModel.identity.kind === "authenticated" ? (
              <section className="authenticated-surface" aria-live="polite">
                <span className="surface-kicker">Authenticated Bond</span>
                <strong>{viewModel.identity.pubDress}</strong>
                {viewModel.identity.native ? (
                  <button type="button" onClick={onLogout}>
                    Sign out
                  </button>
                ) : null}
              </section>
            ) : (
              <section className="identity-message" aria-live="polite">
                <span className="message-orbit" aria-hidden="true" />
                <p>{viewModel.identity.detail}</p>
              </section>
            )}
          </div>

          <RuntimeStatus {...viewModel.runtime} />
        </section>
      </div>
    </AppChrome>
  );
}
