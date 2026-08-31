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
EXPECTED_SCHEMA_COUNT = 64
GENERATOR_VERSION = "1.2.0"
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


@dataclass(frozen=True)
class DiscriminatedVariant:
    discriminator: str
    value: Any
    properties: dict[str, Any]


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


def variant_suffix(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return f"Value{str(value).replace('-', 'Minus').replace('.', 'Point')}"
    suffix = pascal_case(re.sub(r"[^A-Za-z0-9_]+", "_", str(value)))
    return suffix or "Value"


def merge_property_schema(base: Any, override: Any) -> Any:
    """Preserve base shape while applying a conditional branch narrowing."""
    if not isinstance(base, dict) or not isinstance(override, dict):
        return override
    if any(key in override for key in ("const", "$ref", "oneOf", "anyOf", "enum")):
        return override
    if any(key in base for key in ("oneOf", "anyOf")) and "type" in override:
        return override
    merged = dict(base)
    merged.update(override)
    return merged


def discriminated_variants(document: dict[str, Any]) -> list[DiscriminatedVariant] | None:
    """Return declared exhaustive root-object variants when they are machine-provable."""
    declared_discriminator = document.get("x-axtro-discriminator")
    if not isinstance(declared_discriminator, str) or not declared_discriminator:
        return None
    properties = document.get("properties")
    clauses = document.get("allOf")
    if not isinstance(properties, dict) or not isinstance(clauses, list) or not clauses:
        return None

    parsed: list[tuple[str, Any, dict[str, Any]]] = []
    for clause in clauses:
        if not isinstance(clause, dict) or "else" in clause:
            return None
        condition = clause.get("if")
        consequence = clause.get("then")
        if not isinstance(condition, dict) or not isinstance(consequence, dict):
            return None
        condition_properties = condition.get("properties")
        consequence_properties = consequence.get("properties")
        if not isinstance(condition_properties, dict) or len(condition_properties) != 1:
            return None
        if not isinstance(consequence_properties, dict):
            return None
        discriminator, discriminator_constraint = next(iter(condition_properties.items()))
        if not isinstance(discriminator_constraint, dict) or "const" not in discriminator_constraint:
            return None
        if discriminator not in document.get("required", []):
            return None
        parsed.append((discriminator, discriminator_constraint["const"], consequence_properties))

    discriminator = parsed[0][0]
    if any(candidate != discriminator for candidate, _, _ in parsed):
        return None
    if discriminator != declared_discriminator:
        return None
    discriminator_schema = properties.get(discriminator)
    if not isinstance(discriminator_schema, dict):
        return None
    if discriminator_schema.get("type") == "boolean":
        expected_values: list[Any] = [False, True]
    elif isinstance(discriminator_schema.get("enum"), list):
        expected_values = discriminator_schema["enum"]
    elif "const" in discriminator_schema:
        expected_values = [discriminator_schema["const"]]
    else:
        return None
    encoded_expected = {json_literal(value) for value in expected_values}
    encoded_actual = {json_literal(value) for _, value, _ in parsed}
    if len(encoded_actual) != len(parsed) or encoded_actual != encoded_expected:
        return None

    variants: list[DiscriminatedVariant] = []
    for _, value, overrides in parsed:
        variant_properties = {
            name: merge_property_schema(schema, overrides.get(name, schema))
            for name, schema in properties.items()
        }
        variant_properties[discriminator] = {"const": value}
        variants.append(DiscriminatedVariant(discriminator, value, variant_properties))
    return variants


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
        if "x-axtro-discriminator" in document and discriminated_variants(document) is None:
            raise ValueError(
                f"{path.relative_to(ROOT)} declares x-axtro-discriminator "
                "without exhaustive machine-provable variants"
            )
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
        lines.append(
            f"/** Source: {contract.source_schema}; schema: {contract.schema_id}; version: {contract.schema_version}. */",
        )
        variants = discriminated_variants(contract.document)
        if variants is None:
            lines.append(
                f"export interface {contract.type_name} "
                f"{ts_type(contract.document, current_document=contract.document, documents_by_id=documents_by_id)}",
            )
        else:
            rendered_variants = []
            for variant in variants:
                variant_schema = {
                    "type": "object",
                    "properties": variant.properties,
                    "required": contract.document.get("required", []),
                }
                rendered_variants.append(
                    ts_type(
                        variant_schema,
                        current_document=contract.document,
                        documents_by_id=documents_by_id,
                    )
                )
            lines.append(
                f"export type {contract.type_name} = "
                + "\n  | ".join(rendered_variants)
                + ";",
            )
        lines.append("")
    lines.extend([render_metadata(contracts, "typescript"), ""])
    return "\n".join(lines)


def render_python(contracts: list[ContractSchema]) -> str:
    documents_by_id = {contract.schema_id: contract.document for contract in contracts}
    lines = [
        '"""Generated contract type declarations. Do not edit manually."""',
        "from __future__ import annotations",
        "",
        "from typing import Any, Literal, TypeAlias, TypedDict",
        "",
        f"CONTRACT_GENERATOR_VERSION = {py_literal(GENERATOR_VERSION)}",
        "",
    ]
    for contract in contracts:
        lines.append(f"# Source: {contract.source_schema}; schema: {contract.schema_id}; version: {contract.schema_version}.")
        properties = contract.document.get("properties", {})
        variants = discriminated_variants(contract.document)
        if variants is not None:
            variant_names: list[str] = []
            for variant in variants:
                variant_name = f"_{contract.type_name}{pascal_case(variant.discriminator)}{variant_suffix(variant.value)}"
                variant_names.append(variant_name)
                lines.append(f"class {variant_name}(TypedDict):")
                for name, value in variant.properties.items():
                    lines.append(f"    {name}: {py_type(value, contract.document, documents_by_id)}")
                lines.append("")
            lines.append(f"{contract.type_name}: TypeAlias = {' | '.join(variant_names)}")
        elif not isinstance(properties, dict) or not properties:
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
