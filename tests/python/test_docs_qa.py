from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "docs_qa.py"

_spec = importlib.util.spec_from_file_location("docs_qa", SCRIPT)
docs_qa = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(docs_qa)


class DocsQaTests(unittest.TestCase):
    def test_committed_docs_pass_the_deterministic_gate(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(SCRIPT)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
        self.assertIn("DOCUMENTATION QA PASSED", completed.stdout)

    def test_vendored_markdown_under_node_modules_is_never_scanned(self) -> None:
        self.assertFalse(docs_qa.is_repository_markdown(Path("node_modules/@some/package/README.md")))
        self.assertFalse(docs_qa.is_repository_markdown(Path("dist/generated/README.md")))
        self.assertFalse(docs_qa.is_repository_markdown(Path(".next/types/README.md")))
        self.assertTrue(docs_qa.is_repository_markdown(Path("docs/adr/README.md")))


if __name__ == "__main__":
    unittest.main()
