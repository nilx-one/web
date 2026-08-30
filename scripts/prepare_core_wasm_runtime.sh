#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -Eeuo pipefail

core_dir="${1:?path to checked-out nilx-one/core is required}"
expected_core_revision="e09a42184951b6f40ad4b11eedf6e48c5b6a0ac9"
expected_wasm_sha256="d55bd185a9ec108cf83c0394c350c094cae9c09e381a1c22b11e388b1cd93320"
runtime_version="0.1.0"
runtime_build="$PWD/.core-wasm-runtime"

actual_core_revision="$(git -C "$core_dir" rev-parse HEAD)"
if [[ "$actual_core_revision" != "$expected_core_revision" ]]; then
  echo "Core revision mismatch: expected $expected_core_revision, got $actual_core_revision" >&2
  exit 1
fi

rm -rf "$runtime_build"
(
  cd "$core_dir"
  cargo generate-lockfile
  ./scripts/build_wasm_package.sh "$runtime_build"
)

printf '%s  %s\n' "$expected_wasm_sha256" "$runtime_build/index_bg.wasm" | sha256sum --check --status

cat >"$runtime_build/provenance.json" <<JSON
{
  "core_repository": "nilx-one/core",
  "core_revision": "$expected_core_revision",
  "contract_version": "$runtime_version",
  "wasm_sha256": "$expected_wasm_sha256"
}
JSON

for host in apps/site apps/telegram-mini-app; do
  destination="$host/public/core/$runtime_version"
  rm -rf "$destination"
  mkdir -p "$destination"
  cp "$runtime_build/index.js" "$destination/index.js"
  cp "$runtime_build/index_bg.wasm" "$destination/index_bg.wasm"
  cp "$runtime_build/provenance.json" "$destination/provenance.json"
done

rm -rf "$runtime_build"
