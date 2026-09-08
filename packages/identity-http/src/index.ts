// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  formatPubDress,
  type BrowserIdentityProvider,
  type BrowserProviderContextResult,
  type BrowserProviderLinkResult,
  type IdentityAccessPort,
  type IdentityProjection,
  type NativeAuthenticationResult,
  type NativeIdentityContextResult,
  type NativeMutationResult,
  type NativeRecoveryResult,
  type NativeRegistrationResult,
  type ProviderIdentityLookupResult,
  type ProviderRegistrationResult,
  type ProviderPasswordHost,
  type PubDressRenameResult,
  type ProviderPasswordResult,
  type PubDressLabelResolutionResult,
  type PubDressResolutionResult,
  type PubDressSelection,
} from "@nilx-one/application";

interface IdentityHttpAdapterOptions {
  fetch?: typeof globalThis.fetch;
  getAuthorization(): string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIdentity(value: unknown): IdentityProjection | undefined {
  if (!isRecord(value) || typeof value.pub_dress !== "string") {
    return undefined;
  }
  return {
    pubDress: value.pub_dress,
    ...(typeof value.avaia_pub_dress === "string"
      ? { avaiaPubDress: value.avaia_pub_dress }
      : {}),
    ...(typeof value.pub_dress_url === "string"
      ? { pubDressUrl: value.pub_dress_url }
      : {}),
  };
}

function parseErrorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return typeof value.error.code === "string" ? value.error.code : undefined;
}

function isBrowserProvider(value: unknown): value is BrowserIdentityProvider {
  return value === "telegram" || value === "discord";
}

class IdentityHttpAdapter implements IdentityAccessPort {
  private readonly fetch: typeof globalThis.fetch;

