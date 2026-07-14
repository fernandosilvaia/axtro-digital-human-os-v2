BEGIN;

CREATE TABLE schema_registry (
  schema_id text PRIMARY KEY,
  version text NOT NULL,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  document jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','deprecated','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schema_id, version)
);

CREATE TABLE provider_catalog (
  provider_id text PRIMARY KEY,
  provider_type text NOT NULL,
  display_name text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('candidate','approved','fallback','deprecated','disabled')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE region_policy_catalog (
  policy_id text PRIMARY KEY,
  jurisdiction text NOT NULL,
  sector text NOT NULL,
  version text NOT NULL,
  policy_document jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','deprecated')),
  effective_at timestamptz,
  UNIQUE (jurisdiction, sector, version)
);

CREATE TABLE tenants (
  id app.uuid_v7 PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('trial','active','suspended','closing','deleted')),
  home_region text NOT NULL,
  default_language text NOT NULL,
  default_timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id app.uuid_v7 PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings_version bigint NOT NULL DEFAULT 1 CHECK (settings_version > 0),
  brand_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_identities (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  name text NOT NULL,
  identity_type text NOT NULL CHECK (identity_type IN ('user','service','agent','workflow','provider')),
  status text NOT NULL CHECK (status IN ('active','disabled','revoked')),
  scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE agents (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  name text NOT NULL,
  role_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','disabled','archived')),
  disclosure_profile_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE agent_deployments (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  agent_id app.uuid_v7 NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development','staging','canary','production')),
  version text NOT NULL,
  configuration jsonb NOT NULL,
  rollout_percentage numeric(5,2) NOT NULL DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
  status text NOT NULL CHECK (status IN ('pending','active','paused','rolled_back','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, agent_id, environment, version)
);

CREATE TABLE role_pack_installations (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  role_pack_id text NOT NULL,
  version text NOT NULL,
  manifest_checksum text NOT NULL CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active','disabled','deprecated')),
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, role_pack_id, version)
);

CREATE TABLE skill_pack_installations (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  skill_pack_id text NOT NULL,
  version text NOT NULL,
  manifest_checksum text NOT NULL CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active','disabled','deprecated')),
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, skill_pack_id, version)
);

CREATE TABLE provider_connections (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  provider_id text NOT NULL REFERENCES provider_catalog(provider_id),
  region text NOT NULL,
  secret_handle text NOT NULL,
  non_secret_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending_validation','active','degraded','disabled','revoked')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider_id, region)
);

COMMIT;
