// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type HostKind = "browser" | "telegram";
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

export const ZERO_SAFE_AREA: SafeAreaInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
