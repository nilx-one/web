#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

: "${IDENTITY_IMAGE:?IDENTITY_IMAGE is required}"
: "${IDENTITY_ENV_FILE:?IDENTITY_ENV_FILE is required}"
: "${IDENTITY_CONTRACT:?IDENTITY_CONTRACT is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

compose_file="${COMPOSE_FILE:-compose.yaml}"
edge_network="${EDGE_NETWORK:-nilx-edge}"

case "$IDENTITY_CONTRACT" in
  *[!0-9]*|'')
    echo "IDENTITY_CONTRACT must be a non-negative integer" >&2
    exit 1
    ;;
esac

test -r "$IDENTITY_ENV_FILE"
docker network inspect "$edge_network" >/dev/null
docker image inspect "$IDENTITY_IMAGE" >/dev/null

IDENTITY_IMAGE="$IDENTITY_IMAGE" \
IDENTITY_ENV_FILE="$IDENTITY_ENV_FILE" \
IDENTITY_CONTRACT="$IDENTITY_CONTRACT" \
RELEASE_SHA="$RELEASE_SHA" \
EDGE_NETWORK="$edge_network" \
  docker compose --file "$compose_file" config --quiet

IDENTITY_IMAGE="$IDENTITY_IMAGE" \
IDENTITY_ENV_FILE="$IDENTITY_ENV_FILE" \
IDENTITY_CONTRACT="$IDENTITY_CONTRACT" \
RELEASE_SHA="$RELEASE_SHA" \
EDGE_NETWORK="$edge_network" \
  docker compose --file "$compose_file" up --detach --remove-orphans

container_id="$(
  IDENTITY_IMAGE="$IDENTITY_IMAGE" \
  IDENTITY_ENV_FILE="$IDENTITY_ENV_FILE" \
  IDENTITY_CONTRACT="$IDENTITY_CONTRACT" \
  RELEASE_SHA="$RELEASE_SHA" \
  EDGE_NETWORK="$edge_network" \
    docker compose --file "$compose_file" ps --quiet identity
)"
test -n "$container_id"

active_contract="$(docker inspect --format '{{ index .Config.Labels "one.nilx.identity.contract" }}' "$container_id")"
if [ "$active_contract" != "$IDENTITY_CONTRACT" ]; then
  echo "Active identity contract mismatch: expected $IDENTITY_CONTRACT, got $active_contract" >&2
  exit 1
fi

attempt=1
while [ "$attempt" -le 30 ]; do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
  case "$health" in
    healthy)
      exit 0
      ;;
    unhealthy)
      docker logs --tail 80 "$container_id" >&2 || true
      exit 1
      ;;
  esac
  sleep 2
  attempt=$((attempt + 1))
done

docker logs --tail 80 "$container_id" >&2 || true
echo "identity service did not become healthy" >&2
exit 1
