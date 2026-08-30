#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
set -eu

cd "$(dirname "$0")"

: "${TELEGRAM_MINI_APP_IMAGE:?TELEGRAM_MINI_APP_IMAGE is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

EDGE_NETWORK="${EDGE_NETWORK:-nilx-edge}"

if [ "$EDGE_NETWORK" != "nilx-edge" ]; then
  echo "EDGE_NETWORK must be nilx-edge" >&2
  exit 1
fi

case "$RELEASE_SHA" in
  *[!0-9a-f]*|'')
    echo "RELEASE_SHA must be a lowercase hexadecimal commit SHA" >&2
    exit 1
    ;;
esac

if ! docker image inspect "$TELEGRAM_MINI_APP_IMAGE" >/dev/null 2>&1; then
  echo "Immutable runtime image is not loaded: $TELEGRAM_MINI_APP_IMAGE" >&2
  exit 1
fi

if ! docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then
  docker network create "$EDGE_NETWORK" >/dev/null
fi

export TELEGRAM_MINI_APP_IMAGE RELEASE_SHA EDGE_NETWORK

docker compose config --quiet
docker compose up -d --wait telegram-mini-app

container_id="$(docker compose ps -q telegram-mini-app)"
test -n "$container_id"

active_sha="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container_id")"
if [ "$active_sha" != "$RELEASE_SHA" ]; then
  echo "Active runtime revision mismatch: expected $RELEASE_SHA, got $active_sha" >&2
  exit 1
fi

if ! docker inspect "$container_id" \
  --format '{{range $network, $config := .NetworkSettings.Networks}}{{range $config.Aliases}}{{println .}}{{end}}{{end}}' \
  | grep -qx 'ox1-telegram-mini-app'; then
  echo "Expected edge alias is missing: ox1-telegram-mini-app" >&2
  exit 1
fi

docker compose exec -T telegram-mini-app wget -q -O - http://127.0.0.1:8080/health >/dev/null

echo "0x1 Telegram Mini App $RELEASE_SHA is healthy"
echo "Edge alias verified: ox1-telegram-mini-app"
