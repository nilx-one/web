// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  isAvatarModel,
  formatPubDress,
  isBondProviderType,
  type BondProviderType,
  type BrowserIdentityProvider,
  type BrowserProviderConnectionsResult,
  type BrowserProviderContextResult,
  type BrowserProviderDisconnectResult,
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
  type ProviderSelfDisconnectResult,
  type TelegramProviderLinkResult,
  type AvaiaLocationPublishResult,
  type AvaiaProfileAccessPort,
  type AvaiaProfileProjection,
  type AvaiaProfileReadResult,
  type AvaiaProfileUpdateResult,
  type AvatarModel,
  type AvatarModelResult,
  type ProviderPasswordHost,
  type PubDressRenameResult,
  type ProviderPasswordResult,
  type PubDressLabelResolutionResult,
  type PubDressResolutionResult,
  type PubDressSelection,
  type ExperiencePublication,
  type AwardOutcome,
  type AwardResult,
  type ClaimedFindView,
  type ClaimsReadResult,
  type CommitAwardsResult,
  type CommittedAward,
  type CommittedAwardAccessPort,
  MAX_CLAIM_BUCKETS,
  type NearbySpeechAccessPort,
  type PubInfoAccessPort,
  type SpokenLineView,
  type PubInfoExperience,
  type PubInfoExperienceResult,
  type PubInfoRejection,
} from "@nilx-one/application";

export * from "./bond-location-control";

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
    ...(isAvatarModel(value.avatar_model)
      ? { avatarModel: value.avatar_model }
      : {}),
    ...(typeof value.pub_dress_url === "string"
      ? { pubDressUrl: value.pub_dress_url }
      : {}),
  };
}

/** Matches the E7 wire scale in `ox1_contracts::GEO_COORDINATE_E7_SCALE`. */
const GEO_COORDINATE_E7_SCALE = 10_000_000;

function parseAvaiaCoordinate(
  value: unknown,
): { longitude: number; latitude: number } | undefined {
  if (
    !isRecord(value) ||
    typeof value.longitude_e7 !== "string" ||
    typeof value.latitude_e7 !== "string"
  ) {
    return undefined;
  }
  const longitudeE7 = Number(value.longitude_e7);
  const latitudeE7 = Number(value.latitude_e7);
  if (!Number.isFinite(longitudeE7) || !Number.isFinite(latitudeE7)) {
    return undefined;
  }
  return {
    longitude: longitudeE7 / GEO_COORDINATE_E7_SCALE,
    latitude: latitudeE7 / GEO_COORDINATE_E7_SCALE,
  };
}

function parseAvaiaLocation(
  value: unknown,
): AvaiaProfileProjection["location"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const coordinate = parseAvaiaCoordinate(value.coordinate);
  return coordinate === undefined ? undefined : { coordinate };
}

/**
 * The stored Avaia, carried exactly as the service answered. `model_ref` is
 * reserved by the contract and is not projected: no model a device may or may
 * not run is identity truth about the Avaia.
 */
function parseAvaiaProfile(value: unknown): AvaiaProfileProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.pub_dress !== "string" ||
    typeof value.owner_pub_dress !== "string" ||
    (value.configuration_state !== "unconfigured" &&
      value.configuration_state !== "configured")
  ) {
    return undefined;
  }
  const location = parseAvaiaLocation(value.location);
  return {
    pubDress: value.pub_dress,
    ownerPubDress: value.owner_pub_dress,
    configurationState: value.configuration_state,
    ...(location === undefined ? {} : { location }),
  };
}

function parseErrorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return typeof value.error.code === "string" ? value.error.code : undefined;
}

const SPOKEN_LINE_ID = /^line_[0-9a-f]{64}$/;
const CANONICAL_SECONDS = /^(0|[1-9][0-9]{0,14})$/;
const MAX_SPOKEN_LINES = 50;

/**
 * Reads the wire shape of `GET /api/v1/speech/nearby`. Anything that is not
 * exactly a list of well-formed lines is dropped whole: a half-understood
 * answer is not adopted.
 */
function parseNearbySpeech(
  body: unknown,
): readonly SpokenLineView[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.lines)) return undefined;
  if (body.lines.length > MAX_SPOKEN_LINES) return undefined;
  const lines: SpokenLineView[] = [];
  for (const line of body.lines as readonly unknown[]) {
    if (
      !isRecord(line) ||
      typeof line.id !== "string" ||
      !SPOKEN_LINE_ID.test(line.id) ||
      typeof line.speaker !== "string" ||
      line.speaker.length === 0 ||
      typeof line.text !== "string" ||
      line.text.length === 0 ||
      typeof line.spoken_at !== "string" ||
      !CANONICAL_SECONDS.test(line.spoken_at)
    ) {
      return undefined;
    }
    lines.push({
      id: line.id,
      speaker: line.speaker,
      text: line.text,
      spokenAt: Number(line.spoken_at),
    });
  }
  return lines;
}

