BEGIN;

CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE DOMAIN app.uuid_v7 AS uuid
  CHECK (
    VALUE IS NULL
    OR (
      substring(VALUE::text from 15 for 1) = '7'
      AND substring(VALUE::text from 20 for 1) ~ '^[89ab]$'
    )
  );

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

COMMIT;
