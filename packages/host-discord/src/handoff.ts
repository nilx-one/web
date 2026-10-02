// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  SILENT_SOUND,
  UNSUPPORTED_GEOLOCATION,
  ZERO_SAFE_AREA,
  type GeolocationCapability,
  type HostChangeListener,
  type HostPort,
  type HostSnapshot,
  type SoundCapability,
} from "@nilx-one/host-contract";

/**
 * Asks the identity service to accept the Discord proof a hand-off left on the
 * product origin. The proof is an HttpOnly cookie; this value only opts a
 * request in, so the cookie never authenticates a request that did not ask.
 */
export const DISCORD_HANDOFF_AUTHORIZATION = "discord-handoff";

export interface DiscordHandoffEnvironment {
  matchMedia(query: string): MediaQueryList;
  open(url: string, target: string, features: string): Window | null;
  readonly geolocation?: GeolocationCapability;
  readonly sound?: SoundCapability;
}

function assertExternalUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
}

/**
 * Discord, reached on the product origin. The Activity sent the person here to
 * create a password their password manager files under this origin; the page
 * still acts for the Discord account that sent them, so it is a Discord host,
 * not the Web one, even though it runs in a browser.
 */
class DiscordHandoffHost implements HostPort {
  private readonly colorScheme: MediaQueryList;
  public readonly geolocation: GeolocationCapability;
  public readonly sound: SoundCapability;

  public constructor(private readonly environment: DiscordHandoffEnvironment) {
    this.colorScheme = environment.matchMedia("(prefers-color-scheme: dark)");
    this.geolocation = environment.geolocation ?? UNSUPPORTED_GEOLOCATION;
    this.sound = environment.sound ?? SILENT_SOUND;
  }

  public getSnapshot(): HostSnapshot {
    return {
      kind: "discord",
      available: true,
      theme: this.colorScheme.matches ? "dark" : "light",
      safeArea: ZERO_SAFE_AREA,
      authentication: {
        kind: "discord-oauth",
        authenticated: true,
        verification: "required",
      },
    };
  }

  public subscribe(listener: HostChangeListener): () => void {
    const handleChange = (): void => listener(this.getSnapshot());
    this.colorScheme.addEventListener("change", handleChange);
    return () => this.colorScheme.removeEventListener("change", handleChange);
  }

  public ready(): void {
    // The hand-off was confirmed before ProductApp mounts.
  }

  public openExternal(url: URL): void {
    assertExternalUrl(url);
    this.environment.open(url.href, "_blank", "noopener,noreferrer");
  }

  public impact(_style: "light" | "medium" | "heavy"): void {
    // A browser page has no host haptic primitive worth promising here.
  }
}

export function createDiscordHandoffHost(
  environment: DiscordHandoffEnvironment = window,
): HostPort {
  return new DiscordHandoffHost(environment);
}

/** Whether this origin holds a live Discord hand-off for the person. */
export async function readDiscordHandoff(
  fetcher: typeof globalThis.fetch,
): Promise<boolean> {
  try {
    const response = await fetcher("/api/v1/auth/discord/handoff", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { state?: unknown }).state === "active"
    );
  } catch {
    return false;
  }
}
