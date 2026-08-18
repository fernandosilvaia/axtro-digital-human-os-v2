# scripts/canaries/

Scripts in this directory are **manual-only, human-triggered verifications
against real (billed) third-party providers.** They exist to answer
questions automated tests cannot, because the thing under test is an
external provider's real-world behavior (Tavus room teardown, a Recall bot
in a real meeting), not our own code.

## Non-negotiable rules for anything placed in this directory

1. **Never referenced by CI, GitHub Actions, cron, a Railway service, or any
   `pnpm`/`npm` script alias.** Grep for the filename before adding it
   anywhere outside a human's terminal:
   `grep -rn "canaries/" .github/ railway.json package.json apps/*/package.json`
   must keep returning nothing but this directory and its own docs.
2. **Every script must hard-exit before doing anything real** unless a
   dedicated `*_CONFIRM` environment variable is set to an exact, loud,
   hard-to-fat-finger value (not `1` or `true` — something a human has to
   read and mean). See each script's own gate for its exact value.
3. **Every script must require real provider credentials as environment
   variables**, never a checked-in fixture or a shared CI secret. If a
   provider has no sandbox (confirmed by research, not assumed), the
   script's doc must say so explicitly and describe the minimal-cost
   real-account alternative instead of pretending a sandbox exists.
4. **Every run must write evidence to `.canary-evidence/`** (gitignored,
   see root `.gitignore`) as a timestamped JSON file — never only to stdout.
   A canary that is not evidenced is not a canary, it's an anecdote.
5. **Every script documents itself in `docs/operations/`**, not only in
   `--help` output. The doc is the source of truth for when to run it, what
   it costs, and what pass/fail means; the script is the mechanism.
6. **A canary script never mutates the paid-effects ledger**
   (`beginProviderEffect` / `commitProviderEffect` /
   `completeProviderEffect` / `compensateCommittedProviderEffect`). If a
   canary needs to attach to a paid effect's lifecycle, that is a product
   change reviewed through the normal path (ADR / decisions log / code
   review) — not something a manual measurement script backs into.

## Current scripts

| Script | Question it answers | Doc |
|---|---|---|
| `termination-latency-canary.mjs` | When we call the provider's "stop" endpoint, how long until a real, independent participant stops receiving the avatar's audio/video? | `docs/operations/TERMINATION_LATENCY_CANARY.md` |
