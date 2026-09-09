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
import {
  createRawJournalPresenter,
  createShadeMapFactory,
} from "@nilx-one/map-shade";
import { createLocalPresenceJournal } from "@nilx-one/presence-idb";
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
// geolocation capability rather than growing a Telegram-specific one. Presence
// capture remains intentionally unwired until its iOS behavior is verified
// firsthand; the existing host location still drives ordinary map presentation.
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
const localPresence = createLocalPresenceJournal().catch(() => null);
const journalPresenter = createRawJournalPresenter();
const [anchorLng, anchorLat] = MAP_BOOTSTRAP_CAMERA.center;
const mapRenderer = createMapLibreRenderer({
  createMap: createShadeMapFactory({
    runtime: localPresence,
    anchor: { lng: anchorLng, lat: anchorLat },
    onCellTap: (tap) => journalPresenter.show(tap),
  }),
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
