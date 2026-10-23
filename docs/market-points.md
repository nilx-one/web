# 0xda-market · Kyiv map points

These 22 author-requested points are **unverified BusinessPoints** of the
0xda-market BBond (0x1 `13-business-bonds-and-presence.md`), seeded for a local
preview with `isVerified: false` and drawn as labelled points, with no shop or
stationed-Avaia model. They are not registered businesses, verified listings,
proof of ownership, visits, purchases or subscription providers. Real landmarks
are navigation anchors; coordinates are approximate site anchors, not surveyed
entrances.

`features/courier/market-points.ts` holds the one BusinessPoint record per
point, used by the map pins and as the courier destination; there is no
separate destination entity. Each point's ID is `{ owner_pub_dress:
"0xda-market", number }`, its `UInt8` number following the table order below
(Золоті Ворота is 0, вул. Чорних Запорожців 21). Numbers are allocated once and
never reassigned; a new point takes the next one. The point `pub_dress` is the
seeded constant `0xda-market-<place>`, not derived by Web: point-address
derivation waits for Core's address contract.

Before this model the same points were referenced as `0xda-market-<place>`.
That reference is now each point's seeded `pub_dress`, and
`LEGACY_MARKET_POINT_NUMBERS` maps it explicitly to the stable number. Nothing
persisted the old reference. Map pins are keyed by the BusinessPoint ID.
Built-in points do not populate the business-station API, and other business
owners' station models continue to work.

| Point                      | Latitude, longitude | Placement source                                                                                                                           |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Золоті Ворота              | 50.44890, 30.51310  | Existing `use-business-stations.test.tsx` station coordinate                                                                               |
| Батьківщина-Мати           | 50.42650, 30.56320  | Existing `use-business-stations.test.tsx` station coordinate                                                                               |
| Пейзажна алея              | 50.45642, 30.51562  | [Find Way](https://www.find-way.com.ua/en/regions/kyiv-region/kyiv/art-park-peizajna-alleya-landscape-alley-kyiv)                          |
| Космополіт · Шулявка       | 50.45060, 30.44237  | [Novobudovy](https://novobudovy.com/torhovi-tsentry-kyieva/torgovo-rozvazhalnij-centr); [current COSMO name](https://cosmo-multimall.com/) |
| Gorodok Gallery            | 50.48974, 30.49582  | [Novobudovy](https://novobudovy.com/torhovi-tsentry-kyieva/torgovij-centr-gorodok)                                                         |
| SmartPlaza Polytech        | 50.45135, 30.46827  | [Visicom](https://maps.visicom.ua/c/30.4672,50.45141,17/f/POI3B2OIA6P?lang=uk); [official address](https://smartplazapolytech.com/)        |
| РайON · Троєщина           | 50.51648, 30.60187  | [Mapcarta / OSM](https://mapcarta.com/W160581658)                                                                                          |
| Mandarin Plaza             | 50.44137, 30.52153  | [Discover Ukraine](https://discover.ua/en/en/locations/torgivelniy-centr-mandarin-plaza)                                                   |
| Respublika Park            | 50.37355, 30.44626  | [Mapcarta / OSM](https://mapcarta.com/W293888317)                                                                                          |
| Lavina Mall                | 50.49555, 30.36049  | [Mapcarta / OSM](https://mapcarta.com/W446901282)                                                                                          |
| River Mall                 | 50.40531, 30.61195  | [Mapcarta / OSM](https://mapcarta.com/W489629304)                                                                                          |
| Retroville                 | 50.50359, 30.41658  | [Mapcarta / OSM](https://mapcarta.com/W435080613)                                                                                          |
| ЦУМ 🤍                     | 50.44546, 30.52047  | [Mapcarta / OSM](https://mapcarta.com/W30601064)                                                                                           |
| SkyMall                    | 50.49304, 30.55936  | [Mapcarta / OSM](https://mapcarta.com/W157510073)                                                                                          |
| DREAM berry                | 50.51681, 30.49865  | [Mapcarta / OSM](https://mapcarta.com/W1066535879)                                                                                         |
| DREAM yellow               | 50.50753, 30.49837  | [Mapcarta / OSM](https://mapcarta.com/W314119691)                                                                                          |
| Gulliver 🖤                | 50.43869, 30.52312  | [Mapcarta / OSM](https://mapcarta.com/W272607734)                                                                                          |
| метро Осокорки             | 50.39519, 30.61625  | [Mapcarta / OSM](https://mapcarta.com/N5267935780)                                                                                         |
| метро Позняки              | 50.39790, 30.63466  | [Mapcarta / OSM](https://mapcarta.com/N10726245817)                                                                                        |
| Троєщина · Молодіжний парк | 50.52167, 30.62306  | Approximate central-neighbourhood anchor, [municipal park location](https://desna.kyivzelenbud.com/place/park/park-molodizhnyj/)           |
| метро Лівобережна          | 50.45186, 30.59817  | [Mapcarta](https://mapcarta.com/35334944)                                                                                                  |
| вул. Чорних Запорожців     | 50.47938, 30.59755  | Approximate street anchor by no. 5, [Visicom](https://maps.visicom.ua/c/30.59755,50.47946,17/f/ADR3K0MXUAA02MZJS5?lang=uk)                 |

Sources checked 2026-10-17. Mapcarta's geographic data is based on
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
No third-party models, photographs, tiles or logos are copied into this catalog.
DREAM's [official addresses](https://dreamtown.ua/en/contacts) distinguish berry
(21Б) from yellow (1Б). SmartPlaza means Polytech at Beresteiskyi Avenue 24.
The street requested as Petra Zaporozhtsia is now Chornykh Zaporozhtsiv; its
stable game ID retains the original spelling.

## Dispatch and old runtimes

Only agreement in the Exclusive/Special offer dispatches xPing. Core's
[`courier_destination`](https://github.com/nilx-one/core/blob/master/docs/courier-destination.md)
chooses the nearest point: Web sends the trip's origin and the projection's
points as `{ point_id, coordinate }`, with `point_id` the zero-padded point
number (`"000"`–`"255"`) within the one owner, and maps the answer back to that
BusinessPoint. The selector owns no tier, flight time or arrival. On a runtime
without the export, the built-in directory's presentation-only preview chooses
the same way (nearest, then smallest number), using the renderer contract's
distance function. This preview always uses this fixed list, never arbitrary
incoming candidates.
It is used only for an absent binding, not malformed Core output or service
errors. An external directory without a preview still requires Core.

The flyover from #454 owns road routing, height, banking and actual progress.
Its arrival event controls ✅. A seeded preview carries no authoritative ETA;
agreement and arrival grant no entitlement and call no commerce endpoint.

## Browser Market Dock

The browser site supplies `/market.html`, a separate document mounting the
pinned `@0xda-market/webapp-core` package. After xPing actually reaches the
selected point (immediately with reduced motion), it parks and the Dock opens
that document. Closing the Dock ends the flight and restores the world camera.
Hosts without this capability retain the existing return flight.

The shared WebApp reads the complete public catalog through the GET-only
`/market-api/bootstrap` proxy. The proxy fixes the upstream path and strips
session headers. A failed or timed-out bootstrap shows a retry action. Iframe
unmount disposes the shared app's document listeners. No location, point ID,
identity session, or device balance is passed to Market. The iframe is
same-origin and unsandboxed, so the pinned WebApp is trusted code with the
site's origin privileges: review every pin bump as such.

Seeded points remain explicitly unverified. Browsing neither verifies a visit
nor grants an entitlement. This host disables every checkout transport method;
Special purchases require a separate authoritative seeds debit and subscription
grant integration before checkout can be enabled.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
