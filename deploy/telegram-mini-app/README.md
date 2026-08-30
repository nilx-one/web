# 0x1 Telegram Mini App runtime

The Telegram Mini App is the Telegram composition root of the same 0x1 Web product. It is packaged as a static immutable OCI image and joins the shared `nilx-edge` network as `ox1-telegram-mini-app:8080`.

## Public contract

The intended shared-edge route is:

```text
https://0x1.nilx.one/* -> ox1-telegram-mini-app:8080/*
```

`0x0sky/infra` owns the public HTTPS route. This repository owns the application build, image, container identity and release lifecycle.

## Image lifecycle

`package-telegram-mini-app.yml` runs after changes reach `master`. It performs only artifact packaging:

1. builds `@nilx-one/telegram-mini-app`;
2. builds the static runtime image;
3. publishes the immutable image as `ghcr.io/nilx-one/0x1-telegram-mini-app:sha-<commit>`.

It does not repeat the repository's full CI suite and does not deploy.

PR CI builds all Web hosts once. The deploy-validation job reuses the already-built Telegram `dist` artifact to validate the runtime image and Compose contract without rebuilding application source.

## Deployment

Production deployment is manual-only through `deploy-telegram-mini-app.yml` and must run from `master`.

Required GitHub Environment `production` settings:

- secret `SSH_HOST`;
- secret `SSH_USER`;
- secret `SSH_PRIVATE_KEY`;
- optional variable `SSH_PORT` (default `22022`);
- optional variable `SSH_DEPLOYMENT_PATH` (default `/opt/nilx-one-web/telegram-mini-app`).

The deploy workflow consumes the immutable image for the selected `master` commit, copies only deployment descriptors to the server, pulls the image, activates it, verifies container health/revision/edge alias and rolls back to the previous release if activation fails.

The deployment does not build source, change DNS, change shared Caddy, configure BotFather or create Telegram credentials.

## Runtime

The image contains only the built static Mini App and Caddy. It exposes internal port `8080` and `/health`.

```text
container:  nilx-one-telegram-mini-app-telegram-mini-app-1
network:    nilx-edge
alias:      ox1-telegram-mini-app
port:       8080
health:     /health
```

No Telegram bot token is needed by this static Web host. Telegram-specific launch context remains an input through the existing host adapter; protocol truth stays outside the WebView layer.

---

© 2026 aiaiaiai · aiaiaiai.org
