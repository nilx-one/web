// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { createBrowserGeolocation } from "@nilx-one/host-browser";
import { createBusinessSurfaceHttp } from "@nilx-one/identity-http";
import { createMapLibreRenderer } from "@nilx-one/map-maplibre";
import { BusinessWorld } from "@nilx-one/product-app/business";
import { useState } from "react";
import { createBusinessNavigation } from "./business-navigation";
import type { PublicBondProjection } from "./public-bond";

export function PublicBusinessPage({ bond }: { bond: PublicBondProjection }) {
  const [dependencies] = useState(() => ({
    renderer: createMapLibreRenderer(),
    directory: createBusinessSurfaceHttp(),
    navigation: createBusinessNavigation(
      new URL(bond.pubDressUrl).hostname.slice(0, -".nilx.one".length),
    ),
    geolocation: createBrowserGeolocation(),
  }));
  return <BusinessWorld {...dependencies} />;
}
