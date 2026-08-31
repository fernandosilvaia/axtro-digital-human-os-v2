from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml
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
            generated_typescript = generated_ts.read_text(encoding="utf-8")
            self.assertEqual(69, generated_typescript.count('"source_schema"'))
            generated_python = generated_py.read_text(encoding="utf-8")
            self.assertIn("schema_version", generated_python)
            self.assertIn("class _FakeProviderScenarioRequired(TypedDict):", generated_python)
            self.assertIn("class FakeProviderScenario(_FakeProviderScenarioRequired, total=False):", generated_python)
            self.assertIn("operation: Literal['channel.health'", generated_python)
            self.assertIn("export type TurnOutcomeRecorded =", generated_typescript)
            self.assertIn("TurnOutcomeRecorded: TypeAlias =", generated_python)
            self.assertIn("export type PortalPublicDemoActionResult =", generated_typescript)
            self.assertIn("PortalPublicDemoActionResult: TypeAlias =", generated_python)
            self.assertIn('reason_code: "demo_unavailable";', generated_typescript)
            self.assertIn("seen_commands: Array<{", generated_typescript)
            self.assertIn(
                "export type MeetingTerminalNotificationDeliveryReceipt =",
                generated_typescript,
            )
            self.assertIn(
                "MeetingTerminalNotificationDeliveryReceipt: TypeAlias =",
                generated_python,
            )
            self.assertIn(
                "class _MeetingTerminalNotificationDeliveryReceiptOutcomeProviderAccepted(TypedDict):",
                generated_python,
            )
            self.assertIn("export type PortalTextPreviewAdmission =", generated_typescript)
            self.assertIn("export type PortalTextPreviewActionResult =", generated_typescript)
            self.assertIn(
                "class _PortalTextPreviewAdmissionPersistentTranscriptFalse(TypedDict):",
                generated_python,
            )
            self.assertIn(
                "class _PortalTextPreviewActionResultOutcomeSuccess(TypedDict):",
                generated_python,
            )
            self.assertIn("export interface ProviderProcessingProfile", generated_typescript)
            compile(generated_python, str(generated_py), "exec")

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
        self.assertEqual(69, rejected)

    def test_portal_text_preview_contracts_bind_privacy_and_browser_authority(self) -> None:
        registry = schema_registry()

        admission_schema = json.loads(
            (SCHEMAS / "portal_text_preview_admission.schema.json").read_text(encoding="utf-8")
        )
        admission = json.loads(
            (VALID / "portal_text_preview_admission.json").read_text(encoding="utf-8")
        )
        admission_validator = Draft202012Validator(admission_schema, registry=registry)
        self.assertFalse(list(admission_validator.iter_errors(admission)))
        persistence_escalation = {
            **admission,
            "persistent_transcript": True,
        }
        self.assertTrue(list(admission_validator.iter_errors(persistence_escalation)))

        command_schema = json.loads(
            (SCHEMAS / "portal_text_preview_browser_command.schema.json").read_text(encoding="utf-8")
        )
        command = json.loads(
            (VALID / "portal_text_preview_browser_command.json").read_text(encoding="utf-8")
        )
        command_validator = Draft202012Validator(command_schema, registry=registry)
        for mutation in (
            {**command, "aiIdentityAcknowledged": False},
            {**command, "essentialProcessingAccepted": False},
            {**command, "history": []},
            {**command, "transcriptId": "caller-controlled"},
        ):
            self.assertTrue(list(command_validator.iter_errors(mutation)))

        result_schema = json.loads(
            (SCHEMAS / "portal_text_preview_action_result.schema.json").read_text(encoding="utf-8")
        )
        result = json.loads(
            (VALID / "portal_text_preview_action_result.json").read_text(encoding="utf-8")
        )
        result_validator = Draft202012Validator(result_schema, registry=registry)
        crossed_failure = {
            **result,
            "outcome": "failure",
            "error": "generation_failed",
        }
        self.assertTrue(list(result_validator.iter_errors(crossed_failure)))

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

    def test_turn_outcome_recorded_couples_success_failure_and_persistence(self) -> None:
        schema = json.loads((SCHEMAS / "turn_outcome_recorded.schema.json").read_text(encoding="utf-8"))
        valid = json.loads((VALID / "turn_outcome_recorded.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        self.assertFalse(list(validator.iter_errors(valid)))
        self.assertEqual("failed", valid["outcome"])
        self.assertEqual("provider_response_uncommitted", valid["reason_code"])
        self.assertIsNone(valid["persistence"])

        succeeded = {
            **valid,
            "outcome": "succeeded",
            "reason_code": "generation_succeeded",
            "persistence": "disabled",
            "resulting_turn_index": 2,
        }
        self.assertFalse(list(validator.iter_errors(succeeded)))
        mutations = (
            {**succeeded, "reason_code": "generation_failed"},
            {**succeeded, "reason_code": "provider_response_uncommitted"},
            {**succeeded, "persistence": None},
            {**valid, "reason_code": "generation_succeeded"},
            {**valid, "persistence": "disabled"},
            {**valid, "generation": 10000001},
            {**valid, "resulting_turn_index": -1},
            {**valid, "reply": "content must not enter the event"},
            {**valid, "provider_request_id": "opaque-provider-id"},
        )
        for candidate in mutations:
            self.assertTrue(list(validator.iter_errors(candidate)), "crossed turn outcome passed")

    def test_data_governance_contracts_bind_authority_and_terminal_privacy(self) -> None:
        registry = schema_registry()

        command_schema = json.loads(
            (SCHEMAS / "data_governance_command.schema.json").read_text(encoding="utf-8")
        )
        command = json.loads(
            (VALID / "data_governance_command.json").read_text(encoding="utf-8")
        )
        command_validator = Draft202012Validator(command_schema, registry=registry)
        self.assertFalse(list(command_validator.iter_errors(command)))
        self.assertEqual("uuidv7_ascending", command_schema["properties"]["approval_ids"]["x-axtro-order"])
        self.assertTrue(list(command_validator.iter_errors({**command, "approval_ids": []})))
        self.assertTrue(
            list(command_validator.iter_errors({**command, "approval_ids": command["approval_ids"] * 2})),
            "duplicate individual approvals must not satisfy quorum",
        )
        tenant_authorization = {
            **command,
            "scope_type": "tenant",
            "data_subject_id": None,
            "approval_ids": [
                "01957e8a-789a-7abc-8abc-0123456789ab",
                "01957e8a-89ab-7abc-8abc-0123456789ab",
            ],
        }
        self.assertFalse(list(command_validator.iter_errors(tenant_authorization)))
        self.assertTrue(
            list(command_validator.iter_errors({**tenant_authorization, "approval_ids": command["approval_ids"]})),
            "tenant authorization requires two distinct approvals",
        )
        self.assertTrue(
            list(command_validator.iter_errors({**tenant_authorization, "requested_action": "redact"})),
            "tenant redaction must not be widened into tenant destruction",
        )

        receipt_schema = json.loads(
            (SCHEMAS / "data_governance_receipt.schema.json").read_text(encoding="utf-8")
        )
        receipt = json.loads(
            (VALID / "data_governance_receipt.json").read_text(encoding="utf-8")
        )
        receipt_validator = Draft202012Validator(receipt_schema, registry=registry)
        redaction = {
            **receipt,
            "outcome": "redaction_completed",
            "resulting_state": "verifying",
            "work_item_id": "01957e8a-abcd-7abc-8abc-0123456789ab",
            "surface": "database",
            "action": "redact",
        }
        self.assertFalse(list(receipt_validator.iter_errors(redaction)))
        self.assertTrue(
            list(receipt_validator.iter_errors({**redaction, "resulting_state": "executing_irreversible_deletion"})),
            "redaction evidence must never escalate into irreversible deletion",
        )
        effect_surfaces = {
            "object_storage": "external_delete",
            "cache": "cache_invalidate",
            "embedding_index": "external_delete",
            "provider_copy": "external_delete",
            "auth_identity": "external_delete",
            "vault_secret": "crypto_erase",
            "backup": "backup_expiry_wait",
        }
        for surface, action in effect_surfaces.items():
            effect_unknown = {
                **receipt,
                "outcome": "effect_unknown",
                "resulting_state": "effect_unknown",
                "work_item_id": "01957e8a-abcd-7abc-8abc-0123456789ab",
                "surface": surface,
                "action": action,
                "outcome_code": "external_effect_unknown",
            }
            self.assertFalse(list(receipt_validator.iter_errors(effect_unknown)), surface)
            if surface != "backup":
                self.assertFalse(
                    list(receipt_validator.iter_errors({**effect_unknown, "action": "redact"})),
                    f"{surface} redaction ambiguity must remain reconcilable",
                )
        for forbidden_key, forbidden_value in (
            ("resource_locator_hmac", "hmac-sha256:" + "a" * 64),
            ("subject_id", "01957e8a-abcd-7abc-8abc-0123456789ab"),
            ("content_digest", "a" * 64),
            ("raw_error", "provider leaked a private value"),
            ("object_url", "https://storage.example/private-object"),
            ("provider_reference", "provider-object-42"),
        ):
            self.assertTrue(
                list(receipt_validator.iter_errors({**receipt, forbidden_key: forbidden_value})),
                forbidden_key,
            )

        work_item_schema = json.loads(
            (SCHEMAS / "data_governance_work_item.schema.json").read_text(encoding="utf-8")
        )
        work_item = json.loads(
            (VALID / "data_governance_work_item.json").read_text(encoding="utf-8")
        )
        work_item_validator = Draft202012Validator(work_item_schema, registry=registry)
        self.assertFalse(list(work_item_validator.iter_errors(work_item)))
        self.assertTrue(
            list(work_item_validator.iter_errors({
                **work_item,
                "resource_locator_hmac": "hmac-sha256:" + "b" * 64,
            })),
            "terminal work must erase its operational locator",
        )
        redaction_item = {
            **work_item,
            "surface": "object_storage",
            "resource_class": "object_blob",
            "action": "redact",
            "state": "effect_unknown",
            "resource_locator_hmac": "hmac-sha256:" + "b" * 64,
            "attempt": 1,
            "next_attempt_at": None,
            "failure_code": "external_effect_unknown",
            "verification_digest": None,
            "retention_exception_code": None,
            "recoverable_until": None,
        }
        for surface, resource_class in (
            ("object_storage", "object_blob"),
            ("cache", "cache_entry"),
            ("embedding_index", "embedding"),
            ("provider_copy", "provider_copy"),
            ("auth_identity", "authentication_identity"),
            ("vault_secret", "vault_secret"),
        ):
            self.assertFalse(
                list(work_item_validator.iter_errors({
                    **redaction_item,
                    "surface": surface,
                    "resource_class": resource_class,
                })),
                surface,
            )
        self.assertTrue(list(work_item_validator.iter_errors({
            **redaction_item,
            "surface": "backup",
            "resource_class": "backup_snapshot",
        })))

        status_schema = json.loads(
            (SCHEMAS / "data_governance_status.schema.json").read_text(encoding="utf-8")
        )
        status = json.loads(
            (VALID / "data_governance_status.json").read_text(encoding="utf-8")
        )
        status_validator = Draft202012Validator(status_schema, registry=registry)
        for active_action in ("redact", "irreversible_delete"):
            self.assertFalse(list(status_validator.iter_errors({
                **status,
                "state": "effect_unknown",
                "active_action": active_action,
                "attempt": 1,
                "status_code": "external_effect_unknown",
                "completed_at": None,
            })), active_action)

        hold_schema = json.loads(
            (SCHEMAS / "data_legal_hold.schema.json").read_text(encoding="utf-8")
        )
        hold = json.loads((VALID / "data_legal_hold.json").read_text(encoding="utf-8"))
        hold_validator = Draft202012Validator(hold_schema, registry=registry)
        self.assertFalse(list(hold_validator.iter_errors(hold)))
        self.assertTrue(list(hold_validator.iter_errors({
            **hold,
            "scope_hmac": "hmac-sha256:" + "c" * 64,
        })))
        self.assertTrue(list(hold_validator.iter_errors({
            **hold,
            "authorized_by_actor_id": "01957e8a-abcd-7abc-8abc-0123456789ab",
        })))
        self.assertTrue(list(hold_validator.iter_errors({
            **hold,
            "operation": "expire",
            "outcome": "released",
        })))

    def test_legal_hold_asyncapi_separates_records_and_binds_uuidv7_tenant(self) -> None:
        asyncapi = yaml.safe_load(
            (ROOT / "contracts" / "asyncapi" / "axtro-events.yaml").read_text(encoding="utf-8")
        )
        hold_schema = json.loads(
            (SCHEMAS / "data_legal_hold.schema.json").read_text(encoding="utf-8")
        )
        receipt = json.loads((VALID / "data_legal_hold.json").read_text(encoding="utf-8"))
        command = {
            **receipt,
            "record_type": "command",
            "receipt_id": None,
            "scope_hmac": "hmac-sha256:" + "b" * 64,
            "authorized_by_actor_id": "01957e8a-789a-7abc-8abc-0123456789ab",
            "outcome": None,
            "outcome_code": None,
        }
        records = {
            "command": (
                "dataLegalHoldCommands",
                "dataLegalHoldCommand",
                "DataLegalHoldCommand",
                command,
            ),
            "receipt": (
                "dataLegalHoldReceipts",
                "dataLegalHoldReceipt",
                "DataLegalHoldReceipt",
                receipt,
            ),
        }

        for record_type, (channel_name, message_name, component_name, document) in records.items():
            channel = asyncapi["channels"][channel_name]
            self.assertEqual(
                f"#/components/messages/{component_name}",
                channel["messages"][message_name]["$ref"],
            )
            payload = asyncapi["components"]["messages"][component_name]["payload"]
            self.assertEqual("../schemas/data_legal_hold.schema.json", payload["allOf"][0]["$ref"])
            discriminator = payload["allOf"][1]
            self.assertEqual(record_type, discriminator["properties"]["record_type"]["const"])
            validator = Draft202012Validator({"allOf": [hold_schema, discriminator]})
            self.assertFalse(list(validator.iter_errors(document)), record_type)
            wrong_type = "receipt" if record_type == "command" else "command"
            self.assertTrue(
                list(validator.iter_errors({**document, "record_type": wrong_type})),
                f"{channel_name} accepted wrong record_type",
            )

            parameter = channel["parameters"]["tenantId"]
            self.assertEqual("$message.payload#/tenant_id", parameter["location"])
            tenant_schema = parameter["x-axtro-schema"]
            self.assertEqual("uuid", tenant_schema["format"])
            tenant_validator = Draft202012Validator(tenant_schema)
            self.assertFalse(list(tenant_validator.iter_errors(document["tenant_id"])))
            self.assertTrue(list(tenant_validator.iter_errors("tenant-alpha")))
            self.assertTrue(list(tenant_validator.iter_errors(
                "01957e8a-9999-4abc-8abc-0123456789ab"
            )))

            def accepts_channel_tenant(channel_tenant_id: str) -> bool:
                return (
                    not list(tenant_validator.iter_errors(channel_tenant_id))
                    and channel_tenant_id == document["tenant_id"]
                )

            self.assertTrue(accepts_channel_tenant(document["tenant_id"]))
            self.assertFalse(
                accepts_channel_tenant("01957e8a-9999-7abc-8abc-0123456789ab"),
                "cross-tenant channel substitution matched payload tenant_id",
            )

    def test_data_governance_asyncapi_binds_uuidv7_tenant_to_every_payload(self) -> None:
        asyncapi = yaml.safe_load(
            (ROOT / "contracts" / "asyncapi" / "axtro-events.yaml").read_text(encoding="utf-8")
        )
        channels = {
            "dataGovernanceCommands": "data_governance_command.json",
            "dataGovernanceStatus": "data_governance_status.json",
            "dataGovernanceWorkItems": "data_governance_work_item.json",
            "dataGovernanceReceipts": "data_governance_receipt.json",
        }

        for channel_name, example_name in channels.items():
            document = json.loads((VALID / example_name).read_text(encoding="utf-8"))
            parameter = asyncapi["channels"][channel_name]["parameters"]["tenantId"]
            self.assertEqual("$message.payload#/tenant_id", parameter["location"])
            tenant_schema = parameter["x-axtro-schema"]
            self.assertEqual("uuid", tenant_schema["format"])
            tenant_validator = Draft202012Validator(tenant_schema)
            self.assertFalse(list(tenant_validator.iter_errors(document["tenant_id"])))
            self.assertTrue(list(tenant_validator.iter_errors("tenant-alpha")))
            self.assertTrue(list(tenant_validator.iter_errors(
                "01957e8a-9999-4abc-8abc-0123456789ab"
            )))

            def accepts_channel_tenant(channel_tenant_id: str) -> bool:
                return (
                    not list(tenant_validator.iter_errors(channel_tenant_id))
                    and channel_tenant_id == document["tenant_id"]
                )

            self.assertTrue(accepts_channel_tenant(document["tenant_id"]), channel_name)
            self.assertFalse(
                accepts_channel_tenant("01957e8a-9999-7abc-8abc-0123456789ab"),
                f"{channel_name} accepted a cross-tenant channel substitution",
            )

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
