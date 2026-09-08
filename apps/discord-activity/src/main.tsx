// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  CORE_RUNTIME_BASE_URL,
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import { createBrowserGeolocation } from "@nilx-one/host-browser";
import {
  bootstrapDiscordActivity,
  installDiscordProxyRouting,
  resolveDiscordProxyUrl,
} from "@nilx-one/host-discord";
import { createIdentityHttpAdapter } from "@nilx-one/identity-http";
import { createMapLibreRenderer } from "@nilx-one/map-maplibre";
import { ProductApp } from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

// Discord answers this origin through its own proxy, and only paths below
// `/.proxy/` reach the client's URL mappings. Routing is installed before the
// first request so the identity API, the published map style, the basemap
// archive, and the Core Wasm artifact all resolve where Discord serves them.
installDiscordProxyRouting();

const root = createRoot(container);

function reportBootstrapFailure(mount: HTMLElement, error: unknown): void {
  const reason =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "Unknown failure";

  // The Activity has no shell yet, so the failure has to describe itself here
  // rather than disappear into an embedded console nobody can open.
  mount.replaceChildren();
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  notice.style.cssText =
    "margin:0;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#f5f4ef;background:#101014;min-height:100vh";
  notice.textContent = `0x1 could not start this Discord Activity session. Reopen the Activity and try again. (${reason})`;
  mount.append(notice);
}

async function main(): Promise<void> {
  // An Activity runs in an embedded browser, so the host reuses the browser
  // geolocation capability; Discord's own restrictions arrive as capability
  // results rather than as a Discord branch in the map feature.
  const session = await bootstrapDiscordActivity({
    environment: {
      matchMedia: (query: string) => window.matchMedia(query),
      geolocation: createBrowserGeolocation(),
    },
  });
  const coreRuntimeBaseUrl = resolveDiscordProxyUrl(
    CORE_RUNTIME_BASE_URL,
    window.location,
  );
  const core = createCoreWasmClient({
    // The runtime module is imported, not fetched, so the proxied base is
    // resolved here instead of travelling through the proxied transport.
    loadBindings: () =>
      loadGeneratedCoreWasmBindings({ baseUrl: coreRuntimeBaseUrl }),
  });
  const identity = createIdentityHttpAdapter({
    fetch: session.fetch,
    getAuthorization: () => session.authorization,
  });
  const mapRenderer = createMapLibreRenderer();

  root.render(
    <StrictMode>
      <ProductApp
        core={core}
        host={session.host}
        identity={identity}
        mapRenderer={mapRenderer}
      />
    </StrictMode>,
  );
}

void main().catch((error: unknown) => {
  console.error("Discord Activity bootstrap failed", error);
  reportBootstrapFailure(container, error);
});