  public constructor(private readonly options: IdentityHttpAdapterOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async resolvePubDress(
    selection: PubDressSelection,
  ): Promise<PubDressResolutionResult> {
    const response = await this.fetch("/api/v1/identity/resolve", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pub_dress: formatPubDress(selection) }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      typeof body.pub_dress === "string" &&
      (body.state === "available" || body.state === "registered")
    ) {
      return { kind: body.state, pubDress: body.pub_dress };
    }
    switch (parseErrorCode(body)) {
      case "invalid_pub_dress_length":
        return { kind: "rejected", reason: "invalid-length" };
      case "invalid_pub_dress_discriminator":
      case "invalid_pub_dress_character":
      case "invalid_pub_dress_prefix":
        return { kind: "rejected", reason: "invalid-character" };
      case "rate_limited":
        return { kind: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async resolvePubDressLabel(
    label: string,
  ): Promise<PubDressLabelResolutionResult> {
    const response = await this.fetch("/api/v1/identity/url/resolve", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      typeof body.label === "string" &&
      (body.state === "available" || body.state === "registered")
    ) {
      return { kind: body.state, label: body.label };
    }
    switch (parseErrorCode(body)) {
      case "invalid_pub_dress_label":
        return { kind: "rejected", reason: "invalid-label" };
      case "rate_limited":
        return { kind: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async readNativeContext(): Promise<NativeIdentityContextResult> {
    const response = await this.fetch("/api/v1/auth/native/context", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body)) {
      return { kind: "service-unavailable" };
    }
    if (body.state === "anonymous") {
      return { kind: "anonymous" };
    }
    if (
      body.state === "remembered" &&
      typeof body.remembered_pub_dress === "string"
    ) {
      return { kind: "remembered", pubDress: body.remembered_pub_dress };
    }
    if (body.state === "authenticated") {
      const identity = parseIdentity(body.identity);
      if (identity !== undefined) {
        return { kind: "authenticated", identity };
      }
    }
    return { kind: "service-unavailable" };
  }

  public async registerNative(
    pubDress: string,
    password: string,
    idempotencyKey: string,
  ): Promise<NativeRegistrationResult> {
    const response = await this.fetch("/api/v1/auth/native/registration", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ pub_dress: pubDress, password }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body)) {
      const identity = parseIdentity(body.identity);
      if (
        body.state === "recovery_key_required" &&
        identity !== undefined &&
        typeof body.recovery_key === "string" &&
        typeof body.challenge === "string"
      ) {
        return {
          kind: "recovery-key-required",
          identity,
          recoveryKey: body.recovery_key,
          challenge: body.challenge,
        };
      }
    }
    switch (parseErrorCode(body)) {
      case "invalid_password_length":
        return { kind: "rejected", reason: "invalid-password-length" };
      case "compromised_password":
        return { kind: "rejected", reason: "compromised-password" };
      case "pub_dress_unavailable":
        return { kind: "rejected", reason: "unavailable" };
      case "native_registration_already_committed":
        return { kind: "rejected", reason: "already-committed" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async authenticateNative(
    pubDress: string,
    password: string,
  ): Promise<NativeAuthenticationResult> {
    return this.nativeAuthenticationRequest("/api/v1/auth/native/session", {
      pub_dress: pubDress,
      password,
    });
  }

  public async acknowledgeRecoveryKey(
    challenge: string,
  ): Promise<NativeAuthenticationResult> {
    return this.nativeAuthenticationRequest(
      "/api/v1/auth/native/recovery/acknowledgement",
      { challenge },
    );
  }

  public async forgetRememberedBond(): Promise<NativeMutationResult> {
    return this.nativeMutation("/api/v1/auth/native/remembered/forget");
  }

  public async logoutNative(): Promise<NativeMutationResult> {
    return this.nativeMutation("/api/v1/auth/native/logout");
  }

  public async recoverNative(
    pubDress: string,
    recoveryKey: string,
    newPassword: string,
  ): Promise<NativeRecoveryResult> {
    const response = await this.fetch("/api/v1/auth/native/recovery", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({
        pub_dress: pubDress,
        recovery_key: recoveryKey,
        new_password: newPassword,
      }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body)) {
      const identity = parseIdentity(body.identity);
      if (
        body.state === "authenticated" &&
        identity !== undefined &&
        typeof body.replacement_recovery_key === "string"
      ) {
        return {
          kind: "recovered",
          identity,
          replacementRecoveryKey: body.replacement_recovery_key,
        };
      }
    }
    switch (parseErrorCode(body)) {
      case "invalid_recovery_material":
        return { kind: "rejected", reason: "invalid-recovery-material" };
      case "invalid_password_length":
        return { kind: "rejected", reason: "invalid-password-length" };
      case "compromised_password":
        return { kind: "rejected", reason: "compromised-password" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async readProviderIdentity(): Promise<ProviderIdentityLookupResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return { kind: "authentication-required" };
    }
    const response = await this.fetch("/api/v1/identity", {
      cache: "no-store",
      headers: { authorization },
    });
    if (response.status === 404) {
      return { kind: "not-registered" };
    }
    if (response.status === 401) {
      return { kind: "authentication-required" };
    }
    if (!response.ok) {
      return { kind: "service-unavailable" };
    }
    const body: unknown = await response.json();
    const identity = parseIdentity(body);
    return identity === undefined
      ? { kind: "service-unavailable" }
      : {
          kind: "registered",
          identity,
          ...(isRecord(body) && typeof body.password_required === "boolean"
            ? { passwordRequired: body.password_required }
            : {}),
        };
  }

  public async setProviderPassword(
    host: ProviderPasswordHost,
    password: string,
  ): Promise<ProviderPasswordResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return { kind: "rejected", reason: "authentication-required" };
    }
    // One operation per verified provider: the service resolves the binding
    // from the credential this adapter already carries, and the path only says
    // which provider proof is being presented.
    const response = await this.fetch(`/api/v1/auth/${host}/password`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ password }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body)) {
      const identity = parseIdentity(body.identity);
      if (
        body.state === "recovery_key_required" &&
        identity !== undefined &&
        typeof body.recovery_key === "string" &&
        typeof body.challenge === "string"
      ) {
        return {
          kind: "recovery-key-required",
          identity,
          recoveryKey: body.recovery_key,
          challenge: body.challenge,
        };
      }
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "password_already_set":
        return { kind: "rejected", reason: "already-set" };
      case "invalid_password_length":
        return { kind: "rejected", reason: "invalid-password-length" };
      case "compromised_password":
        return { kind: "rejected", reason: "compromised-password" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async renameAvaiaSlug(slug: string): Promise<PubDressRenameResult> {
    return this.renameAddress("/api/v1/identity/avaia/pub_dress", slug);
  }

  public async renamePubDressSlug(slug: string): Promise<PubDressRenameResult> {
    return this.renameAddress("/api/v1/identity/pub_dress", slug);
  }

  // Both addresses are named the same way: one slug, presented by whatever
  // proof this host holds, answered with the identity the service now keeps.
  private async renameAddress(
    path: string,
    slug: string,
  ): Promise<PubDressRenameResult> {
    // A browser Bond proves itself with its session cookie and a provider host
    // with its host proof, so the transport carries whichever it has.
    const authorization = this.authorization();
    const response = await this.fetch(path, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ slug }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const identity = parseIdentity(body);
      if (identity !== undefined) {
        return { kind: "renamed", identity };
      }
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "pub_dress_unavailable":
        return { kind: "rejected", reason: "unavailable" };
      case "avaia_unavailable":
        return { kind: "rejected", reason: "avaia-unavailable" };
      case "invalid_pub_dress_length":
      case "invalid_avaia_length":
        return { kind: "rejected", reason: "invalid-length" };
      case "invalid_avaia_suffix":
        return { kind: "rejected", reason: "invalid-avaia-suffix" };
      case "invalid_pub_dress_character":
      case "invalid_pub_dress_discriminator":
      case "invalid_pub_dress_prefix":
      case "invalid_avaia_character":
      case "invalid_avaia_discriminator":
        return { kind: "rejected", reason: "invalid-character" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async registerProvider(
    selection: PubDressSelection,
  ): Promise<ProviderRegistrationResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return { kind: "rejected", reason: "authentication-required" };
    }
    const response = await this.fetch("/api/v1/identity/registration", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(selection),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body)) {
      const identity = parseIdentity(body.identity);
      if (
        identity !== undefined &&
        (body.outcome === "registered" || body.outcome === "already_registered")
      ) {
        return {
          kind: "registered",
          ...(typeof body.password_required === "boolean"
            ? { passwordRequired: body.password_required }
            : {}),
          outcome:
            body.outcome === "registered" ? "created" : "already-registered",
          identity,
        };
      }
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
      case "telegram_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "invalid_pub_dress_length":
        return { kind: "rejected", reason: "invalid-length" };
      case "invalid_pub_dress_discriminator":
      case "invalid_pub_dress_character":
      case "invalid_pub_dress_prefix":
        return { kind: "rejected", reason: "invalid-character" };
      case "pub_dress_unavailable":
        return { kind: "rejected", reason: "unavailable" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public browserProviderAuthorizationUrl(
    provider: BrowserIdentityProvider,
    intent?: "connect",
  ): string {
    const query = new URLSearchParams({ provider });
    if (intent === "connect") query.set("intent", intent);
    return `/auth?${query.toString()}`;
  }

  public async readBrowserProviderContext(): Promise<BrowserProviderContextResult> {
    const response = await this.fetch(
      "/api/v1/auth/browser/provider/context",
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body) || !isRecord(body.available)) {
      return { kind: "service-unavailable" };
    }
    if (
      typeof body.available.telegram !== "boolean" ||
      typeof body.available.discord !== "boolean"
    ) {
      return { kind: "service-unavailable" };
    }
    const available = {
      telegram: body.available.telegram,
      discord: body.available.discord,
    };
    if (body.state === "none") {
      return { kind: "none", available };
    }
    if (body.state === "pending" && isBrowserProvider(body.provider)) {
      return { kind: "pending", provider: body.provider, available };
    }
    return { kind: "service-unavailable" };
  }

  public async linkBrowserProvider(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult> {
    const response = await this.fetch("/api/v1/auth/browser/provider/link", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ pub_dress: expectedPubDress }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      body.state === "linked" &&
      isBrowserProvider(body.provider)
    ) {
      return { kind: "linked", provider: body.provider };
    }
    switch (parseErrorCode(body)) {
      case "native_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "provider_proof_required":
        return { kind: "rejected", reason: "provider-proof-required" };
      case "provider_already_linked":
        return { kind: "rejected", reason: "provider-already-linked" };
      case "native_session_changed":
        return { kind: "rejected", reason: "session-changed" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  private async nativeAuthenticationRequest(
    path: string,
    body: Record<string, string>,
  ): Promise<NativeAuthenticationResult> {
    const response = await this.fetch(path, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(payload)) {
      const identity = parseIdentity(payload.identity);
      if (payload.state === "authenticated" && identity !== undefined) {
        return { kind: "authenticated", identity };
      }
    }
    switch (parseErrorCode(payload)) {
      case "invalid_native_credentials":
        return { kind: "rejected", reason: "invalid-credentials" };
      case "invalid_registration_challenge":
        return { kind: "rejected", reason: "invalid-challenge" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  private async nativeMutation(path: string): Promise<NativeMutationResult> {
    const response = await this.fetch(path, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-0x1-csrf": "1" },
    });
    if (response.ok) {
      return { kind: "completed" };
    }
    return response.status === 403
      ? { kind: "rejected" }
      : { kind: "service-unavailable" };
  }

  private authorization(): string | undefined {
    const authorization = this.options.getAuthorization();
    return authorization === undefined || authorization.length === 0
      ? undefined
      : authorization;
  }
}

export function createIdentityHttpAdapter(
  options: IdentityHttpAdapterOptions,
): IdentityAccessPort {
  return new IdentityHttpAdapter(options);
}
