# nilx-one/web project

Web client for 0x1 — a persistent spatial interface for identity, host integrations, and the shared world behind [nilx.one](https://nilx.one).

This README is the durable source for the GitHub Project that coordinates work in [`nilx-one/web`](https://github.com/nilx-one/web). The Project tracks delivery; it does not define protocol truth.

## Scope

The Project tracks work required to evolve the canonical 0x1 Web client family:

- the browser client published at `nilx.one`;
- the shared `product-app` and UI surfaces used by supported hosts;
- browser, Telegram, Discord, and future host adapters without forking canonical behavior;
- native Web registration, authentication, sessions, and provider bindings;
- map and spatial presentation;
- accessibility, observability, testing, CI, packaging, and deploy readiness.

## Boundaries

Project work must preserve the repository architecture:

- protocol and shared behavioral truth come from versioned 0x1/Core contracts, not React views, host SDKs, browser APIs, or Project metadata;
- host-specific integrations remain adapters around the shared product rather than independent implementations;
- Project fields, statuses, estimates, and issue descriptions are coordination metadata only;
- merge and deployment are separate operations; production activation is not implied by a merged change.

## Delivery

Keep each item small enough to review as one coherent task:

1. start from the latest `master`;
2. use a dedicated `feature/` or `fix/` branch;
3. keep one task per branch and pull request;
4. run the repository's full correctness CI;
5. validate deployability when the change affects deployment;
6. merge only after the change is green and explicitly authorized;
7. deploy separately when explicitly requested.

Issues should describe the intended outcome, the owning architectural boundary, acceptance criteria, and the evidence required to consider the work complete. Pull requests should link back to the issue or Project item they implement.

## Sources of truth

Use the Project to navigate work, then verify decisions against the repository and protocol sources:

- [`README.md`](../../README.md) — repository purpose, applications, runtime services, and local verification;
- [`docs/architecture.md`](../architecture.md) — dependency direction and host/application boundaries;
- [`docs/map-data.md`](../map-data.md) — map data contracts and sourcing;
- [`docs/map-visual-language.md`](../map-visual-language.md) — map presentation language;
- [`nilx-one/core`](https://github.com/nilx-one/core) — versioned shared behavior consumed by the Web client;
- [`nilx-one/0x1`](https://github.com/nilx-one/0x1) — canonical 0x1 protocol and specification work.

When Project metadata and a canonical source disagree, the canonical source wins.

---

© 2026 aiaiaiai · aiaiaiai.org
