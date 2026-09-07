// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  UNSUPPORTED_GEOLOCATION,
  ZERO_SAFE_AREA,
  type GeolocationCapability,
  type HostChangeListener,
  type HostPort,
  type HostSnapshot,
  type SafeAreaInsets,
} from "@nilx-one/host-contract";

export interface TelegramHostComposition {
  /**
   * Telegram Mini Apps run in an embedded browser, so the composition root
   * hands this host the same browser capability rather than growing a second
   * geolocation implementation here.
   */
  readonly geolocation?: GeolocationCapability;
}

export interface TelegramWebAppBridge {
  initData: string;
  colorScheme: "dark" | "light";
  safeAreaInset?: Partial<SafeAreaInsets>;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
  };
  ready(): void;
  expand(): void;
  openLink(url: string): void;
  onEvent(
    event: "themeChanged" | "viewportChanged",
    listener: () => void,
  ): void;
  offEvent(
    event: "themeChanged" | "viewportChanged",
    listener: () => void,
  ): void;
}

function safeInset(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? 0
    : Math.max(0, value);
}

function readSafeArea(bridge: TelegramWebAppBridge): SafeAreaInsets {
  const inset = bridge.safeAreaInset;

  if (inset === undefined) {
    return ZERO_SAFE_AREA;
  }

  return {
    top: safeInset(inset.top),
    right: safeInset(inset.right),
    bottom: safeInset(inset.bottom),
    left: safeInset(inset.left),
  };
}

function assertExternalUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
}

class TelegramHost implements HostPort {
  public constructor(
    private readonly bridge: TelegramWebAppBridge | undefined,
    public readonly geolocation: GeolocationCapability,
  ) {}

  public getSnapshot(): HostSnapshot {
    return {
      kind: "telegram",
      available: this.bridge !== undefined,
      theme: this.bridge?.colorScheme ?? "light",
      safeArea:
        this.bridge === undefined ? ZERO_SAFE_AREA : readSafeArea(this.bridge),
      authentication: {
        kind: "telegram-init-data",
        initData: this.bridge?.initData ?? "",
        verification: "required",
      },
    };
  }

  public subscribe(listener: HostChangeListener): () => void {
    if (this.bridge === undefined) {
      return () => undefined;
    }

    const handleChange = (): void => listener(this.getSnapshot());
    this.bridge.onEvent("themeChanged", handleChange);
    this.bridge.onEvent("viewportChanged", handleChange);

    return () => {
      this.bridge?.offEvent("themeChanged", handleChange);
      this.bridge?.offEvent("viewportChanged", handleChange);
    };
  }

  public ready(): void {
    this.bridge?.ready();
    this.bridge?.expand();
  }

  public openExternal(url: URL): void {
    assertExternalUrl(url);
    this.bridge?.openLink(url.href);
  }

  public impact(style: "light" | "medium" | "heavy"): void {
    this.bridge?.HapticFeedback?.impactOccurred(style);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function resolveTelegramWebApp(
  browserGlobal: unknown,
): TelegramWebAppBridge | undefined {
  if (!isRecord(browserGlobal) || !isRecord(browserGlobal.Telegram)) {
    return undefined;
  }

  const webApp = browserGlobal.Telegram.WebApp;

  if (
    !isRecord(webApp) ||
    typeof webApp.ready !== "function" ||
    typeof webApp.expand !== "function" ||
    typeof webApp.openLink !== "function" ||
    typeof webApp.onEvent !== "function" ||
    typeof webApp.offEvent !== "function"
  ) {
    return undefined;
  }

  return webApp as unknown as TelegramWebAppBridge;
}

export function createTelegramHost(
  bridge?: TelegramWebAppBridge,
  composition: TelegramHostComposition = {},
): HostPort {
  return new TelegramHost(
    bridge,
    composition.geolocation ?? UNSUPPORTED_GEOLOCATION,
  );
}
