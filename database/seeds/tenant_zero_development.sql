-- Development-only deterministic seed. It contains no human PII or provider credentials.
BEGIN;

INSERT INTO tenants (id, slug, legal_name, status, home_region, default_language, default_timezone)
VALUES
  ('0197c000-0000-7000-8000-000000000001', 'tenant-zero-alpha', 'Tenant Zero Alpha Demo', 'active', 'local', 'en', 'UTC'),
  ('0197c000-0000-7000-8000-000000000002', 'tenant-zero-beta', 'Tenant Zero Beta Demo', 'active', 'local', 'en', 'UTC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_settings (tenant_id)
VALUES
  ('0197c000-0000-7000-8000-000000000001'),
  ('0197c000-0000-7000-8000-000000000002')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO service_identities (tenant_id, id, name, identity_type, status, scopes)
VALUES
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000011', 'tenant-zero-workflow', 'workflow', 'active', ARRAY['session:read', 'session:write', 'provider:use', 'tool:use']),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000012', 'tenant-zero-workflow', 'workflow', 'active', ARRAY['session:read', 'session:write', 'provider:use', 'tool:use'])
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO agents (tenant_id, id, name, role_type, status, disclosure_profile_id)
VALUES
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000021', 'Tenant Zero Sales Closer', 'sales_closer', 'active', 'development-ai-disclosure-v1'),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000022', 'Tenant Zero Sales Closer', 'sales_closer', 'active', 'development-ai-disclosure-v1')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO agent_deployments (tenant_id, id, agent_id, environment, version, configuration, status)
VALUES
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000031', '0197c000-0000-7000-8000-000000000021', 'development', '1.0.0', '{"provider_mode":"fake","scenario_id":"tenant-zero-v1"}'::jsonb, 'active'),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000032', '0197c000-0000-7000-8000-000000000022', 'development', '1.0.0', '{"provider_mode":"fake","scenario_id":"tenant-zero-v1"}'::jsonb, 'active')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO role_pack_installations (tenant_id, id, role_pack_id, version, manifest_checksum, status)
VALUES
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000041', 'sales-closer', '1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'active'),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000042', 'sales-closer', '1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'active')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO skill_pack_installations (tenant_id, id, skill_pack_id, version, manifest_checksum, status)
VALUES
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000051', 'qualification', '1.0.0', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'active'),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000052', 'qualification', '1.0.0', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'active')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO provider_connections (tenant_id, id, provider_id, region, secret_handle, non_secret_configuration, status)
VALUES
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000061', 'fake-realtime', 'local', 'ref_fake_tenant_zero_alpha_realtime', '{"scenario_id":"tenant-zero-v1"}'::jsonb, 'active'),
  ('0197c000-0000-7000-8000-000000000001', '0197c000-0000-7000-8000-000000000071', 'fake-catalog', 'local', 'ref_fake_tenant_zero_alpha_catalog', '{"read_only":true}'::jsonb, 'active'),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000062', 'fake-realtime', 'local', 'ref_fake_tenant_zero_beta_realtime', '{"scenario_id":"tenant-zero-v1"}'::jsonb, 'active'),
  ('0197c000-0000-7000-8000-000000000002', '0197c000-0000-7000-8000-000000000072', 'fake-catalog', 'local', 'ref_fake_tenant_zero_beta_catalog', '{"read_only":true}'::jsonb, 'active')
ON CONFLICT (tenant_id, id) DO NOTHING;

DO $$
DECLARE
  alpha_tenant app.uuid_v7 := '0197c000-0000-7000-8000-000000000001';
  beta_tenant app.uuid_v7 := '0197c000-0000-7000-8000-000000000002';
