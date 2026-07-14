# Codex project configuration

This directory contains project-scoped Codex defaults and narrow custom agents.

- `config.toml` keeps the main session in `workspace-write` with `on-request` approvals and network disabled by default.
- `agents/` contains read-only reviewers plus one bounded implementation worker.
- Repository skills live under `.agents/skills/`.
- `AGENTS.md` remains the normative instruction hierarchy for the repository.

Recommended orchestration:

1. The parent agent selects one task from `backlog/MVP_TASK_GRAPH.yaml`.
2. Read-only agents explore or audit independent concerns in parallel.
3. A single `implementation_worker` owns each write set.
4. The parent waits for all results, integrates, runs gates, and updates `PROGRESS.md`.
5. No two write-capable agents edit the same files concurrently.
