// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import { createBrowserGeolocation } from "@nilx-one/host-browser";
import {
  createTelegramHost,
  resolveTelegramWebApp,
} from "@nilx-one/host-telegram";
import { createIdentityHttpAdapter } from "@nilx-one/identity-http";
import {
  MAP_BOOTSTRAP_CAMERA,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import { createShadeLayer } from "@nilx-one/map-shade";
import { createShadeSource, toShadeSource } from "@nilx-one/presence-contract";
import { createPresenceIdbStore } from "@nilx-one/presence-idb";
import { createPresenceJournalPanel } from "@nilx-one/presence-panel";
import "@nilx-one/presence-panel/styles.css";
import { ProductApp } from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

// A Mini App runs in an embedded browser, so the host reuses the browser
// geolocation capability rather than growing a Telegram-specific one.
const host = createTelegramHost(resolveTelegramWebApp(window), {
  geolocation: createBrowserGeolocation(),
});
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

// Presence, render side only. The journal is read and the shade is drawn; no
// capture is composed here.
//
// Capture is deliberately not wired. A Mini App WebView is not Safari, and
// recent Telegram clients expose their own location API rather than the
// browser one; which of those this host actually gets was not verifiable from
// the build container, so nothing here assumes an answer. Wiring it is a
// question for the host adapter, where the capability already lives.
const presenceStore = createPresenceIdbStore({
  indexedDB: window.indexedDB,
  crypto: window.crypto,
});
const shadeSource = createShadeSource(presenceStore);
const journalPanel = createPresenceJournalPanel(presenceStore);
// Outside the React root on purpose: createRoot clears its container's
// children when it renders, which would take the panel with them.
document.body.append(journalPanel.element);

const shadeLayer = createShadeLayer({
  source: toShadeSource(shadeSource),
  anchor: {
    longitude: MAP_BOOTSTRAP_CAMERA.center[0],
    latitude: MAP_BOOTSTRAP_CAMERA.center[1],
  },
});
shadeLayer.subscribeCellActivation((cell) => {
  void journalPanel.show(cell);
});

// An empty journal is a fully dark map, which is the correct picture of
// having recorded nothing — not a broken screen.
void shadeSource.start();

const mapRenderer = createMapLibreRenderer({
  groundLayers: [shadeLayer],
});

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
