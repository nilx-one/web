#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

# Public smoke for the model boundary. A model nobody can fetch is a feature that renders
# unavailable for a reason that has nothing to do with anyone's device, so this asks the
# public origin the same questions a browser will.

set -eu

public_origin="${PUBLIC_ORIGIN:-https://nilx.one}"
model_id="${MODEL_ID:-Qwen3-0.6B-q4f16_1-MLC}"
model_revision="${MODEL_REVISION:-1}"
retry="${MODEL_RETRY:-12}"
retry_delay="${MODEL_RETRY_DELAY:-2}"

case "$public_origin" in
  https://*) ;;
  *)
    echo "PUBLIC_ORIGIN must use HTTPS" >&2
    exit 2
    ;;
esac

case "$model_id$model_revision" in
  *[!0-9A-Za-z._-]*|'')
    echo "MODEL_ID and MODEL_REVISION contain unsupported characters" >&2
    exit 2
    ;;
esac

case "$retry:$retry_delay" in
  *[!0-9:]*|:*|*:)
    echo "MODEL_RETRY and MODEL_RETRY_DELAY must be unsigned integers" >&2
    exit 2
    ;;
esac

public_origin="${public_origin%/}"
base_url="$public_origin/models/$model_id/resolve/$model_revision"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
manifest_file="$work_dir/manifest.json"

attempt=1
while [ "$attempt" -le "$retry" ]; do
  manifest_status="$(
    curl --silent --show-error \
      --connect-timeout 5 --max-time 15 \
      --output "$manifest_file" \
      --write-out '%{http_code}' \
      "$base_url/manifest.json" || true
  )"

  if [ "$manifest_status" = 200 ] && grep -Fq "\"$model_id\"" "$manifest_file"; then
    break
  fi

  if [ "$attempt" -eq "$retry" ]; then
    echo "model public smoke failed: expected the manifest of $model_id at $base_url/manifest.json, got ${manifest_status:-request-failed}" >&2
    exit 1
  fi

  sleep "$retry_delay"
  attempt=$((attempt + 1))
done

config_status="$(
  curl --silent --show-error \
    --connect-timeout 5 --max-time 15 \
    --output "$work_dir/mlc-chat-config.json" \
    --write-out '%{http_code}' \
    "$base_url/mlc-chat-config.json" || true
)"

if [ "$config_status" != 200 ]; then
  echo "model public smoke failed: chat config returned ${config_status:-request-failed}" >&2
  exit 1
fi

lib_headers="$work_dir/model.wasm.headers"
lib_status="$(
  curl --silent --show-error --head \
    --connect-timeout 5 --max-time 15 \
    --dump-header "$lib_headers" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$base_url/model.wasm" || true
)"

if [ "$lib_status" != 200 ]; then
  echo "model public smoke failed: model library returned ${lib_status:-request-failed}" >&2
  exit 1
fi

# A revision directory never changes, so anything short of an immutable answer means every
# eviction costs the full download again.
grep -iq 'cache-control:.*immutable' "$lib_headers" || {
  echo "model public smoke failed: $base_url/model.wasm is not served as immutable" >&2
  exit 1
}

echo "model public boundary healthy: manifest 200, config 200, library 200 and immutable"
