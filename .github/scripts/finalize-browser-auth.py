# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from pathlib import Path
import subprocess

path = Path("tests/integration/product-app.test.tsx")
text = path.read_text()
replacements = {
    'screen.getByRole("button", { name: /Telegram — coming next/i })': 'screen.getByRole("button", { name: "Sign in with Telegram" })',
    'screen.getByRole("button", { name: /Discord — coming later/i })': 'screen.getByRole("button", { name: "Sign in with Discord" })',
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(f"expected one stale provider assertion: {old}")
    text = text.replace(old, new)
path.write_text(text)
subprocess.run(["git", "add", str(path)], check=True)
