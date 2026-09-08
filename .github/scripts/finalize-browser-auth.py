# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

BASE = "4464cd629502a120d7d5ccbb7178d6333357d29a"
CONTRACT_PATH = "services/identity/deploy/contract.version"
TARGETS_PATH = "deploy/web/targets.json"
PRODUCT_INDEX_PATH = "packages/product-app/src/index.tsx"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def git_text(ref: str, path: str) -> str:
    result = run("git", "show", f"{ref}:{path}")
    return result.stdout


def changed(ref_a: str, ref_b: str) -> set[str]:
    result = run("git", "diff", "--name-only", ref_a, ref_b)
    return {line for line in result.stdout.splitlines() if line}


def resolve_product_index_conflict(text: str) -> str:
    pattern = re.compile(
        r"^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n",
        re.MULTILINE | re.DOTALL,
    )
    merged, count = pattern.subn(lambda match: match.group(1) + match.group(2), text)
    if count != 1 or "<<<<<<<" in merged or ">>>>>>>" in merged:
        raise SystemExit(
            f"{PRODUCT_INDEX_PATH}: expected exactly one composable conflict, found {count}"
        )
    return merged


def three_way_merge(path: str, master: str) -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        ours_path = root / "ours"
        base_path = root / "base"
        theirs_path = root / "theirs"
        ours_path.write_text(git_text("HEAD", path))
        base_path.write_text(git_text(BASE, path))
        theirs_path.write_text(git_text(master, path))
        result = run(
            "git",
            "merge-file",
            "-p",
            str(ours_path),
            str(base_path),
            str(theirs_path),
            check=False,
        )
        output = result.stdout
        if result.returncode != 0:
            if path != PRODUCT_INDEX_PATH:
                print(f"semantic merge conflict: {path}")
                print(output)
                raise SystemExit(1)
            output = resolve_product_index_conflict(output)
        Path(path).write_text(output)


run("git", "fetch", "origin", "master", "--depth=1")
run("git", "fetch", "origin", BASE, "--depth=1")
master = run("git", "rev-parse", "origin/master").stdout.strip()
master_changed = changed(BASE, master)
branch_changed = changed(BASE, "HEAD")

for path in sorted(master_changed):
    if path in {CONTRACT_PATH, TARGETS_PATH}:
        continue
    if path not in branch_changed:
        run("git", "checkout", master, "--", path)
        continue
    three_way_merge(path, master)

master_contract = int(git_text(master, CONTRACT_PATH).strip())
Path(CONTRACT_PATH).write_text(f"{master_contract + 1}\n")

targets = json.loads(git_text(master, TARGETS_PATH))
targets["targets"]["web"]["requiresIdentityContract"] = master_contract + 1
Path(TARGETS_PATH).write_text(json.dumps(targets, indent=2) + "\n")

run("git", "add", "-A")
print(f"semantically merged master {master}; identity contract {master_contract + 1}")
