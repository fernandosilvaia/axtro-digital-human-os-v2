#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "contracts" / "schemas"
VALID = ROOT / "contracts" / "examples" / "valid"
INVALID = ROOT / "contracts" / "examples" / "invalid"
EXPECTED_COUNT = 61


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AssertionError(f"Invalid JSON in {path.relative_to(ROOT)}: {exc}") from exc


def walk_closed_objects(node: Any, pointer: str = "$", conditional_fragment: bool = False) -> list[str]:
    errors: list[str] = []
    if isinstance(node, dict):
        # Conditional branches may constrain selected fields of an enclosing,
        # closed object. All independently declared object shapes remain closed.
        is_object_schema = not conditional_fragment and (
            node.get("type") == "object" or "properties" in node or "patternProperties" in node
        )
        if is_object_schema and node.get("additionalProperties") is not False:
            errors.append(f"{pointer}: object schema must set additionalProperties=false")
        for key, value in node.items():
            errors.extend(walk_closed_objects(
                value,
                f"{pointer}/{key}",
                conditional_fragment or key in {"if", "then", "else", "not"},
            ))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            errors.extend(walk_closed_objects(value, f"{pointer}/{index}", conditional_fragment))
    return errors


def build_registry(documents: dict[Path, Any]) -> Registry:
    resources: list[tuple[str, Resource[Any]]] = []
    for path, document in documents.items():
        schema_id = document.get("$id") if isinstance(document, dict) else None
        if isinstance(schema_id, str) and schema_id:
            resources.append((schema_id, Resource.from_contents(document)))
    return Registry().with_resources(resources)


def main() -> int:
    errors: list[str] = []
    schema_files = sorted(SCHEMAS.glob("*.schema.json"))
    if len(schema_files) != EXPECTED_COUNT:
        errors.append(f"Expected {EXPECTED_COUNT} schemas, found {len(schema_files)}")

    schema_names = {p.name.removesuffix(".schema.json") for p in schema_files}
    valid_names = {p.stem for p in VALID.glob("*.json")}
    invalid_names = {p.stem for p in INVALID.glob("*.json")}
    if schema_names != valid_names:
        errors.append(f"Valid example mismatch. Missing={sorted(schema_names-valid_names)}, extra={sorted(valid_names-schema_names)}")
    if schema_names != invalid_names:
        errors.append(f"Invalid example mismatch. Missing={sorted(schema_names-invalid_names)}, extra={sorted(invalid_names-schema_names)}")

    documents: dict[Path, Any] = {}
    for path in schema_files:
        try:
            documents[path] = load_json(path)
        except AssertionError as exc:
            errors.append(str(exc))

    registry = build_registry(documents)
    ids: set[str] = set()
    for path in schema_files:
        name = path.name.removesuffix(".schema.json")
        try:
            document = documents[path]
            Draft202012Validator.check_schema(document)
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT)}: invalid Draft 2020-12 schema: {exc}")
            continue

        schema_id = document.get("$id")
        if not schema_id or schema_id in ids:
            errors.append(f"{path.relative_to(ROOT)}: missing or duplicate $id")
        ids.add(schema_id)
        if document.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            errors.append(f"{path.relative_to(ROOT)}: wrong JSON Schema draft")
        schema_version = document.get("properties", {}).get("schema_version", {}).get("const")
        if not isinstance(schema_version, str) or re.fullmatch(r"2\.\d+\.\d+", schema_version) is None:
            errors.append(f"{path.relative_to(ROOT)}: schema_version must be a fixed v2 semantic version")
        if "schema_version" not in document.get("required", []):
            errors.append(f"{path.relative_to(ROOT)}: schema_version must be required")
        for closed_error in walk_closed_objects(document):
            errors.append(f"{path.relative_to(ROOT)} {closed_error}")

        validator = Draft202012Validator(document, registry=registry)
        valid_path = VALID / f"{name}.json"
        invalid_path = INVALID / f"{name}.json"
        if valid_path.exists():
            valid_errors = sorted(validator.iter_errors(load_json(valid_path)), key=lambda e: list(e.path))
            if valid_errors:
                errors.append(f"{valid_path.relative_to(ROOT)} should pass: {valid_errors[0].message}")
        if invalid_path.exists():
            invalid_errors = list(validator.iter_errors(load_json(invalid_path)))
            if not invalid_errors:
                errors.append(f"{invalid_path.relative_to(ROOT)} should fail but passed")

    if errors:
        print("CONTRACT VALIDATION FAILED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"CONTRACT VALIDATION PASSED: {len(schema_files)} schemas, {len(valid_names)} valid examples, {len(invalid_names)} invalid examples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
