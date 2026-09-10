#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -eu

public_origin="${PUBLIC_ORIGIN:-https://nilx.one}"
health_retry="${HEALTH_RETRY:-12}"
health_retry_delay="${HEALTH_RETRY_DELAY:-2}"

case "$public_origin" in
  https://*) ;;
  *)
    echo "PUBLIC_ORIGIN must use HTTPS" >&2
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
body_file="$work_dir/identity-public-check.body"

request_until() {
  path="$1"
  expected_status="$2"
  expected_body="$3"
  label="$4"
  attempt=1

  while [ "$attempt" -le "$health_retry" ]; do
    status="$(
      curl --silent --show-error \
        --connect-timeout 5 \
        --max-time 15 \
        --output "$body_file" \
        --write-out '%{http_code}' \
        "$public_origin$path" || true
    )"

    if [ "$status" = "$expected_status" ] && grep -Fq "$expected_body" "$body_file"; then
      echo "public boundary healthy: $label ($status)"
      return 0
    fi

    if [ "$attempt" -lt "$health_retry" ]; then
      sleep "$health_retry_delay"
    fi
    attempt=$((attempt + 1))
  done

  echo "public boundary failed: $label expected $expected_status and $expected_body from $public_origin$path, got ${status:-request-failed}" >&2
  return 1
}

request_until \
  '/api/v1/identity' \
  401 \
  '"code":"provider_authentication_required"' \
  'identity-auth-boundary'

request_until \
  '/api/v1/auth/browser/provider/context' \
  200 \
  '"available":{"telegram":true,"discord":true}' \
  'browser-provider-availability'