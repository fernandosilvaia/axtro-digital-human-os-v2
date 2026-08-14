from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts" / "generate_contract_types.py"
SCHEMAS = ROOT / "contracts" / "schemas"
INVALID = ROOT / "contracts" / "examples" / "invalid"
VALID = ROOT / "contracts" / "examples" / "valid"


def schema_registry() -> Registry:
    resources = []
    for path in sorted(SCHEMAS.glob("*.schema.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        resources.append((document["$id"], Resource.from_contents(document)))
    return Registry().with_resources(resources)


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
            self.assertEqual(48, generated_ts.read_text(encoding="utf-8").count('"source_schema"'))
            generated_python = generated_py.read_text(encoding="utf-8")
            self.assertIn("schema_version", generated_python)
            self.assertIn("class _FakeProviderScenarioRequired(TypedDict):", generated_python)
            self.assertIn("class FakeProviderScenario(_FakeProviderScenarioRequired, total=False):", generated_python)
            self.assertIn("operation: Literal['channel.health'", generated_python)

    def test_every_invalid_example_is_rejected_by_its_source_schema(self) -> None:
        rejected = 0
        registry = schema_registry()
        for schema_path in sorted(SCHEMAS.glob("*.schema.json")):
            schema = json.loads(schema_path.read_text(encoding="utf-8"))
            example_path = INVALID / f"{schema_path.name.removesuffix('.schema.json')}.json"
            example = json.loads(example_path.read_text(encoding="utf-8"))
            errors = list(Draft202012Validator(schema, registry=registry).iter_errors(example))
            self.assertTrue(errors, f"{example_path.relative_to(ROOT)} unexpectedly passed")
            rejected += 1
        self.assertEqual(48, rejected)

    def test_runtime_configuration_contract_rejects_live_mode_and_secret_like_handles(self) -> None:
        schema_path = SCHEMAS / "runtime_configuration.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        valid = json.loads((VALID / "runtime_configuration.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        for key, value in (("provider_mode", "live"), ("secret_broker_handle", "secret://local/sk-handle")):
            candidate = {**valid, key: value}
            self.assertTrue(list(validator.iter_errors(candidate)), f"{key}={value} unexpectedly passed")

    def test_turn_committed_contract_couples_speaker_role_to_generation(self) -> None:
        schema_path = SCHEMAS / "turn_committed.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        valid = json.loads((VALID / "turn_committed.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        participant_with_generation = {**valid, "generation_id": 1}
        presenter_without_generation = {
            **valid,
            "speaker_role": "presenter",
            "generation_id": None,
        }
        for candidate in (participant_with_generation, presenter_without_generation):
            self.assertTrue(list(validator.iter_errors(candidate)), "role and generation unexpectedly passed")

    def test_context_composition_contract_binds_kind_to_trust_and_provenance(self) -> None:
        schema_path = SCHEMAS / "context_composition.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        valid = json.loads((VALID / "context_composition.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        self.assertFalse(list(validator.iter_errors(valid)))

        hypothesis_without_evidence = json.loads(json.dumps(valid))
        entry = hypothesis_without_evidence["entries"][0]
        entry["kind"] = "hypothesis"
        entry["trust_level"] = "uncertain"
        entry["data_classification"] = "internal"
        entry["confidence"] = 0.5
        entry["provenance"]["source_kind"] = "server_owned_suggestion_snapshot"
        entry["provenance"]["checksum_sha256"] = None
        entry["provenance"]["evidence_refs"] = []

        knowledge_without_checksum = json.loads(json.dumps(valid))
        entry = knowledge_without_checksum["entries"][0]
        entry["kind"] = "approved_knowledge"
        entry["trust_level"] = "untrusted"
        entry["data_classification"] = "internal"
        entry["confidence"] = None
        entry["provenance"]["source_kind"] = "approved_knowledge_catalog"
        entry["provenance"]["checksum_sha256"] = None

        restricted_external = json.loads(json.dumps(valid))
        entry = restricted_external["entries"][0]
        entry["kind"] = "suggestion"
        entry["trust_level"] = "uncertain"
        entry["data_classification"] = "restricted"
        entry["confidence"] = 0.5
        entry["provenance"]["source_kind"] = "server_owned_suggestion_snapshot"
        entry["provenance"]["checksum_sha256"] = None

        knowledge_without_receipt = json.loads(json.dumps(valid))
        entry = knowledge_without_receipt["entries"][0]
        entry["kind"] = "approved_knowledge"
        entry["trust_level"] = "untrusted"
        entry["data_classification"] = "internal"
        entry["confidence"] = None
        entry["provenance"]["source_kind"] = "approved_knowledge_catalog"
        entry["provenance"]["checksum_sha256"] = "a" * 64
        entry["provenance"]["evidence_refs"] = []

        for candidate in (
            hypothesis_without_evidence,
            knowledge_without_checksum,
            restricted_external,
            knowledge_without_receipt,
        ):
            self.assertTrue(list(validator.iter_errors(candidate)), "context entry binding unexpectedly passed")


if __name__ == "__main__":
    unittest.main()
