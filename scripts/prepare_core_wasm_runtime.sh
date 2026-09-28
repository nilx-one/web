#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -Eeuo pipefail

core_dir="${1:?path to checked-out nilx-one/core is required}"
expected_core_revision="c224304947280169017e298237bcf5361d1bfb30"
expected_wasm_sha256="43ab28588d8e097decf77b4710ae560b82bc812a629a6fdf9ef7b5d73a8cd325"
runtime_version="0.1.0"
runtime_build="$PWD/.core-wasm-runtime"

actual_core_revision="$(git -C "$core_dir" rev-parse HEAD)"
if [[ "$actual_core_revision" != "$expected_core_revision" ]]; then
  echo "Core revision mismatch: expected $expected_core_revision, got $actual_core_revision" >&2
  exit 1
fi

# A fresh `cargo generate-lockfile` re-resolves to whatever crates.io serves
# that day, and the Wasm bytes move with it. `core-wasm.Cargo.lock` is the
# resolution this digest was built from, tinyvec 1.12.0 included. The Core
# build script passes `--locked`, so a dependency that is not in the file
# fails closed instead of being solved again.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lockfile="$script_dir/core-wasm.Cargo.lock"

rm -rf "$runtime_build"
(
  cd "$core_dir"
  cp "$lockfile" Cargo.lock
  ./scripts/build_wasm_package.sh "$runtime_build"
)

actual_wasm_sha256="$(sha256sum "$runtime_build/index_bg.wasm" | awk '{print $1}')"
if [[ "$actual_wasm_sha256" != "$expected_wasm_sha256" ]]; then
  echo "Core Wasm digest mismatch: expected $expected_wasm_sha256, got $actual_wasm_sha256" >&2
  exit 1
fi

cat >"$runtime_build/provenance.json" <<JSON
{
  "core_repository": "nilx-one/core",
  "core_revision": "$expected_core_revision",
  "contract_version": "$runtime_version",
  "wasm_sha256": "$expected_wasm_sha256"
}
JSON

for host in apps/site apps/telegram-mini-app apps/discord-activity; do
  destination="$host/public/core/$runtime_version"
  rm -rf "$destination"
  mkdir -p "$destination"
  cp "$runtime_build/index.js" "$destination/index.js"
  cp "$runtime_build/index_bg.wasm" "$destination/index_bg.wasm"
  cp "$runtime_build/provenance.json" "$destination/provenance.json"
done

rm -rf "$runtime_build"
