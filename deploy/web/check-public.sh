#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

public_origin="${PUBLIC_ORIGIN:-https://nilx.one}"
public_path="${PUBLIC_PATH:?PUBLIC_PATH is required}"
client_name="${CLIENT_NAME:?CLIENT_NAME is required}"
health_retry="${HEALTH_RETRY:-12}"
health_retry_delay="${HEALTH_RETRY_DELAY:-2}"

case "$public_origin" in
  https://*) ;;
  *)
    echo "PUBLIC_ORIGIN must use HTTPS" >&2
    exit 2
    ;;
esac

case "$public_path" in
  /*) ;;
  *)
    echo "PUBLIC_PATH must start with /" >&2
    exit 2
    ;;
esac

case "$client_name" in
  *[!a-z0-9-]*|'')
    echo "CLIENT_NAME must contain only lowercase letters, digits, and hyphens" >&2
    exit 2
    ;;
esac

case "$health_retry" in
  ''|*[!0-9]*)
    echo "HEALTH_RETRY must be an unsigned integer" >&2
    exit 2
    ;;
esac

case "$health_retry_delay" in
  ''|*[!0-9]*)
    echo "HEALTH_RETRY_DELAY must be an unsigned integer" >&2
    exit 2
    ;;
esac

public_origin="${public_origin%/}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
body_file="$work_dir/$client_name.body"
attempt=1

while [ "$attempt" -le "$health_retry" ]; do
  status="$(
    curl --silent --show-error \
      --connect-timeout 5 \
      --max-time 15 \
      --output "$body_file" \
      --write-out '%{http_code}' \
      "$public_origin$public_path" || true
  )"

  if [ "$status" = 200 ] && grep -Fq '<div id="root"></div>' "$body_file"; then
    echo "public boundary healthy: $client_name ($status)"
    exit 0
  fi

  if [ "$attempt" -lt "$health_retry" ]; then
    sleep "$health_retry_delay"
  fi
  attempt=$((attempt + 1))
done

echo "public boundary failed: $client_name expected 200 from $public_origin$public_path, got ${status:-request-failed}" >&2
exit 1
