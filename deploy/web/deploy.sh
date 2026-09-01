#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
set -eu

cd "$(dirname "$0")"

: "${CLIENT_NAME:?CLIENT_NAME is required}"
: "${CLIENT_IMAGE:?CLIENT_IMAGE is required}"
: "${CLIENT_ROOT:?CLIENT_ROOT is required}"
: "${EDGE_ALIAS:?EDGE_ALIAS is required}"
: "${COMPAT_EDGE_ALIAS:?COMPAT_EDGE_ALIAS is required}"
: "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

EDGE_NETWORK="${EDGE_NETWORK:-nilx-edge}"

case "$CLIENT_NAME" in
  *[!a-z0-9-]*|'')
    echo "CLIENT_NAME must contain only lowercase letters, digits, and hyphens" >&2
    exit 1
    ;;
esac

case "$EDGE_ALIAS" in
  *[!a-z0-9-]*|'')
    echo "EDGE_ALIAS must contain only lowercase letters, digits, and hyphens" >&2
    exit 1
    ;;
esac

case "$COMPAT_EDGE_ALIAS" in
  *[!a-z0-9-]*|'')
    echo "COMPAT_EDGE_ALIAS must contain only lowercase letters, digits, and hyphens" >&2
    exit 1
    ;;
esac

case "$RELEASE_SHA" in
  *[!0-9a-f]*|'')
    echo "RELEASE_SHA must be a lowercase hexadecimal commit SHA" >&2
    exit 1
    ;;
esac

case "$CLIENT_ROOT" in
  /srv/*) ;;
  *)
    echo "CLIENT_ROOT must be inside /srv" >&2
    exit 1
    ;;
esac

if [ "$EDGE_NETWORK" != "nilx-edge" ]; then
  echo "EDGE_NETWORK must be nilx-edge" >&2
  exit 1
fi

if ! docker image inspect "$CLIENT_IMAGE" >/dev/null 2>&1; then
  echo "Immutable client image is not loaded: $CLIENT_IMAGE" >&2
  exit 1
fi

if ! docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then
  docker network create "$EDGE_NETWORK" >/dev/null
fi

export CLIENT_NAME CLIENT_IMAGE CLIENT_ROOT EDGE_ALIAS COMPAT_EDGE_ALIAS COMPOSE_PROJECT_NAME RELEASE_SHA EDGE_NETWORK

docker compose config --quiet
docker compose up -d --wait --remove-orphans client

container_id="$(docker compose ps -q client)"
test -n "$container_id"

active_sha="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container_id")"
if [ "$active_sha" != "$RELEASE_SHA" ]; then
  echo "Active runtime revision mismatch: expected $RELEASE_SHA, got $active_sha" >&2
  exit 1
fi

active_client="$(docker inspect --format '{{ index .Config.Labels "one.nilx.client" }}' "$container_id")"
if [ "$active_client" != "$CLIENT_NAME" ]; then
  echo "Active client mismatch: expected $CLIENT_NAME, got $active_client" >&2
  exit 1
fi

aliases="$(docker inspect "$container_id" \
  --format '{{range $network, $config := .NetworkSettings.Networks}}{{range $config.Aliases}}{{println .}}{{end}}{{end}}')"

printf '%s\n' "$aliases" | grep -qx "$EDGE_ALIAS" || {
  echo "Expected edge alias is missing: $EDGE_ALIAS" >&2
  exit 1
}

if [ "$COMPAT_EDGE_ALIAS" != "$EDGE_ALIAS" ]; then
  printf '%s\n' "$aliases" | grep -qx "$COMPAT_EDGE_ALIAS" || {
    echo "Expected compatibility edge alias is missing: $COMPAT_EDGE_ALIAS" >&2
    exit 1
  }
fi

docker compose exec -T client test -f "$CLIENT_ROOT/index.html"
docker compose exec -T client wget -q -O - http://127.0.0.1:8080/health >/dev/null

echo "0x1 $CLIENT_NAME $RELEASE_SHA is healthy"
echo "Edge alias verified: $EDGE_ALIAS"
