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
  createBrowserSound,
} from "@nilx-one/host-browser";
import { createBondLocationGeolocation } from "@nilx-one/host-contract";
import {
  DISCORD_HANDOFF_AUTHORIZATION,
  createDiscordHandoffHost,
  readDiscordHandoff,
} from "@nilx-one/host-discord/handoff";
import {
  createIdentityHttpAdapter,
  readBondLocationControl,
} from "@nilx-one/identity-http";
import {
  MAP_BOOTSTRAP_CAMERA,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import { createFogField, createShadeMapFactory } from "@nilx-one/map-shade";
import { LOCAL_MODEL_CATALOG } from "@nilx-one/narration-webllm";
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
import { reportMapRendererStatus, reportWorldWipe } from "./error-reporting";
import { PublicBondPage, isPublicBondHostname } from "./public-bond";
import { wipeLocalWorldOnce } from "./world-wipe";

/**
 * How much memory this surface declares it will spend on a local model, in MB. Declared, not
 * measured: `WebGPU` reports no memory budget. It admits every entry the catalog serves today;
 * a surface that must hold less declares less, and Settings then shows the entries it refuses
 * with their reason.
 */
const LOCAL_MODEL_BUDGET_MB = 2048;

/**
 * Adapts `@nilx-one/narration-webllm`'s browser host — this product's source and sizing
 * over `@aiaiaiai/webllm`'s lifecycle — to the shape `@nilx-one/product-app` asks for. That
 * package cannot depend on this adapter itself — see
 * `packages/product-app/src/shell/local-model-host.ts` — so this composition root is where
 * the two sides meet.
 */
function createLocalModelHost(): LocalModelHost {
  const runtime = createLocalModelRuntimeHost({
    budgetMb: LOCAL_MODEL_BUDGET_MB,
  });

  return {
    async inspect(modelId: string): Promise<LocalModelDeviceVerdict> {
      const verdict = await runtime.inspect(modelId);
      switch (verdict.kind) {
        case "usable":
          return { kind: "usable" };
        case "over_budget":
          return {
            kind: "over_budget",
            requiredMb: verdict.requiredMb,
            budgetMb: verdict.budgetMb,
          };
        default:
          return { kind: verdict.kind };
      }
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

/** A stale or forged `?host=discord` must not follow the Web host around. */
function forgetDiscordHandoffLanding(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("host")) return;
  url.searchParams.delete("host");
  window.history.replaceState(window.history.state, "", url);
}

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

const root = createRoot(container);

// The wipe is confirmed before any store reads the world it clears.
const wipe = await wipeLocalWorldOnce();

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
  reportWorldWipe(reporter, wipe);
  const core = createCoreWasmClient({
    loadBindings: loadGeneratedCoreWasmBindings,
  });
  // The Discord Activity sends a person here to create a password this origin
  // owns. While the service still holds that hand-off, the page acts for the
  // Discord account that sent them: a Discord host, not the Web one.
  const discordHandoff =
    new URLSearchParams(window.location.search).get("host") === "discord" &&
    (await readDiscordHandoff(globalThis.fetch.bind(globalThis)));
  if (!discordHandoff) forgetDiscordHandoffLanding();
  const identity = createIdentityHttpAdapter({
    getAuthorization: () =>
      discordHandoff ? DISCORD_HANDOFF_AUTHORIZATION : undefined,
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
  // A manual location declared from Telegram is the Bond's location here too:
  // the browser is asked only while the Bond is live.
  const hostEnvironment = {
    matchMedia: (query: string) => window.matchMedia(query),
    open: (url: string, target: string, features: string) =>
      window.open(url, target, features),
    geolocation: createBondLocationGeolocation({
      device: browserGeolocation,
      readLocation: () => readBondLocationControl(),
    }),
    sound: createBrowserSound(),
  };
  const host = discordHandoff
    ? createDiscordHandoffHost(hostEnvironment)
    : createBrowserHost(hostEnvironment);
  const fog = createFogField(localPresence);
  const [anchorLng, anchorLat] = MAP_BOOTSTRAP_CAMERA.center;
  const mapRenderer = createMapLibreRenderer({
    createMap: createShadeMapFactory({
      runtime: fog.runtime,
      anchor: { lng: anchorLng, lat: anchorLat },
    }),
    fog: fog.field,
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
          catalog: LOCAL_MODEL_CATALOG.models,
          defaultModelId: LOCAL_MODEL_CATALOG.defaultModelId,
        }}
      />
    </StrictMode>,
  );
}
