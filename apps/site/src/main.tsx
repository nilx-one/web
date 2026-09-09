// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { createBrowserReporter } from "@aiaiaiai/4x-errors-browser";
import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import {
  createBrowserGeolocation,
  createBrowserHost,
} from "@nilx-one/host-browser";
import { createIdentityHttpAdapter } from "@nilx-one/identity-http";
import {
  MAP_BOOTSTRAP_CAMERA,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import {
  createRawJournalPresenter,
  createShadeMapFactory,
} from "@nilx-one/map-shade";
import {
  createPresenceGeolocation,
  createPresenceTracker,
} from "@nilx-one/presence-geo";
import { createLocalPresenceJournal } from "@nilx-one/presence-idb";
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

  // Presence is deliberately outside the error reporter: this private local
  // journal has no analytics or error-egress path. Failure degrades to the map
  // that already existed before this feature.
  const localPresence = createLocalPresenceJournal().catch(() => null);
  const tracker = localPresence.then((journal) =>
    journal === null ? null : createPresenceTracker({ store: journal.store }),
  );
  const browserGeolocation = createPresenceGeolocation(
    createBrowserGeolocation(),
    tracker,
  );
  const host = createBrowserHost({
    matchMedia: (query) => window.matchMedia(query),
    open: (url, target, features) => window.open(url, target, features),
    geolocation: browserGeolocation,
  });
  const journalPresenter = createRawJournalPresenter();
  const [anchorLng, anchorLat] = MAP_BOOTSTRAP_CAMERA.center;
  const mapRenderer = createMapLibreRenderer({
    createMap: createShadeMapFactory({
      runtime: localPresence,
      anchor: { lng: anchorLng, lat: anchorLat },
      onCellTap: (tap) => journalPresenter.show(tap),
    }),
  });

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
