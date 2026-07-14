#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKS = [
    "docs_qa.py",
    "validate_contracts.py",
    "validate_specs.py",
    "validate_database_contract.py",
    "validate_codex_setup.py",
    "validate_migration_inventory.py",
    "secret_scan.py",
]


def main() -> int:
    failures: list[str] = []
    for check in CHECKS:
        print(f"\n==> {check}")
        completed = subprocess.run([sys.executable, str(ROOT / "scripts" / check)], cwd=ROOT)
        if completed.returncode:
            failures.append(check)
    if failures:
        print(f"\nVALIDATION SUITE FAILED: {', '.join(failures)}")
        return 1
    print(f"\nVALIDATION SUITE PASSED: {len(CHECKS)} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
