#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "database" / "migrations"
SUPABASE_MIGRATIONS = ROOT / "database" / "supabase-only"
EXPECTED = [
    "0001_extensions_and_domains.sql",
    "0002_control_plane.sql",
    "0003_interaction_and_actions.sql",
    "0004_knowledge_governance.sql",
    "0005_rls_and_immutability.sql",
    "0006_reference_seeds.sql",
    "0007_relational_tenancy_integrity.sql",
    "0008_outbox_event_identity.sql",
    "0009_cost_event_reconciliation.sql",
    "0010_session_timeline_event_identity.sql",
    "0011_post_call_workflow_persistence.sql",
    "0012_cost_event_conversation_unit.sql",
]

IMMUTABLE_SUPABASE_MIGRATIONS = {
    "0049_portal_text_preview_admission.sql": "79b24e7fdc768a30b02d3596b71799fae484043e37561ddfcd435f46076b3100",
    "0050_meeting_terminal_notification_claim.sql": "262e033328175f704f8cfef1cafdcb0a2ef9b9aac7e4cc86f2b33890044c7224",
}
LATEST_SUPABASE_VERSION = 60


def main() -> int:
    errors: list[str] = []
    supabase_migrations = sorted(path for path in SUPABASE_MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    supabase_versions = [int(path.name[:4]) for path in supabase_migrations]
    if supabase_versions != list(range(1, LATEST_SUPABASE_VERSION + 1)):
        errors.append(
            "Supabase-only migrations must be one contiguous, unique sequence "
            f"from 0001 through {LATEST_SUPABASE_VERSION:04d}"
        )
    for filename, expected_sha256 in IMMUTABLE_SUPABASE_MIGRATIONS.items():
        path = SUPABASE_MIGRATIONS / filename
        if not path.exists():
            errors.append(f"Missing immutable Supabase-only migration {filename}")
            continue
        actual_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_sha256 != expected_sha256:
            errors.append(f"Immutable Supabase-only migration checksum changed: {filename}")
    for filename in EXPECTED:
        path = MIGRATIONS / filename
        if not path.exists():
            errors.append(f"Missing migration {filename}")
            continue
        text = path.read_text(encoding="utf-8")
        if "BEGIN;" not in text or "COMMIT;" not in text:
            errors.append(f"{filename} must have explicit transaction boundaries")
        if text.count("BEGIN;") != text.count("COMMIT;"):
            errors.append(f"{filename} has unbalanced transaction boundaries")

    all_sql = "\n".join((MIGRATIONS / f).read_text(encoding="utf-8") for f in EXPECTED if (MIGRATIONS / f).exists())
    if re.search(r"gen_random_uuid\s*\(", all_sql, re.IGNORECASE):
        errors.append("Domain IDs must not use gen_random_uuid() defaults")
    if re.search(r"vector\s*\(\s*1536\s*\)", all_sql, re.IGNORECASE):
        errors.append("Embedding dimension must not be hard-coded to 1536")
    if "CREATE DOMAIN app.uuid_v7" not in all_sql:
        errors.append("UUIDv7 domain is missing")
    if "substring(VALUE::text from 15 for 1) = '7'" not in all_sql:
        errors.append("UUIDv7 version constraint is missing")
    if "substring(VALUE::text from 20 for 1) ~ '^[89ab]$'" not in all_sql:
        errors.append("UUIDv7 RFC variant constraint is missing")
    if "FORCE ROW LEVEL SECURITY" not in all_sql:
        errors.append("Forced RLS is missing")

    runtime_bridge_repair = SUPABASE_MIGRATIONS / "0044_runtime_bridge_integrity_repair.sql"
    if not runtime_bridge_repair.exists():
        errors.append("Missing Supabase-only runtime bridge integrity repair 0044")
    else:
        repair_sql = runtime_bridge_repair.read_text(encoding="utf-8")
        if "BEGIN;" not in repair_sql or "COMMIT;" not in repair_sql:
            errors.append("0044 runtime bridge repair must have explicit transaction boundaries")
        for invariant in (
            "portal_runtime_kill_switches_tenant_id_id_key",
            "portal_runtime_kill_switch_events_tenant_kill_switch_fkey",
            "foreign key (tenant_id,kill_switch_id)",
            "references public.portal_runtime_kill_switches(tenant_id,id)",
            "provider_ref=p_provider_ref",
            "provider_url is not distinct from p_provider_url",
            "'version',44",
            "'runtimeBridgeReceiptIntegrity'",
        ):
            if invariant not in repair_sql:
                errors.append(f"0044 runtime bridge integrity invariant is missing: {invariant}")

    meeting_status_repair = SUPABASE_MIGRATIONS / "0045_drop_ambiguous_meeting_status_overload.sql"
    if not meeting_status_repair.exists():
        errors.append("Missing Supabase-only meeting status overload repair 0045")
    else:
        repair_sql = meeting_status_repair.read_text(encoding="utf-8")
        if "BEGIN;" not in repair_sql or "COMMIT;" not in repair_sql:
            errors.append("0045 meeting status overload repair must have explicit transaction boundaries")
        for invariant in (
            "drop function if exists public.portal_update_meeting_bot_session_status_service(text, text);",
            "'version',45",
            "'meetingBotStatusUpdateUnambiguous'",
        ):
            if invariant not in repair_sql:
                errors.append(f"0045 meeting status overload repair invariant is missing: {invariant}")

    termination_fence = SUPABASE_MIGRATIONS / "0046_provider_effect_termination_fence.sql"
    if not termination_fence.exists():
        errors.append("Missing Supabase-only provider effect termination fence 0046")
    else:
        fence_sql = termination_fence.read_text(encoding="utf-8")
        if "BEGIN;" not in fence_sql or "COMMIT;" not in fence_sql:
            errors.append("0046 termination fence must have explicit transaction boundaries")
        for invariant in (
            "provider_effect_termination_receipts",
            "force row level security",
            "portal_begin_provider_effect_termination_service",
            "portal_settle_provider_effect_termination_service",
            "tenant admin membership required",
            "'version',46",
            "'providerEffectTerminationFence'",
        ):
            if invariant not in fence_sql:
                errors.append(f"0046 termination fence invariant is missing: {invariant}")
    service_role_schema_usage = SUPABASE_MIGRATIONS / "0047_service_role_app_schema_usage.sql"
    if not service_role_schema_usage.exists():
        errors.append("Missing Supabase-only service-role app schema usage fix 0047")
    else:
        schema_usage_sql = service_role_schema_usage.read_text(encoding="utf-8")
        if "BEGIN;" not in schema_usage_sql or "COMMIT;" not in schema_usage_sql:
            errors.append("0047 service-role app schema usage fix must have explicit transaction boundaries")
        for invariant in (
            "grant usage on schema app to service_role",
            "grant usage on type app.uuid_v7 to service_role",
            "'version',47",
            "'serviceRoleAppSchemaUsage'",
            "has_schema_privilege('service_role','app','USAGE')",
            "has_type_privilege('service_role','app.uuid_v7','USAGE')",
        ):
            if invariant not in schema_usage_sql:
                errors.append(f"0047 service-role app schema usage invariant is missing: {invariant}")
    tavus_stage_settlement_timestamp = SUPABASE_MIGRATIONS / "0048_tavus_stage_settlement_timestamp.sql"
    if not tavus_stage_settlement_timestamp.exists():
        errors.append("Missing Supabase-only Tavus stage settlement timestamp repair 0048")
    else:
        timestamp_sql = tavus_stage_settlement_timestamp.read_text(encoding="utf-8")
        if "BEGIN;" not in timestamp_sql or "COMMIT;" not in timestamp_sql:
            errors.append("0048 Tavus stage settlement timestamp repair must have explicit transaction boundaries")
        for invariant in (
            "portal_settle_provider_effect_termination_service",
            "portal_resolve_tavus_stage_capability_service",
            "portal_revoke_tavus_stage_capability_service",
            "v_stage_mutation_at timestamptz;",
            "v_stage_mutation_at:=clock_timestamp();",
            "c.expires_at<=v_stage_mutation_at",
            "position('c.expires_at<=v_stage_mutation_at' in regexp_replace(pg_get_functiondef('public.portal_resolve_tavus_stage_capability_service(text)'::regprocedure)",
            "updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval '45 minutes')",
            "tavus_stage_expiry_chk",
            "'version',48",
            "'tavusStageExpiryConcurrencyFence'",
        ):
            if invariant not in timestamp_sql:
                errors.append(f"0048 Tavus stage settlement timestamp invariant is missing: {invariant}")
    business_action_admission = SUPABASE_MIGRATIONS / "0051_business_action_admission_and_leads.sql"
    if not business_action_admission.exists():
        errors.append("Missing Supabase-only business action admission and leads migration 0051")
    else:
        admission_sql = business_action_admission.read_text(encoding="utf-8")
        if "begin;" not in admission_sql or "commit;" not in admission_sql:
            errors.append("0051 business action admission must have explicit transaction boundaries")
        for invariant in (
            "portal_business_action_kill_switches",
            "portal_business_action_kill_switch_events",
            "portal_business_action_agent_settings",
            "portal_business_action_grants",
            "portal_business_action_receipts",
            "portal_business_action_leads",
            "portal_set_business_action_kill_switch_service",
            "portal_business_action_status_service",
            "portal_set_business_action_agent_settings_service",
            "portal_admit_business_action_service",
            "portal_register_business_lead_service",
            "action_kind in ('register_lead')",
            "foreign key (tenant_id,kill_switch_id) references public.portal_business_action_kill_switches(tenant_id,id)",
            "unique (tenant_id,idempotency_key)",
            "contact_email is not null or contact_phone is not null",
            "'version',51",
            "'businessActionKillSwitches'",
            "'businessActionGrants'",
            "'businessActionReceipts'",
            "'businessActionLeads'",
        ):
            if invariant not in admission_sql:
                errors.append(f"0051 business action admission invariant is missing: {invariant}")
        for absent_calendar_object in (
            "create table public.portal_business_action_calendar_reservations",
            "create table public.portal_business_action_calendar_connections",
            "create table public.portal_business_action_proposals",
            "create table public.portal_business_action_proposal_slots",
            "create or replace function public.portal_propose_business_meeting_slots_service",
            "create or replace function public.portal_reserve_business_meeting_slot_service",
            "create or replace function public.portal_connect_google_calendar_service",
            "google_event_id",
        ):
            if absent_calendar_object in admission_sql:
                errors.append(f"0051 must not implement wave 1b calendar scope: found {absent_calendar_object}")
    calendar_scheduling = SUPABASE_MIGRATIONS / "0052_business_action_calendar_scheduling.sql"
    if not calendar_scheduling.exists():
        errors.append("Missing Supabase-only business action calendar scheduling migration 0052")
    else:
        calendar_sql = calendar_scheduling.read_text(encoding="utf-8")
        if "begin;" not in calendar_sql or "commit;" not in calendar_sql:
            errors.append("0052 business action calendar scheduling must have explicit transaction boundaries")
        for invariant in (
            "create table public.portal_business_action_proposals",
            "create table public.portal_business_action_proposal_slots",
            "create table public.portal_business_action_calendar_connections",
            "create table public.portal_business_action_calendar_reservations",
            "create table public.portal_business_action_meeting_reconcile_approvals",
            "portal_propose_business_meeting_slots_service",
            "portal_reserve_business_meeting_slot_service",
            "portal_dispatch_business_meeting_reservation_service",
            "portal_commit_business_meeting_reservation_service",
            "portal_release_business_meeting_reservation_service",
            "portal_mark_business_meeting_reservation_unknown_service",
            "portal_reconcile_business_meeting_reservation_service",
            "portal_connect_google_calendar_service",
            "portal_disconnect_google_calendar_service",
            "portal_google_calendar_connection_context_service",
            "vault.create_secret",
            "action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot')",
            "start_at timestamptz not null",
            "end_at timestamptz not null",
            "timezone text not null",
            "'version',52",
            "'businessActionProposals'",
            "'businessActionCalendarReservations'",
            "'businessActionCalendarConnections'",
        ):
            if invariant not in calendar_sql:
                errors.append(f"0052 business action calendar scheduling invariant is missing: {invariant}")
        for forbidden_slot_storage in ("slots jsonb not null", "slots jsonb[]"):
            if forbidden_slot_storage in calendar_sql:
                errors.append(f"0052 must never persist proposal slots as a JSONB array column: found {forbidden_slot_storage}")
    calendar_credential_read = SUPABASE_MIGRATIONS / "0053_business_action_calendar_credential_read.sql"
    if not calendar_credential_read.exists():
        errors.append("Missing Supabase-only business action calendar credential read migration 0053")
    else:
        credential_read_sql = calendar_credential_read.read_text(encoding="utf-8")
        if "begin;" not in credential_read_sql or "commit;" not in credential_read_sql:
            errors.append("0053 business action calendar credential read must have explicit transaction boundaries")
        for invariant in (
            "portal_google_calendar_decrypted_refresh_token_service",
            "status='connected'",
            "vault.decrypted_secrets",
            "'outcome','not_connected'",
            "'outcome','found','refreshToken',v_refresh_token",
            "'version',53",
            "'businessActionCalendarCredentialRead'",
        ):
            if invariant not in credential_read_sql:
                errors.append(f"0053 business action calendar credential read invariant is missing: {invariant}")
        for forbidden_grant in ("to public;", "to anon;"):
            if forbidden_grant in credential_read_sql:
                errors.append(f"0053 must never grant the decrypted-secret RPC to {forbidden_grant.split()[1].rstrip(';')}")
    live_call_context = SUPABASE_MIGRATIONS / "0054_business_action_live_call_context.sql"
    if not live_call_context.exists():
        errors.append("Missing Supabase-only business action live call context migration 0054")
    else:
        live_call_context_sql = live_call_context.read_text(encoding="utf-8")
        if "begin;" not in live_call_context_sql or "commit;" not in live_call_context_sql:
            errors.append("0054 business action live call context must have explicit transaction boundaries")
        for invariant in (
            "create or replace function public.portal_business_action_call_context_service",
            "provider_effect_reservations",
            "portal_runtime_provider_channel_receipts",
            "portal_runtime_channel_bindings",
            "left join public.sessions s",
            "s.status in ('completed','failed')",
            "language sql stable security definer",
            "'version',54",
            "'businessActionLiveCallContext'",
        ):
            if invariant not in live_call_context_sql:
                errors.append(f"0054 business action live call context invariant is missing: {invariant}")
        for forbidden_write in ("insert into", "update public.", "delete from"):
            if forbidden_write in live_call_context_sql.lower():
                errors.append(f"0054 must remain a pure read: found {forbidden_write}")
    capability_lineage_repair = SUPABASE_MIGRATIONS / "0056_schema_capability_lineage_repair.sql"
    if not capability_lineage_repair.exists():
        errors.append("Missing Supabase-only schema capability lineage repair 0056")
    else:
        lineage_sql = capability_lineage_repair.read_text(encoding="utf-8")
        if "begin;" not in lineage_sql or "commit;" not in lineage_sql:
            errors.append("0056 schema capability lineage repair must have explicit transaction boundaries")
        for invariant in (
            "'version',56",
            "'portalTextPreviewAdmission'",
            "'portalTextPreviewTurnFence'",
            "'portalTextPreviewEgressAuthorization'",
            "'portalTextPreviewProviderFailureReceipt'",
            "'portalTextTranscriptOptIn'",
            "'portalTextPreviewCleanup'",
            "'portalTextPreviewCanonicalOutbox'",
            "'portalTextPreviewSecurityBoundary'",
            "'legacyAuthenticatedChatTranscriptWriterAvailable'",
            "'meetingTerminalNotificationClaim'",
            "'businessActionKillSwitches'",
            "'businessActionGrants'",
            "'businessActionReceipts'",
            "'businessActionLeads'",
            "'businessActionProposals'",
            "'businessActionCalendarReservations'",
            "'businessActionCalendarConnections'",
            "'businessActionCalendarCredentialRead'",
            "'businessActionLiveCallContext'",
            "'businessActionEmailLengthBound'",
            "create or replace function app.portal_service_role_only(p_signature text)",
            "revoke all on function app.portal_service_role_only(text) from public,anon,authenticated,service_role;",
            "create or replace function app.portal_table_locked_down(p_table regclass)",
            "revoke all on function app.portal_table_locked_down(regclass) from public,anon,authenticated,service_role;",
            "app.portal_table_locked_down(to_regclass('public.portal_business_action_receipts'))",
            "app.portal_service_role_only('public.portal_admit_business_action_service",
            "app.portal_service_role_only('public.portal_register_business_lead_service",
            "app.portal_service_role_only('public.portal_propose_business_meeting_slots_service",
            "app.portal_service_role_only('public.portal_reserve_business_meeting_slot_service",
            "app.portal_service_role_only('public.portal_connect_google_calendar_service",
            "app.portal_service_role_only('public.portal_google_calendar_decrypted_refresh_token_service",
            "app.portal_service_role_only('public.portal_business_action_call_context_service",
            "char_length(contact_email)<=320",
            "char_length(google_account_email)<=320",
            "revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;",
            "grant execute on function public.portal_schema_capabilities_service() to service_role;",
        ):
            if invariant not in lineage_sql:
                errors.append(f"0056 schema capability lineage invariant is missing: {invariant}")
    meeting_notification_outbox = SUPABASE_MIGRATIONS / "0057_meeting_terminal_notification_outbox.sql"
    if not meeting_notification_outbox.exists():
        errors.append("Missing Supabase-only meeting terminal notification outbox 0057")
    else:
        notification_sql = meeting_notification_outbox.read_text(encoding="utf-8")
        if "begin;" not in notification_sql or "commit;" not in notification_sql:
            errors.append("0057 meeting terminal notification outbox must have explicit transaction boundaries")
        for invariant in (
            "meeting_terminal_notification_outbox",
            "meeting_terminal_notification_payloads",
            "meeting_terminal_notification_attempt_receipts",
            "force row level security",
            "portal_enqueue_meeting_terminal_notification",
            "portal_lease_meeting_terminal_notifications_service",
            "portal_begin_meeting_terminal_notification_dispatch_service",
            "portal_ack_meeting_terminal_notification_service",
            "portal_fail_meeting_terminal_notification_service",
            "portal_meeting_terminal_notification_backlog_service",
            "portal_cleanup_meeting_terminal_notifications_service",
            "orphaned_deadline",
            "meeting_terminal_notification",
            "'version',57",
            "'meetingTerminalNotificationOutbox'",
            "'meetingTerminalNotificationAtomicEnqueue'",
            "'meetingTerminalNotificationLegacyClaimDisabled'",
            "'meetingTerminalNotificationBoundedUnknown'",
            "'meetingTerminalNotificationWorkerHeartbeat'",
        ):
            if invariant not in notification_sql:
                errors.append(f"0057 meeting notification invariant is missing: {invariant}")
    text_preview_authority_repair = SUPABASE_MIGRATIONS / "0058_portal_text_preview_authority_repair.sql"
    if not text_preview_authority_repair.exists():
        errors.append("Missing Supabase-only text preview authority repair 0058")
    else:
        authority_sql = text_preview_authority_repair.read_text(encoding="utf-8")
        if "begin;" not in authority_sql or "commit;" not in authority_sql:
            errors.append("0058 text preview authority repair must have explicit transaction boundaries")
        for invariant in (
            "portal text preview historical generation outside 0..9 requires operator reconciliation",
            "v_user_id:=auth.uid();",
            "persistent text preview admission remains closed until M6-04",
            "from public,anon,authenticated,service_role",
            "check (generation between 0 and 9) not valid",
            "foreign key (tenant_id,transcript_id)",
            "on delete set null (transcript_id) not valid",
            "app.prevent_text_preview_reference_mutation()",
            "app.portal_external_roles_revoked",
            "c.confdelsetcols=array[",
            "'version',58",
            "'portalTextPreviewAuthorityRepair'",
        ):
            if invariant not in authority_sql:
                errors.append(f"0058 text preview authority invariant is missing: {invariant}")
        if re.search(
            r"grant\s+execute\s+on\s+function\s+public\.portal_admit_text_preview_authenticated",
            authority_sql,
            re.IGNORECASE,
        ):
            errors.append("0058 recovered admission must remain owner-only in M6-02")
    if "tenant_isolation" not in all_sql:
        errors.append("Tenant isolation policy is missing")
    if "event_document ->> 'tenant_id' IS DISTINCT FROM tenant_id::text" not in all_sql:
        errors.append("Outbox historical envelope tenant validation must be null-safe")
    if "event_document ->> 'tenant_id' IS NOT DISTINCT FROM tenant_id::text" not in all_sql:
        errors.append("Outbox envelope tenant check must be null-safe")
    if "(event_document ->> 'event_id')::app.uuid_v7 IS NOT DISTINCT FROM event_id" not in all_sql:
        errors.append("Outbox envelope event identity check must be null-safe")
    if "session_timeline_event_document_identity_check" not in all_sql:
        errors.append("Session timeline canonical envelope identity check is missing")
    if "event_document - ARRAY[" not in all_sql or "] = '{}'::jsonb" not in all_sql:
        errors.append("Session timeline envelope must remain closed")
    timeline_identity_migration = (MIGRATIONS / "0010_session_timeline_event_identity.sql").read_text(encoding="utf-8")
    if "DISABLE TRIGGER session_timeline_append_only" not in timeline_identity_migration:
        errors.append("Session timeline backfill must explicitly suspend its append-only trigger")
    if "ENABLE TRIGGER session_timeline_append_only" not in timeline_identity_migration:
        errors.append("Session timeline backfill must restore its append-only trigger")
    for constraint_name in (
        "session_participants_tenant_session_id_id_key",
        "sessions_active_presenter_fk",
        "conversation_turns_tenant_id_session_id_participant_id_fkey",
        "handoffs_tenant_id_session_id_from_presenter_id_fkey",
        "events_outbox_tenant_event_id_key",
        "events_outbox_event_document_identity_check",
        "session_timeline_tenant_event_id_key",
        "session_timeline_event_document_identity_check",
        "session_timeline_completion_source_key",
        "workflow_commands_source_completion_fkey",
        "workflow_commands_receipt_source_key",
        "workflow_runs_post_call_command_fkey",
        "workflow_runs_receipt_reference_key",
        "workflow_step_receipts_run_command_session_fkey",
        "workflow_step_receipts_command_source_fkey",
        "workflow_step_receipts_source_completion_fkey",
        "post_call_workflow_results_run_command_session_fkey",
        "post_call_workflow_results_command_source_fkey",
        "post_call_workflow_results_source_completion_fkey",
        "post_call_workflow_results_evidence_reference_key",
        "post_call_workflow_result_evidence_result_session_fkey",
        "post_call_workflow_result_evidence_timeline_fkey",
        "cost_events_tenant_id_reconciles_cost_event_id_fkey",
    ):
        if constraint_name not in all_sql:
            errors.append(f"Relational tenancy constraint is missing: {constraint_name}")
    for constraint_name in (
        "cost_events_currency_check",
        "cost_events_amount_reconciliation_check",
        "cost_events_rate_card_pair_check",
        "cost_events_reconciliation_source_check",
    ):
        if constraint_name not in all_sql:
            errors.append(f"Cost ledger constraint is missing: {constraint_name}")
    cost_reconciliation_migration = (MIGRATIONS / "0009_cost_event_reconciliation.sql").read_text(encoding="utf-8")
    if "CHECK (amount_usd = round(quantity * unit_cost_usd, 8)) NOT VALID" not in cost_reconciliation_migration:
        errors.append("Cost amount reconciliation must preserve legacy rows with a forward-only constraint")
    if "CREATE FUNCTION app.validate_cost_event_reconciliation()" not in cost_reconciliation_migration:
        errors.append("Cost reconciliation target validation function is missing")
    if "CREATE TRIGGER cost_events_reconciliation_target" not in cost_reconciliation_migration:
        errors.append("Cost reconciliation target trigger is missing")
    if "CREATE UNIQUE INDEX cost_events_tenant_source_provider_request_ref_unique" not in cost_reconciliation_migration:
        errors.append("Cost provider request replay guard is missing")
    cost_conversation_migration = (MIGRATIONS / "0012_cost_event_conversation_unit.sql").read_text(encoding="utf-8")
    if "'conversation'" not in cost_conversation_migration:
        errors.append("Cost conversation unit must be added by a forward-only migration")
    if "VALIDATE CONSTRAINT cost_events_unit_type_check" not in cost_conversation_migration:
        errors.append("Cost conversation unit constraint must be validated")
    workflow_migration = (MIGRATIONS / "0011_post_call_workflow_persistence.sql").read_text(encoding="utf-8")
    for invariant in (
        "workflow_commands_profile_check",
        "workflow_runs_post_call_profile_check",
        "workflow_runs_post_call_error_check",
        "workflow_runs_post_call_lease_check",
        "workflow_runs_post_call_waiting_check",
        "workflow_runs_post_call_lifecycle_check",
        "workflow_runs_post_call_terminal_check",
        "workflow_runs_tenant_post_call_command_unique",
        "workflow_step_receipts_shape_check",
        "post_call_workflow_results_shape_check",
        "follow_up_external_effect = false",
        "post_call_workflow_result_evidence_ordinal_check",
    ):
        if invariant not in workflow_migration:
            errors.append(f"Post-call workflow invariant is missing: {invariant}")
    if all_sql.count("ON DELETE RESTRICT") < 2:
        errors.append("Historical session references must reject hard deletion")
    for immutable_table in (
        "session_timeline", "consent_evidence", "disclosure_records", "tool_receipts", "audit_log", "cost_events",
        "workflow_commands", "workflow_step_receipts", "post_call_workflow_results", "post_call_workflow_result_evidence",
    ):
        if f"{immutable_table}_append_only" not in all_sql:
            errors.append(f"Append-only trigger missing for {immutable_table}")

    create_table = set(re.findall(r"CREATE TABLE\s+([a-z_]+)", all_sql, re.IGNORECASE))
    rls_array_matches = re.findall(r"tenant_tables\s+text\[\]\s*:=\s*ARRAY\[(.*?)\];", all_sql, re.IGNORECASE | re.DOTALL)
    if rls_array_matches:
        rls_tables = {
            table
            for array_body in rls_array_matches
            for table in re.findall(r"'([a-z_]+)'", array_body)
        }
        global_tables = {"schema_registry", "provider_catalog", "region_policy_catalog", "tenants"}
        expected_tenant_tables = create_table - global_tables
        missing_rls = expected_tenant_tables - rls_tables
        extra_rls = rls_tables - create_table
        if missing_rls:
            errors.append(f"Tenant tables missing from RLS list: {sorted(missing_rls)}")
        if extra_rls:
            errors.append(f"RLS list references unknown tables: {sorted(extra_rls)}")
    else:
        errors.append("Could not parse tenant RLS table list")

    if errors:
        print("DATABASE CONTRACT VALIDATION FAILED")
        for error in errors: print(f"- {error}")
        return 1
    print(f"DATABASE CONTRACT VALIDATION PASSED: {len(create_table)} tables, {len(EXPECTED)} migrations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
