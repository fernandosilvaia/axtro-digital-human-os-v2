#!/usr/bin/env python3
"""Fail the architecture gate when generated contract artifacts drift."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    completed = subprocess.run([sys.executable, str(ROOT / "scripts" / "generate_contract_types.py"), "--check"], cwd=ROOT)
    if completed.returncode:
        print("CONTRACT GENERATION VALIDATION FAILED")
        return completed.returncode
    print("CONTRACT GENERATION VALIDATION PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
