#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".codex" / "config.toml"
AGENT_DIR = ROOT / ".codex" / "agents"
SKILL_DIR = ROOT / ".agents" / "skills"
EXPECTED_AGENTS = {
    "architecture_reviewer": "read-only",
    "security_reviewer": "read-only",
    "realtime_reviewer": "read-only",
    "data_reviewer": "read-only",
    "test_reviewer": "read-only",
    "docs_researcher": "read-only",
    "cost_reviewer": "read-only",
    "implementation_worker": "workspace-write",
}
EXPECTED_SKILLS = {
    "architecture-change",
    "contract-first-feature",
    "realtime-quality",
    "security-review",
}


def main() -> int:
    errors: list[str] = []

    if not CONFIG.exists():
        errors.append("Missing .codex/config.toml")
    else:
        try:
            config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"Invalid .codex/config.toml: {exc}")
            config = {}
        if config.get("approval_policy") != "on-request":
            errors.append("Codex approval_policy must be on-request")
        if config.get("sandbox_mode") != "workspace-write":
            errors.append("Codex sandbox_mode must be workspace-write")
        if config.get("sandbox_workspace_write", {}).get("network_access") is not False:
            errors.append("Codex workspace network access must default to false")
        agents = config.get("agents", {})
        if agents.get("max_depth") != 1:
            errors.append("agents.max_depth must remain 1")
        if not isinstance(agents.get("max_threads"), int) or agents.get("max_threads") < 2:
            errors.append("agents.max_threads must allow bounded parallel review")

    found_agents: dict[str, Path] = {}
    if not AGENT_DIR.exists():
        errors.append("Missing .codex/agents directory")
    else:
        for path in sorted(AGENT_DIR.glob("*.toml")):
            try:
                data = tomllib.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                errors.append(f"Invalid agent TOML {path.relative_to(ROOT)}: {exc}")
                continue
            for field in ("name", "description", "developer_instructions"):
                if not isinstance(data.get(field), str) or not data[field].strip():
                    errors.append(f"{path.relative_to(ROOT)} missing non-empty {field}")
            name = data.get("name")
            if isinstance(name, str):
                if name in found_agents:
                    errors.append(f"Duplicate custom agent name {name}")
                found_agents[name] = path
                expected_mode = EXPECTED_AGENTS.get(name)
                if expected_mode and data.get("sandbox_mode") != expected_mode:
                    errors.append(f"Agent {name} must use sandbox_mode={expected_mode}")
            if data.get("sandbox_mode") == "danger-full-access":
                errors.append(f"{path.relative_to(ROOT)} must not use danger-full-access")

    missing_agents = set(EXPECTED_AGENTS) - set(found_agents)
    extra_agents = set(found_agents) - set(EXPECTED_AGENTS)
    if missing_agents:
        errors.append(f"Missing custom agents: {sorted(missing_agents)}")
    if extra_agents:
        errors.append(f"Unexpected custom agents: {sorted(extra_agents)}")

    found_skills: set[str] = set()
    if not SKILL_DIR.exists():
        errors.append("Missing .agents/skills directory")
    else:
        for skill_file in sorted(SKILL_DIR.glob("*/SKILL.md")):
            text = skill_file.read_text(encoding="utf-8")
            if not text.startswith("---\n"):
                errors.append(f"{skill_file.relative_to(ROOT)} missing YAML frontmatter")
                continue
            match = re.search(r"^name:\s*([^\n]+)$", text, re.MULTILINE)
            description = re.search(r"^description:\s*([^\n]+)$", text, re.MULTILINE)
            if not match or not description:
                errors.append(f"{skill_file.relative_to(ROOT)} missing name or description")
                continue
            name = match.group(1).strip()
            found_skills.add(name)
            if skill_file.parent.name != name:
                errors.append(f"Skill folder {skill_file.parent.name} must match skill name {name}")
    if found_skills != EXPECTED_SKILLS:
        errors.append(f"Skill set mismatch. Expected={sorted(EXPECTED_SKILLS)} found={sorted(found_skills)}")

    if (ROOT / "skills").exists():
        errors.append("Legacy root skills/ directory must not exist; use .agents/skills/")

    if errors:
        print("CODEX SETUP VALIDATION FAILED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"CODEX SETUP VALIDATION PASSED: {len(found_agents)} custom agents, {len(found_skills)} repository skills")
    return 0


if __name__ == "__main__":
    sys.exit(main())
