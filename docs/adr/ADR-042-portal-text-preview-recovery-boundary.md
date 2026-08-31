# ADR-042: Portal text preview recovery boundary

**Status:** Accepted for M6-00 recovery
**Date:** 2026-08-31
**Related:** Constitution Arts. 3, 5, 7, 9, 10, 15 and 16; ADR-005, ADR-015, ADR-024, ADR-027, ADR-028, ADR-033

## Context

The historical migration `0049_portal_text_preview_admission.sql` was absent
from the current branch even though later operational records describe it as
applied. Recovering the immutable SQL exposed a second lineage break. The
migration emits the canonical event `turn.outcome_recorded`, but the current
contract catalog, generated types, domain parser and reducer no longer know
that event. A PostgreSQL producer would therefore create an envelope that the
canonical timeline consumer rejects.

The same historical branch also contained four application contracts and the
complete Portal preview runtime. Those files are absent from the current
branch. The visible preview still invokes a legacy Server Action that can call
the provider and persist transcripts without the durable disclosure, consent,
admission, turn and egress fences introduced by migration 0049.

Restoring the entire historical commit in the schema-lineage task would mix 91
files and more than 15,000 changed lines with a forward-only database repair.
Leaving the legacy preview reachable while describing the feature as unready
would preserve the unsafe path.

## Decision

M6-00 restores one atomic producer-consumer unit:

1. the immutable migrations 0049 and 0050;
2. the forward-only capability repair 0056;
3. the normative `turn_outcome_recorded` schema and valid and invalid examples;
4. generated TypeScript and Python types;
5. the strict domain parser and deterministic reducer;
6. codec, replay and PostgreSQL integration evidence using the exact envelope
   emitted by migration 0049.

The four application contracts and Portal runtime return in a separate,
bounded contract-first task. They must land together:

- `portal_text_preview_admission`;
- `portal_text_preview_browser_command`;
- `portal_text_preview_signed_state_payload`;
- `portal_text_preview_action_result`;
- generated types;
- Server Action, signed state, release gate, provider privacy attestation,
  user interface and their tests.

Until that task is complete, the current text preview is hard-closed in two
independent places. The Server Action returns before authentication, database,
ledger or provider work, and the user interface exposes no submit control. A
strict recovery configuration value must remain `false`; setting it to another
value makes readiness fail and never re-enables the legacy implementation.

Database capability and application availability are distinct. M6-00 may
prove that the schema and canonical outbox are compatible. It must not claim
that Portal text preview is available end to end.

## Production gates

Restoring the application bundle is necessary but insufficient for promotion.
The feature remains closed until all of these are proven:

- durable, tenant-scoped PostgreSQL relay from `events_outbox` to
  `session_timeline`;
- scheduled, bounded and observable cleanup;
- valid OpenRouter privacy attestation for the selected processing profile;
- cross-tenant, consent, replay, cancellation and cost tests;
- an explicitly authorized staged rollout.

No remote migration, deployment, credential, provider setting or feature flag
is changed by this decision.

## Alternatives considered

1. Restore only the SQL and weaken the harness. Rejected because the database
   would emit an event that the canonical consumer cannot decode.
2. Restore all 91 historical files in M6-00. Rejected because it obscures the
   schema repair inside an unsafe, difficult-to-review merge.
3. Keep the legacy preview available until the runtime returns. Rejected
   because a disabled replacement must not fall back to the path it is meant
   to contain.

## Consequences

Schema and event lineage become reproducible without silently reopening an
unsafe product surface. The preview is temporarily unavailable. The next task
has a closed write set and explicit operational gates. Rollback of application
code keeps the preview closed; database rollback remains forward-only and
requires the staged compatibility plan documented by M6-00.

## Revisit trigger

Revisit when the complete preview runtime bundle and its operational gates are
green, or when another Portal surface needs to emit `turn.outcome_recorded`.
