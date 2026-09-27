# 0x1 Web client runtime

The production artifact in this repository is one immutable Web client image containing every built host composition. Browser, Telegram, Discord, and future messenger hosts are deployment targets of the same 0x1 Web client, not separate products.

## Host contract

`deploy/web/targets.json` is the deployment manifest. Each target declares the built application, runtime root, edge alias, Compose project identity, public path, and minimum identity-service contract it requires.

Current targets are:

```text
web       -> /          -> nilxone-web
telegram  -> /telegram/ -> nilxone-telegram
discord   -> /discord/  -> nilxone-discord
```

All host containers proxy only the bounded identity API surface to `nilxone-identity:1927`. Protocol truth stays outside rendering and host layers.

Discord is the one host that does not reach this surface directly. An Activity is served from `<client_id>.discordsays.com` and every request it makes is answered by Discord's proxy, which matches only paths below `/.proxy/` against the Activity's URL mappings. The Discord client therefore re-roots its own absolute paths — `/api`, `/map`, `/core` — under that prefix at runtime; the deployed surface stays identical for every host. Discord authentication additionally requires `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in the identity service runtime, without which `/api/v1/auth/discord/config` reports the host as unconfigured.

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

## Model artifacts

Local narration loads a model from this host, not from a third party. What may be served is the catalog in `packages/narration-webllm/src/model-catalog.json` — the same table Settings offers from — and `deploy/web/bootstrap-models.sh` places one entry per invocation, the way `bootstrap-basemap.sh` places the basemap:

```sh
for id in Qwen3-0.6B-q4f16_1-MLC Qwen3-1.7B-q4f16_1-MLC SmolLM2-360M-Instruct-q4f16_1-MLC \
  OLMo-2-0425-1B-Instruct-q4f16_1-MLC Llama-3.2-1B-Instruct-q4f16_1-MLC; do
  MODEL_ROOT=/srv/models MODEL_ID="$id" sh deploy/web/bootstrap-models.sh
done
```

The catalog names each entry's revision, the conversion commit its weights are fetched from, and the model library the pinned registry pairs with it, so no entry can be paired with another entry's library by default. A `model_id` the catalog does not serve is refused before anything is fetched: nothing is mirrored before its licence is read (`nilx-one/ai` `docs/model-licences.md`). Every revision directory also receives the licence files its entry names — the Apache-2.0 text for four entries; the Llama 3.2 Community License and its `NOTICE` for Llama — copied from `deploy/web/third_party/` and refused if their sha256 is not the one that was read.

**Order of a rollout.** `Qwen3-0.6B` moves to revision `2`, the first to carry `LICENSE` and the notices the licence reading produced. Bootstrap every entry before deploying a client built from this catalog: until an entry's revision exists here, browsers load that entry from its upstream registry instead, which works and is exactly the third-party fetch the mirror exists to avoid. Revision `1` of `Qwen3-0.6B` can be removed once no deployed client asks for it.

It fetches the chat config, the tokenizer, the artifact manifest, every weight shard and the compiled model library; checks each shard against the size its manifest declares; writes everything atomically into `$MODEL_ROOT/<model_id>/resolve/<revision>/`; and leaves a `manifest.json` carrying the total download size, the shard list, SRI hashes for the config, tokenizer and library, the upstream sources, the licence and its files, any attribution the licence obliges, and the notices from the catalog. A revision that already exists is left alone.

The path is not decorative. WebLLM appends `resolve/main/` to any model URL that does not already name a revision, so serving from `…/resolve/<revision>/` both satisfies that rule and gives a directory whose contents never change — which is why Caddy serves `/models/*` as `immutable`, and why re-acquiring a model after a browser evicts it costs a cache hit rather than the whole download.

Why this host rather than a bucket, for now:

- same origin as the app, so no third party learns who is loading an avatar and nothing has to be negotiated with CORS;
- no new vendor, credentials, or bill, on a path that already carries a large third-party asset;
- an immutable revision path is exactly what a CDN would want later, so putting one in front of `/models/*` is a configuration change rather than a redesign.

`deploy/web/check-models-public.sh` is the public smoke, for every served entry at its catalog revision (or one, with `MODEL_ID`): the manifest answers for that entry, the chat config answers, the library answers and is served immutable, and every licence file beside the weights answers. Both scripts are covered by `.test.sh` neighbours that mock `curl`, and CI runs them with the other deployment scripts.

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

For every target, the orchestrator reads `requiresIdentityContract` from the deployment manifest and runs the identity dependency workflow first. It resolves the newest successful packaged identity image in the selected release ancestry and verifies that its `contract.version` satisfies the requirement. The active identity image is read from the newest successful `nilxone-identity` run in infra. Identity is activated only when needed: when the target forces it, when the active image is unknown, or when the release carries a different identity package. It is left alone when that package is already active, or when a newer package with a sufficient contract is (so a branch deploy never downgrades it). Client deployment starts only after identity is settled.

`identity` is an explicit maintenance target that forces activation of the newest verified identity package available in the selected ancestry.

`all` is the complete release path: it settles Identity as above, then rolls out every client target from the manifest in `deployOrder`, one host at a time. Each client job waits for its infra `deploy-workload` run to finish (`deploy/infra-workload.sh await`), and a failed host stops the remaining ones. Each target retains its own rollback boundary; `all` is coordinated but not a cross-target transactional rollback.

Each client target has its own release directory under `${CLIENT_DEPLOYMENT_ROOT:-.local/share/nilx-one}/<target>` and its own Compose project. Updating one target does not move the others to a new image SHA.

Deployment consumes immutable GHCR packages. It does not rebuild source or rerun full CI.

## Identity contract

`services/identity/deploy/contract.version` is the monotonic runtime contract version provided by the identity service. Client targets declare only the minimum contract they require.

A client-only change must not increase that requirement unless a verified identity package providing the new contract exists in the release ancestry.

## Edge ownership

`0x0sky/infra` owns public HTTPS route selection. This repository owns host builds, immutable packages, container aliases, dependency requirements, and release activation.

---

© 2026 aiaiaiai · aiaiaiai.org
