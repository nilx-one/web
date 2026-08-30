# 0x1 Web

The canonical Web client family for 0x1.

This monorepository contains one shared product application and thin entry points for the browser and messenger Mini Apps. It consumes versioned behavior from [`nilx-one/core`](https://github.com/nilx-one/core); React, host SDKs, and browser APIs do not define protocol truth.

## Architecture

The repository composes three scopes:

1. **Clean Architecture** controls dependency direction across the repository.
2. **Feature-level MVVM** separates React views from presentation state and application use cases.
3. **Host adapters** translate browser, Telegram, and future messenger capabilities behind one contract.

Telegram is a host of the shared product, not an independent feature implementation. See [Architecture](docs/architecture.md).

```text
apps -> product-app -> application
  |         |              ^
  |         +-> ui         |
  +-> host adapters        +-> core-wasm
```

## Applications

- `apps/site` — official browser client;
- `apps/telegram-mini-app` — Telegram WebView composition root.

Both applications render the same `product-app` package. Host-specific code stays in adapters.

## Local verification

Requires Node.js 24+ and pnpm 11.

```bash
pnpm install
pnpm check
pnpm dev:site
```

`pnpm check` runs repository policy, formatting, lint, strict TypeScript, contract tests, integration tests, and production builds for every host. CI does not deploy.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CLA.md](CLA.md), and [TRADEMARKS.md](TRADEMARKS.md) before submitting substantial work.

New authored source and configuration files must carry the canonical aiaiaiai copyright signature and `SPDX-License-Identifier: MPL-2.0` when the format supports comments. Repository policy CI validates this automatically.

## License

Licensed under the Mozilla Public License, Version 2.0 (`MPL-2.0`). See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

© 2026 aiaiaiai · aiaiaiai.org
