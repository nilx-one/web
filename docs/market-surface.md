# Business Bond public surfaces

## Contract

`0xda-market` is a Business Bond, not a special Web host. Registering its
`pub_dress` allocates its public label through the same mechanism as every other
Bond. Its public address is `https://0xda-market.nilx.one`.

The generic public host resolver must look up the registered Bond first. The
server-authoritative Business classification selects a Business Bond view; the
hostname, a brand-name constant, or the presence of stations cannot establish
that classification. An unregistered address remains not found. A business with
zero points is still a Business Bond.

The same view must work for any registered Business Bond. Market-specific
capabilities can later compose into it from authoritative projections. Opening
the page does not create an interaction, purchase, verification or BondChain
entry. Existing BusinessPoints remain the destinations; do not duplicate them.

## Verified current implementation

- `IdentityRepository::register_business` calls
  `insert_human_with_public_label_in` and records the `business` role in the same
  transaction. There is no need for a second market-specific label allocation.
- `/api/v1/identity/public` resolves the stored label from the request host and
  returns not found for an unallocated label.
- The public projection now exposes `bond_type` from the stored Business role.
  The browser selects the Business world from this classification, never from
  the hostname or presence of stations.
- Internally, current business provisioning uses the `human` identity storage
  category plus a Business access role. That implementation detail must not be
  confused with the product's Business Bond type or silently redesigned here.

## Public URLs and point identity

| Public URL                                   | Context                                          |
| -------------------------------------------- | ------------------------------------------------ |
| `https://<pub_dress>.nilx.one/`              | The registered Business Bond organization        |
| `https://<pub_dress>.nilx.one/<point>`       | An eligible BusinessPoint owned by that BBond    |
| `https://0xda-market.nilx.one/zoloti_vorota` | Example route for the market's Golden Gate point |

`<point>` is a readable, owner-scoped route segment. It resolves to the existing
stable `BusinessPoint.id`; it is not another Bond, station, destination, or point
ID. The example spelling `zoloti_vorota` is a requested URL shape, not a new
client-side transliteration algorithm. Core/application must own accepted route
normalization, owner-scoped uniqueness, conflicts with reserved application
paths, and an explicit migration/alias policy for later changes. A display-name
edit must not silently invalidate an accepted URL or change the point ID.

The public point view must follow the canonical publication lifecycle in
`0x1/documents/13-business-bonds-and-presence.md`: registration alone does not
publish all points. Pending previews link to the organization and remain marked
as preparation; private, expired or withdrawn point data must not leak through a
deep link or an old cache. A missing or ineligible point is explicitly unavailable,
with a link to the organization; do not silently substitute another point.

The existing legacy `business_stations` rows cannot simply be promoted into the
new point route. Their station-Avaia coupling requires the already documented
compatibility migration, preserving identifiers and without granting verification.

## Shared world and contextual Dock

The requested experience is the 0x1 world with a Business Dock. The point is a
context in the persistent world, not a separate storefront application. Reuse
`AppShell` and `DockWindow`; opening an organization, opening one of its points,
and returning to the organization must not remount the map renderer.

A point Dock has this order:

1. **Back to organization.** A deterministic navigation action to that BBond's
   root context, even after a direct deep link. Do not implement this as blind
   browser history back, which may leave the organization entirely.
2. **Heading.** `Business Bond`, then the selected point's published
   `display_name`, for example `0xda-market Золоті Ворота`. Keep the owning
   organization's identity available. The point remains a BusinessPoint; the
   heading describes its owning Bond type.
3. **Compact assortment grid.** For 0xda-market, show published quantities of
   `₴€£` and the 0x1 game-items category, including subscription types and other
   published 0x1 items. Quantity and price must have explicit labels and units;
   a published offer quantity is not the visitor's balance. Do not invent stock,
   prices or a successful purchase to fill the layout. An unconnected catalog,
   an empty catalog and a failed request are distinct states.
4. **Public information.** Website, social profiles, phone, email and other
   explicitly published contact fields. Omit absent fields. Private sign-in or
   verification contacts must never be reused as public contacts. Point-specific
   contacts and organization contacts must retain their scope; any inherited
   organization contact should be labelled accordingly.

The organization context identifies the BBond and lists its publicly eligible
points in the selected city. A point selection pushes the Dock stack; Back pops
to that organization with its city selection and list position preserved.
Browser Back/Forward must also restore the corresponding context. Selecting a
point may focus the camera on its published coordinate; it must not move the
visitor's Bond or Avaia or claim physical arrival.

The public projection needs explicit Business classification, organization
identity, point ID and accepted route, `display_name`, publication state, public
contacts, and an optional catalog projection. These are contract requirements,
not fields already supplied by today's API. Catalog and contacts are optional
capabilities of any Business Bond, not tests for the name `0xda-market`.

## Organization city selector

At `https://<pub_dress>.nilx.one/`, offer **«Подивитися всі точки в: Києві»**
with an editable city choice. Kyiv, Odesa, Saint Petersburg, Minsk and Paris are
examples of possible cities, not seeded claims that this business has points
there. City names are localized; lookup and selection use stable city IDs,
including country/region disambiguation for identically named cities.

Resolve the initial city in this order:

1. An explicit city selection in the current navigation context. A manual
   selection remains authoritative for browsing until the visitor changes it;
   a later location response must not overwrite it.
