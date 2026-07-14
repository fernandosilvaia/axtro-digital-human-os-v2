#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "legacy" / "v1"
INVENTORY = ROOT / "legacy" / "V1_FILE_INVENTORY.sha256"
MAP = ROOT / "MIGRATION_MAP_V1_TO_V2.md"
EXPECTED_COUNT = 62


def main() -> int:
    errors: list[str] = []
    files = sorted(path for path in V1.rglob("*") if path.is_file())
    if len(files) != EXPECTED_COUNT:
        errors.append(f"Expected {EXPECTED_COUNT} V1 files, found {len(files)}")

    inventory: dict[str, str] = {}
    if not INVENTORY.exists():
        errors.append("Missing legacy/V1_FILE_INVENTORY.sha256")
    else:
        for line_number, line in enumerate(INVENTORY.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            parts = line.split("  ", 1)
            if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]):
                errors.append(f"Invalid inventory line {line_number}")
                continue
            inventory[parts[1]] = parts[0]

    actual_paths = {str(path.relative_to(V1)) for path in files}
    if set(inventory) != actual_paths:
        errors.append(
            f"Inventory path mismatch. Missing={sorted(actual_paths-set(inventory))}, extra={sorted(set(inventory)-actual_paths)}"
        )
    for path in files:
        rel = str(path.relative_to(V1))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if inventory.get(rel) != digest:
            errors.append(f"Hash mismatch for legacy/v1/{rel}")

    if not MAP.exists():
        errors.append("Missing MIGRATION_MAP_V1_TO_V2.md")
    else:
        text = MAP.read_text(encoding="utf-8")
        rows = re.findall(r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|", text, re.MULTILINE)
        mapped_paths = {path for _, path in rows}
        if len(rows) != EXPECTED_COUNT:
            errors.append(f"Expected {EXPECTED_COUNT} numbered migration rows, found {len(rows)}")
        if mapped_paths != actual_paths:
            errors.append(
                f"Migration map path mismatch. Missing={sorted(actual_paths-mapped_paths)}, extra={sorted(mapped_paths-actual_paths)}"
            )
        if "Nenhum dos dois ZIPs recebidos" not in text:
            errors.append("Migration map must preserve the corrected PDF evidence statement")

    fable_partial = ROOT / "legacy" / "fable-v2-partial"
    if not fable_partial.exists() or len(list(fable_partial.glob("*.md"))) != 3:
        errors.append("Fable partial return must be preserved as three historical Markdown files")

    if errors:
        print("MIGRATION INVENTORY VALIDATION FAILED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"MIGRATION INVENTORY VALIDATION PASSED: {len(files)} V1 files mapped and hash-verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
