// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The product-session half of aiaiaiai Identity Service sign-in.
 *
 * An AIS product session proves ownership of the returned 0x1 profile only.
 * Until Core's verified legacy Bond migration is complete, it does NOT
 * authorize a native Bond's wallet, Avaia, purchases or gameplay. Matching
 * pub_dress labels cannot link identities.
 *
 * This adapter deliberately never attaches Telegram initData or Discord
 * authorization: those provider credentials are not proof of Bond ownership.
 */
export interface AisProfile {
  readonly profileId: string;
  readonly pubDress?: string;
  readonly experience: {
    readonly authority: "client";
    readonly bondXp: number;
    readonly avaiaXp: number;
  };
}

export type AisConfiguration =
  | { readonly kind: "enabled"; readonly issuer: string }
  | { readonly kind: "disabled" | "unavailable" };

export type AisSessionReading =
  | { readonly kind: "profile-session"; readonly profile: AisProfile }
  | { readonly kind: "anonymous" | "unavailable" };

export type AisSessionSignOut =
  | { readonly kind: "signed-out" }
  | { readonly kind: "unavailable" };

export interface AisProductSessionPort {
  readConfiguration(): Promise<AisConfiguration>;
  /** Returns the local server route, not an untrusted OIDC redirect URI. */
  signInPath(returnPath?: string): string;
  readSession(): Promise<AisSessionReading>;
  signOut(): Promise<AisSessionSignOut>;
}

interface AisProductSessionOptions {
  /** The host's same-origin transport; Discord may supply its proxied fetch. */
  fetch?: typeof globalThis.fetch;
}

const AIS_CONFIG = "/api/v1/auth/aiaiaiai/config";
const AIS_START = "/api/v1/auth/aiaiaiai/start";
const AIS_SESSION = "/api/v1/product/session";
const AIS_SIGN_OUT = "/api/v1/product/session/sign-out";
const PROFILE_ID = /^[0-9a-f]{32}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeReturnPath(value: string | undefined): string {
  return value !== undefined &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    value.length <= 512
    ? value
    : "/";
}

function parseAisProfile(value: unknown): AisProfile | undefined {
  if (
    !record(value) ||
    typeof value.profile_id !== "string" ||
    !PROFILE_ID.test(value.profile_id)
  ) {
    return undefined;
  }
  const experience = value.experience;
  if (
    !record(experience) ||
    experience.authority !== "client" ||
    typeof experience.bond_xp !== "number" ||
    typeof experience.avaia_xp !== "number" ||
    !Number.isSafeInteger(experience.bond_xp) ||
    !Number.isSafeInteger(experience.avaia_xp) ||
    experience.bond_xp < 0 ||
    experience.avaia_xp < 0 ||
    (value.pub_dress !== null &&
      value.pub_dress !== undefined &&
      typeof value.pub_dress !== "string")
  ) {
    return undefined;
  }
  return {
    profileId: value.profile_id,
    ...(typeof value.pub_dress === "string"
      ? { pubDress: value.pub_dress }
      : {}),
    experience: {
      authority: "client",
      bondXp: experience.bond_xp,
      avaiaXp: experience.avaia_xp,
    },
  };
}

export function createAisProductSessionPort(
  options: AisProductSessionOptions = {},
): AisProductSessionPort {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    signInPath(returnPath) {
      return (
        AIS_START + "?return=" + encodeURIComponent(safeReturnPath(returnPath))
      );
    },

    async readConfiguration() {
      try {
        const response = await fetcher(AIS_CONFIG, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return { kind: "unavailable" };
        const body: unknown = await response.json();
        if (!record(body)) return { kind: "unavailable" };
        if (body.enabled === false) return { kind: "disabled" };
        if (
          body.enabled === true &&
          typeof body.issuer === "string" &&
          body.issuer.startsWith("https://") &&
          new URL(body.issuer).origin === body.issuer
        ) {
          return { kind: "enabled", issuer: body.issuer };
        }
      } catch {
        return { kind: "unavailable" };
      }
      return { kind: "unavailable" };
    },

    async readSession() {
      try {
        const response = await fetcher(AIS_SESSION, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) return { kind: "anonymous" };
        if (!response.ok) return { kind: "unavailable" };
        const body: unknown = await response.json();
        if (!record(body)) return { kind: "unavailable" };
        const profile = parseAisProfile(body.profile);
        return profile === undefined
          ? { kind: "unavailable" }
          : { kind: "profile-session", profile };
      } catch {
        return { kind: "unavailable" };
      }
    },

    async signOut() {
      try {
        const response = await fetcher(AIS_SIGN_OUT, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-0x1-csrf": "1" },
        });
        if (!response.ok) return { kind: "unavailable" };
        const body: unknown = await response.json();
        return record(body) && body.signed_out === true
          ? { kind: "signed-out" }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
