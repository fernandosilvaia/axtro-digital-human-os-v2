from __future__ import annotations

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import docs_qa  # noqa: E402
import secret_scan  # noqa: E402
import validate_contracts  # noqa: E402


class ValidatorNegativeFixtureTests(unittest.TestCase):
    def test_broken_schema_fixture_fails_contract_validator(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            schemas = root / "schemas"
            valid = root / "valid"
            invalid = root / "invalid"
            for path in (schemas, valid, invalid):
                path.mkdir()
            (schemas / "broken.schema.json").write_text("{not valid json", encoding="utf-8")
            with patch.multiple(
                validate_contracts,
                ROOT=root,
                SCHEMAS=schemas,
                VALID=valid,
                INVALID=invalid,
                EXPECTED_COUNT=1,
            ), redirect_stdout(io.StringIO()):
                self.assertEqual(1, validate_contracts.main())

    def test_broken_markdown_link_fixture_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "fixture.md").write_text("[missing](nope.md)\n", encoding="utf-8")
            errors: list[str] = []
            with patch.object(docs_qa, "ROOT", root):
                docs_qa.check_markdown(errors)
            self.assertTrue(any("broken link" in error for error in errors))

    def test_secret_fixture_fails_secret_scan_without_committing_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = "sk-" + ("A" * 20)
            (root / "fixture.mjs").write_text(f"const token = '{candidate}';\n", encoding="utf-8")
            with patch.object(secret_scan, "ROOT", root), redirect_stdout(io.StringIO()):
                self.assertEqual(1, secret_scan.main())

    def test_unknown_traceability_task_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph = root / "backlog" / "MVP_TASK_GRAPH.yaml"
            matrix = root / "docs" / "operations" / "REQUIREMENTS_TRACEABILITY_MATRIX.md"
            graph.parent.mkdir(parents=True)
            matrix.parent.mkdir(parents=True)
            graph.write_text(
                "milestones: {M0: {exit_gate: M0-01}}\n"
                "tasks:\n"
                "  - id: M0-01\n"
                "    milestone: M0\n"
                "    title: fixture\n"
                "    lane: quality\n"
                "    dependencies: []\n"
                "    objective: fixture\n"
                "    primary_files: []\n"
                "    acceptance: []\n"
                "    tests: []\n",
                encoding="utf-8",
            )
            matrix.write_text(
                "| Requirement | Component | Contract | Data | Task | Test | Metric/Fallback |\n"
                "| REQ-FIXTURE-001 | fixture | fixture | fixture | M1-12 | fixture | fixture |\n",
                encoding="utf-8",
            )
            errors: list[str] = []
            with patch.object(docs_qa, "ROOT", root):
                docs_qa.check_traceability(errors)
            self.assertTrue(any("unknown tasks" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
