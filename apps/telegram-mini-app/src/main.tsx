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
  telegramLanguageTags,
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
import { declareHostLanguages } from "@nilx-one/product-app/localization";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  createManualLocationMapRenderer,
  locationControlFingerprint,
  readTelegramLocationControl,
} from "./location-control";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

async function bootstrap(): Promise<void> {
  const telegramBridge = resolveTelegramWebApp(window);
  declareHostLanguages(telegramLanguageTags(telegramBridge));

  // Location control is read before the host receives a geolocation
  // capability. Only an explicit live answer enables browser GPS; unknown
  // server state therefore cannot accidentally reveal the device position.
  const locationControl = await readTelegramLocationControl(
    telegramBridge?.initData ?? "",
  );
  const host = createTelegramHost(
    telegramBridge,
    locationControl.kind === "live"
      ? { geolocation: createBrowserGeolocation() }
      : {},
  );
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
  const baseMapRenderer = createMapLibreRenderer({
    createMap: createShadeMapFactory({
      runtime: localPresence,
      anchor: { lng: anchorLng, lat: anchorLat },
      onCellTap: (tap) => journalPresenter.show(tap),
    }),
  });
  const mapRenderer =
    locationControl.kind === "manual"
      ? createManualLocationMapRenderer(baseMapRenderer, locationControl.position)
      : baseMapRenderer;

  // Telegram commonly keeps a Mini App alive while the user returns to the
  // bot. Re-read when it becomes visible; a changed mode needs a fresh
  // composition because geolocation authority is intentionally immutable for
  // the lifetime of one host instance.
  const initialLocationFingerprint = locationControlFingerprint(locationControl);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void readTelegramLocationControl(telegramBridge?.initData ?? "").then(
      (next) => {
        if (locationControlFingerprint(next) !== initialLocationFingerprint) {
          window.location.reload();
        }
      },
    );
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
}

void bootstrap();
