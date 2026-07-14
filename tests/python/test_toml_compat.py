from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from toml_compat import TomlSubsetError, loads  # noqa: E402


class TomlCompatTests(unittest.TestCase):
    def test_reads_scalars_tables_and_multiline_values(self) -> None:
        parsed = loads(
            'name = "reviewer"\nactive = true\ncount = 2\n[agents]\nnotes = """line one\nline two\n"""\n'
        )
        self.assertEqual("reviewer", parsed["name"])
        self.assertTrue(parsed["active"])
        self.assertEqual(2, parsed["count"])
        self.assertEqual("line one\nline two\n", parsed["agents"]["notes"])

    def test_rejects_unsupported_values(self) -> None:
        with self.assertRaises(TomlSubsetError):
            loads("items = [1, 2]\n")


if __name__ == "__main__":
    unittest.main()
