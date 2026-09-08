// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaProfileAccessPort,
  AvaiaProfileProjection,
  AvaiaProfileReadResult,
  AvaiaProfileUpdateResult,
  IdentityAccessPort,
} from "@nilx-one/application";

export interface AvaiaProfileHttpOptions {
  fetch?: typeof globalThis.fetch;
  getAuthorization(): string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProfile(value: unknown): AvaiaProfileProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.pub_dress !== "string" ||
    typeof value.owner_pub_dress !== "string" ||
    (value.configuration_state !== "unconfigured" &&
      value.configuration_state !== "configured") ||
    (value.model_ref !== null && typeof value.model_ref !== "string")
  ) {
    return undefined;
  }

  return {
    pubDress: value.pub_dress,
    ownerPubDress: value.owner_pub_dress,
    configurationState: value.configuration_state,
    modelRef: value.model_ref,
  };
}

function errorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  return typeof value.error.code === "string" ? value.error.code : undefined;
}

function authorizationHeaders(
  options: AvaiaProfileHttpOptions,
): Record<string, string> {
  const authorization = options.getAuthorization();
  return authorization === undefined || authorization.length === 0
    ? {}
    : { authorization };
}

export function withAvaiaProfileHttp(
  identity: IdentityAccessPort,
  options: AvaiaProfileHttpOptions,
): IdentityAccessPort & AvaiaProfileAccessPort {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function readAvaiaProfile(): Promise<AvaiaProfileReadResult> {
    const response = await fetch("/api/v1/identity/avaia", {
      cache: "no-store",
      credentials: "same-origin",
      headers: authorizationHeaders(options),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const profile = parseProfile(body);
      return profile === undefined
        ? { kind: "service-unavailable" }
        : { kind: "available", profile };
    }
    return response.status === 401
      ? { kind: "authentication-required" }
      : { kind: "service-unavailable" };
  }

  async function updateAvaiaProfile(
    pubDress: string,
  ): Promise<AvaiaProfileUpdateResult> {
    const response = await fetch("/api/v1/identity/avaia", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-0x1-csrf": "1",
        ...authorizationHeaders(options),
      },
      body: JSON.stringify({ pub_dress: pubDress }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const profile = parseProfile(body);
      return profile === undefined
        ? { kind: "service-unavailable" }
        : { kind: "updated", profile };
    }

    const code = errorCode(body);
    if (response.status === 401) {
      return { kind: "rejected", reason: "authentication-required" };
    }
    if (code === "avaia_owner_discriminator_mismatch") {
      return { kind: "rejected", reason: "owner-discriminator-mismatch" };
    }
    if (code === "avaia_unavailable" || response.status === 409) {
      return { kind: "rejected", reason: "unavailable" };
    }
    if (code === "rate_limited" || response.status === 429) {
      return { kind: "rejected", reason: "rate-limited" };
    }
    if (response.status === 422) {
      return { kind: "rejected", reason: "invalid-address" };
    }
    return { kind: "service-unavailable" };
  }

  return Object.assign(identity, { readAvaiaProfile, updateAvaiaProfile });
}
