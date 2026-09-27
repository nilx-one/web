#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -Eeuo pipefail

script="$(cd "$(dirname "$0")" && pwd)/identity-activation.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

repository=ghcr.io/nilx-one/0x1-identity
cd "$test_dir"
git init -q -b master
git config user.email test@example.invalid
git config user.name test
mkdir -p services/identity/deploy

commit() {
  printf '%s\n' "$1" >services/identity/deploy/contract.version
  git add -A
  git commit -q --allow-empty -m "$2"
  git rev-parse HEAD
}

# master: old(8) -> base(9) -> head(9); branch from base: diverged(9)
old="$(commit 8 old)"
base="$(commit 9 base)"
head="$(commit 9 head)"
git checkout -q -b branch "$base"
diverged="$(commit 9 diverged)"
git checkout -q master
unknown=0123456789abcdef0123456789abcdef01234567

failures=0
expect() {
  local label="$1" want="$2" package="$3" active="$4" force="${5:-false}" required="${6:-9}"
  local output rc=0
  output="$(IDENTITY_RELEASE_SHA="$package" REQUIRED_IDENTITY_CONTRACT="$required" \
    FORCE_IDENTITY="$force" IMAGE_REPOSITORY="$repository" ACTIVE_IMAGE="$active" \
    bash "$script" 2>&1)" || rc=$?

  local got
  if [ "$rc" -ne 0 ]; then
    got=refuse
  else
    got="$(sed -n 's/^deploy=//p' <<<"$output")"
  fi
  if [ "$got" != "$want" ]; then
    echo "FAIL ${label}: want ${want}, got ${got}: ${output}" >&2
    failures=$((failures + 1))
  fi
}

image() { printf '%s:sha-%s' "$repository" "$1"; }

expect "same package is already active" false "$head" "$(image "$head")"
expect "same package is forced" true "$head" "$(image "$head")" true
expect "package descends from the running one" true "$head" "$(image "$base")"
expect "package is older than the running one" false "$base" "$(image "$head")"
expect "diverged package with sufficient running contract" refuse "$diverged" "$(image "$head")"
expect "diverged package is forced" true "$diverged" "$(image "$head")" true
expect "diverged package with insufficient running contract" true "$diverged" "$(image "$old")"
expect "no identity deployment exists" true "$head" ""
expect "running package is not in the repository" refuse "$head" "$(image "$unknown")"
expect "running image is foreign" refuse "$head" "ghcr.io/other/identity:latest"
expect "package contract below requirement" refuse "$old" "$(image "$head")"
expect "package contract below requirement even when forced" refuse "$old" "" true
expect "package without contract.version" refuse "$unknown" ""

[ "$failures" -eq 0 ] || exit 1
echo "identity-activation tests passed"
