// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BusinessPointId } from "./courier";

/** Read-only published projections; neither the URL nor the client publishes points. */
export interface BusinessCity {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly region?: string;
  readonly aliases: readonly string[];
  /** Published locality boundary, used locally; device coordinates never leave the host. */
  readonly boundary?: readonly (readonly [number, number])[];
}
export interface BusinessContact {
  readonly label: string;
  readonly href: string;
}
export interface BusinessOffer {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly quantity?: string;
  readonly price?: string;
}
export type BusinessCatalog =
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly offers: readonly BusinessOffer[] };
export interface BusinessPointSurface {
  readonly id: BusinessPointId;
  readonly route: string;
  readonly displayName: string;
  readonly cityId: string;
  readonly contacts: readonly BusinessContact[];
  readonly catalog: BusinessCatalog;
}
export interface BusinessSurface {
  readonly pubDress: string;
  readonly publicUrl: string;
  readonly displayName: string;
  readonly contacts: readonly BusinessContact[];
  readonly directory:
    | { readonly kind: "unavailable" }
    | {
        readonly kind: "ready";
        readonly cities: readonly BusinessCity[];
        /** Only currently publishable point pages; pending previews belong to the organization. */
        readonly points: readonly BusinessPointSurface[];
      };
}
export type BusinessSurfaceResult =
  | { readonly kind: "ready"; readonly business: BusinessSurface }
  | { readonly kind: "not-found" | "unavailable" };
export interface BusinessSurfacePort {
  /** Resolve the allocated DNS label, not a pub_dress reconstructed from a hostname. */
  read(label: string, signal?: AbortSignal): Promise<BusinessSurfaceResult>;
}

export interface BusinessNavigationState {
  readonly label: string;
  readonly point?: string;
  readonly cityId?: string;
}
export interface BusinessNavigationPort {
  getSnapshot(): BusinessNavigationState | null;
  subscribe(listener: () => void): () => void;
  /** Remains in the current origin. Undefined point means the organization. */
  open(label: string, point?: string, cityId?: string): void;
  close(): void;
  /** Reconcile navigation performed by the host router. */
  sync(): void;
  href(label: string, point?: string): string;
}