2. City context explicitly passed from the originating 0x1 application, using
   its existing location observation or selected city. Do not request another
   location observation or repeat a permission prompt by default.
3. When no usable city context exists, ask whether to determine the city here,
   and provide manual selection immediately. Request device location through
   the host geolocation capability only after choosing that option. Denial,
   timeout or unsupported geolocation leaves the searchable selector usable;
   do not repeatedly prompt or invent a fallback city.

The manual city list **must include search**. It must support selecting cities
without location permission, display country/region where needed, and distinguish
no search matches, no published points in the selected city, and a failed lookup.
Do not silently change an inferred city to the nearest city containing points.
A city with no eligible points displays an explicit empty state and an action to
choose another city. Only the selected BBond's eligible points are listed.

Origin handoff carries the minimum resolved city context rather than precise
coordinates. Same-origin navigation passes this context in application state.
Cross-origin navigation requires an explicit, validated handoff of the city ID;
shared cookies or cross-origin local-storage reads are not a solution. The exact
transport is an implementation decision. A city ID is a browsing hint, not proof
of physical presence or an authentication claim. Do not put raw coordinates,
authentication tokens, or private location history in the link. Share/copy links
must not automatically include the visitor's inferred city context.

If the source has only coordinates and no resolved city, use the authorized
existing observation to resolve the city through a defined location-to-city
adapter; do not collect another observation merely for this page. New coordinate
egress to a remote geocoder is not implicitly part of this contract: preserve
0x1's current local-location boundary and define any required service separately.

The selected city filters discovery; it does not move the Bond or Avaia, alter a
point's declared location, or claim the visitor is there. A direct point URL
opens that point without first demanding geolocation or city selection. Its
organization Back target preserves the previous city context when available;
otherwise it can use the point's published city as a browsing context without
claiming that it is the visitor's city.

## Origins and continuity

Two entry modes should converge on the same Business context:

- Inside an already running `nilx.one`, route to the organization/point within
  that origin and keep the world, camera and session alive. The internal route
  is `/?business=<allocated-label>&point=<point>` (omit `point` for the
  organization). Share/copy uses the public subdomain URL.
- A direct public URL loads the shared client on the BBond origin, resolves the
  organization and point, and opens the corresponding Dock. It does not require
  a redirect to `nilx.one`. Point-to-organization navigation on that subdomain
  stays within the same document after the initial load.

Changing the browser's visible hostname requires a document navigation. History
routing and service workers cannot remove that origin boundary. Cache immutable,
versioned client assets and public map resources where permitted, render the
shell early and revalidate public projections. Cache is an optimization, not a
promise of a shared renderer, session, storage or instant first visit across
subdomains. Never use stale publication or catalog data to authorize actions.

Current host-only identity cookies must not be widened or copied. Public
browsing need not authenticate the visitor. An authenticated action on another
origin needs a separately defined continuation/authorization flow; the BBond
in the URL is the viewed subject, never the visitor's identity.

Wildcard DNS/TLS and edge routing must serve registered Bond labels generally,
including direct loads and refreshes of point paths. Registration should not
require a per-business infrastructure change. This source inspection does not
establish current production DNS/TLS state or production registration of
`0xda-market`.

## Acceptance criteria for implementation

- Any registered BBond uses the same organization and point route mechanism;
  unallocated labels remain not found.
- Owner-scoped resolution rejects another owner's point and missing points;
  a zero-point BBond still renders as Business.
- Deep-link refresh opens the same point; point Back always opens its owner;
  same-origin navigation preserves the map instance.
- An incoming city context causes no geolocation request or permission prompt;
  missing context offers location or manual selection with search.
- A manual selection wins over delayed location responses; denied or unavailable
  geolocation, duplicate city names, empty results and point Back are handled.
- City discovery remains owner-scoped; private coordinates are not added to
  shared links or treated as presence evidence.
- Published display name, catalog and contacts follow the Dock order above;
  missing contact fields create no blank or invented entries.
- Preview, unavailable, empty and failed states remain distinct; point visibility
  and withdrawal follow the existing publication contract, including on refresh.
- Visitor session/identity is never taken from the business hostname; visiting or
  browsing does not record a purchase, presence, or BondChain completion.
- Full CI validates code and contracts; deploy validation checks the packaged
  routes and infrastructure configuration without activating a release.

## Status

The general client integration is implemented: role-based Business selection,
public and internal point routing, persistent map ownership, organization Back,
searchable city selection, assortment and public-contact rendering, and explicit
unavailable/empty/error states. The public HTTP contract is versioned and
validated by the client. Public projections are revalidated on navigation and
when the page becomes visible.

Same-origin navigation carries the city ID in history state. The public entry
can consume `#business-city=<city-id>` and removes it from the URL; share links
omit this hint. Existing observed coordinates can be matched locally against
city boundaries supplied by the directory, without sending coordinates to a
remote geocoder. No new geolocation request occurs without an explicit action.

The backend resolves the allocated label and Business role, but currently
returns `directory: { status: "unavailable" }`. The canonical BusinessPoint
publisher, city boundaries, catalog and public contacts still need to be wired
into this projection. Ready directories are exercised with test fixtures only;
production cannot yet list real points or offers through this endpoint. Legacy
stations are not promoted or granted verification, and no inventory is invented.

No DNS, registration, merge or deployment operation has been performed.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
