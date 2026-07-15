# M1 Walking Skeleton evidence

Run the complete deterministic M1 demo and compare it with the frozen evidence:

```bash
pnpm m1:e2e
```

The command builds the workspace, executes the lifecycle, three textual turns,
governed catalog lookup, outbox relay, post-call workflow, replay verifier,
cost ledger and operations console, then checks the result twice for exact
determinism.

`timeline.json` contains ordered metadata and envelope fingerprints only.
Event payloads and restricted turn content are deliberately omitted.
`evidence.json` contains hashes, counts, closed outcomes and the required
failure matrix. `manifest.json` binds both artifacts by canonical SHA-256.

All integrations are local deterministic fakes. This evidence performs no
network access, production access, remote migration, external effect or deploy.
