#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "database" / "migrations"
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


def main() -> int:
    errors: list[str] = []
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
