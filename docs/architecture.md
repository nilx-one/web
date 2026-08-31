# Web Architecture

## Decision

0x1 Web uses **Clean Architecture across repository boundaries** and **MVVM inside presentation features**.

This is a composition, not two competing application architectures:

- Clean Architecture decides which layer may depend on which other layer;
- application use cases orchestrate ports without owning protocol rules;
- MVVM turns application projections into stable, testable view state;
- React views render that state and emit user intent;
- browser and messenger APIs enter only through host adapters;
- bounded server-side host services verify provider claims and keep provider secrets out of browser bundles;
- `nilx-one/core` remains the executable owner of shared protocol and product behavior.

VIPER is not the default for React features. Its Router and Presenter roles overlap with typed routing and MVVM view models, while its additional objects add little isolation at this stage. A feature may adopt a stricter interactor/presenter split later only when its complexity demonstrates the need.

## Dependency rule

Dependencies point inward:

| Scope         | May depend on                                     | Must not own                                                                     |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `application` | no Web package                                    | BondChain completion, Relationship derivation, gamification, or other Core rules |
| `product-app` | `application`, `host-contract`, `ui`              | host SDK access or protocol decisions                                            |
| `ui`          | React                                             | use cases, Core bindings, host behavior, or product state                        |
| `core-wasm`   | `application` ports                               | presentation or host behavior                                                    |
| host adapters | `host-contract`                                   | product flows or protocol authority                                              |
| `apps/*`      | composition dependencies                          | copied screens or business logic                                                 |
| `services/*`  | pinned Core contracts, provider SDKs, persistence | protocol semantics, UI state, or browser-visible secrets                         |

The architecture test rejects forbidden internal imports and messenger-global access outside its adapter. Server-side services have their own language-level and deployment checks because they are not part of the browser dependency graph.

## Runtime composition

```mermaid
flowchart TD
    Host["Browser or Telegram host"] --> Root["App composition root"]
    Root --> View["Feature View + ViewModel"]
    View --> UseCase["Application use case"]
    UseCase --> CorePort["Core port"]
    CorePort --> Wasm["Rust Core via WebAssembly"]
    Root --> IdentityAPI["Identity HTTP adapter"]
    IdentityAPI --> IdentityService["services/identity"]
    IdentityService --> CoreContracts["Pinned Rust Core contracts"]
    Telegram["Telegram"] --> IdentityService
```

The arrow into WebAssembly is an adapter boundary. Until a versioned Core artifact exists, the adapter returns an explicit unavailable projection. The UI must not replace the missing behavior with TypeScript rules or sample relationship truth.

The server-side identity service is also an adapter boundary. It may verify Telegram evidence and persist a provider binding, but it may not redefine canonical `pub_dress` validation or infer protocol identity facts beyond the contract it consumes from Core.

## Host boundary

Every client host provides capabilities through `host-contract`:

- authentication envelope;
- theme and safe-area state;
- lifecycle events;
- back navigation;
- haptics;
- external links and sharing.

Telegram `initData` is always marked unverified at the client boundary. It becomes authentication context only after server-side signature validation. `TELOXIDE_TOKEN` exists only in the server-side identity runtime and must never enter Vite configuration, client JavaScript, static assets, or browser-visible environment state. Host availability changes presentation capability, never Core semantics.

The canonical production Web origin is `https://nilx.one`. Telegram Mini App authentication remains an ephemeral host envelope under `/telegram/`. Browser authentication uses the single flat route `/auth?provider=telegram` for both initiation and callback: absence of an authorization response starts the flow, while a returned `code` and `state` complete it. The auth router accepts only explicitly implemented provider values and fails closed for a missing, repeated, or unknown `provider`. Successful authentication becomes a server-managed same-origin session before the shared identity API accepts it. Both Telegram evidence forms must resolve to the same Telegram user identifier and therefore the same Stage 1 Bond identity; a browser login must never create a second provider namespace or identity record.

The bounded identity API remains same-origin under `/api/v1/*`. A separate API origin is not part of the current contract because it would add cross-origin and cookie policy without changing the identity boundary.

## Rendering boundary

Custom graphics select WebGPU by capability. Failure to acquire an adapter falls back to WebGL2. If neither is available, the feature exposes an unsupported state. There is no `CanvasRenderingContext2D` fallback.

MapLibre will own geographic rendering when the map vertical slice begins. Shared spatial and visibility decisions must arrive as Core projections rather than TypeScript rules.

## Feature shape

Each product feature grows vertically:

```text
features/<feature>/
├── <feature>-view.tsx
├── <feature>-view-model.ts
└── <feature>-view-model.test.ts
```

Use cases and ports that are shared across presentation features live in `application`. Host-specific branches do not live in feature views or view models.

## Delivery

Every browser and Mini App entry point must pass the same formatting, lint, type, contract, integration, accessibility, and production-build gates. Server-side services pass their own full CI and deployability validation. Packaging produces immutable artifacts; merge and deployment remain separate, and production deployment is manual.

---

© 2026 aiaiaiai · aiaiaiai.org
