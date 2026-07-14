BEGIN;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_policy ON tenants
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'tenant_settings','service_identities','agents','agent_deployments',
    'role_pack_installations','skill_pack_installations','provider_connections',
    'contact_profiles','sessions','session_participants','session_state_snapshots',
    'session_timeline','conversation_turns','consent_evidence','disclosure_records',
    'session_health','action_intents','policy_decisions','human_approvals',
    'tool_executions','tool_receipts','handoffs','knowledge_sources',
    'knowledge_versions','knowledge_chunks','knowledge_embeddings','workflow_runs',
    'audit_log','events_outbox','cost_events','usage_ledger','evaluation_runs',
    'experiment_candidates','deployment_promotions'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER session_timeline_append_only
BEFORE UPDATE OR DELETE ON session_timeline
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER consent_evidence_append_only
BEFORE UPDATE OR DELETE ON consent_evidence
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER disclosure_records_append_only
BEFORE UPDATE OR DELETE ON disclosure_records
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER tool_receipts_append_only
BEFORE UPDATE OR DELETE ON tool_receipts
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER cost_events_append_only
BEFORE UPDATE OR DELETE ON cost_events
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

COMMIT;
