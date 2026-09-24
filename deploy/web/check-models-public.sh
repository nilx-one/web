#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

# Public smoke for the model boundary. A model nobody can fetch is a feature that renders
# unavailable for a reason that has nothing to do with anyone's device, so this asks the
# public origin the same questions a browser will — for every entry the catalog serves, at
# the revision the catalog names, including the licence files that travel with the weights.
# MODEL_ID narrows the check to one entry.

set -eu

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
MODEL_CATALOG="${MODEL_CATALOG:-$script_dir/../../packages/narration-webllm/src/model-catalog.json}"
public_origin="${PUBLIC_ORIGIN:-https://nilx.one}"
only_model="${MODEL_ID:-}"
retry="${MODEL_RETRY:-12}"
retry_delay="${MODEL_RETRY_DELAY:-2}"

case "$public_origin" in
  https://*) ;;
  *)
    echo "PUBLIC_ORIGIN must use HTTPS" >&2
    exit 2
    ;;
esac

case "$only_model" in
  *[!0-9A-Za-z._-]*)
    echo "MODEL_ID contains unsupported characters" >&2
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
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

# One line per served entry: model_id, revision, then the licence files beside the weights.
entries="$(python3 -c '
import json, sys
catalog = json.load(open(sys.argv[1], encoding="utf-8"))
for model in catalog["models"]:
    if sys.argv[2] in ("", model["model_id"]):
        files = [item["name"] for item in model["mirror"]["licence_files"]]
        print(" ".join([model["model_id"], model["mirror"]["revision"], *files]))
' "$MODEL_CATALOG" "$only_model")"

[ -n "$entries" ] || {
  echo "model public smoke failed: ${only_model:-the catalog} is not served" >&2
  exit 1
}

status_of() {
  # $1 url, $2 output file
  curl --silent --show-error \
    --connect-timeout 5 --max-time 15 \
    --output "$2" \
    --write-out '%{http_code}' \
    "$1" || true
}

check_entry() {
  model_id="$1"
  model_revision="$2"
  shift 2
  base_url="$public_origin/models/$model_id/resolve/$model_revision"
  manifest_file="$work_dir/$model_id.manifest.json"

  attempt=1
  while [ "$attempt" -le "$retry" ]; do
    manifest_status="$(status_of "$base_url/manifest.json" "$manifest_file")"
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

  config_status="$(status_of "$base_url/mlc-chat-config.json" "$work_dir/config.json")"
  if [ "$config_status" != 200 ]; then
    echo "model public smoke failed: $model_id chat config returned ${config_status:-request-failed}" >&2
    exit 1
  fi

  lib_headers="$work_dir/$model_id.model.wasm.headers"
  lib_status="$(
    curl --silent --show-error --head \
      --connect-timeout 5 --max-time 15 \
      --dump-header "$lib_headers" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$base_url/model.wasm" || true
  )"
  if [ "$lib_status" != 200 ]; then
    echo "model public smoke failed: $model_id model library returned ${lib_status:-request-failed}" >&2
    exit 1
  fi

  # A revision directory never changes, so anything short of an immutable answer means every
  # eviction costs the full download again.
  grep -iq 'cache-control:.*immutable' "$lib_headers" || {
    echo "model public smoke failed: $base_url/model.wasm is not served as immutable" >&2
    exit 1
  }

  # Serving the weights without their licence is redistributing them without it.
  for licence_file in "$@"; do
    licence_status="$(status_of "$base_url/$licence_file" "$work_dir/licence")"
    if [ "$licence_status" != 200 ]; then
      echo "model public smoke failed: $model_id $licence_file returned ${licence_status:-request-failed}" >&2
      exit 1
    fi
  done

  echo "  $model_id@$model_revision: manifest, config, library (immutable) and $# licence file(s)"
}

printf '%s\n' "$entries" | while read -r line; do
  # shellcheck disable=SC2086
  check_entry $line
done

echo "model public boundary healthy"
