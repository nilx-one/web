// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { DiscordSDK, type IDiscordSDK } from "@discord/embedded-app-sdk";
import {
  UNSUPPORTED_GEOLOCATION,
  ZERO_SAFE_AREA,
  type GeolocationCapability,
  type HostChangeListener,
  type HostPort,
  type HostSnapshot,
} from "@nilx-one/host-contract";

type DiscordActivityBridge = Pick<IDiscordSDK, "ready"> & {
  commands: Pick<
    IDiscordSDK["commands"],
    | "authorize"
    | "authenticate"
    | "encourageHardwareAcceleration"
    | "openExternalLink"
  >;
};

export interface DiscordHostEnvironment {
  matchMedia(query: string): MediaQueryList;
  /**
   * A Discord Activity runs in an embedded browser, so the composition root
   * supplies the same browser capability instead of a Discord-specific one.
   * Host restrictions then arrive as capability results, not special cases.
   */
  readonly geolocation?: GeolocationCapability;
}

export interface DiscordActivitySession {
  authorization: string;
  host: HostPort;
}

export interface DiscordActivityBootstrapOptions {
  environment?: DiscordHostEnvironment;
  fetch?: typeof globalThis.fetch;
  sdkFactory?: (clientId: string) => DiscordActivityBridge;
}

function assertExternalUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    throw new Error(`Discord bootstrap response is missing ${field}`);
  }
  const result = value[field];
  if (result.length === 0) {
    throw new Error(`Discord bootstrap response contains an empty ${field}`);
  }
  return result;
}

class DiscordHost implements HostPort {
  private readonly colorScheme: MediaQueryList;
  public readonly geolocation: GeolocationCapability;

  public constructor(
    private readonly bridge: DiscordActivityBridge,
    environment: DiscordHostEnvironment,
  ) {
    this.colorScheme = environment.matchMedia("(prefers-color-scheme: dark)");
    this.geolocation = environment.geolocation ?? UNSUPPORTED_GEOLOCATION;
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
    // Discord's asynchronous READY handshake is completed before ProductApp mounts.
  }

  public openExternal(url: URL): void {
    assertExternalUrl(url);
    void this.bridge.commands.openExternalLink({ url: url.href });
  }

  public impact(_style: "light" | "medium" | "heavy"): void {
    // Discord Activities expose no host haptic primitive in the current baseline.
  }
}

export function createDiscordHost(
  bridge: DiscordActivityBridge,
  environment: DiscordHostEnvironment = window,
): HostPort {
  return new DiscordHost(bridge, environment);
}

export async function bootstrapDiscordActivity(
  options: DiscordActivityBootstrapOptions = {},
): Promise<DiscordActivitySession> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const environment = options.environment ?? window;

  const configResponse = await fetcher("/api/v1/auth/discord/config");
  if (!configResponse.ok) {
    throw new Error("Discord Activity authentication is not configured");
  }
  const clientId = requireString(await configResponse.json(), "client_id");
  const bridge = options.sdkFactory?.(clientId) ?? new DiscordSDK(clientId);

  await bridge.ready();
  void bridge.commands.encourageHardwareAcceleration().catch(() => undefined);

  const { code } = await bridge.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  if (code.length === 0) {
    throw new Error("Discord did not return an authorization code");
  }

  const tokenResponse = await fetcher("/api/v1/auth/discord/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!tokenResponse.ok) {
    throw new Error("Discord authorization code exchange failed");
  }
  const accessToken = requireString(await tokenResponse.json(), "access_token");
  const authentication = await bridge.commands.authenticate({
    access_token: accessToken,
  });
  if (authentication === null || authentication === undefined) {
    throw new Error("Discord Activity authentication failed");
  }

  return {
    authorization: `discord ${accessToken}`,
    host: createDiscordHost(bridge, environment),
  };
}
