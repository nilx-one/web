# 0x1 Web client runtime

The production artifact in this repository is one immutable Web client image containing every built host composition. Browser, Telegram, Discord, and future messenger hosts are deployment targets of the same 0x1 Web client, not separate products.

## Host contract

`deploy/web/targets.json` is the deployment manifest. Each target declares the built application, runtime root, edge alias, Compose project identity, public path, and minimum identity-service contract it requires.

Current targets are:

```text
web       -> /          -> ox1-web
telegram  -> /telegram/ -> ox1-telegram
discord   -> /discord/  -> ox1-discord
```

The Browser host temporarily keeps the compatibility alias `ox1-telegram-mini-app` so the existing shared edge remains valid while public routing migrates to explicit host aliases.

All host containers proxy only the bounded identity API surface to `ox1-identity:8080`. Protocol truth stays outside rendering and host layers.

## Immutable package

`package-web.yml` builds all host compositions with the pinned verified Core Wasm runtime and publishes one image:

```text
ghcr.io/nilx-one/0x1-web:sha-<commit>
```

The image contains:

```text
/srv/site
/srv/telegram-mini-app
/srv/discord-activity
```

Each deployed host selects exactly one runtime root through `CLIENT_ROOT`. This allows `web`, `telegram`, and `discord` to advance independently while reusing the same verified artifact for a given commit.

## Deployment

`Deploy Production` is the only manual production entry point.

Available targets:

```text
all
web
telegram
discord
identity
```

For a client target, the orchestrator reads `requiresIdentityContract` from the deployment manifest. The identity dependency workflow inspects the active production identity contract and performs no environment transition when the active contract is already sufficient. When a newer contract is required, it resolves the newest successful packaged identity image in the selected release ancestry, verifies the image contract label, activates identity first, and only then allows client deployment.

`identity` is an explicit maintenance target that forces activation of the newest verified identity package available in the selected master ancestry.

`all` resolves the full client target list from the manifest, ensures the maximum required identity contract once, then activates each client host in deterministic order.

Each client target has its own release directory under `${CLIENT_DEPLOYMENT_ROOT:-.local/share/nilx-one}/<target>` and its own Compose project. Updating one target does not move the others to a new image SHA.

Deployment consumes immutable GHCR packages. It does not rebuild source or rerun full CI.

## Identity contract

`services/identity/deploy/contract.version` is the monotonic runtime contract version provided by the identity service. Client targets declare only the minimum contract they require.

A client-only change must not increase that requirement unless a verified identity package providing the new contract exists in the release ancestry.

## Edge ownership

`0x0sky/infra` owns public HTTPS route selection. This repository owns host builds, immutable packages, container aliases, dependency requirements, and release activation.

---

© 2026 aiaiaiai · aiaiaiai.org
