#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Decides whether a release must activate its identity package. Run inside a full clone.
#
# Inputs (environment):
#   IDENTITY_RELEASE_SHA        commit of the verified identity package in the release ancestry
#   REQUIRED_IDENTITY_CONTRACT  minimum identity contract the selected clients require
#   FORCE_IDENTITY              true to activate the package regardless of what is running
#   IMAGE_REPOSITORY            identity image repository, e.g. ghcr.io/nilx-one/0x1-identity
#   ACTIVE_IMAGE                image of the newest successful identity deployment, empty if none
#
# Prints "deploy=true|false" and "reason=..." lines. Exits 1, leaving production untouched, when
# the package cannot satisfy the clients or when replacing the running identity would not be a
# plain upgrade; the explicit `identity` target forces it.
#
# A running package built from a branch that was later squash-merged is not an ancestor of the
# release. It is still a plain upgrade when the branch changed no identity input after it forked.

set -Eeuo pipefail

package_sha="${IDENTITY_RELEASE_SHA:?IDENTITY_RELEASE_SHA is required}"
required="${REQUIRED_IDENTITY_CONTRACT:?REQUIRED_IDENTITY_CONTRACT is required}"
force="${FORCE_IDENTITY:?FORCE_IDENTITY is required}"
repository="${IMAGE_REPOSITORY:?IMAGE_REPOSITORY is required}"
active_image="${ACTIVE_IMAGE:-}"

[[ "$required" =~ ^[0-9]+$ ]] || { echo "REQUIRED_IDENTITY_CONTRACT must be an unsigned integer" >&2; exit 2; }

contract_at() {
  local value
  value="$(git show "$1:services/identity/deploy/contract.version" 2>/dev/null | tr -d '[:space:]')" || return 1
  [[ "$value" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$value"
}

is_ancestor() {
  git merge-base --is-ancestor "$1" "$2" 2>/dev/null
}

identity_inputs=(services/identity .github/workflows/package-identity-service.yml)

# A package built from a pull request branch is absent from a branch-only clone; fetch it by id.
ensure_commit() {
  git cat-file -e "$1^{commit}" 2>/dev/null ||
    git fetch -q --no-tags origin "$1" >/dev/null 2>&1
}

# True when $1 changed no identity input since it forked from $2's history.
identity_unchanged_since_fork() {
  local fork
  fork="$(git merge-base "$1" "$2" 2>/dev/null)" || return 1
  git diff --quiet "$fork" "$1" -- "${identity_inputs[@]}"
}

decide() {
  printf 'deploy=%s\nreason=%s\n' "$1" "$2"
  exit 0
}

refuse() {
  echo "::error::$1 Leaving the running identity in place; deploy the \`identity\` target to replace it deliberately." >&2
  exit 1
}

package_contract="$(contract_at "$package_sha")" || {
  echo "::error::Identity package ${package_sha} has no readable contract.version." >&2
  exit 1
}
if (( package_contract < required )); then
  echo "::error::Identity package ${package_sha} provides contract ${package_contract}, clients require ${required}." >&2
  exit 1
fi

[ "$force" = true ] && decide true "forced by the requested target"
[ -n "$active_image" ] || decide true "no successful identity deployment exists"

active_sha="${active_image#"${repository}:sha-"}"
if [ "$active_sha" = "$active_image" ] || ! [[ "$active_sha" =~ ^[0-9a-f]{40}$ ]]; then
  refuse "Running identity image ${active_image} is not an immutable ${repository} package."
fi

[ "$active_sha" = "$package_sha" ] && decide false "identity package ${active_sha} is already active"

ensure_commit "$active_sha" || true
active_contract="$(contract_at "$active_sha")" ||
  refuse "Running identity package ${active_sha} is not readable in this repository."

if is_ancestor "$active_sha" "$package_sha"; then
  decide true "identity package upgrades ${active_sha} to ${package_sha}"
fi

if (( active_contract < required )); then
  decide true "running identity ${active_sha} provides contract ${active_contract}, clients require ${required}"
fi

if is_ancestor "$package_sha" "$active_sha"; then
  decide false "newer identity package ${active_sha} with contract ${active_contract} is already active"
fi

if identity_unchanged_since_fork "$active_sha" "$package_sha"; then
  decide true "running identity package ${active_sha} changed no identity input since it forked; upgrading to ${package_sha}"
fi

refuse "Identity package ${package_sha} and running package ${active_sha} have diverged, and the running contract ${active_contract} already satisfies ${required}."
