# 0x1 Web runtime

The production workload in this repository is the canonical 0x1 Web client, not a Telegram-specific application. Telegram and future messenger integrations remain host adapters around the shared product.

## Public contract

The canonical edge identity is:

```text
ox1-web:8080
```

The intended public route is:

```text
https://0x1.nilx.one/* -> ox1-web:8080/*
```

`0x0sky/infra` owns the public HTTPS route. This repository owns the application build, immutable image, container identity and release lifecycle.

During migration from the earlier Telegram-named runtime, the container also exposes the compatibility alias `ox1-telegram-mini-app`. This keeps the currently deployed edge contract functional until infra is updated to `ox1-web`.

## Image lifecycle

`package-web.yml` runs after changes reach `master`. It performs artifact packaging only:

1. builds `@nilx-one/site` with the pinned verified Core Wasm runtime;
2. builds the static production image;
3. publishes `ghcr.io/nilx-one/0x1-web:sha-<commit>`.

It does not repeat the repository's full CI suite and does not deploy.

PR CI builds every Web host once. Deploy validation reuses the already-built browser `dist` artifact to validate the runtime image and Compose contract without rebuilding application source.

## Deployment

Production deployment is manual-only through `deploy-web.yml` and must run from `master`.

Required GitHub Environment `production` settings:

- secret `SSH_HOST`;
- secret `SSH_USER`;
- secret `SSH_PRIVATE_KEY`;
- optional variable `SSH_PORT` (default `22022`);
- optional variable `SSH_DEPLOYMENT_PATH` (default `.local/share/nilx-one/web`).

Relative deployment paths are resolved against the SSH user's home directory. The default therefore requires no root-owned `/opt` directory and no `sudo` permission for the `deploy` user.

The deploy workflow consumes the immutable image for the selected `master` commit, copies only deployment descriptors to the server, loads the image, activates it, verifies container health/revision/edge aliases and rolls back to the previous release if activation fails.

The deployment does not build source, change DNS or mutate shared Caddy configuration.

## Runtime

```text
container:  nilx-one-web-web-1
network:    nilx-edge
alias:      ox1-web
compat:     ox1-telegram-mini-app
port:       8080
health:     /health
```

Protocol truth stays outside the Web rendering and host layers.

---

© 2026 aiaiaiai · aiaiaiai.org
