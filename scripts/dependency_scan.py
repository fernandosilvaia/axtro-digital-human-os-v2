#!/usr/bin/env python3
"""Deterministic high-severity dependency gate for committed JS and Python locks.

The advisory snapshot is versioned with the repository. This script never opens
the network, so M0-M1 gates remain reproducible and fail closed when the locks
or snapshot cannot be parsed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
SEVERITY_RANK = {"low": 1, "moderate": 2, "high": 3, "critical": 4}


class DependencyScanError(ValueError):
    """Raised when an input cannot safely support a dependency decision."""


@dataclass(frozen=True)
class Dependency:
    ecosystem: str
    name: str
    version: str


@dataclass(frozen=True)
class Advisory:
    identifier: str
    ecosystem: str
    package: str
    affected_versions: tuple[str, ...]
    severity: str


def normalize_package_name(value: str) -> str:
    return value.lower().replace("_", "-")


def load_advisories(path: Path) -> tuple[Advisory, ...]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DependencyScanError("advisory snapshot is unreadable") from exc
    if not isinstance(raw, dict) or set(raw) != {"schema_version", "advisories"}:
        raise DependencyScanError("advisory snapshot has an invalid shape")
    if raw.get("schema_version") != "1.0.0" or not isinstance(raw.get("advisories"), list):
        raise DependencyScanError("advisory snapshot has an unsupported version")

    advisories: list[Advisory] = []
    seen: set[tuple[str, str, str]] = set()
    for item in raw["advisories"]:
        if not isinstance(item, dict) or set(item) != {"id", "ecosystem", "package", "affected_versions", "severity"}:
            raise DependencyScanError("advisory entry has an invalid shape")
        identifier = item["id"]
        ecosystem = item["ecosystem"]
        package = item["package"]
        affected_versions = item["affected_versions"]
        severity = item["severity"]
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]{2,127}", identifier)
            or ecosystem not in {"npm", "pypi"}
            or not isinstance(package, str)
            or not re.fullmatch(r"@?[A-Za-z0-9][A-Za-z0-9@._/-]{0,127}", package)
            or severity not in SEVERITY_RANK
            or not isinstance(affected_versions, list)
            or not affected_versions
        ):
            raise DependencyScanError("advisory entry contains an invalid value")
        versions: list[str] = []
        for version in affected_versions:
            if not isinstance(version, str) or not re.fullmatch(r"[0-9A-Za-z.+!_-]{1,128}", version):
                raise DependencyScanError("advisory entry contains an invalid version")
            versions.append(version)
        key = (ecosystem, normalize_package_name(package), identifier)
        if key in seen:
            raise DependencyScanError("advisory snapshot contains a duplicate entry")
        seen.add(key)
        advisories.append(
            Advisory(
                identifier=identifier,
                ecosystem=ecosystem,
                package=normalize_package_name(package),
                affected_versions=tuple(versions),
                severity=severity,
            )
        )
    return tuple(advisories)


def load_pnpm_lock(path: Path) -> tuple[Dependency, ...]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise DependencyScanError("pnpm lock is unreadable") from exc
    if not any(re.fullmatch(r"lockfileVersion:\s*['\"]?9(?:\.0)?['\"]?", line.strip()) for line in lines):
        raise DependencyScanError("pnpm lock has an unsupported version")

    dependencies: list[Dependency] = []
    in_packages = False
    found_packages = False
    for line in lines:
        if line == "packages:":
            in_packages = True
            found_packages = True
            continue
        if not in_packages:
            continue
        if line and not line.startswith("  "):
            break
        match = re.fullmatch(r"  (?P<key>'[^']+'|\"[^\"]+\"|[^:]+):", line)
        if match is None:
            continue
        raw_key = match.group("key").strip().strip("'\"")
        package, separator, version = raw_key.rpartition("@")
        if not separator or not package or not version or not re.fullmatch(r"[A-Za-z0-9@._/-]+", package):
            raise DependencyScanError("pnpm lock has an invalid package entry")
        dependencies.append(Dependency("npm", normalize_package_name(package), version))
    if not found_packages:
        raise DependencyScanError("pnpm lock is missing the packages section")
    if not dependencies:
        raise DependencyScanError("pnpm lock has no resolved packages")
    return tuple(dependencies)


def load_uv_lock(path: Path) -> tuple[Dependency, ...]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise DependencyScanError("uv lock is unreadable") from exc
    if not re.search(r"(?m)^version\s*=\s*1\s*$", text):
        raise DependencyScanError("uv lock has an unsupported version")

    blocks = text.split("[[package]]")
    if len(blocks) < 2:
        raise DependencyScanError("uv lock is missing package entries")
    dependencies: list[Dependency] = []
    for block in blocks[1:]:
        name_match = re.search(r'(?m)^name\s*=\s*"(?P<value>[A-Za-z0-9._-]{1,128})"\s*$', block)
        version_match = re.search(r'(?m)^version\s*=\s*"(?P<value>[0-9A-Za-z.+!_-]{1,128})"\s*$', block)
        source_match = re.search(r"(?m)^source\s*=\s*\{(?P<value>[^}]*)\}\s*$", block)
        if name_match is None or version_match is None or source_match is None:
            raise DependencyScanError("uv lock has an invalid package entry")
        if re.search(r'\bvirtual\s*=', source_match.group("value")):
            continue
        dependencies.append(
            Dependency(
                "pypi",
                normalize_package_name(name_match.group("value")),
                version_match.group("value"),
            )
        )
    if not dependencies:
        raise DependencyScanError("uv lock has no resolved packages")
    return tuple(dependencies)


def high_or_critical_findings(
    dependencies: Iterable[Dependency], advisories: Iterable[Advisory]
) -> tuple[tuple[Dependency, Advisory], ...]:
    advisory_index: dict[tuple[str, str, str], list[Advisory]] = {}
    for advisory in advisories:
        for version in advisory.affected_versions:
            advisory_index.setdefault((advisory.ecosystem, advisory.package, version), []).append(advisory)
    findings: list[tuple[Dependency, Advisory]] = []
    for dependency in dependencies:
        for advisory in advisory_index.get((dependency.ecosystem, dependency.name, dependency.version), []):
            if SEVERITY_RANK[advisory.severity] >= SEVERITY_RANK["high"]:
                findings.append((dependency, advisory))
    return tuple(findings)


def scan(root: Path, advisory_path: Path) -> tuple[tuple[Dependency, Advisory], ...]:
    advisories = load_advisories(advisory_path)
    dependencies = (*load_pnpm_lock(root / "pnpm-lock.yaml"), *load_uv_lock(root / "uv.lock"))
    return high_or_critical_findings(dependencies, advisories)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan committed locks against the committed advisory snapshot")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--advisories", type=Path)
    arguments = parser.parse_args(argv)
    root = arguments.root.resolve()
    advisory_path = arguments.advisories.resolve() if arguments.advisories else root / "security" / "dependency-advisories.json"
    try:
        findings = scan(root, advisory_path)
    except DependencyScanError as exc:
        print("DEPENDENCY SCAN FAILED")
        print(f"- {exc}")
        return 1
    if findings:
        print("DEPENDENCY SCAN FAILED")
        for dependency, advisory in findings:
            print(f"- {advisory.identifier}: {dependency.ecosystem}:{dependency.name}@{dependency.version} ({advisory.severity})")
        return 1
    print("DEPENDENCY SCAN PASSED: no high or critical findings in committed locks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
