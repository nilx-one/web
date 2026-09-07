// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import { createBrowserGeolocation } from "@nilx-one/host-browser";
import { bootstrapDiscordActivity } from "@nilx-one/host-discord";
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

const root = createRoot(container);

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
  const core = createCoreWasmClient({
    loadBindings: loadGeneratedCoreWasmBindings,
  });
  const identity = createIdentityHttpAdapter({
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
  container.textContent =
    "0x1 could not authenticate this Discord Activity session. Reopen the Activity and try again.";
});
