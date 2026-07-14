#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = ROOT / "contracts" / "openapi" / "axtro-api.yaml"
ASYNCAPI = ROOT / "contracts" / "asyncapi" / "axtro-events.yaml"


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must contain a YAML object")
    return value


def walk_refs(node: Any, source: Path, errors: list[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str) and not value.startswith("#") and "://" not in value:
                target = (source.parent / value).resolve()
                if not target.exists():
                    errors.append(f"{source.relative_to(ROOT)} has missing $ref {value}")
            walk_refs(value, source, errors)
    elif isinstance(node, list):
        for value in node:
            walk_refs(value, source, errors)


def collect_operation_ids(paths: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for path_item in paths.values():
        if not isinstance(path_item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete", "options", "head"):
            operation = path_item.get(method)
            if isinstance(operation, dict) and operation.get("operationId"):
                values.append(operation["operationId"])
    return values


def main() -> int:
    errors: list[str] = []
    for path in (OPENAPI, ASYNCAPI):
        if not path.exists():
            errors.append(f"Missing {path.relative_to(ROOT)}")
    if errors:
        print("SPEC VALIDATION FAILED")
        for error in errors: print(f"- {error}")
        return 1

    try:
        openapi = load_yaml(OPENAPI)
        asyncapi = load_yaml(ASYNCAPI)
    except Exception as exc:
        print(f"SPEC VALIDATION FAILED\n- {exc}")
        return 1

    if openapi.get("openapi") != "3.1.0":
        errors.append("OpenAPI version must be 3.1.0")
    required_paths = {
        "/sessions", "/sessions/{session_id}", "/sessions/{session_id}/activate",
        "/sessions/{session_id}/turns", "/sessions/{session_id}/action-intents",
        "/sessions/{session_id}/handoffs", "/sessions/{session_id}/complete",
        "/sessions/{session_id}/timeline",
    }
    missing_paths = required_paths - set(openapi.get("paths", {}))
    if missing_paths:
        errors.append(f"OpenAPI missing paths: {sorted(missing_paths)}")
    operation_ids = collect_operation_ids(openapi.get("paths", {}))
    if len(operation_ids) != len(set(operation_ids)):
        errors.append("OpenAPI operationId values must be unique")
    if not openapi.get("components", {}).get("securitySchemes"):
        errors.append("OpenAPI must declare securitySchemes")

    if asyncapi.get("asyncapi") != "3.0.0":
        errors.append("AsyncAPI version must be 3.0.0")
    for key in ("channels", "operations", "components"):
        if not asyncapi.get(key):
            errors.append(f"AsyncAPI missing {key}")
    required_operations = {"publishDomainEvent", "consumeDomainEvent", "requestWorkflow", "consumeWorkflowCommand", "publishWorkflowStatus"}
    missing_operations = required_operations - set(asyncapi.get("operations", {}))
    if missing_operations:
        errors.append(f"AsyncAPI missing operations: {sorted(missing_operations)}")

    walk_refs(openapi, OPENAPI, errors)
    walk_refs(asyncapi, ASYNCAPI, errors)

    if errors:
        print("SPEC VALIDATION FAILED")
        for error in errors: print(f"- {error}")
        return 1
    print(f"SPEC VALIDATION PASSED: {len(openapi.get('paths', {}))} OpenAPI paths, {len(asyncapi.get('operations', {}))} AsyncAPI operations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
