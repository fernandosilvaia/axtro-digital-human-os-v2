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
    for constraint_name in (
        "session_participants_tenant_session_id_id_key",
        "sessions_active_presenter_fk",
        "conversation_turns_tenant_id_session_id_participant_id_fkey",
        "handoffs_tenant_id_session_id_from_presenter_id_fkey",
    ):
        if constraint_name not in all_sql:
            errors.append(f"Relational tenancy constraint is missing: {constraint_name}")
    if all_sql.count("ON DELETE RESTRICT") < 2:
        errors.append("Historical session references must reject hard deletion")
    for immutable_table in ("session_timeline", "consent_evidence", "disclosure_records", "tool_receipts", "audit_log", "cost_events"):
        if f"{immutable_table}_append_only" not in all_sql:
            errors.append(f"Append-only trigger missing for {immutable_table}")

    create_table = set(re.findall(r"CREATE TABLE\s+([a-z_]+)", all_sql, re.IGNORECASE))
    rls_array_match = re.search(r"tenant_tables\s+text\[\]\s*:=\s*ARRAY\[(.*?)\];", all_sql, re.IGNORECASE | re.DOTALL)
    if rls_array_match:
        rls_tables = set(re.findall(r"'([a-z_]+)'", rls_array_match.group(1)))
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
