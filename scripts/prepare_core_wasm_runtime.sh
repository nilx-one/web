#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -Eeuo pipefail

core_dir="$(cd "${1:?path to checked-out nilx-one/core is required}" && pwd)"
expected_core_revision="b49898393164d633f139add5bf9ab88288f58476"
expected_wasm_sha256="3648719e9cb87be6030c63b722a50c4900024964982c99ba72213f53dc234a37"
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
  cargo fetch --locked
  cargo_home="${CARGO_HOME:-${HOME}/.cargo}"
  registry_src=("${cargo_home}"/registry/src/index.crates.io-*)
  if [[ ${#registry_src[@]} -ne 1 || ! -d ${registry_src[0]} ]]; then
    echo "expected one cargo registry source directory, got: ${registry_src[*]}" >&2
    exit 1
  fi
  # Panic locations embed this machine's cargo registry path, including the
  # index hash in the directory name. Remap it, and the Core checkout, so the
  # Wasm digest does not depend on where the runner keeps crates.
  export RUSTFLAGS="--remap-path-prefix=${registry_src[0]}=/cargo-registry --remap-path-prefix=${core_dir}=/core-source${RUSTFLAGS:+ ${RUSTFLAGS}}"
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
