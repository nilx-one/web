// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  IdentityLookupResult,
  IdentityProjection,
  IdentityRegistrationPort,
  IdentityRegistrationResult,
  PubDressSelection,
} from "@nilx-one/application";

interface IdentityHttpAdapterOptions {
  fetch?: typeof globalThis.fetch;
  getTelegramInitData(): string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIdentity(value: unknown): IdentityProjection | undefined {
  if (!isRecord(value) || typeof value.pub_dress !== "string") {
    return undefined;
  }
  return { pubDress: value.pub_dress };
}

function parseErrorCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return typeof value.error.code === "string" ? value.error.code : undefined;
}

class IdentityHttpAdapter implements IdentityRegistrationPort {
  private readonly fetch: typeof globalThis.fetch;

  public constructor(private readonly options: IdentityHttpAdapterOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async read(): Promise<IdentityLookupResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return { kind: "authentication-required" };
    }
    const response = await this.fetch("/api/v1/identity", {
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

    const identity = parseIdentity(await response.json());
    return identity === undefined
      ? { kind: "service-unavailable" }
      : { kind: "registered", identity };
  }

  public async register(
    selection: PubDressSelection,
  ): Promise<IdentityRegistrationResult> {
    const authorization = this.authorization();
    if (authorization === undefined) {
      return {
        kind: "rejected",
        reason: "authentication-required",
      };
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
      const outcome = body.outcome;
      if (
        identity !== undefined &&
        (outcome === "registered" || outcome === "already_registered")
      ) {
        return {
          kind: "registered",
          outcome: outcome === "registered" ? "created" : "already-registered",
          identity,
        };
      }
    }

    const errorCode = parseErrorCode(body);
    switch (errorCode) {
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

  private authorization(): string | undefined {
    const initData = this.options.getTelegramInitData();
    return initData === undefined || initData.length === 0
      ? undefined
      : `tma ${initData}`;
  }
}

export function createIdentityHttpAdapter(
  options: IdentityHttpAdapterOptions,
): IdentityRegistrationPort {
  return new IdentityHttpAdapter(options);
}
