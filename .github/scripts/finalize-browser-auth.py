# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

import subprocess

FILES = [
    "deploy/web/targets.json",
    "packages/identity-http/src/index.ts",
    "packages/product-app/src/features/identity/identity-foundation-view.tsx",
    "packages/product-app/src/index.tsx",
]

subprocess.run(
    ["npx", "--yes", "prettier@3.9.6", "--write", *FILES],
    check=True,
)
# The legacy finalize runner stages the other three files itself; this fourth
# path is included explicitly so the formatting commit is complete.
subprocess.run(["git", "add", "packages/identity-http/src/index.ts"], check=True)
