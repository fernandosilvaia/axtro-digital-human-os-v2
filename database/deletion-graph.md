# Deletion and Retention Graph

This document is the human-readable view of the machine catalog decided by
ADR-046. The initial baseline contains 85 tenant-scoped tables, plus the
`tenants` root and external surfaces. Completion requires a two-way anti-join:
every public table with `tenant_id` appears in the catalog, and every cataloged
PostgreSQL table exists with the declared scope. Drift fails closed.

The four pre-v59 global tables are outside the tenant graph:
`schema_registry`, `provider_catalog`, `region_policy_catalog` and
`worker_heartbeats`. They must never contain tenant IDs, provider references or
PII. `worker_heartbeats` may contain only low-cardinality operational counters.
The v59 `data_governance_resource_catalog` is also global and contains only
closed resource metadata, never a customer locator or content.

## Portable tenant graph: 38 tables

### Configuration and agents: 7

`tenant_settings`, `service_identities`, `agents`, `agent_deployments`,
`role_pack_installations`, `skill_pack_installations`, `provider_connections`.

### Sessions and contacts: 8

`contact_profiles`, `sessions`, `session_participants`,
`session_state_snapshots`, `session_timeline`, `conversation_turns`,
`session_health`, `handoffs`.

### Consent, policy and actions: 7

`consent_evidence`, `disclosure_records`, `action_intents`,
`policy_decisions`, `human_approvals`, `tool_executions`, `tool_receipts`.

### Knowledge: 4

`knowledge_sources`, `knowledge_versions`, `knowledge_chunks`,
`knowledge_embeddings`.

### Workflow, governance, cost and learning: 12

`workflow_runs`, `workflow_commands`, `workflow_step_receipts`,
`post_call_workflow_results`, `post_call_workflow_result_evidence`, `audit_log`,
`events_outbox`, `cost_events`, `usage_ledger`, `evaluation_runs`,
`experiment_candidates`, `deployment_promotions`.

## Supabase-only tenant graph: 47 tables

### Auth and Portal configuration: 4

`user_tenant_memberships`, `tenant_invites`, `agent_video_config`,
`agent_brain_config`.

### Transcript content: 1

`conversation_transcripts`.

### Basic billing: 2

`tenant_cost_alerts`, `tenant_subscriptions`.

### Provider effects and billing: 13

`meeting_bot_sessions`, `provider_effect_reservations`,
`provider_effect_reconciliation_receipts`,
`provider_effect_termination_receipts`, `billing_usage_outbox`,
`billing_checkout_intents`, `billing_stripe_event_receipts`,
`recall_webhook_deliveries`, `tavus_webhook_deliveries`,
`tavus_customer_delivery_receipts`, `tavus_stage_capabilities`,
`ai_usage_reservations`, `ai_usage_reconciliation_receipts`.

### Runtime bridge: 8

`portal_runtime_kill_switches`, `portal_runtime_kill_switch_events`,
`portal_runtime_channel_bindings`, `portal_runtime_channel_dispatches`,
`portal_runtime_provider_channel_receipts`,
`portal_runtime_scene_execution_receipts`,
`portal_runtime_operator_approvals`,
`portal_runtime_operator_reconciliation_receipts`.

### Text preview v49: 5

`portal_text_preview_privacy_policies`, `portal_text_preview_admissions`,
`portal_text_preview_turn_claims`, `portal_text_preview_egress_authorizations`,
`portal_text_preview_transcript_writes`.

### Business actions: 11

`portal_business_action_kill_switches`,
`portal_business_action_kill_switch_events`,
`portal_business_action_agent_settings`, `portal_business_action_grants`,
`portal_business_action_receipts`, `portal_business_action_leads`,
`portal_business_action_proposals`, `portal_business_action_proposal_slots`,
`portal_business_action_calendar_connections`,
`portal_business_action_calendar_reservations`,
`portal_business_action_meeting_reconcile_approvals`.

### Meeting notifications: 3

`meeting_terminal_notification_outbox`,
`meeting_terminal_notification_payloads`,
`meeting_terminal_notification_attempt_receipts`.

## Governance control graph introduced by v59: 11 tables

The 85-table count above is the complete pre-v59 tenant graph. The disposition
profile adds and self-registers these tenant-scoped control tables under the
`v59_control` catalog generation:

`data_governance_subjects`, `data_governance_subject_artifact_links`,
`data_governance_requests`, `data_governance_policy_decisions`,
`data_governance_approvals`, `data_legal_holds`,
`data_legal_hold_scope_items`, `data_legal_hold_receipts`,
`data_governance_work_items`, `data_governance_attempt_receipts`,
`data_governance_final_receipts`.

