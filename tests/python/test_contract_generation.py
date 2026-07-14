from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts" / "generate_contract_types.py"
SCHEMAS = ROOT / "contracts" / "schemas"
INVALID = ROOT / "contracts" / "examples" / "invalid"
VALID = ROOT / "contracts" / "examples" / "valid"


class ContractGenerationTests(unittest.TestCase):
    def test_checked_in_generated_types_are_current(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(GENERATOR), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)

    def test_generation_is_deterministic_with_schema_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            command = [sys.executable, str(GENERATOR), "--output-root", str(output_root)]
            first = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(0, first.returncode, first.stdout + first.stderr)
            generated_ts = output_root / "packages" / "contracts-ts" / "src" / "generated.ts"
            generated_py = output_root / "packages" / "contracts-py" / "src" / "axtro_contracts" / "__init__.py"
            first_ts = generated_ts.read_bytes()
            first_py = generated_py.read_bytes()
            second = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(0, second.returncode, second.stdout + second.stderr)
            self.assertEqual(first_ts, generated_ts.read_bytes())
            self.assertEqual(first_py, generated_py.read_bytes())
            self.assertEqual(32, generated_ts.read_text(encoding="utf-8").count('"source_schema"'))
            self.assertIn("schema_version", generated_py.read_text(encoding="utf-8"))

    def test_every_invalid_example_is_rejected_by_its_source_schema(self) -> None:
        rejected = 0
        for schema_path in sorted(SCHEMAS.glob("*.schema.json")):
            schema = json.loads(schema_path.read_text(encoding="utf-8"))
            example_path = INVALID / f"{schema_path.name.removesuffix('.schema.json')}.json"
            example = json.loads(example_path.read_text(encoding="utf-8"))
            errors = list(Draft202012Validator(schema).iter_errors(example))
            self.assertTrue(errors, f"{example_path.relative_to(ROOT)} unexpectedly passed")
            rejected += 1
        self.assertEqual(32, rejected)

    def test_runtime_configuration_contract_rejects_live_mode_and_secret_like_handles(self) -> None:
        schema_path = SCHEMAS / "runtime_configuration.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        valid = json.loads((VALID / "runtime_configuration.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        for key, value in (("provider_mode", "live"), ("secret_broker_handle", "secret://local/sk-handle")):
            candidate = {**valid, key: value}
            self.assertTrue(list(validator.iter_errors(candidate)), f"{key}={value} unexpectedly passed")


if __name__ == "__main__":
    unittest.main()
