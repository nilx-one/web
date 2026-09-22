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
import { NARRATION_MODEL_ID } from "@nilx-one/narration-webllm";
import {
  createBrowserHost as createLocalModelRuntimeHost,
  describeLocalModelDownload,
} from "@nilx-one/narration-webllm/browser";
import {
  createPresenceGeolocation,
  createPresenceTracker,
} from "@nilx-one/presence-geo";
import { createLocalPresenceJournal } from "@nilx-one/presence-idb";
import {
  ProductApp,
  type LocalModelDeviceVerdict,
  type LocalModelHost,
} from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./bond-dock-motion.css";
import { reportMapRendererStatus } from "./error-reporting";
import { PublicBondPage, isPublicBondHostname } from "./public-bond";

/**
 * Adapts `@nilx-one/narration-webllm`'s browser host — this product's source and sizing
 * over `@aiaiaiai/webllm`'s lifecycle — to the shape `@nilx-one/product-app` asks for. That
 * package cannot depend on this adapter itself — see
 * `packages/product-app/src/shell/local-model-host.ts` — so this composition root is where
 * the two sides meet.
 */
function createLocalModelHost(): LocalModelHost {
  const runtime = createLocalModelRuntimeHost();

  return {
    async inspect(): Promise<LocalModelDeviceVerdict> {
      const { kind } = await runtime.inspect();
      return kind === "usable" ? { kind } : { kind };
    },
    isCached: (modelId) => runtime.isCached(modelId),
    async describe(modelId) {
      const description = await describeLocalModelDownload(modelId);
      return description.bytes === null
        ? { bytes: null, source: description.source }
        : {
            bytes: description.bytes,
            source: description.source,
            notices: description.notices,
          };
    },
    open: (modelId, onProgress, signal) =>
      runtime.open(modelId, onProgress, signal),
    remove: (modelId) => runtime.remove(modelId),
  };
}

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
        localModel={{
          host: createLocalModelHost(),
          modelId: NARRATION_MODEL_ID,
        }}
      />
    </StrictMode>,
  );
}
