// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BrowserIdentityProvider,
  CorePubDressLabelResult,
  PubDressLabelResolutionResult,
  PubDressSelection,
} from "@nilx-one/application";
import { AppChrome, RuntimeStatus } from "@nilx-one/ui";
import { useState } from "react";
import { AuthForm } from "@aiaiaiai/auth-view";
export { calculateFieldReflection } from "@aiaiaiai/auth-view";

import { useSystemErrorNotices } from "../system-informer/system-informer";
import type { AvatarChoiceViewState } from "./avatar-choice-view-model";
import type {
  IdentityFoundationViewModel,
  IdentityViewState,
} from "./identity-foundation-view-model";
import {
  ProviderPasswordForm,
  ProviderPasswordHandoff,
} from "./provider-password-form";
import { PubDressUrlField } from "./pub-dress-url-field";
import { createPubDressUrlViewState } from "./pub-dress-url-view-model";
import {
  HOST_LABEL_KEYS,
  RUNTIME_LABEL_KEYS,
  translateCopy,
  translateFirst,
  useLocalization,
  type Translate,
} from "../../shell/localization";

export interface BrowserProviderAuthViewState {
  available: {
    telegram: boolean;
    discord: boolean;
    github: boolean;
  };
  pendingProvider?: BrowserIdentityProvider;
  suggestedPubDress?: string;
  onAuthorize(provider: BrowserIdentityProvider): void;
  onApplySuggestedPubDress(pubDress: string): void;
  onChooseExistingIdentity(): void;
}

export interface IdentityFoundationViewProps {
  password: string;
  selection: PubDressSelection;
  viewModel: IdentityFoundationViewModel;
  browserProviderAuth?: BrowserProviderAuthViewState | undefined;
  /** Normative public-label derivation returned by 0x1 Core. */
  pubDressLabelDerivation?: CorePubDressLabelResult | undefined;
  pubDressLabelDerivationPending?: boolean;
  /**
   * Availability of the allocated public label. Absent until the identity
   * service exposes label resolution; only a real collision answer can open
   * the editable second part.
   */
  pubDressUrlResolution?: PubDressLabelResolutionResult;
  /** The body a new Bond picked, or nothing when it chose to decide later. */
  onAvatarChoice?(
    model: AvatarChoiceViewState["options"][number]["model"],
  ): void;
  onSkipAvatarChoice?(): void;
  onCredentialAutofill(selection: PubDressSelection, password: string): void;
  onForgetRemembered(): void;
  onLogout(): void;
  /**
   * Present when password setup belongs to another origin than this host's;
   * the setup step then hands off instead of showing the form.
   */
  passwordHandoff?: {
    open(): void;
    returned(): void;
  };
  onPasswordChange(password: string): void;
  onResolvePubDress(): void;
  onSelectionChange(selection: PubDressSelection): void;
  onSubmit(): void;
}

function heading(identity: IdentityViewState, t: Translate): string {
  switch (identity.kind) {
    case "avatar-choice":
      return t("identity.heading.avatar");
    case "provider-password":
      return t("identity.heading.password");
    case "form":
      switch (identity.mode) {
        case "register":
          return t("identity.heading.register");
        case "sign-in":
        case "remembered":
          return t("identity.heading.welcome");
        case "provider-register":
          return t("identity.heading.choose");
        case "initial":
        case "resolving":
          return t("identity.heading.enter");
      }
      return t("identity.heading.enter");
    case "authenticated":
    case "loading":
    case "provider-required":
    case "unavailable":
      return t("identity.heading.default");
  }
}

function lede(identity: IdentityViewState, t: Translate): string {
  switch (identity.kind) {
    case "avatar-choice":
      return t("identity.lede.avatar");
    case "provider-password":
      return t("identity.lede.password").replaceAll(
        "{provider}",
        identity.provider,
      );
    case "authenticated":
      return t("identity.lede.authenticated");
    case "form":
      if (identity.mode === "register") {
        return t("identity.lede.register");
      }
      if (identity.mode === "remembered") {
        return t("identity.lede.remembered").replaceAll(
          "{name}",
          identity.rememberedPubDress ?? t("identity.lede.rememberedFallback"),
        );
      }
      if (identity.mode === "provider-register") {
        return t("identity.lede.provider");
      }
      return t("identity.lede.default");
    case "loading":
    case "provider-required":
    case "unavailable":
      return translateCopy(t, identity.detail);
  }
}

