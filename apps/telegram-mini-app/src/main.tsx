// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import { createBrowserSound } from "@nilx-one/host-browser";
import {
  createTelegramHost,
  resolveTelegramWebApp,
  telegramLanguageTags,
} from "@nilx-one/host-telegram";
import {
  createIdentityHttpAdapter,
  moveManualBondLocation,
} from "@nilx-one/identity-http";
import {
  MAP_BOOTSTRAP_CAMERA,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import { createFogField, createShadeMapFactory } from "@nilx-one/map-shade";
import { createLocalPresenceJournal } from "@nilx-one/presence-idb";
import { ProductApp, type ManualMoveOutcome } from "@nilx-one/product-app";
import { declareHostLanguages } from "@nilx-one/product-app/localization";
import "@nilx-one/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createMutableDeclaredGeolocation,
  quantizeDeclaredPoint,
  type ObservedGeolocation,
} from "@nilx-one/host-contract";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { startTelegramChromeAppearanceSync } from "./appearance";
import {
  locationControlFingerprint,
  readTelegramLocationControl,
} from "./location-control";

const LOCATION_PERSIST_INTERVAL_MS = 15_000;

function createTelegramLiveLocationSink(
  initData: string,
): (position: ObservedGeolocation) => void {
  let lastSentAt = 0;
  return (position) => {
    const now = Date.now();
    if (now - lastSentAt < LOCATION_PERSIST_INTERVAL_MS) return;
    lastSentAt = now;
    void fetch("/api/v1/location-control", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        authorization: `tma ${initData}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        longitude: position.longitude,
        latitude: position.latitude,
      }),
    }).catch(() => undefined);
  };
}

async function bootstrap(): Promise<void> {
  const container = document.querySelector<HTMLElement>("#root");
  if (container === null) {
    throw new Error("0x1 root element is missing");
  }

  const telegramBridge = resolveTelegramWebApp(window);
  declareHostLanguages(telegramLanguageTags(telegramBridge));
  startTelegramChromeAppearanceSync(telegramBridge);

  // Location control is read before the host receives a geolocation
  // capability. Only an explicit live answer enables browser GPS; unknown
  // server state therefore cannot accidentally reveal the device position.
  const locationControl = await readTelegramLocationControl(
    telegramBridge?.initData ?? "",
  );
  // A manual Bond location stands the Bond at the declared point: the host
  // answers that point, marked declared, and never asks the device at all.
  // Telegram has no sound of its own; its embedded browser plays Web Audio.
  const sound = createBrowserSound();
  const manualLocation =
    locationControl.kind === "manual"
      ? createMutableDeclaredGeolocation(locationControl.position)
      : undefined;
  const host = createTelegramHost(
    telegramBridge,
    locationControl.kind === "live"
      ? {
          enableLiveLocation: true,
          onLiveLocation: createTelegramLiveLocationSink(
            telegramBridge?.initData ?? "",
          ),
          sound,
        }
      : manualLocation !== undefined
        ? {
            geolocation: manualLocation.geolocation,
            sound,
          }
        : { sound },
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
  const fog = createFogField(localPresence);
  const [anchorLng, anchorLat] = MAP_BOOTSTRAP_CAMERA.center;
  const mapRenderer = createMapLibreRenderer({
    createMap: createShadeMapFactory({
      runtime: fog.runtime,
      anchor: { lng: anchorLng, lat: anchorLat },
    }),
    fog: fog.field,
  });

  // Telegram commonly keeps a Mini App alive while the user returns to the
  // bot. Re-read when it becomes visible; a changed mode needs a fresh
  // composition because geolocation authority is intentionally immutable for
  // the lifetime of one host instance.
  let currentLocationFingerprint = locationControlFingerprint(locationControl);
  let manualMoveRevision = 0;
  const onManualBondMove = async (
    from: { readonly longitude: number; readonly latitude: number },
    to: { readonly longitude: number; readonly latitude: number },
  ): Promise<ManualMoveOutcome> => {
    if (manualLocation === undefined) return { kind: "rejected" };
    // Without initData there is no identity to authorize; send no header
    // rather than an empty `tma ` credential, as the Web host does.
    const initData = telegramBridge?.initData ?? "";
    const result = await moveManualBondLocation(from, to, {
      authorization: initData.length > 0 ? `tma ${initData}` : undefined,
    });
    if (result.kind === "failed") return { kind: "rejected" };
    let authoritative: {
      readonly longitude: number;
      readonly latitude: number;
    };
    if (result.kind === "accepted") {
      authoritative = to;
    } else if (result.state.kind === "manual") {
      authoritative = result.state.position;
    } else {
      // Only a fresh composition may enable device GPS; never reuse the
      // manual-only geolocation capability for a remote mode change.
      if (result.state.kind === "live") window.location.reload();
      return { kind: "rejected" };
    }
    // The identity service stores integer E7 coordinates. Publish the
    // canonical server point through a declared-only observer (never GPS).
    const stored = quantizeDeclaredPoint(authoritative);
    manualMoveRevision += 1;
    currentLocationFingerprint = locationControlFingerprint({
      kind: "manual",
      position: stored,
    });
    manualLocation.update(stored);
    return result.kind === "accepted"
      ? { kind: "accepted" }
      : { kind: "rejected", current: stored };
  };
  // Only a definite answer is a changed mode. `unavailable` is also what a
  // slow network or a Mini App left in the background past its initData's
  // lifetime reads as; reloading on it would restart the page with the same
  // initData and land on "Reopen 0x1 from Telegram" instead of the world.
  const recheckLocationControl = (): void => {
    const startedAtRevision = manualMoveRevision;
    void readTelegramLocationControl(telegramBridge?.initData ?? "").then(
      (next) => {
        // A read started before a successful local movement must not trigger
        // a false "remote change" reload after the manual update.
        if (startedAtRevision !== manualMoveRevision) return;
        if (next.kind === "unavailable") return;
        if (locationControlFingerprint(next) !== currentLocationFingerprint) {
          window.location.reload();
        }
      },
    );
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    recheckLocationControl();
  });
  const locationControlPoll = window.setInterval(
    recheckLocationControl,
    LOCATION_PERSIST_INTERVAL_MS,
  );
  window.addEventListener(
    "pagehide",
    () => window.clearInterval(locationControlPoll),
    { once: true },
  );

  createRoot(container).render(
    <StrictMode>
      <ProductApp
        core={core}
        host={host}
        identity={identity}
        mapRenderer={mapRenderer}
        onManualBondMove={onManualBondMove}
        routerBasepath="/telegram"
      />
    </StrictMode>,
  );
}

void bootstrap();
