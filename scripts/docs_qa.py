#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = [
    "README.md", "START_CODEX_TODAY.md", "AGENTS.md", "PROGRESS.md",
    "ARCHITECTURE_CONSTITUTION.md", "ARCHITECTURE_STATUS.md",
    "DOCUMENTATION_MANIFEST.yaml", "MIGRATION_MAP_V1_TO_V2.md", "PENDENCIAS_EXTERNAS.md",
    ".codex/config.toml", ".agents/skills/architecture-change/SKILL.md",
    "docs/product/PRODUCT_VISION.md", "docs/product/PRODUCT_REQUIREMENTS.md", "docs/product/MVP_SCOPE.md",
    "docs/architecture/SYSTEM_ARCHITECTURE.md", "docs/architecture/REALTIME_INTERACTION_KERNEL.md",
    "docs/architecture/TURN_COORDINATOR.md", "docs/architecture/ACTION_AND_TOOL_RUNTIME.md",
    "docs/security/SECURITY_ARCHITECTURE.md", "docs/security/THREAT_MODEL.md",
    "docs/playbooks/HANDOFF_TO_CODEX.md", "docs/playbooks/PROMPT_EXECUCAO_AUTONOMA_CODEX.md",
    "docs/operations/REQUIREMENTS_TRACEABILITY_MATRIX.md",
    "backlog/MVP_TASK_GRAPH.yaml", "contracts/openapi/axtro-api.yaml", "contracts/asyncapi/axtro-events.yaml",
    "database/reference-schema.sql", "spreadsheets/UNIT_ECONOMICS_V2.xlsx",
]
LINK_PATTERN = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
TASK_REFERENCE_PATTERN = re.compile(r"\bM\d+-\d+\b")


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must contain a YAML object")
    return data


def check_task_graph(errors: list[str]) -> None:
    graph = load_yaml(ROOT / "backlog" / "MVP_TASK_GRAPH.yaml")
    tasks = graph.get("tasks", [])
    if not isinstance(tasks, list) or not tasks:
        errors.append("Task graph has no tasks")
        return
    ids = [task.get("id") for task in tasks if isinstance(task, dict)]
    if len(ids) != len(set(ids)):
        errors.append("Task graph contains duplicate task IDs")
    id_set = set(ids)
    indegree = {task_id: 0 for task_id in id_set}
    outgoing: dict[str, list[str]] = defaultdict(list)
    for task in tasks:
        if not isinstance(task, dict):
            errors.append("Task graph contains a non-object task")
            continue
        for field in ("id", "milestone", "title", "lane", "dependencies", "objective", "primary_files", "acceptance", "tests"):
            if field not in task:
                errors.append(f"Task {task.get('id')} missing {field}")
        for dep in task.get("dependencies", []):
            if dep not in id_set:
                errors.append(f"Task {task.get('id')} depends on unknown {dep}")
            else:
                outgoing[dep].append(task["id"])
                indegree[task["id"]] += 1
    queue = deque(sorted(k for k, value in indegree.items() if value == 0))
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for child in outgoing[node]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    if visited != len(id_set):
        errors.append("Task graph contains a dependency cycle")
    progress_path = ROOT / "PROGRESS.md"
    if progress_path.exists():
        progress_text = progress_path.read_text(encoding="utf-8")
        missing_progress_ids = sorted(task_id for task_id in id_set if f"`{task_id}`" not in progress_text)
        if missing_progress_ids:
            errors.append(f"PROGRESS.md missing task IDs: {missing_progress_ids}")

    for milestone, spec in graph.get("milestones", {}).items():
        exit_gate = spec.get("exit_gate") if isinstance(spec, dict) else None
        if exit_gate not in id_set:
            errors.append(f"Milestone {milestone} has invalid exit gate {exit_gate}")


def check_traceability(errors: list[str]) -> None:
    """Prove that every P0 matrix row points at an executable task."""
    matrix_path = ROOT / "docs" / "operations" / "REQUIREMENTS_TRACEABILITY_MATRIX.md"
    graph_path = ROOT / "backlog" / "MVP_TASK_GRAPH.yaml"
    if not matrix_path.exists() or not graph_path.exists():
        return
    graph = load_yaml(graph_path)
    task_ids = {
        task.get("id")
        for task in graph.get("tasks", [])
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    for line_number, line in enumerate(matrix_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.startswith("| REQ-"):
            continue
        references = TASK_REFERENCE_PATTERN.findall(line)
        if not references:
            errors.append(f"{matrix_path.relative_to(ROOT)}:{line_number} has no task reference")
            continue
        unknown = sorted(set(references) - task_ids)
        if unknown:
            errors.append(
                f"{matrix_path.relative_to(ROOT)}:{line_number} references unknown tasks: {unknown}"
            )


def check_markdown(errors: list[str]) -> None:
    for path in ROOT.rglob("*.md"):
        if "legacy" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if text.count("```") % 2:
            errors.append(f"{path.relative_to(ROOT)} has unbalanced fenced code blocks")
        for match in LINK_PATTERN.finditer(text):
            target = match.group(1).split("#", 1)[0]
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.exists():
                errors.append(f"{path.relative_to(ROOT)} has broken link {target}")


def main() -> int:
    errors: list[str] = []
    for relative in REQUIRED_FILES:
        if not (ROOT / relative).exists():
            errors.append(f"Missing required file: {relative}")

    manifest_path = ROOT / "DOCUMENTATION_MANIFEST.yaml"
    if manifest_path.exists():
        manifest = load_yaml(manifest_path)
        gates = manifest.get("required_gates", {})
        if gates.get("contracts_count") != 33:
            errors.append("Manifest contracts_count must be 33")
        if gates.get("openapi_version") != "3.1.0" or gates.get("asyncapi_version") != "3.0.0":
            errors.append("Manifest API versions are incorrect")

    check_task_graph(errors)
    check_traceability(errors)
    check_markdown(errors)

    normative_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in ROOT.rglob("*.md")
        if "legacy" not in path.parts
    )
    forbidden_patterns = {
        r"(?<!não significa )\bpronto para produção\b": "unqualified production readiness",
        r"\bcertificado juridicamente\b": "unsupported legal certification",
        r"\bavatar escolhido definitivamente\b": "unsupported permanent avatar choice",
    }
    lowered = normative_text.lower()
    for pattern, label in forbidden_patterns.items():
        if re.search(pattern, lowered):
            errors.append(f"Forbidden claim found: {label}")

    if errors:
        print("DOCUMENTATION QA FAILED")
        for error in errors: print(f"- {error}")
        return 1
    task_count = len(load_yaml(ROOT / "backlog" / "MVP_TASK_GRAPH.yaml").get("tasks", []))
    print(f"DOCUMENTATION QA PASSED: {len(REQUIRED_FILES)} required files, {task_count} executable tasks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