Operational subject links and resource locators are erased after verification.
Only catalog-authorized, closed and content-free request, policy, approval,
hold, attempt and final evidence may remain. The two-way anti-join covers these
tables as well as the historical graph.

## Root and authorized retention exception

`tenants` is the root but is not deleted. Closure keeps its UUID as an opaque,
non-reusable tombstone after removing identifying name, slug, settings,
memberships and content. This is the relational anchor for authorized
content-free receipts. No other tenant row survives unless the catalog names a
specific legal or financial retention rule or an active narrow legal hold.

Retained evidence is redacted to the closed receipt schema. It cannot contain a
subject reference, name, e-mail, phone, transcript, summary, prompt, knowledge
text, meeting URL, object key, provider reference, free-form JSON, raw error,
content embedding or content digest.

## External surfaces

The catalog also covers these non-table surfaces:

- object storage under a server-derived tenant prefix;
- process, edge and shared caches under a server-derived tenant prefix;
- search and vector indexes, including any provider-managed copy;
- provider-side conversations, bots, recordings, transcripts, files and
  generated artifacts;
- Supabase Vault secrets and Supabase Auth users or sessions;
- backups, snapshots and PITR recovery points.

Each active surface must implement bounded `apply`, `reconcile` and `verify`.
Objects are addressed from server-owned namespace data, never from a
caller-supplied URL. An external timeout is `unknown` and blocks completion.
Backups report a verified `recoverable_until`; the system does not claim
irrecoverability until that window expires and a later verification receipt is
recorded. Any restore must replay deletion tombstones before serving reads.

## Disposition rules

### Tenant closure

Deletion is a durable workflow, not an unrestricted SQL statement:

1. freeze policy and catalog versions on an authenticated request;
2. inventory the entire graph and fail on uncataloged surfaces or missing
   subject lineage;
3. drain or reconcile provider, billing, notification and workflow effects;
4. evaluate exact legal holds and collect required individual approvals;
5. export only when contractually authorized;
6. atomically set `closing` and activate the catalog write fence;
7. revoke sessions, identities, connections and new external admission;
8. clean external surfaces in bounded, idempotent work items;
9. redact or delete PostgreSQL rows in cataloged dependency order;
10. verify every item independently, tombstone `tenants`, and append the
    content-free receipt;
11. keep the backup exception visible through `recoverable_until`.

Only an exact request, work item, tenant, catalog target and current lease fence
may authorize terminal disposition. A generic GUC, trigger bypass or caller-
controlled session flag is prohibited.

### Data-subject requests

Subject disposition follows only explicit same-tenant lineage. The system does
not match by name, e-mail, phone, transcript similarity, embedding or hash. An
unlinked artifact that may contain subject data moves the request to
`operator_required`; it cannot be omitted from a completion receipt.

The subject write fence protects the exact artifact generation while the
tenant remains active. Concurrently linked content must be included or make
verification fail. Free-text transcripts are content and are never assumed to
be anonymous.

### Knowledge

Source disposition covers versions, chunks and embeddings, then explicitly
invalidates and verifies every cache, search and vector namespace. A database
cascade alone is not completion evidence.

### Append-only and integrity evidence

Session timeline, consent, disclosure, actions, tool receipts, workflow
receipts, provider effects, billing, runtime, preview and notification records
may be append-only and may contain content. Append-only is an integrity rule,
not an indefinite-retention basis.

Each class has a narrow terminal routine. It either removes the exact row or
redacts only cataloged content fields while atomically appending a content-free
receipt. Relationships cannot be reassigned to another tenant, session,
reservation or request. Direct updates, direct deletes and generic immutability
bypass remain denied.

In-flight or ambiguous external effects are reconciled before disposition.
Open Checkout intents reach a signed terminal state. Provider-effect and AI
usage ambiguity never expires into success. Tavus stage capabilities and
private room URLs are operational secrets and must be revoked and removed.

Notification payload rows are the only notification rows allowed to carry
recipient, subject or HTML. Accepted or simulated payloads are purgeable after
one day and dead-letter payloads after 30 days, subject to an exact legal hold.
Outbox and attempt receipts are retained only after their closed fields pass
the content-free rule and their policy window is still active.

### Legal holds

A legal hold is purpose-, artifact- and time-scoped. It blocks only matching
work items, not the entire tenant by default. Create, release and expire are
separate append-only commands and receipts. The worker locks and rechecks holds
at inventory and every irreversible fence; a concurrent matching hold wins.

### Legacy deletion paths

`portal_purge_old_conversation_transcripts_service` and point-delete functions
are not valid production disposition authorities. They must be revoked or
wrapped by an authorized request, inventory, legal-hold check, exact work item
and receipt. Age or possession of `service_role` alone is never sufficient.