BEGIN
  IF (SELECT count(*) FROM tenants WHERE id IN (alpha_tenant, beta_tenant)) <> 2
    OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = alpha_tenant AND slug = 'tenant-zero-alpha' AND legal_name = 'Tenant Zero Alpha Demo' AND status = 'active' AND home_region = 'local' AND default_language = 'en' AND default_timezone = 'UTC')
    OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = beta_tenant AND slug = 'tenant-zero-beta' AND legal_name = 'Tenant Zero Beta Demo' AND status = 'active' AND home_region = 'local' AND default_language = 'en' AND default_timezone = 'UTC')
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM tenant_settings WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 2
    OR EXISTS (SELECT 1 FROM tenant_settings WHERE tenant_id IN (alpha_tenant, beta_tenant) AND (settings_version <> 1 OR brand_config <> '{}'::jsonb OR retention_policy <> '{}'::jsonb OR feature_flags <> '{}'::jsonb))
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM service_identities WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 2
    OR NOT EXISTS (SELECT 1 FROM service_identities WHERE tenant_id = alpha_tenant AND id = '0197c000-0000-7000-8000-000000000011' AND name = 'tenant-zero-workflow' AND identity_type = 'workflow' AND status = 'active' AND scopes = ARRAY['session:read', 'session:write', 'provider:use', 'tool:use'])
    OR NOT EXISTS (SELECT 1 FROM service_identities WHERE tenant_id = beta_tenant AND id = '0197c000-0000-7000-8000-000000000012' AND name = 'tenant-zero-workflow' AND identity_type = 'workflow' AND status = 'active' AND scopes = ARRAY['session:read', 'session:write', 'provider:use', 'tool:use'])
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM agents WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 2
    OR NOT EXISTS (SELECT 1 FROM agents WHERE tenant_id = alpha_tenant AND id = '0197c000-0000-7000-8000-000000000021' AND name = 'Tenant Zero Sales Closer' AND role_type = 'sales_closer' AND status = 'active' AND disclosure_profile_id = 'development-ai-disclosure-v1')
    OR NOT EXISTS (SELECT 1 FROM agents WHERE tenant_id = beta_tenant AND id = '0197c000-0000-7000-8000-000000000022' AND name = 'Tenant Zero Sales Closer' AND role_type = 'sales_closer' AND status = 'active' AND disclosure_profile_id = 'development-ai-disclosure-v1')
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM agent_deployments WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 2
    OR NOT EXISTS (SELECT 1 FROM agent_deployments WHERE tenant_id = alpha_tenant AND id = '0197c000-0000-7000-8000-000000000031' AND agent_id = '0197c000-0000-7000-8000-000000000021' AND environment = 'development' AND version = '1.0.0' AND configuration = '{"provider_mode":"fake","scenario_id":"tenant-zero-v1"}'::jsonb AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM agent_deployments WHERE tenant_id = beta_tenant AND id = '0197c000-0000-7000-8000-000000000032' AND agent_id = '0197c000-0000-7000-8000-000000000022' AND environment = 'development' AND version = '1.0.0' AND configuration = '{"provider_mode":"fake","scenario_id":"tenant-zero-v1"}'::jsonb AND status = 'active')
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM role_pack_installations WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 2
    OR EXISTS (SELECT 1 FROM role_pack_installations WHERE tenant_id IN (alpha_tenant, beta_tenant) AND (role_pack_id <> 'sales-closer' OR version <> '1.0.0' OR manifest_checksum <> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' OR status <> 'active'))
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM skill_pack_installations WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 2
    OR EXISTS (SELECT 1 FROM skill_pack_installations WHERE tenant_id IN (alpha_tenant, beta_tenant) AND (skill_pack_id <> 'qualification' OR version <> '1.0.0' OR manifest_checksum <> 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' OR status <> 'active'))
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;

  IF (SELECT count(*) FROM provider_connections WHERE tenant_id IN (alpha_tenant, beta_tenant)) <> 4
    OR NOT EXISTS (SELECT 1 FROM provider_connections WHERE tenant_id = alpha_tenant AND id = '0197c000-0000-7000-8000-000000000061' AND provider_id = 'fake-realtime' AND region = 'local' AND secret_handle = 'ref_fake_tenant_zero_alpha_realtime' AND non_secret_configuration = '{"scenario_id":"tenant-zero-v1"}'::jsonb AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM provider_connections WHERE tenant_id = alpha_tenant AND id = '0197c000-0000-7000-8000-000000000071' AND provider_id = 'fake-catalog' AND region = 'local' AND secret_handle = 'ref_fake_tenant_zero_alpha_catalog' AND non_secret_configuration = '{"read_only":true}'::jsonb AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM provider_connections WHERE tenant_id = beta_tenant AND id = '0197c000-0000-7000-8000-000000000062' AND provider_id = 'fake-realtime' AND region = 'local' AND secret_handle = 'ref_fake_tenant_zero_beta_realtime' AND non_secret_configuration = '{"scenario_id":"tenant-zero-v1"}'::jsonb AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM provider_connections WHERE tenant_id = beta_tenant AND id = '0197c000-0000-7000-8000-000000000072' AND provider_id = 'fake-catalog' AND region = 'local' AND secret_handle = 'ref_fake_tenant_zero_beta_catalog' AND non_secret_configuration = '{"read_only":true}'::jsonb AND status = 'active')
  THEN
    RAISE EXCEPTION 'tenant-zero seed composition diverged';
  END IF;
END;
$$;

COMMIT;
