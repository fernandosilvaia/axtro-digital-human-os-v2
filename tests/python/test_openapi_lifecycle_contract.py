"""Executable OpenAPI conformance checks for the five M1 lifecycle operations."""
from __future__ import annotations

import copy
import unittest
from pathlib import Path
from typing import Any

import jsonschema
import yaml


ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "contracts" / "openapi" / "axtro-api.yaml"
UUID_V7 = "018f0000-0000-7000-8000-000000000001"


def load_openapi() -> dict[str, Any]:
    value = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError("OpenAPI document must be an object")
    return value


def resolve_local_schema(document: dict[str, Any], value: Any) -> Any:
    if isinstance(value, dict):
        reference = value.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/"):
            target: Any = document
            for segment in reference.removeprefix("#/").split("/"):
                if not isinstance(target, dict):
                    raise AssertionError(f"unresolvable local OpenAPI reference: {reference}")
                target = target[segment.replace("~1", "/").replace("~0", "~")]
            return resolve_local_schema(document, target)
        return {key: resolve_local_schema(document, item) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_local_schema(document, item) for item in value]
    return copy.deepcopy(value)


def operation_by_id(document: dict[str, Any], operation_id: str) -> dict[str, Any]:
    paths = document.get("paths", {})
    if not isinstance(paths, dict):
        raise AssertionError("OpenAPI paths must be an object")
    for path_item in paths.values():
        if not isinstance(path_item, dict):
            continue
        for operation in path_item.values():
            if isinstance(operation, dict) and operation.get("operationId") == operation_id:
                return operation
    raise AssertionError(f"missing OpenAPI operation {operation_id}")


def request_schema(document: dict[str, Any], operation_id: str) -> dict[str, Any]:
    operation = operation_by_id(document, operation_id)
    body = operation.get("requestBody", {})
    schema = body.get("content", {}).get("application/json", {}).get("schema")
    if not isinstance(schema, dict):
        raise AssertionError(f"{operation_id} must declare application/json request schema")
    resolved = resolve_local_schema(document, schema)
    if not isinstance(resolved, dict):
        raise AssertionError(f"{operation_id} request schema must resolve to an object")
    return resolved


class OpenApiLifecycleContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.document = load_openapi()

    def test_request_schemas_accept_and_reject_generated_cases(self) -> None:
        cases = {
            "createSession": (
                {
                    "agent_id": UUID_V7,
                    "role_pack_id": "sales-closer",
                    "role_pack_version": "1.0.0",
                    "channel": "api",
                    "language": "en-US",
                },
                [
                    {"agent_id": UUID_V7, "role_pack_id": "Invalid Space", "role_pack_version": "1.0.0", "channel": "api", "language": "en-US"},
                    {"agent_id": UUID_V7, "role_pack_id": "sales-closer", "role_pack_version": "bad version!", "channel": "api", "language": "en-US"},
                    {"agent_id": UUID_V7, "role_pack_id": "sales-closer", "role_pack_version": "1.0.0", "channel": "api", "language": "english"},
                ],
            ),
            "activateSession": (
                {"presenter_id": UUID_V7, "expected_state_version": 4},
                [
                    {"presenter_id": UUID_V7, "expected_state_version": -1},
                    {"presenter_id": UUID_V7, "expected_state_version": 9_007_199_254_740_992},
                    {"presenter_id": UUID_V7, "expected_state_version": 4.5},
                ],
            ),
            "completeSession": (
                {"reason": "operator completed the deterministic demo", "expected_state_version": 5},
                [
                    {"reason": "", "expected_state_version": 5},
                    {"reason": "line\nbreak", "expected_state_version": 5},
                    {"reason": "valid", "expected_state_version": 9_007_199_254_740_992},
                ],
            ),
        }
        for operation_id, (valid, invalid_values) in cases.items():
            validator = jsonschema.Draft202012Validator(request_schema(self.document, operation_id))
            self.assertTrue(validator.is_valid(valid), operation_id)
            for invalid in invalid_values:
                self.assertFalse(validator.is_valid(invalid), f"{operation_id} unexpectedly accepted {invalid}")

    def test_lifecycle_operations_declare_problem_and_trace_contracts(self) -> None:
        required = {
            "createSession": {"201", "400", "401", "403", "408", "409", "413", "422", "429", "431", "500", "503"},
            "getSession": {"200", "400", "401", "403", "404", "408", "413", "422", "429", "431", "500"},
            "activateSession": {"200", "400", "401", "403", "404", "408", "409", "413", "422", "429", "431", "500", "503"},
            "completeSession": {"200", "400", "401", "403", "404", "408", "409", "413", "422", "429", "431", "500", "503"},
            "listSessionTimeline": {"200", "400", "401", "403", "404", "408", "413", "422", "429", "431", "500"},
        }
        for operation_id, statuses in required.items():
            operation = operation_by_id(self.document, operation_id)
            responses = operation.get("responses", {})
            self.assertTrue(statuses.issubset(responses), operation_id)
            for status in statuses - {"200", "201"}:
                response = resolve_local_schema(self.document, responses[status])
                self.assertIn("application/problem+json", response.get("content", {}), f"{operation_id} {status}")
                self.assertIn("X-Trace-Id", response.get("headers", {}), f"{operation_id} {status}")
            success_status = "201" if operation_id == "createSession" else "200"
            self.assertIn("X-Trace-Id", responses[success_status].get("headers", {}), operation_id)

    def test_idempotency_and_problem_schema_are_executable_contracts(self) -> None:
        components = self.document["components"]
        idempotency = resolve_local_schema(self.document, components["parameters"]["IdempotencyKey"])["schema"]
        validator = jsonschema.Draft202012Validator(idempotency)
        self.assertTrue(validator.is_valid("complete-api-0001"))
        self.assertFalse(validator.is_valid("short"))
        self.assertFalse(validator.is_valid("invalid key with whitespace"))

        problem_schema = resolve_local_schema(self.document, components["schemas"]["Problem"])
        problem_validator = jsonschema.Draft202012Validator(problem_schema)
        self.assertTrue(problem_validator.is_valid({
            "type": "https://axtro.local/problems/session-lifecycle-rejected",
            "title": "Request rejected",
            "status": 422,
            "detail": "Session lifecycle request did not match its contract",
            "trace_id": "a" * 32,
        }))
        self.assertFalse(problem_validator.is_valid({"status": 422}))


if __name__ == "__main__":
    unittest.main()