function ProviderRow({
  auth,
}: {
  auth: BrowserProviderAuthViewState | undefined;
}) {
  const { t } = useLocalization();
  const signInWith = (provider: string) =>
    t("identity.provider.signInWithNamed").replaceAll("{provider}", provider);
  const suggestedPubDress = auth?.suggestedPubDress;
  const pendingLabel =
    auth?.pendingProvider === "telegram"
      ? "Telegram"
      : auth?.pendingProvider === "discord"
        ? "Discord"
        : auth?.pendingProvider === "github"
          ? "GitHub"
          : undefined;
  return (
    <section className="provider-row" aria-labelledby="provider-row-label">
      <span id="provider-row-label">{t("identity.provider.signInWith")}</span>
      <div className="provider-buttons">
        <button
          type="button"
          disabled={auth?.available.telegram !== true}
          aria-label={signInWith("Telegram")}
          onClick={() => auth?.onAuthorize("telegram")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 11 15-6-4.7 14-3.6-4.1L8 17l.6-4.1L17 7.4 6.4 12.2 4 11Z" />
          </svg>
          <span>Telegram</span>
          <small>{t("identity.provider.web")}</small>
        </button>
        <button
          type="button"
          disabled={auth?.available.discord !== true}
          aria-label={signInWith("Discord")}
          onClick={() => auth?.onAuthorize("discord")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.2 7.2A14 14 0 0 1 12 6.3a14 14 0 0 1 4.8.9c1.1 1.6 2 4.3 2.2 6.5a12 12 0 0 1-3.2 2.1l-.8-1.1a8.6 8.6 0 0 0 1.4-.7c-2.7 1.2-6.1 1.2-8.8 0 .4.3.9.5 1.4.7l-.8 1.1A12 12 0 0 1 5 13.7c.2-2.2 1.1-4.9 2.2-6.5Z" />
            <circle cx="9.5" cy="11.5" r="1" />
            <circle cx="14.5" cy="11.5" r="1" />
          </svg>
          <span>Discord</span>
          <small>{t("identity.provider.web")}</small>
        </button>
        <button
          type="button"
          disabled={auth?.available.github !== true}
          aria-label={signInWith("GitHub")}
          onClick={() => auth?.onAuthorize("github")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.8a9.3 9.3 0 0 0-2.9 18.1c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 2.9.9.1-.7.4-1.1.7-1.4-2.3-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A9.3 9.3 0 0 0 12 2.8Z" />
          </svg>
          <span>GitHub</span>
          <small>{t("identity.provider.web")}</small>
        </button>
      </div>
      {pendingLabel === undefined ? null : (
        <>
          <p
            className="identity-status identity-status--available"
            aria-live="polite"
          >
            {t("identity.provider.verified").replaceAll(
              "{provider}",
              pendingLabel,
            )}
          </p>
          <div className="provider-buttons">
            {suggestedPubDress === undefined ? null : (
              <button
                type="button"
                onClick={() =>
                  auth?.onApplySuggestedPubDress(suggestedPubDress)
                }
              >
                {t("identity.provider.suggested").replaceAll(
                  "{pubDress}",
                  suggestedPubDress,
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => auth?.onChooseExistingIdentity()}
            >
              {t("identity.provider.existing")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function AvatarChoiceView({
  state,
  onChoose,
  onSkip,
}: {
  state: Extract<IdentityViewState, { kind: "avatar-choice" }>;
  onChoose(model: AvatarChoiceViewState["options"][number]["model"]): void;
  onSkip(): void;
}) {
  const { t } = useLocalization();
  return (
    <section className="avatar-surface" aria-label={t("identity.avatar.label")}>
      <span className="surface-kicker">{state.pubDress}</span>
      <ul className="avatar-gallery">
        {state.choice.options.map((option) => (
          <li key={option.model}>
            <button
              className={`avatar-card${option.selected ? " avatar-card--selected" : ""}`}
              type="button"
              disabled={state.choice.busy}
              aria-pressed={option.selected}
              onClick={() => onChoose(option.model)}
            >
              {/* A still of the study itself, so the card cannot promise a
                  body the world would not draw. */}
              <img src={option.previewUrl} alt="" width={210} height={450} />
              <strong>{option.name}</strong>
              <small>{translateCopy(t, option.detail)}</small>
            </button>
          </li>
        ))}
      </ul>
      {state.choice.error === undefined ? null : (
        <p className="identity-error" role="alert">
          {translateCopy(t, state.choice.error)}
        </p>
      )}
      <button className="text-action" type="button" onClick={onSkip}>
        {t("identity.avatar.later")}
      </button>
    </section>
  );
}

function IdentityForm({
  identity,
  password,
  selection,
  pubDressLabelDerivation,
  pubDressLabelDerivationPending,
  pubDressUrlResolution,
  onResolvePubDress,
  ...actions
}: {
  identity: Extract<IdentityViewState, { kind: "form" }>;
  password: string;
  pubDressLabelDerivation: CorePubDressLabelResult | undefined;
  pubDressLabelDerivationPending: boolean;
  pubDressUrlResolution: PubDressLabelResolutionResult | undefined;
  selection: PubDressSelection;
  onCredentialAutofill(selection: PubDressSelection, password: string): void;
  onForgetRemembered(): void;
  onPasswordChange(password: string): void;
  onResolvePubDress(): void;
  onSelectionChange(selection: PubDressSelection): void;
  onSubmit(): void;
}) {
  const { t } = useLocalization();
  const [suffix, setSuffix] = useState("");
  const url = createPubDressUrlViewState({
    selection,
    suffix,
    pending: identity.status.kind === "checking",
    resolution: pubDressUrlResolution,
    derivation: pubDressLabelDerivation,
    derivationPending: pubDressLabelDerivationPending,
  });
  return (
    <AuthForm
      identity={{
        mode: identity.mode,
        busy: identity.busy,
        status: {
          ...identity.status,
          detail: translateCopy(t, identity.status.detail),
        },
        ...(identity.error === undefined
          ? {}
          : { error: translateCopy(t, identity.error) }),
        ...(identity.rememberedPubDress === undefined
          ? {}
          : { rememberedUsername: identity.rememberedPubDress }),
      }}
      copy={{
        label: "pub_dress",
        continueWith: t("identity.form.continueWith"),
        create: t("identity.form.create"),
        discriminator: t("identity.form.discriminator"),
        edit: t("identity.form.edit"),
        hidePassword: t("identity.form.hidePassword"),
        notYou: t("identity.form.notYou"),
        password: t("identity.form.password"),
        passwordPlaceholder: t("identity.form.passwordPlaceholder"),
        passwordRules: t("identity.form.passwordRules"),
        showPassword: t("identity.form.showPassword"),
        signIn: t("identity.form.signIn"),
        slugPlaceholder: t("identity.form.slugPlaceholder"),
      }}
      password={password}
      selection={selection}
      onResolveUsername={onResolvePubDress}
      {...actions}
      addressExtension={
        <PubDressUrlField
          state={url}
          busy={identity.busy}
          onSuffixChange={setSuffix}
        />
      }
    />
  );
}

export function IdentityFoundationView({
  browserProviderAuth,
  password,
  pubDressLabelDerivation,
  pubDressLabelDerivationPending = false,
  pubDressUrlResolution,
  selection,
  viewModel,
  onAvatarChoice,
  onSkipAvatarChoice,
  onCredentialAutofill,
  onForgetRemembered,
  onLogout,
  onPasswordChange,
  onResolvePubDress,
  onSelectionChange,
  onSubmit,
  passwordHandoff,
}: IdentityFoundationViewProps) {
  const { t } = useLocalization();
  const identity = viewModel.identity;
  const error =
    identity.kind === "unavailable"
      ? identity.detail
      : identity.kind === "form" &&
          identity.status.kind === "service-unavailable"
        ? identity.status.detail
        : identity.kind === "avatar-choice"
          ? identity.choice.error
          : "error" in identity
            ? identity.error
            : undefined;
  useSystemErrorNotices(
    error === undefined
      ? []
      : [
          {
            id: `identity:${identity.kind}:${error}`,
            kind: "error",
            title: t("system.ping.error"),
            description: translateCopy(t, error),
          },
        ],
  );
  return (
    <AppChrome
      copy={{
        skip: t("chrome.skip"),
        home: t("chrome.home"),
        currentHost: t("chrome.currentHost"),
      }}
      hostLabel={translateFirst(t, viewModel.hostLabel, HOST_LABEL_KEYS)}
      safeArea={viewModel.safeArea}
      footer={
        <>
          <span>0x1 · {t("identity.stage")}</span>
          <span>© 2026 aiaiaiai · aiaiaiai.org</span>
        </>
      }
    >
      <div className="foundation-layout">
        <section className="identity-panel" aria-labelledby="foundation-title">
          <div className="identity-copy">
            <p className="eyebrow">{t("identity.eyebrow")}</p>
            <h1 id="foundation-title">{heading(viewModel.identity, t)}</h1>
            <p className="foundation-lede">{lede(viewModel.identity, t)}</p>
          </div>

          <div className="identity-surface">
            {viewModel.showProviderRow ? (
              <>
                <ProviderRow auth={browserProviderAuth} />
                <div className="identity-divider" aria-hidden="true">
                  <span>{t("identity.or")}</span>
                </div>
              </>
            ) : null}
            {viewModel.identity.kind === "provider-password" &&
            passwordHandoff !== undefined ? (
              <ProviderPasswordHandoff
                pubDress={viewModel.identity.pubDress}
                onHandoff={passwordHandoff.open}
                onReturn={passwordHandoff.returned}
              />
            ) : viewModel.identity.kind === "provider-password" ? (
              <ProviderPasswordForm
                key={viewModel.identity.pubDress}
                pubDress={viewModel.identity.pubDress}
                password={password}
                busy={viewModel.identity.busy}
                {...(viewModel.identity.error === undefined
                  ? {}
                  : { error: viewModel.identity.error })}
                onPasswordChange={onPasswordChange}
                onSubmit={onSubmit}
              />
            ) : viewModel.identity.kind === "form" ? (
              <IdentityForm
                identity={viewModel.identity}
                password={password}
                pubDressLabelDerivation={pubDressLabelDerivation}
                pubDressLabelDerivationPending={pubDressLabelDerivationPending}
                pubDressUrlResolution={pubDressUrlResolution}
                selection={selection}
                onCredentialAutofill={onCredentialAutofill}
                onForgetRemembered={onForgetRemembered}
                onPasswordChange={onPasswordChange}
                onResolvePubDress={onResolvePubDress}
                onSelectionChange={onSelectionChange}
                onSubmit={onSubmit}
              />
            ) : viewModel.identity.kind === "avatar-choice" ? (
              <AvatarChoiceView
                state={viewModel.identity}
                onChoose={(model) => onAvatarChoice?.(model)}
                onSkip={() => onSkipAvatarChoice?.()}
              />
            ) : viewModel.identity.kind === "authenticated" ? (
              <section className="authenticated-surface" aria-live="polite">
                <span className="surface-kicker">
                  {t("identity.authenticated")}
                </span>
                <strong>{viewModel.identity.pubDress}</strong>
                {browserProviderAuth?.pendingProvider !== undefined ? (
                  <button
                    type="button"
                    onClick={browserProviderAuth.onChooseExistingIdentity}
                  >
                    {t("identity.provider.connectExisting").replaceAll(
                      "{pubDress}",
                      viewModel.identity.pubDress,
                    )}
                  </button>
                ) : null}
                {viewModel.identity.native ? (
                  <button type="button" onClick={onLogout}>
                    {t("header.signOut")}
                  </button>
                ) : null}
              </section>
            ) : (
              <section className="identity-message" aria-live="polite">
                <span className="message-orbit" aria-hidden="true" />
                <p>{translateCopy(t, viewModel.identity.detail)}</p>
              </section>
            )}
          </div>

          <RuntimeStatus
            tone={viewModel.runtime.tone}
            label={translateFirst(
              t,
              viewModel.runtime.label,
              RUNTIME_LABEL_KEYS,
            )}
            detail={translateCopy(t, viewModel.runtime.detail)}
          />
        </section>
      </div>
    </AppChrome>
  );
}
