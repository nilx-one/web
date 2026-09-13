#!/usr/bin/env sh
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

# Places one local-inference model on this host, the way the basemap is placed: fetched
# once, verified, written atomically, and served from our own origin afterwards.
#
# The layout is not ours to choose. WebLLM appends `resolve/main/` to any model URL that
# does not already name a revision, so serving from `<id>/resolve/<revision>/` both
# satisfies that rule and gives an immutable directory that can be cached forever and rolled
# forward explicitly.

set -eu

: "${MODEL_ROOT:?MODEL_ROOT is required}"

MODEL_ID="${MODEL_ID:-Qwen3-0.6B-q4f16_1-MLC}"
MODEL_REVISION="${MODEL_REVISION:-1}"
MODEL_SOURCE="${MODEL_SOURCE:-https://huggingface.co/mlc-ai/${MODEL_ID}/resolve/main}"
MODEL_LIB_URL="${MODEL_LIB_URL:-https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm}"

case "$MODEL_ROOT" in
  /*) ;;
  *)
    echo "MODEL_ROOT must be absolute" >&2
    exit 2
    ;;
esac

case "$MODEL_ID$MODEL_REVISION" in
  *[!0-9A-Za-z._-]*|'')
    echo "MODEL_ID and MODEL_REVISION contain unsupported characters" >&2
    exit 2
    ;;
esac

command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required to read the artifact manifest and hash the files" >&2
  exit 2
}

target_dir="$MODEL_ROOT/$MODEL_ID/resolve/$MODEL_REVISION"

if [ -s "$target_dir/manifest.json" ]; then
  echo "Model already present: $target_dir"
  exit 0
fi

work_dir="$(mktemp -d "${MODEL_ROOT%/}/.model.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

fetch() {
  # $1 url, $2 destination
  curl --silent --show-error --fail --location \
    --connect-timeout 10 --max-time 1800 \
    --output "$2" "$1"
}

echo "Fetching $MODEL_ID from $MODEL_SOURCE"
fetch "$MODEL_SOURCE/mlc-chat-config.json" "$work_dir/mlc-chat-config.json"
fetch "$MODEL_SOURCE/tokenizer.json" "$work_dir/tokenizer.json"
fetch "$MODEL_SOURCE/ndarray-cache.json" "$work_dir/ndarray-cache.json"

# The shard list and the honest download size both come from the artifact manifest rather
# than from a number written down somewhere by hand.
shards="$(python3 -c '
import json, sys
cache = json.load(open(sys.argv[1]))
for record in cache.get("records", []):
    path = record.get("dataPath")
    if path:
        print(path, record.get("nbytes", 0))
' "$work_dir/ndarray-cache.json")"

[ -n "$shards" ] || {
  echo "ndarray-cache.json declared no shards" >&2
  exit 1
}

echo "$shards" | while read -r shard expected; do
  fetch "$MODEL_SOURCE/$shard" "$work_dir/$shard"
  actual="$(python3 -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$work_dir/$shard")"
  if [ "$expected" != 0 ] && [ "$actual" != "$expected" ]; then
    echo "$shard is $actual bytes, manifest declares $expected" >&2
    exit 1
  fi
  echo "  $shard ($actual bytes)"
done

echo "Fetching model library from $MODEL_LIB_URL"
fetch "$MODEL_LIB_URL" "$work_dir/model.wasm"

python3 - "$work_dir" "$MODEL_ID" "$MODEL_REVISION" "$MODEL_SOURCE" "$MODEL_LIB_URL" <<'PY'
import base64, datetime, hashlib, json, os, sys

work, model_id, revision, source, lib_url = sys.argv[1:6]


def sri(name):
    with open(os.path.join(work, name), "rb") as handle:
        return "sha256-" + base64.b64encode(hashlib.sha256(handle.read()).digest()).decode()


cache = json.load(open(os.path.join(work, "ndarray-cache.json")))
shards = [record["dataPath"] for record in cache.get("records", []) if record.get("dataPath")]
weight_bytes = sum(os.path.getsize(os.path.join(work, shard)) for shard in shards)
lib_bytes = os.path.getsize(os.path.join(work, "model.wasm"))

manifest = {
    "schema": 1,
    "model_id": model_id,
    "revision": revision,
    "generated_at": datetime.datetime.now(datetime.timezone.utc)
    .replace(microsecond=0)
    .isoformat()
    .replace("+00:00", "Z"),
    # What a person is asked to download before anything starts.
    "bytes": weight_bytes + lib_bytes,
    "shards": shards,
    # SRI covers what WebLLM can verify. Weight shards are not covered by that mechanism;
    # the immutable revision directory and their recorded sizes are what pins them.
    "integrity": {
        "config": sri("mlc-chat-config.json"),
        "tokenizer": {"tokenizer.json": sri("tokenizer.json")},
        "model_lib": sri("model.wasm"),
    },
    "source": {"weights": source, "model_lib": lib_url},
    "notices": [
        "Model weights converted and published by mlc-ai; see the upstream model card for the model licence.",
        "Model library compiled by mlc-ai/binary-mlc-llm-libs (Apache-2.0).",
    ],
}

with open(os.path.join(work, "manifest.json"), "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2, ensure_ascii=False)
    handle.write("\n")

print(f"Manifest: {manifest['bytes']} bytes across {len(shards)} shard(s)")
PY

mkdir -p "$(dirname "$target_dir")"
chmod 0755 "$work_dir"
chmod 0644 "$work_dir"/*
mv "$work_dir" "$target_dir"
trap - EXIT HUP INT TERM

echo "Model ready: $target_dir"