function isBrowserProvider(value: unknown): value is BrowserIdentityProvider {
  return value === "telegram" || value === "discord" || value === "github";
}

class IdentityHttpAdapter
  implements
    IdentityAccessPort,
    AvaiaProfileAccessPort,
    PubInfoAccessPort,
    CommittedAwardAccessPort,
    NearbySpeechAccessPort
{
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

  public async linkTelegramProvider(
    expectedPubDress: string,
  ): Promise<TelegramProviderLinkResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return { kind: "rejected", reason: "authentication-required" };
    }
    const response = await this.fetch("/api/v1/auth/telegram/link", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ pub_dress: expectedPubDress }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body) && body.state === "linked") {
      return { kind: "linked" };
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "provider_already_linked":
        return { kind: "rejected", reason: "provider-already-linked" };
      case "provider_type_already_linked":
        return { kind: "rejected", reason: "provider-type-already-linked" };
      case "session_changed":
        return { kind: "rejected", reason: "session-changed" };
      default:
        return { kind: "service-unavailable" };
    }
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

  public async chooseAvatarModel(
    model: AvatarModel,
  ): Promise<AvatarModelResult> {
    const authorization = this.authorization();
    const response = await this.fetch("/api/v1/identity/avatar", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ model }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const identity = parseIdentity(body);
      if (identity !== undefined) {
        return { kind: "chosen", identity };
      }
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "unknown_avatar_model":
        return { kind: "rejected", reason: "unknown-model" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  // Contract 8 keeps the Avaia the owner configured. The address travels whole
  // in both directions: the service is the authority on what a valid one is,
  // and this client never assembles one out of parts it assumed.
  public async readAvaiaProfile(): Promise<AvaiaProfileReadResult> {
    const authorization = this.authorization();
    const response = await this.fetch("/api/v1/identity/avaia", {
      cache: "no-store",
      credentials: "same-origin",
      headers: authorization === undefined ? {} : { authorization },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const profile = parseAvaiaProfile(body);
      if (profile !== undefined) {
        return { kind: "available", profile };
      }
    }
    return parseErrorCode(body) === "provider_authentication_required"
      ? { kind: "authentication-required" }
      : { kind: "service-unavailable" };
  }

  public async updateAvaiaProfile(
    pubDress: string,
  ): Promise<AvaiaProfileUpdateResult> {
    const authorization = this.authorization();
    const response = await this.fetch("/api/v1/identity/avaia", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ pub_dress: pubDress }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const profile = parseAvaiaProfile(body);
      if (profile !== undefined) {
        return { kind: "updated", profile };
      }
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "avaia_owner_discriminator_mismatch":
        return { kind: "rejected", reason: "owner-discriminator-mismatch" };
      case "avaia_unavailable":
        return { kind: "rejected", reason: "unavailable" };
      case "invalid_avaia_length":
      case "invalid_avaia_character":
      case "invalid_avaia_discriminator":
      case "invalid_avaia_suffix":
        return { kind: "rejected", reason: "invalid-address" };
      case "rate_limited":
        return { kind: "rejected", reason: "rate-limited" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async publishAvaiaLocation(position: {
    longitude: number;
    latitude: number;
  }): Promise<AvaiaLocationPublishResult> {
    const authorization = this.authorization();
    const response = await this.fetch("/api/v1/identity/avaia/location", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({
        longitude: position.longitude,
        latitude: position.latitude,
      }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const profile = parseAvaiaProfile(body);
      if (profile !== undefined) {
        return { kind: "published", profile };
      }
    }
    switch (parseErrorCode(body)) {
      case "provider_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "invalid_avaia_location":
        return { kind: "rejected", reason: "invalid-location" };
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
    const response = await this.fetch("/api/v1/auth/browser/provider/context", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body) || !isRecord(body.available)) {
      return { kind: "service-unavailable" };
    }
    if (
      typeof body.available.telegram !== "boolean" ||
      typeof body.available.discord !== "boolean" ||
      typeof body.available.github !== "boolean"
    ) {
      return { kind: "service-unavailable" };
    }
    const available = {
      telegram: body.available.telegram,
      discord: body.available.discord,
      github: body.available.github,
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
      case "provider_type_already_linked":
        return { kind: "rejected", reason: "provider-type-already-linked" };
      case "native_session_changed":
        return { kind: "rejected", reason: "session-changed" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async readBrowserProviderConnections(): Promise<BrowserProviderConnectionsResult> {
    const response = await this.fetch(
      "/api/v1/auth/browser/provider/connections",
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      body.state === "available" &&
      Array.isArray(body.providers) &&
      body.providers.every(isBondProviderType)
    ) {
      return {
        kind: "available",
        connections: body.providers.map((provider) => ({ provider })),
      };
    }
    return parseErrorCode(body) === "native_authentication_required"
      ? { kind: "authentication-required" }
      : { kind: "service-unavailable" };
  }

  public async disconnectBrowserProvider(
    provider: BondProviderType,
  ): Promise<BrowserProviderDisconnectResult> {
    const response = await this.fetch(
      "/api/v1/auth/browser/provider/disconnect",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ provider }),
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (
      response.ok &&
      isRecord(body) &&
      body.state === "disconnected" &&
      typeof body.provider === "string" &&
      isBondProviderType(body.provider)
    ) {
      return { kind: "disconnected", provider: body.provider };
    }
    switch (parseErrorCode(body)) {
      case "native_authentication_required":
        return { kind: "rejected", reason: "authentication-required" };
      case "provider_not_connected":
        return { kind: "rejected", reason: "not-connected" };
      default:
        return { kind: "service-unavailable" };
    }
  }

  public async disconnectSelfProvider(): Promise<ProviderSelfDisconnectResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return { kind: "rejected", reason: "authentication-required" };
    }
    const response = await this.fetch("/api/v1/auth/telegram/disconnect", {
      method: "POST",
      cache: "no-store",
      headers: { authorization },
    });
    if (response.ok) {
      return { kind: "disconnected" };
    }
    if (response.status === 401) {
      return { kind: "rejected", reason: "authentication-required" };
    }
    if (response.status === 404) {
      return { kind: "rejected", reason: "not-connected" };
    }
    const body: unknown = await response.json().catch(() => undefined);
    return parseErrorCode(body) === "sole_access_path"
      ? { kind: "rejected", reason: "sole-access-path" }
      : { kind: "service-unavailable" };
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

  public async readPubInfo(): Promise<PubInfoExperienceResult> {
    const authorization = this.authorization();
    const response = await this.fetch("/api/v1/identity/pub-info", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
      },
    });
    return parsePubInfoResult(
      response,
      await response.json().catch(() => undefined),
    );
  }

  public async readNearbySpeech(): Promise<
    readonly SpokenLineView[] | undefined
  > {
    const authorization = this.authorization();
    try {
      const response = await this.fetch("/api/v1/speech/nearby", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          ...(authorization === undefined ? {} : { authorization }),
        },
      });
      if (!response.ok) return undefined;
      return parseNearbySpeech(await response.json().catch(() => undefined));
    } catch {
      return undefined;
    }
  }

  public async publishExperience(
    publication: ExperiencePublication,
  ): Promise<PubInfoExperienceResult> {
    const authorization = this.authorization();
    const response = await this.fetch("/api/v1/identity/pub-info", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({
        ...(publication.carry === undefined
          ? {}
          : {
              carry: {
                bond_xp: publication.carry.bondXp,
                avaia_xp: publication.carry.avaiaXp,
              },
            }),
        events: publication.events.map((event) => ({
          id: event.id,
          earner: event.earner,
          amount: event.amount,
        })),
      }),
    });
    return parsePubInfoResult(
      response,
      await response.json().catch(() => undefined),
    );
  }

  public async commitAwards(
    awards: readonly CommittedAward[],
  ): Promise<CommitAwardsResult> {
    const authorization = this.authorization();
    let response: Response;
    try {
      response = await this.fetch("/api/v1/identity/pub-info/awards", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          ...(authorization === undefined ? {} : { authorization }),
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({
          awards: awards.map((award) => ({
            id: award.id,
            parent: award.parent,
            chain: award.chain,
            kind: award.kind,
            earner: award.earner,
            ...(award.tier === undefined ? {} : { tier: award.tier }),
            ...(award.artifactId === undefined
              ? {}
              : { artifact_id: award.artifactId }),
            ...(award.recipe === undefined ? {} : { recipe: award.recipe }),
          })),
        }),
      });
    } catch {
      return { kind: "service-unavailable" };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const experience = parsePubInfoExperience(body);
      const results = parseAwardResults(body, awards);
      if (experience !== undefined && results !== undefined) {
        return { kind: "committed", experience, results };
      }
      return { kind: "service-unavailable" };
    }
    return pubInfoRefusal(body);
  }

  public async readClaims(
    buckets: readonly string[],
  ): Promise<ClaimsReadResult> {
    const asked = [...new Set(buckets)].sort();
    // The service refuses these too; asking would only spend the limit.
    if (
      asked.length === 0 ||
      asked.length > MAX_CLAIM_BUCKETS ||
      !asked.every((bucket) => CLAIM_BUCKET.test(bucket))
    ) {
      return { kind: "rejected", reason: "invalid" };
    }
    const authorization = this.authorization();
    let response: Response;
    try {
      response = await this.fetch(
        `/api/v1/identity/finds/claims?buckets=${asked.join(",")}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            ...(authorization === undefined ? {} : { authorization }),
          },
        },
      );
    } catch {
      return { kind: "service-unavailable" };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const read = parseClaims(body, asked);
      return read === undefined
        ? { kind: "service-unavailable" }
        : { kind: "read", ...read };
    }
    return pubInfoRefusal(body);
  }

  private authorization(): string | undefined {
    const authorization = this.options.getAuthorization();
    return authorization === undefined || authorization.length === 0
      ? undefined
      : authorization;
  }
}

function parsePubInfoExperience(value: unknown): PubInfoExperience | undefined {
  if (!isRecord(value) || !isRecord(value.experience)) return undefined;
  // The service writes this. A missing or different label is not a total
  // this client will treat as the shared standing.
  if (value.experience.authority !== "client") return undefined;
  const bondXp = value.experience.bond_xp;
  const avaiaXp = value.experience.avaia_xp;
  if (!isExperienceTotal(bondXp) || !isExperienceTotal(avaiaXp))
    return undefined;
  return { bondXp, avaiaXp };
}

function isExperienceTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const CLAIM_BUCKET = /^[0-9a-f]{2}$/;
const ARTIFACT_SHA = /^[0-9a-f]{64}$/;
const COMMITMENT = /^xp:[A-Za-z0-9_-]{43}$/;

/**
 * One outcome per award sent, in the order sent and under the same ids. An
 * answer that does not line up with the request is not adopted.
 */
function parseAwardResults(
  body: unknown,
  awards: readonly CommittedAward[],
): AwardResult[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.results)) return undefined;
  if (body.results.length !== awards.length) return undefined;
  const results: AwardResult[] = [];
  for (const [index, entry] of body.results.entries()) {
    const id = awards[index]?.id;
    if (!isRecord(entry) || id === undefined || entry.id !== id)
      return undefined;
    const outcome = parseAwardOutcome(entry);
    if (outcome === undefined) return undefined;
    results.push({ id, outcome });
  }
  return results;
}

function parseAwardOutcome(
  entry: Record<string, unknown>,
): AwardOutcome | undefined {
  switch (entry.outcome) {
    case "accepted":
      return { kind: "accepted" };
    case "duplicate":
      return { kind: "duplicate" };
    case "behind": {
      const head = entry.head ?? null;
      if (head !== null && !(typeof head === "string" && COMMITMENT.test(head)))
        return undefined;
      return { kind: "behind", head };
    }
    case "capped":
      return { kind: "capped" };
    case "already_yours":
      return { kind: "already-yours" };
    case "taken":
      return { kind: "taken" };
    case "too_many_chains":
      return { kind: "too-many-chains" };
    default:
      return undefined;
  }
}

/** The claims answered, each in a bucket that was asked for. */
function parseClaims(
  body: unknown,
  asked: readonly string[],
): { epoch: number; claims: ClaimedFindView[] } | undefined {
  if (!isRecord(body) || !Array.isArray(body.claims)) return undefined;
  const epoch = body.epoch;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0)
    return undefined;
  const buckets = new Set(asked);
  const claims: ClaimedFindView[] = [];
  for (const entry of body.claims) {
    if (
      !isRecord(entry) ||
      typeof entry.sha !== "string" ||
      !ARTIFACT_SHA.test(entry.sha) ||
      !buckets.has(entry.sha.slice(0, 2)) ||
      typeof entry.yours !== "boolean"
    ) {
      return undefined;
    }
    claims.push({ sha: entry.sha, yours: entry.yours });
  }
  return { epoch, claims };
}

function pubInfoRefusal(
  body: unknown,
):
  | { kind: "rejected"; reason: PubInfoRejection }
  | { kind: "service-unavailable" } {
  switch (parseErrorCode(body)) {
    case "provider_authentication_required":
      return { kind: "rejected", reason: "authentication-required" };
    case "session_inactive":
      return { kind: "rejected", reason: "inactive" };
    case "invalid_pub_info":
    case "invalid_awards":
    case "invalid_buckets":
      return { kind: "rejected", reason: "invalid" };
    case "rate_limited":
      return { kind: "rejected", reason: "rate-limited" };
    default:
      return { kind: "service-unavailable" };
  }
}

function parsePubInfoResult(
  response: Response,
  body: unknown,
): PubInfoExperienceResult {
  if (response.ok) {
    const experience = parsePubInfoExperience(body);
    if (experience !== undefined) return { kind: "published", experience };
  }
  return pubInfoRefusal(body);
}

export function createIdentityHttpAdapter(
  options: IdentityHttpAdapterOptions,
): IdentityAccessPort &
  AvaiaProfileAccessPort &
  PubInfoAccessPort &
  CommittedAwardAccessPort &
  NearbySpeechAccessPort {
  return new IdentityHttpAdapter(options);
}
