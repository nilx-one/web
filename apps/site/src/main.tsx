// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import { createBrowserHost } from "@nilx-one/host-browser";
import { createIdentityHttpAdapter } from "@nilx-one/identity-http";
import { createMapLibreRenderer } from "@nilx-one/map-maplibre";
import { ProductApp } from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./bond-dock-motion.css";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

const core = createCoreWasmClient({
  loadBindings: loadGeneratedCoreWasmBindings,
});
const identity = createIdentityHttpAdapter({
  getAuthorization: () => undefined,
});
const mapRenderer = createMapLibreRenderer();

createRoot(container).render(
  <StrictMode>
    <ProductApp
      core={core}
      host={createBrowserHost()}
      identity={identity}
      mapRenderer={mapRenderer}
    />
  </StrictMode>,
);
