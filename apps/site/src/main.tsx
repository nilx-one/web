// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { createBrowserReporter } from "@aiaiaiai/4x-errors-browser";
import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import { createBrowserHost } from "@nilx-one/host-browser";
import { createIdentityHttpAdapter } from "@nilx-one/identity-http";
import {
  MAP_BOOTSTRAP_CAMERA,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import { createShadeLayer } from "@nilx-one/map-shade";
import { createShadeSource, toShadeSource } from "@nilx-one/presence-contract";
import { createPresenceCapture } from "@nilx-one/presence-geo";
import { createPresenceIdbStore } from "@nilx-one/presence-idb";
import { createPresenceJournalPanel } from "@nilx-one/presence-panel";
import "@nilx-one/presence-panel/styles.css";
import { ProductApp } from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./bond-dock-motion.css";
import { reportMapRendererStatus } from "./error-reporting";
import { PublicBondPage, isPublicBondHostname } from "./public-bond";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

const root = createRoot(container);

/** Where the shade lightmap is centred. Bootstrap geography, as the camera is. */
const PRESENCE_ANCHOR = MAP_BOOTSTRAP_CAMERA.center;

if (isPublicBondHostname(window.location.hostname)) {
  // A Bond subdomain is a public identity surface, not an authenticated world
  // host. It resolves only the stored label allocation and never starts the
  // private session, geolocation, map, or Avaia runtime.
  root.render(
    <StrictMode>
      <PublicBondPage />
    </StrictMode>,
  );
} else {
  // Omitted rather than passed as undefined: the reporter's own default endpoint
  // is a different thing from an endpoint explicitly configured as nothing.
  const collectorEndpoint = import.meta.env.VITE_ERRORS_COLLECTOR_ENDPOINT;
  const reporter = createBrowserReporter({
    project: "nilx-one/web",
    source: "browser",
    ...(collectorEndpoint === undefined ? {} : { collectorEndpoint }),
  });
  const core = createCoreWasmClient({
    loadBindings: loadGeneratedCoreWasmBindings,
  });
  const identity = createIdentityHttpAdapter({
    getAuthorization: () => undefined,
  });
  const host = createBrowserHost();

  // Presence: the journal underneath, the shade over the ground, and the tap
  // between them. The renderer is handed the narrowed source, so it can learn
  // which cells are lit and nothing else about them.
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
    // Bootstrap geography, same as the camera's. Anchoring the lightmap on
    // where a person actually lives is an open question, not a Phase 1 answer.
    anchor: {
      longitude: PRESENCE_ANCHOR[0],
      latitude: PRESENCE_ANCHOR[1],
    },
  });
  shadeLayer.subscribeCellActivation((cell) => {
    void journalPanel.show(cell);
  });

  const mapRenderer = createMapLibreRenderer({
    groundLayers: [shadeLayer],
  });

  // Started before capture: an empty journal still draws, and a surface that
  // can never capture still shows whatever was recorded earlier.
  void shadeSource.start();

  const presenceCapture = createPresenceCapture({
    store: presenceStore,
    geolocation: host.geolocation,
  });
  void presenceCapture.start();

  reportMapRendererStatus(reporter, mapRenderer.getStatus());
  mapRenderer.subscribe((status) => reportMapRendererStatus(reporter, status));

  root.render(
    <StrictMode>
      <ProductApp
        core={core}
        host={host}
        identity={identity}
        mapRenderer={mapRenderer}
      />
    </StrictMode>,
  );
}
