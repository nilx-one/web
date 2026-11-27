#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
# Read the canonical ServerContract from stdin. Accept only the reviewed
# placement, not a similarly indented entry under another list.
set -Eeuo pipefail
if ! recipient="$(awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    /^[^[:space:]]/ {
        section = ""
        list = ""
        if ($0 == "metadata:") { section = "metadata"; metadata++ }
        if ($0 == "spec:") { section = "spec"; spec++ }
        if ($0 == "kind: ServerContract") { kind++ }
        if ($0 == "apiVersion: infra.nilx.one/v1") { version++ }
        next
    }
    /^  [^[:space:]]/ {
        list = ""
        if (section == "metadata" && /^  name:/) {
            names++
            if ($0 == "  name: edge-dev-1") { name_ok++ }
        }
        if (section == "spec" && /^  state:/) {
            states++
            if ($0 != "  state: active") { bad_state++ }
        }
        if (section == "spec" && /^  role:/) {
            roles++
            if ($0 == "  role: public-edge") { role_ok++ }
        }
        if (section == "spec" && /^  workloads:/) {
            workloads++
            if ($0 == "  workloads:") { list = "workloads" }
        }
        if (section == "spec" && /^  encryptionRecipient:/) {
            recipients++
            recipient = $0
            sub(/^  encryptionRecipient: /, "", recipient)
        }
        next
    }
    section == "spec" && list == "workloads" && /^    - nilxone-identity$/ { owns++ }
    END {
        if (metadata != 1 || spec != 1 || kind != 1 || version != 1 ||
            names != 1 || name_ok != 1 || states > 1 || bad_state ||
            roles != 1 || role_ok != 1 || workloads != 1 ||
            owns != 1 || recipients != 1) exit 1
        print recipient
    }
')"; then
    echo "::error::Invalid or retired edge-dev-1 contract; nilxone-identity must be owned by spec.workloads." >&2
    exit 1
fi
if [[ ! "$recipient" =~ ^ssh-ed25519\ [A-Za-z0-9+/]{68}$ ]]; then
    echo "::error::edge-dev-1 publishes no valid encryptionRecipient." >&2
    exit 1
fi
printf '%s\n' "$recipient"
