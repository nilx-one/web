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
#
# What may be mirrored, and how, is read from the one catalog table the client also offers
# from: packages/narration-webllm/src/model-catalog.json. It names each entry's revision, the
# conversion commit to fetch from, the model library the pinned registry pairs with it, the
# notices its licence obliges, and the licence files that travel with the weights. A
# model_id the catalog does not serve is refused: nothing is mirrored before its licence is
# read (nilx-one/ai docs/model-licences.md).
#
#   MODEL_ROOT=/srv/nilx-one/models MODEL_ID=Llama-3.2-1B-Instruct-q4f16_1-MLC \
#     sh deploy/web/bootstrap-models.sh
#
# One invocation per entry. Revision, source and library come from the catalog entry and
# nowhere else, so the manifest's licence and notices always describe the bytes beside them.
# A different source is a catalog change, reviewed like any other.

set -eu

# These once overrode the catalog one field at a time, which could pair one entry's licence
# with another artifact's weights. Refused loudly rather than ignored.
if [ -n "${MODEL_REVISION+set}${MODEL_SOURCE+set}${MODEL_LIB_URL+set}" ]; then
  echo "MODEL_REVISION, MODEL_SOURCE and MODEL_LIB_URL no longer override the catalog:" \
    "change the catalog entry instead" >&2
  exit 2
fi

: "${MODEL_ROOT:?MODEL_ROOT is required}"
: "${MODEL_ID:?MODEL_ID is required: one model_id from the catalog}"

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
MODEL_REPO_ROOT="${MODEL_REPO_ROOT:-$(CDPATH='' cd -- "$script_dir/../.." && pwd)}"
MODEL_CATALOG="${MODEL_CATALOG:-$MODEL_REPO_ROOT/packages/narration-webllm/src/model-catalog.json}"

case "$MODEL_ROOT" in
  /*) ;;
  *)
    echo "MODEL_ROOT must be absolute" >&2
    exit 2
    ;;
esac

case "$MODEL_ID" in
  *[!0-9A-Za-z._-]*|'')
    echo "MODEL_ID contains unsupported characters" >&2
    exit 2
    ;;
esac

command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required to read the catalog and the artifact manifest" >&2
  exit 2
}

# Revision, source and library, as the catalog states them for this entry.
catalog_entry="$(python3 -c '
import json, sys
catalog = json.load(open(sys.argv[1], encoding="utf-8"))
entry = next((m for m in catalog["models"] if m["model_id"] == sys.argv[2]), None)
if entry is None:
    sys.exit(3)
mirror = entry["mirror"]
print(mirror["revision"])
print(mirror["source"] + "/resolve/" + mirror["source_commit"])
print(catalog["model_lib_prefix"] + mirror["model_lib"])
' "$MODEL_CATALOG" "$MODEL_ID")" || {
  echo "$MODEL_ID is not in the catalog: nothing is mirrored before its licence is read" >&2
  exit 3
}

MODEL_REVISION="$(printf '%s\n' "$catalog_entry" | sed -n 1p)"
MODEL_SOURCE="$(printf '%s\n' "$catalog_entry" | sed -n 2p)"
MODEL_LIB_URL="$(printf '%s\n' "$catalog_entry" | sed -n 3p)"

case "$MODEL_REVISION" in
  *[!0-9A-Za-z._-]*|'')
    echo "MODEL_REVISION contains unsupported characters" >&2
    exit 2
    ;;
esac

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

python3 - "$work_dir" "$MODEL_ID" "$MODEL_REVISION" "$MODEL_SOURCE" "$MODEL_LIB_URL" \
  "$MODEL_CATALOG" "$MODEL_REPO_ROOT" <<'PY'
import base64, datetime, hashlib, json, os, shutil, sys

work, model_id, revision, source, lib_url, catalog_path, repo_root = sys.argv[1:8]
catalog = json.load(open(catalog_path, encoding="utf-8"))
entry = next(m for m in catalog["models"] if m["model_id"] == model_id)

# The licence travels with the weights. A vendored text that is not the one that was read
# is refused rather than served.
licence_files = []
for item in entry["mirror"]["licence_files"]:
    origin = os.path.join(repo_root, item["from"])
    with open(origin, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    if digest != item["sha256"]:
        sys.exit(f"{item['from']} is not the licence text that was read (sha256 {digest})")
    shutil.copyfile(origin, os.path.join(work, item["name"]))
    licence_files.append(item["name"])


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
    "licence": entry["licence"],
    "licence_files": licence_files,
    "attribution": entry["attribution"],
    # Read from nilx-one/ai docs/model-licences.md, through the catalog, verbatim.
    "notices": entry["notices"],
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
