# 0x1 Web

The canonical Web client family for 0x1.

This monorepository contains one shared product application, thin entry points for browser and messenger Mini Apps, and bounded server-side adapters required by those hosts. It consumes versioned behavior from [`nilx-one/core`](https://github.com/nilx-one/core); React, host SDKs, provider services, and browser APIs do not define protocol truth.

## Architecture

The repository composes three scopes:

1. **Clean Architecture** controls dependency direction across the repository.
2. **Feature-level MVVM** separates React views from presentation state and application use cases.
3. **Host adapters** translate browser, Telegram, and future messenger capabilities behind explicit contracts.

Telegram is a host of the shared product, not an independent feature implementation. Server-side Telegram integration is isolated from browser bundles and remains an adapter to canonical Core contracts. See [Architecture](docs/architecture.md).

```text
apps -> product-app -> application
  |         |              ^
  |         +-> ui         |
  +-> host adapters        +-> core-wasm

services/identity -> pinned Core contracts
```

## Applications

- `apps/site` — official browser client;
- `apps/telegram-mini-app` — Telegram WebView composition root.

Both applications render the same `product-app` package. Host-specific code stays in adapters.

## Runtime services

- `services/identity` — server-side Telegram identity adapter and bot transport. It validates Telegram Mini App `initData`, persists the provider binding, and consumes `TELOXIDE_TOKEN` only at runtime. It does not own `pub_dress` semantics or protocol identity rules.

The browser and Mini App never receive the Telegram bot token.

## Local verification

Requires Node.js 24+ and pnpm 11. Rust is additionally required when changing `services/identity`.

```bash
pnpm install
pnpm check
pnpm dev:site
```

`pnpm check` runs repository policy, formatting, lint, strict TypeScript, contract tests, integration tests, and production builds for every host. Identity-service changes additionally run their dedicated Rust CI and runtime-package validation. CI does not deploy.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CLA.md](CLA.md), and [TRADEMARKS.md](TRADEMARKS.md) before submitting substantial work.

New authored source and configuration files must carry the canonical aiaiaiai copyright signature and `SPDX-License-Identifier: MPL-2.0` when the format supports comments. Repository policy CI validates this automatically.

## License

Licensed under the Mozilla Public License, Version 2.0 (`MPL-2.0`). See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

© 2026 aiaiaiai · aiaiaiai.org
