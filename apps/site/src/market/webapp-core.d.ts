// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Narrow adapter contract for the pinned, JavaScript-only shared WebApp. */
declare module "@0xda-market/webapp-core" {
  export function mountMarketApp(options: {
    document: Document;
    host: {
      locale(): string;
      viewport(): { width: number; height: number };
      onViewportChanged(callback: () => void): void;
      selectionFeedback(): void;
    };
    transport: {
      bootstrap(input: { locale: string }): Promise<unknown>;
      quote(): Promise<never>;
      acceptQuote(): Promise<never>;
      refreshOrder(): Promise<never>;
    };
  }): Promise<unknown>;
}
