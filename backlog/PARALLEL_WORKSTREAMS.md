# Parallel Workstreams for Codex

## Safe parallelism

Use separate Git worktrees and assign exclusive file ownership.

| Lane | Typical scope | Shared-file caution |
|---|---|---|
| Contracts | schemas and generated types | coordinate before changing a schema used by others |
| Platform | workspace, CI and config | owns root manifests during M0 bootstrap |
| Data and security | migrations, repositories and RLS tests | owns database files |
| Realtime | session actor, turns and channel ports | owns realtime worker |
| Providers | adapters and fakes | may not edit domain state silently |
| Frontend | web and meeting room UI | consumes contracts, does not redefine them |
| Quality | E2E, golden tests and failure injection | read-mostly until defects are isolated |
| Security auditor | threat tests and review | fixes in a dedicated branch after evidence |

## Suggested first worktrees

1. `worktrees/platform-m0` for M0-01 and M0-02.
2. `worktrees/contracts-m0` for M0-03 after bootstrap manifests stabilize.
3. `worktrees/data-m0` for M0-07 and M0-08.
4. `worktrees/providers-m0` for M0-11 and M0-12.
5. `worktrees/security-review` as read-only review until a bounded fix is accepted.

Do not run multiple agents that edit `package.json`, shared generated files or the same migration at the same time.
