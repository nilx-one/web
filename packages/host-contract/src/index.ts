// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type HostKind = "browser" | "telegram" | "discord";
export type HostTheme = "dark" | "light";

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type HostAuthenticationEnvelope =
  | {
      kind: "browser-session";
    }
  | {
      kind: "telegram-init-data";
      initData: string;
      verification: "required";
    }
  | {
      kind: "discord-oauth";
      authenticated: boolean;
      verification: "required";
    };

export interface HostSnapshot {
  kind: HostKind;
  available: boolean;
  theme: HostTheme;
  safeArea: SafeAreaInsets;
  authentication: HostAuthenticationEnvelope;
}

export type HostChangeListener = (snapshot: HostSnapshot) => void;
export type HostUnsubscribe = () => void;

export interface HostPort {
  getSnapshot(): HostSnapshot;
  subscribe(listener: HostChangeListener): HostUnsubscribe;
  ready(): void;
  openExternal(url: URL): void;
  impact(style: "light" | "medium" | "heavy"): void;
}

export function hasAuthenticatedProvider(snapshot: HostSnapshot): boolean {
  if (!snapshot.available) {
    return false;
  }

  switch (snapshot.authentication.kind) {
    case "browser-session":
      return false;
    case "telegram-init-data":
      return snapshot.authentication.initData.length > 0;
    case "discord-oauth":
      return snapshot.authentication.authenticated;
  }
}

export const ZERO_SAFE_AREA: SafeAreaInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
