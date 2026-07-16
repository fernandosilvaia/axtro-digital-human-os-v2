-- Fecha o RLS das 3 tabelas de catálogo sem tenant_id que o PostgREST expõe
-- à role anon. Leitura liberada, escrita bloqueada por ausência de policy.
-- Racional: D-V2-055.

BEGIN;

ALTER TABLE schema_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_read_only ON schema_registry
  FOR SELECT
  USING (true);

ALTER TABLE provider_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_read_only ON provider_catalog
  FOR SELECT
  USING (true);

ALTER TABLE region_policy_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE region_policy_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_read_only ON region_policy_catalog
  FOR SELECT
  USING (true);

COMMIT;
