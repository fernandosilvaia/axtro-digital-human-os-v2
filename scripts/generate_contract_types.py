#!/usr/bin/env python3
"""Generate deterministic TypeScript and Python types from normative JSON Schemas."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS_DIR = ROOT / "contracts" / "schemas"
EXPECTED_SCHEMA_COUNT = 48
GENERATOR_VERSION = "1.0.0"
IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


@dataclass(frozen=True)
class ContractSchema:
    name: str
    type_name: str
    source_schema: str
    schema_id: str
    schema_version: str
    source_hash: str
    document: dict[str, Any]


def pascal_case(value: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in value.split("_") if part)


def property_name(value: str) -> str:
    return value if IDENTIFIER.fullmatch(value) else json.dumps(value, ensure_ascii=False)


def json_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def py_literal(value: Any) -> str:
    if value is None:
        return "None"
    return repr(value)


def load_contracts() -> list[ContractSchema]:
    contracts: list[ContractSchema] = []
    paths = sorted(SCHEMAS_DIR.glob("*.schema.json"))
    if len(paths) != EXPECTED_SCHEMA_COUNT:
        raise ValueError(f"Expected {EXPECTED_SCHEMA_COUNT} schemas, found {len(paths)}")
    for path in paths:
        raw = path.read_bytes()
        document = json.loads(raw.decode("utf-8"))
        if not isinstance(document, dict):
            raise ValueError(f"{path.relative_to(ROOT)} must contain an object")
        schema_id = document.get("$id")
        schema_version = document.get("properties", {}).get("schema_version", {}).get("const")
        if not isinstance(schema_id, str) or not schema_id:
            raise ValueError(f"{path.relative_to(ROOT)} is missing $id")
        if not isinstance(schema_version, str) or not schema_version:
            raise ValueError(f"{path.relative_to(ROOT)} is missing schema_version.const")
        name = path.name.removesuffix(".schema.json")
        contracts.append(
            ContractSchema(
                name=name,
                type_name=pascal_case(name),
                source_schema=path.relative_to(ROOT).as_posix(),
                schema_id=schema_id,
                schema_version=schema_version,
                source_hash=hashlib.sha256(raw).hexdigest(),
                document=document,
            )
        )
    return contracts


def resolve_fragment_reference(
    reference: str,
    current_document: dict[str, Any],
    documents_by_id: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], Any] | None:
    """Resolve only JSON Pointer fragments; plain schema refs remain named types."""
    if reference.startswith("#"):
        target_document = current_document
        fragment = reference[1:]
    elif "#" in reference:
        schema_id, fragment = reference.split("#", 1)
        target_document = documents_by_id.get(schema_id)
        if target_document is None:
            return None
    else:
        return None
    if not fragment.startswith("/"):
        return None
    target: Any = target_document
    for segment in fragment.removeprefix("/").split("/"):
        key = segment.replace("~1", "/").replace("~0", "~")
        if not isinstance(target, dict) or key not in target:
            return None
        target = target[key]
    return target_document, target


def ts_type(
    node: Any,
    indent: str = "",
    current_document: dict[str, Any] | None = None,
    documents_by_id: dict[str, dict[str, Any]] | None = None,
) -> str:
    if not isinstance(node, dict):
        return "unknown"
    if "$ref" in node and isinstance(node["$ref"], str):
        resolved = None if current_document is None or documents_by_id is None else resolve_fragment_reference(
            node["$ref"], current_document, documents_by_id,
        )
        if resolved is not None:
            resolved_document, resolved_node = resolved
            return ts_type(resolved_node, indent, resolved_document, documents_by_id)
        reference = node["$ref"].rsplit("/", 1)[-1].removesuffix(".schema.json")
        return pascal_case(reference) if reference else "unknown"
    if "const" in node:
        return json_literal(node["const"])
    if isinstance(node.get("enum"), list):
        return " | ".join(json_literal(value) for value in node["enum"])
    for union_key in ("oneOf", "anyOf"):
        if isinstance(node.get(union_key), list):
            return " | ".join(f"({ts_type(option, indent, current_document, documents_by_id)})" for option in node[union_key])
    declared_type = node.get("type")
    if isinstance(declared_type, list):
        return " | ".join(ts_type({**node, "type": item}, indent, current_document, documents_by_id) for item in declared_type)
    if declared_type == "string":
        return "string"
    if declared_type in {"integer", "number"}:
        return "number"
    if declared_type == "boolean":
        return "boolean"
    if declared_type == "null":
        return "null"
    if declared_type == "array":
        return f"Array<{ts_type(node.get('items', {}), indent, current_document, documents_by_id)}>"
    if declared_type == "object" or "properties" in node:
        properties = node.get("properties")
        if not isinstance(properties, dict) or not properties:
            return "Record<string, unknown>"
        required = set(node.get("required", []))
        lines = ["{"]
        for name, value in properties.items():
            optional = "" if name in required else "?"
            lines.append(f"{indent}  {property_name(name)}{optional}: {ts_type(value, indent + '  ', current_document, documents_by_id)};")
        lines.append(f"{indent}}}")
        return "\n".join(lines)
    if isinstance(node.get("allOf"), list):
        return " & ".join(f"({ts_type(option, indent, current_document, documents_by_id)})" for option in node["allOf"])
    return "unknown"


def py_type(
    node: Any,
    current_document: dict[str, Any] | None = None,
    documents_by_id: dict[str, dict[str, Any]] | None = None,
) -> str:
    if not isinstance(node, dict):
        return "Any"
    if "$ref" in node and isinstance(node["$ref"], str):
        resolved = None if current_document is None or documents_by_id is None else resolve_fragment_reference(
            node["$ref"], current_document, documents_by_id,
        )
        if resolved is not None:
            resolved_document, resolved_node = resolved
            return py_type(resolved_node, resolved_document, documents_by_id)
        reference = node["$ref"].rsplit("/", 1)[-1].removesuffix(".schema.json")
        return pascal_case(reference) if reference else "Any"
    if "const" in node:
        return f"Literal[{py_literal(node['const'])}]"
    if isinstance(node.get("enum"), list):
        return f"Literal[{', '.join(py_literal(value) for value in node['enum'])}]"
    for union_key in ("oneOf", "anyOf"):
        if isinstance(node.get(union_key), list):
            return " | ".join(f"({py_type(option, current_document, documents_by_id)})" for option in node[union_key])
    if isinstance(node.get("allOf"), list):
        return " & ".join(f"({py_type(option, current_document, documents_by_id)})" for option in node["allOf"])
    declared_type = node.get("type")
    if isinstance(declared_type, list):
        return " | ".join(py_type({**node, "type": item}, current_document, documents_by_id) for item in declared_type)
    if declared_type == "string":
        return "str"
    if declared_type == "integer":
        return "int"
    if declared_type == "number":
        return "float"
    if declared_type == "boolean":
        return "bool"
    if declared_type == "null":
        return "None"
    if declared_type == "array":
        return f"list[{py_type(node.get('items', {}), current_document, documents_by_id)}]"
    if declared_type == "object" or "properties" in node:
        return "dict[str, object]"
    return "Any"


def render_metadata(contracts: list[ContractSchema], language: str) -> str:
    metadata = {
        contract.type_name: {
            "schema_id": contract.schema_id,
            "schema_version": contract.schema_version,
            "source_hash": contract.source_hash,
            "source_schema": contract.source_schema,
        }
        for contract in contracts
    }
    encoded = json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True)
    if language == "typescript":
        return f"export const CONTRACT_METADATA = {encoded} as const satisfies Record<string, ContractMetadata>;"
    return f"CONTRACT_METADATA: dict[str, dict[str, str]] = {encoded}"


def render_typescript(contracts: list[ContractSchema]) -> str:
    documents_by_id = {contract.schema_id: contract.document for contract in contracts}
    lines = [
        "/*",
        " * GENERATED FILE. DO NOT EDIT.",
        f" * generator: scripts/generate_contract_types.py@{GENERATOR_VERSION}",
        f" * source: {len(contracts)} JSON Schema Draft 2020-12 documents under contracts/schemas/",
        " */",
        "",
        f"export const CONTRACT_GENERATOR_VERSION = {json_literal(GENERATOR_VERSION)} as const;",
        "export interface ContractMetadata {",
        "  schema_id: string;",
        "  schema_version: string;",
        "  source_hash: string;",
        "  source_schema: string;",
        "}",
        "",
    ]
    for contract in contracts:
        lines.extend(
            [
                f"/** Source: {contract.source_schema}; schema: {contract.schema_id}; version: {contract.schema_version}. */",
                f"export interface {contract.type_name} {ts_type(contract.document, current_document=contract.document, documents_by_id=documents_by_id)}",
                "",
            ]
        )
    lines.extend([render_metadata(contracts, "typescript"), ""])
    return "\n".join(lines)


def render_python(contracts: list[ContractSchema]) -> str:
    documents_by_id = {contract.schema_id: contract.document for contract in contracts}
    lines = [
        '"""Generated contract type declarations. Do not edit manually."""',
        "from __future__ import annotations",
        "",
        "from typing import Any, Literal, TypedDict",
        "",
        f"CONTRACT_GENERATOR_VERSION = {py_literal(GENERATOR_VERSION)}",
        "",
    ]
    for contract in contracts:
        lines.append(f"# Source: {contract.source_schema}; schema: {contract.schema_id}; version: {contract.schema_version}.")
        properties = contract.document.get("properties", {})
        if not isinstance(properties, dict) or not properties:
            lines.append(f"class {contract.type_name}(TypedDict):")
            lines.append("    pass")
        else:
            required = set(contract.document.get("required", []))
            optional = [name for name in properties if name not in required]
            if optional and required:
                required_type_name = f"_{contract.type_name}Required"
                lines.append(f"class {required_type_name}(TypedDict):")
                for name in properties:
                    if name in required:
                        lines.append(f"    {name}: {py_type(properties[name], contract.document, documents_by_id)}")
                lines.append("")
                lines.append(f"class {contract.type_name}({required_type_name}, total=False):")
                for name in optional:
                    lines.append(f"    {name}: {py_type(properties[name], contract.document, documents_by_id)}")
            elif optional:
                lines.append(f"class {contract.type_name}(TypedDict, total=False):")
                for name, value in properties.items():
                    lines.append(f"    {name}: {py_type(value, contract.document, documents_by_id)}")
            else:
                lines.append(f"class {contract.type_name}(TypedDict):")
                for name, value in properties.items():
                    lines.append(f"    {name}: {py_type(value, contract.document, documents_by_id)}")
        lines.append("")
    lines.extend(
        [
            render_metadata(contracts, "python"),
            "",
            "__all__ = [",
            "    'CONTRACT_GENERATOR_VERSION',",
            "    'CONTRACT_METADATA',",
            *[f"    '{contract.type_name}'," for contract in contracts],
            "]",
            "",
        ]
    )
    return "\n".join(lines)


def expected_outputs(contracts: list[ContractSchema], output_root: Path) -> dict[Path, str]:
    return {
        output_root / "packages" / "contracts-ts" / "src" / "generated.ts": render_typescript(contracts),
        output_root / "packages" / "contracts-ts" / "src" / "index.ts": (
            "/* GENERATED FILE. DO NOT EDIT. */\nexport * from './generated.js';\n"
        ),
        output_root / "packages" / "contracts-py" / "src" / "axtro_contracts" / "__init__.py": render_python(contracts),
    }


def write_or_check(outputs: dict[Path, str], check: bool) -> list[Path]:
    drifted: list[Path] = []
    for path, content in outputs.items():
        existing = path.read_text(encoding="utf-8") if path.exists() else None
        if existing == content:
            continue
        drifted.append(path)
        if not check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    return drifted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when generated files differ")
    parser.add_argument("--output-root", type=Path, default=ROOT, help="write generated output below this root")
    args = parser.parse_args(argv)
    try:
        contracts = load_contracts()
        drifted = write_or_check(expected_outputs(contracts, args.output_root.resolve()), args.check)
    except Exception as exc:
        print(f"CONTRACT TYPE GENERATION FAILED: {exc}")
        return 1
    if args.check and drifted:
        print("CONTRACT TYPE GENERATION DRIFT DETECTED")
        for path in drifted:
            print(f"- {path.relative_to(args.output_root.resolve())}")
        return 1
    action = "CHECK PASSED" if args.check else "GENERATED"
    print(f"CONTRACT TYPE {action}: {len(contracts)} schemas, generator {GENERATOR_VERSION}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
