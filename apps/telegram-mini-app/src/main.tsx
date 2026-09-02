// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import {
  createTelegramHost,
  resolveTelegramWebApp,
} from "@nilx-one/host-telegram";
import { createIdentityHttpAdapter } from "@nilx-one/identity-http";
import {
  MAP_STYLE_URL,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import { ProductApp } from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

const host = createTelegramHost(resolveTelegramWebApp(window));
const core = createCoreWasmClient({
  loadBindings: loadGeneratedCoreWasmBindings,
});
const identity = createIdentityHttpAdapter({
  getAuthorization: () => {
    const authentication = host.getSnapshot().authentication;
    return authentication.kind === "telegram-init-data" &&
      authentication.initData.length > 0
      ? `tma ${authentication.initData}`
      : undefined;
  },
});
const mapRenderer = createMapLibreRenderer({ styleUrl: MAP_STYLE_URL });

createRoot(container).render(
  <StrictMode>
    <ProductApp
      core={core}
      host={host}
      identity={identity}
      mapRenderer={mapRenderer}
      routerBasepath="/telegram"
    />
  </StrictMode>,
);
