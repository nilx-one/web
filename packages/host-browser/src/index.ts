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

export {
  createBrowserGeolocation,
  type BrowserGeolocationEnvironment,
} from "./geolocation";

export interface BrowserHostEnvironment {
  matchMedia(query: string): MediaQueryList;
  open(url: string, target: string, features: string): Window | null;
  /** Composed rather than constructed so a test can supply its own provider. */
  readonly geolocation?: GeolocationCapability;
}

function assertExternalUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
}

class BrowserHost implements HostPort {
  private readonly colorScheme: MediaQueryList;
  public readonly geolocation: GeolocationCapability;

  public constructor(private readonly environment: BrowserHostEnvironment) {
    this.colorScheme = environment.matchMedia("(prefers-color-scheme: dark)");
    this.geolocation = environment.geolocation ?? createBrowserGeolocation();
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

  public impact(_style: "light" | "medium" | "heavy"): void {
    // Browser haptics are intentionally absent from the baseline contract.
  }
}

export function createBrowserHost(
  environment: BrowserHostEnvironment = window,
): HostPort {
  return new BrowserHost(environment);
}
