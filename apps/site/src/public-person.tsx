// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_BOOTSTRAP_CAMERA,
  createMapLibreRenderer,
} from "@nilx-one/map-maplibre";
import { MAP_SCALE_ZOOM } from "@nilx-one/map-contract";
import {
  PUBLIC_BOND_GAME_URL,
  PublicBondWorld,
  consumePublicBondMapState,
  publicAvaiaPath,
  publicBondScreen,
} from "@nilx-one/product-app/public-bond";
import { useState, useSyncExternalStore } from "react";
import type { PublicBondProjection } from "./public-bond";

const subscribePath = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const readPath = () => window.location.pathname;

function notifyPath(): void {
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

/**
 * A person's Bond page: the world the game drew when the link was followed,
 * else where its Avaia was published, under the Bond's main screen.
 */
export function PublicPersonPage({ bond }: { bond: PublicBondProjection }) {
  const [setup] = useState(() => {
    const handed = consumePublicBondMapState(window);
    const location = bond.avaia?.location?.coordinate;
    const camera =
      handed.camera ??
      (location === undefined
        ? MAP_BOOTSTRAP_CAMERA
        : {
            center: [location.longitude, location.latitude] as const,
            zoom: MAP_SCALE_ZOOM.street,
            bearing: 0,
            pitch: 0,
          });
    return {
      renderer: createMapLibreRenderer({ initialCamera: camera }),
      appearance:
        handed.appearance ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches
          ? ("dark" as const)
          : ("light" as const)),
    };
  });
  const pathname = useSyncExternalStore(subscribePath, readPath, readPath);
  const avaia = bond.avaia;
  const screen = publicBondScreen(pathname, avaia?.pubDress);
  return (
    <PublicBondWorld
      renderer={setup.renderer}
      appearance={setup.appearance}
      screen={screen}
      bond={{
        pubDress: bond.pubDress,
        publicUrl: bond.pubDressUrl,
        experience: bond.experience,
        ...(avaia === undefined
          ? {}
          : {
              avaia: {
                pubDress: avaia.pubDress,
                configured: avaia.configurationState === "configured",
                ...(avaia.avatarModel === undefined
                  ? {}
                  : { avatarModel: avaia.avatarModel }),
                ...(avaia.location === undefined
                  ? {}
                  : { location: avaia.location.coordinate }),
              },
            }),
      }}
      onBack={() => {
        if (screen === "bond") {
          window.location.assign(PUBLIC_BOND_GAME_URL);
          return;
        }
        history.pushState(history.state, "", "/");
        notifyPath();
      }}
      onOpenAvaia={() => {
        if (avaia === undefined) return;
        history.pushState(history.state, "", publicAvaiaPath(avaia.pubDress));
        notifyPath();
      }}
    />
  );
}
