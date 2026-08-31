# 0x1 Web runtime

The production workload in this repository is the canonical 0x1 Web client. Telegram and future messenger integrations are host adapters around the shared product, not separate product runtimes.

## Public contract

The canonical edge identity is:

```text
ox1-web:8080
```

The intended public routes are:

```text
https://app.nilx.one/*                         -> canonical Browser host
https://app.nilx.one/telegram/                 -> Telegram Mini App host
https://app.nilx.one/auth?provider=telegram    -> browser Telegram sign-in start
https://app.nilx.one/auth/callback?provider=telegram
                                                -> Telegram OIDC callback
```

Both hosts are packaged into the same immutable `0x1-web` image and consume the same shared product and verified Core runtime. `/telegram` redirects to `/telegram/` so relative Vite assets remain inside the Telegram host path.

Browser authentication uses one explicit entry point with an allowlisted `provider` selector. The current Stage 1 identity profile accepts only `provider=telegram`; a missing, repeated, or unknown provider value must fail closed. A future provider is added only with its own adapter contract rather than being inferred from arbitrary query input. The callback exchanges Telegram's authorization code server-side and establishes a same-origin session; neither the code nor provider tokens belong in browser storage.

`0x0sky/infra` owns the public HTTPS route. This repository owns the application build, immutable image, container identity and release lifecycle.

The Web runtime proxies only the bounded Stage 1 identity surface to the registrar's private edge identity:

```text
/api/v1/identity* -> ox1-identity:8080
```

The Telegram host loads Telegram's official Mini App bridge before application code. It forwards raw `Telegram.WebApp.initData` only to the identity adapter; the registrar verifies that authentication server-side. Neither the browser bundle nor the Telegram host treats `initData` as verified identity.

During migration from the earlier Telegram-named runtime, the container also exposes the compatibility alias `ox1-telegram-mini-app`. This keeps the currently deployed edge contract functional until infra is updated to `ox1-web`.

## Telegram configuration

The production Main Mini App URL is:

```text
https://app.nilx.one/telegram/
```

Telegram Web Login configuration must allow both the application origin and the exact OIDC redirect URI:

```text
https://app.nilx.one
https://app.nilx.one/auth/callback?provider=telegram
```

Telegram-side activation remains an external configuration step in BotFather. Configure the 0x1 bot's Main Mini App or menu button to use the URL above only after the corresponding `0x1-web` revision has been deployed. No bot token belongs in this static Web runtime.

## Image lifecycle

`package-web.yml` runs after changes reach `master`. It performs artifact packaging only:

1. builds `@nilx-one/site` and `@nilx-one/telegram-mini-app` with the pinned verified Core Wasm runtime;
2. builds one static production image containing both host artifacts;
3. publishes `ghcr.io/nilx-one/0x1-web:sha-<commit>`.

It does not repeat the repository's full CI suite and does not deploy.

PR CI builds every Web host once. Deploy validation reuses both verified host artifacts, validates the runtime image and Compose contract, and smoke-tests `/` plus `/telegram/` without rebuilding application source.

## Deployment

Production deployment is manual-only through `deploy-web.yml` and must run from `master`.

Required GitHub Environment `production` settings:

- secret `SSH_HOST`;
- secret `SSH_USER`;
- secret `SSH_PRIVATE_KEY`;
- optional variable `SSH_PORT` (default `22022`);
- optional variable `WEB_DEPLOYMENT_PATH` (default `.local/share/nilx-one/web`).

The legacy `SSH_DEPLOYMENT_PATH` variable is intentionally ignored by the Web workflow. This prevents a stale Telegram-specific `/opt/...` value from overriding the canonical Web release path.

Relative deployment paths are resolved against the SSH user's home directory. The default therefore requires no root-owned `/opt` directory and no `sudo` permission for the `deploy` user.

A manual deploy may be started immediately after a merge. The workflow waits for the `Package Web` run for the exact same commit to finish. It proceeds only when that producer run succeeds, fails immediately when packaging fails, and then verifies the exact immutable GHCR image before any SSH activation.

The deploy workflow copies only deployment descriptors to the server, loads the immutable image, activates it, verifies container health/revision/edge aliases and rolls back to the previous release if activation fails.

The deployment does not build source, change DNS, mutate shared Caddy configuration or configure BotFather.

## Runtime

```text
container:  nilx-one-web-web-1
network:    nilx-edge
alias:      ox1-web
compat:     ox1-telegram-mini-app
port:       8080
health:     /health
browser:    /
telegram:   /telegram/
```

Protocol truth stays outside the Web rendering and host layers.

---

© 2026 aiaiaiai · aiaiaiai.org
