"""Strict, dependency-free TOML subset loader for the project setup validator.

Python 3.11+ uses tomllib. Python 3.9 and 3.10 use this parser only for the
repository-owned .codex files, whose supported syntax is deliberately narrow.
"""
from __future__ import annotations

import ast
import re
from typing import Any, Dict


class TomlSubsetError(ValueError):
    """Raised when a repository config uses unsupported TOML syntax."""


def _without_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    output: list[str] = []
    for char in line:
        if quote and char == "\\" and not escaped:
            escaped = True
            output.append(char)
            continue
        if char in {"'", '"'} and not escaped:
            quote = None if quote == char else char if quote is None else quote
        if char == "#" and quote is None:
            break
        output.append(char)
        escaped = False
    return "".join(output).strip()


def _parse_value(raw: str) -> Any:
    value = raw.strip()
    if value in {"true", "false"}:
        return value == "true"
    if re.fullmatch(r"[+-]?\d+", value):
        return int(value)
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        try:
            return ast.literal_eval(value)
        except (SyntaxError, ValueError) as exc:
            raise TomlSubsetError(f"Invalid quoted value: {value!r}") from exc
    raise TomlSubsetError(f"Unsupported TOML value: {value!r}")


def loads(text: str) -> Dict[str, Any]:
    """Load the scalar tables and multiline strings used by .codex TOML files."""
    result: Dict[str, Any] = {}
    current: Dict[str, Any] = result
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        raw_line = _without_comment(lines[index])
        index += 1
        if not raw_line:
            continue
        if raw_line.startswith("[") and raw_line.endswith("]"):
            table_name = raw_line[1:-1].strip()
            if not table_name or not re.fullmatch(r"[A-Za-z0-9_.-]+", table_name):
                raise TomlSubsetError(f"Invalid table name: {table_name!r}")
            current = result
            for part in table_name.split("."):
                existing = current.get(part)
                if existing is None:
                    existing = {}
                    current[part] = existing
                if not isinstance(existing, dict):
                    raise TomlSubsetError(f"Table collides with scalar: {table_name!r}")
                current = existing
            continue
        if "=" not in raw_line:
            raise TomlSubsetError(f"Expected key/value assignment: {raw_line!r}")
        key, value = (part.strip() for part in raw_line.split("=", 1))
        if not re.fullmatch(r"[A-Za-z0-9_-]+", key):
            raise TomlSubsetError(f"Invalid key: {key!r}")
        if value.startswith('\"\"\"'):
            chunks = [value[3:]]
            if value.endswith('\"\"\"') and len(value) > 6:
                chunks[-1] = chunks[-1][:-3]
            else:
                while index < len(lines):
                    candidate = lines[index]
                    index += 1
                    if '\"\"\"' in candidate:
                        before, _, _ = candidate.partition('\"\"\"')
                        chunks.append(before)
                        break
                    chunks.append(candidate)
                else:
                    raise TomlSubsetError(f"Unterminated multiline string for {key!r}")
            current[key] = "\n".join(chunks).lstrip("\n")
            continue
        current[key] = _parse_value(value)
    return result
