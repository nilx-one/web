// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  ZERO_SAFE_AREA,
  type GeolocationCapability,
  type HostChangeListener,
  type HostPort,
  type HostSnapshot,
} from "@nilx-one/host-contract";

import { createBrowserGeolocation } from "./geolocation";
import { createBrowserHaptics, type ImpactStyle } from "./haptics";

export {
  createBrowserGeolocation,
  type BrowserGeolocationEnvironment,
} from "./geolocation";
export {
  createBrowserHaptics,
  type BrowserHapticsEnvironment,
} from "./haptics";

export interface BrowserHostEnvironment {
  matchMedia(query: string): MediaQueryList;
  open(url: string, target: string, features: string): Window | null;
  /** Composed rather than constructed so a test can supply its own provider. */
  readonly geolocation?: GeolocationCapability;
  /** Composed for the same reason; defaults to what this browser offers. */
  readonly haptics?: (style: ImpactStyle) => void;
}

function assertExternalUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
}

class BrowserHost implements HostPort {
  private readonly colorScheme: MediaQueryList;
  public readonly geolocation: GeolocationCapability;
  private readonly haptics: (style: ImpactStyle) => void;

  public constructor(private readonly environment: BrowserHostEnvironment) {
    this.colorScheme = environment.matchMedia("(prefers-color-scheme: dark)");
    this.geolocation = environment.geolocation ?? createBrowserGeolocation();
    this.haptics = environment.haptics ?? createBrowserHaptics();
  }

  public getSnapshot(): HostSnapshot {
    return {
      kind: "browser",
      available: true,
      theme: this.colorScheme.matches ? "dark" : "light",
      safeArea: ZERO_SAFE_AREA,
      authentication: {
        kind: "browser-session",
      },
    };
  }

  public subscribe(listener: HostChangeListener): () => void {
    const handleChange = (): void => listener(this.getSnapshot());
    this.colorScheme.addEventListener("change", handleChange);

    return () => this.colorScheme.removeEventListener("change", handleChange);
  }

  public ready(): void {
    // The browser host has no readiness handshake.
  }

  public openExternal(url: URL): void {
    assertExternalUrl(url);
    this.environment.open(url.href, "_blank", "noopener,noreferrer");
  }

  public impact(style: ImpactStyle): void {
    this.haptics(style);
  }
}

export function createBrowserHost(
  environment: BrowserHostEnvironment = window,
): HostPort {
  return new BrowserHost(environment);
}
