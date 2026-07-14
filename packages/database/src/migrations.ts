import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseUuidV7, type UuidV7 } from "@axtro/domain";

declare const localDatabaseUrlBrand: unique symbol;

/** A password-free PostgreSQL URL pinned to loopback or a local Unix socket. */
export type LocalDatabaseUrl = string & { readonly [localDatabaseUrlBrand]: "LocalDatabaseUrl" };

export interface MigrationFile {
  readonly version: number;
  readonly filename: string;
  readonly path: string;
  readonly checksumSha256: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly filename: string;
  readonly checksumSha256: string;
}

export interface PsqlCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface PsqlResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type PsqlExecutor = (command: PsqlCommand) => PsqlResult;

export interface LocalMigrationOptions {
  readonly databaseUrl: unknown;
  readonly migrationsDirectory?: string;
  readonly psqlPath?: string;
  readonly targetVersion?: number;
  readonly executor?: PsqlExecutor;
}

export interface MigrationApplyResult {
  readonly applied: readonly AppliedMigration[];
  readonly history: readonly AppliedMigration[];
}

export interface SchemaDriftReport {
  readonly migrationCount: number;
  readonly catalogFingerprint: string;
}

export class LocalDatabaseUrlError extends Error {
  constructor() {
    super("Database URL must be a password-free local PostgreSQL endpoint");
    this.name = "LocalDatabaseUrlError";
  }
}

export class MigrationManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationManifestError";
  }
}

export class MigrationDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationDriftError";
  }
}

export class MigrationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationStateError";
  }
}

export class LocalDatabaseCommandError extends Error {
  constructor(phase: string) {
    super(`Local database command failed during ${phase}`);
    this.name = "LocalDatabaseCommandError";
  }
}

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOCAL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const MIGRATION_HISTORY_TABLE = "public.axtro_schema_migrations";
const LOCAL_LOCK_NAMESPACE = "axtro-dhos-v2-migrations";
const UUID_V7_CONSTRAINT_SIGNATURE = "checkvalueisnullorsubstringvaluetextfrom15for17textandsubstringvaluetextfrom20for189abtext";
const CURRENT_TENANT_ID_FUNCTION_SIGNATURE = "selectnullifcurrent_settingapptenant_idtrueuuid";
const PREVENT_MUTATION_FUNCTION_SIGNATURE = "beginraiseexceptiontableisappendonlytg_table_nameusingerrcode55000end";
const APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE = 27;
const COST_RECONCILIATION_ROW_INSERT_TRIGGER_TYPE = 7;
const COST_RECONCILIATION_FUNCTION_SIGNATURES = [
  "newreconciles_cost_event_idisnull",
  "target_costsourceisdistinctfromestimated",
  "target_costsession_idisdistinctfromnewsession_id",
  "target_costprovider_idisdistinctfromnewprovider_id",
  "target_costserviceisdistinctfromnewservice",
  "target_costunit_typeisdistinctfromnewunit_type",
] as const;
const OUTBOX_EVENT_DOCUMENT_IDENTITY_CHECK = "events_outbox_event_document_identity_check";
const OUTBOX_EVENT_DOCUMENT_IDENTITY_SIGNATURES = [
  "jsonb_typeofevent_documentobjecttext",
  "schema_version",
  "aggregate_version",
  "payload_json",
  "occurred_at",
  "event_documentevent_id",
  "appuuid_v7",
  "notevent_documentevent_idtextappuuid_v7uuidisdistinctfromevent_iduuid",
  "notevent_documenttenant_idtextisdistinctfromtenant_idtext",
] as const;
const COST_EVENT_CHECK_CONSTRAINTS = [
  { name: "cost_events_currency_check", signatures: ["currencyusd"] },
  { name: "cost_events_provider_id_length_check", signatures: ["char_lengthprovider_id1andchar_lengthprovider_id120"] },
  { name: "cost_events_service_length_check", signatures: ["char_lengthservice1andchar_lengthservice160"] },
  { name: "cost_events_unit_type_check", signatures: ["unit_type", "minute", "second", "token", "character", "megabyte", "request", "seat", "flat"] },
  { name: "cost_events_amount_reconciliation_check", signatures: ["amount_usdroundquantityunit_cost_usd8"] },
  {
    name: "cost_events_rate_card_pair_check",
    signatures: ["rate_card_refisnullandrate_card_as_ofisnull", "rate_card_refisnotnullandrate_card_as_ofisnotnull"],
  },
  { name: "cost_events_trace_id_check", signatures: ["trace_id", "09af32"] },
  { name: "cost_events_provider_request_ref_check", signatures: ["provider_request_ref", "ppr_az09664"] },
  {
    name: "cost_events_reconciliation_source_check",
    signatures: ["reconciles_cost_event_idisnull", "measured", "provider_reported", "reconciles_cost_event_iduuididuuid"],
  },
] as const;
const COST_EVENT_CHECK_SIGNATURES = COST_EVENT_CHECK_CONSTRAINTS.flatMap(({ name, signatures }) => (
  signatures.map((signature) => ({ name, signature }))
));
const COST_EVENT_UNIQUE_INDEX = {
  name: "cost_events_tenant_source_provider_request_ref_unique",
  signatures: [
    "createuniqueindex",
    "cost_events",
    "tenant_idsourceprovider_request_ref",
    "provider_request_refisnotnull",
  ],
} as const;
const DEFAULT_MIGRATIONS_DIRECTORY = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
  "../../database/migrations",
);

const SENTINEL_SQL_BY_VERSION: Readonly<Record<number, string>> = {
  1: "SELECT EXISTS (SELECT 1 FROM pg_type type JOIN pg_namespace namespace ON namespace.oid = type.typnamespace WHERE namespace.nspname = 'app' AND type.typname = 'uuid_v7')::int;",
  2: "SELECT (to_regclass('public.tenants') IS NOT NULL)::int;",
  3: "SELECT (to_regclass('public.sessions') IS NOT NULL)::int;",
  4: "SELECT (to_regclass('public.knowledge_sources') IS NOT NULL)::int;",
  5: "SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'tenant_isolation')::int;",
  6: "SELECT EXISTS (SELECT 1 FROM public.provider_catalog WHERE provider_id = 'fake-realtime')::int;",
  7: "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_participants_tenant_session_id_id_key')::int;",
  8: "SELECT (EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_outbox_tenant_event_id_key') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_outbox_event_document_identity_check'))::int;",
  9: "SELECT (EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_events_amount_reconciliation_check') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_events_tenant_id_reconciles_cost_event_id_fkey') AND to_regclass('public.cost_events_tenant_source_provider_request_ref_unique') IS NOT NULL)::int;",
};

const EXPECTED_PUBLIC_TABLES = [
  "schema_registry",
  "provider_catalog",
  "region_policy_catalog",
  "tenants",
  "tenant_settings",
  "service_identities",
  "agents",
  "agent_deployments",
  "role_pack_installations",
  "skill_pack_installations",
  "provider_connections",
  "contact_profiles",
  "sessions",
  "session_participants",
  "session_state_snapshots",
  "session_timeline",
  "conversation_turns",
  "consent_evidence",
  "disclosure_records",
  "session_health",
  "action_intents",
  "policy_decisions",
  "human_approvals",
  "tool_executions",
  "tool_receipts",
  "handoffs",
  "knowledge_sources",
  "knowledge_versions",
  "knowledge_chunks",
  "knowledge_embeddings",
  "workflow_runs",
  "audit_log",
  "events_outbox",
  "cost_events",
  "usage_ledger",
  "evaluation_runs",
  "experiment_candidates",
  "deployment_promotions",
] as const;

const EXPECTED_TENANT_TABLES = [
  "tenant_settings",
  "service_identities",
  "agents",
  "agent_deployments",
  "role_pack_installations",
  "skill_pack_installations",
  "provider_connections",
  "contact_profiles",
  "sessions",
  "session_participants",
  "session_state_snapshots",
  "session_timeline",
  "conversation_turns",
  "consent_evidence",
  "disclosure_records",
  "session_health",
  "action_intents",
  "policy_decisions",
  "human_approvals",
  "tool_executions",
  "tool_receipts",
  "handoffs",
  "knowledge_sources",
  "knowledge_versions",
  "knowledge_chunks",
  "knowledge_embeddings",
  "workflow_runs",
  "audit_log",
  "events_outbox",
  "cost_events",
  "usage_ledger",
  "evaluation_runs",
  "experiment_candidates",
  "deployment_promotions",
] as const;

const EXPECTED_RLS_TABLES = ["tenants", ...EXPECTED_TENANT_TABLES] as const;

const EXPECTED_TRIGGERS = [
  { table: "session_timeline", name: "session_timeline_append_only", triggerType: APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE, functionName: "prevent_mutation" },
  { table: "consent_evidence", name: "consent_evidence_append_only", triggerType: APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE, functionName: "prevent_mutation" },
  { table: "disclosure_records", name: "disclosure_records_append_only", triggerType: APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE, functionName: "prevent_mutation" },
  { table: "tool_receipts", name: "tool_receipts_append_only", triggerType: APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE, functionName: "prevent_mutation" },
  { table: "audit_log", name: "audit_log_append_only", triggerType: APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE, functionName: "prevent_mutation" },
  { table: "cost_events", name: "cost_events_append_only", triggerType: APPEND_ONLY_ROW_UPDATE_DELETE_TRIGGER_TYPE, functionName: "prevent_mutation" },
  { table: "cost_events", name: "cost_events_reconciliation_target", triggerType: COST_RECONCILIATION_ROW_INSERT_TRIGGER_TYPE, functionName: "validate_cost_event_reconciliation" },
] as const;

const EXPECTED_RELATIONAL_CONSTRAINTS = [
  {
    table: "session_participants",
    name: "session_participants_tenant_session_id_id_key",
    definition: "unique(tenant_id,session_id,id)",
  },
  {
    table: "sessions",
    name: "sessions_active_presenter_fk",
    definition: "foreignkey(tenant_id,id,active_presenter_id)referencessession_participants(tenant_id,session_id,id)deferrableinitiallydeferred",
  },
  {
    table: "conversation_turns",
    name: "conversation_turns_tenant_id_session_id_participant_id_fkey",
    definition: "foreignkey(tenant_id,session_id,participant_id)referencessession_participants(tenant_id,session_id,id)",
  },
  {
    table: "handoffs",
    name: "handoffs_tenant_id_session_id_from_presenter_id_fkey",
    definition: "foreignkey(tenant_id,session_id,from_presenter_id)referencessession_participants(tenant_id,session_id,id)",
  },
  {
    table: "cost_events",
    name: "cost_events_tenant_id_session_id_fkey",
    definition: "foreignkey(tenant_id,session_id)referencessessions(tenant_id,id)ondeleterestrict",
  },
  {
    table: "cost_events",
    name: "cost_events_tenant_id_reconciles_cost_event_id_fkey",
    definition: "foreignkey(tenant_id,reconciles_cost_event_id)referencescost_events(tenant_id,id)ondeleterestrictnotvalid",
  },
  {
    table: "evaluation_runs",
    name: "evaluation_runs_tenant_id_session_id_fkey",
    definition: "foreignkey(tenant_id,session_id)referencessessions(tenant_id,id)ondeleterestrict",
  },
  {
    table: "events_outbox",
    name: "events_outbox_tenant_event_id_key",
    definition: "unique(tenant_id,event_id)",
  },
] as const;

const HISTORY_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS ${MIGRATION_HISTORY_TABLE} (
  version integer PRIMARY KEY CHECK (version > 0),
  filename text NOT NULL UNIQUE,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

const HISTORY_QUERY_SQL = `
SELECT version || E'\\t' || filename || E'\\t' || checksum_sha256
FROM ${MIGRATION_HISTORY_TABLE}
ORDER BY version;
`;

const HISTORY_EXISTS_SQL = `
SELECT (to_regclass('${MIGRATION_HISTORY_TABLE}') IS NOT NULL)::int;
`;

const CATALOG_ASSERTION_SQL = `
WITH expected_tables(name) AS (
  VALUES ${EXPECTED_PUBLIC_TABLES.map((name) => `('${name}')`).join(", ")}
),
actual_tables AS (
  SELECT relation.relname AS name, relation.relrowsecurity AS row_security, relation.relforcerowsecurity AS force_row_security
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'r'
    AND relation.relname <> 'axtro_schema_migrations'
),
expected_rls_tables(name) AS (
  VALUES ${EXPECTED_RLS_TABLES.map((name) => `('${name}')`).join(", ")}
),
expected_policies(tablename, policyname, predicate) AS (
  VALUES
    ('tenants', 'tenant_self_policy', 'id=app.current_tenant_id'),
    ${EXPECTED_TENANT_TABLES.map((name) => `('${name}', 'tenant_isolation', 'tenant_id=app.current_tenant_id')`).join(",\n    ")}
),
actual_policies AS (
  SELECT
    tablename,
    policyname,
    cmd,
    array_to_string(roles, ',') AS roles,
    replace(regexp_replace(lower(coalesce(qual, '')), '[[:space:]()]', '', 'g'), '::uuid', '') AS normalized_qual,
    replace(regexp_replace(lower(coalesce(with_check, '')), '[[:space:]()]', '', 'g'), '::uuid', '') AS normalized_with_check
  FROM pg_policies
  WHERE schemaname = 'public'
),
expected_triggers(table_name, trigger_name, trigger_type, function_name) AS (
  VALUES ${EXPECTED_TRIGGERS.map((trigger) => `('${trigger.table}', '${trigger.name}', ${trigger.triggerType}, '${trigger.functionName}')`).join(", ")}
),
actual_triggers AS (
  SELECT
    relation.relname AS table_name,
    trigger.tgname AS trigger_name,
    trigger.tgenabled AS enabled,
    trigger.tgtype::integer AS trigger_type,
    function_namespace.nspname AS function_schema,
    procedure.proname AS function_name
  FROM pg_trigger trigger
  JOIN pg_class relation ON relation.oid = trigger.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
  JOIN pg_namespace function_namespace ON function_namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal
),
actual_app_functions AS (
  SELECT
    procedure.proname AS function_name,
    language.lanname AS language_name,
    regexp_replace(lower(procedure.prosrc), '[^a-z0-9_]+', '', 'g') AS source_signature
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  JOIN pg_language language ON language.oid = procedure.prolang
  WHERE namespace.nspname = 'app' AND procedure.proname IN ('current_tenant_id', 'prevent_mutation', 'validate_cost_event_reconciliation')
),
expected_relational_constraints(table_name, constraint_name, definition) AS (
  VALUES ${EXPECTED_RELATIONAL_CONSTRAINTS.map((constraint) => `('${constraint.table}', '${constraint.name}', '${constraint.definition}')`).join(",\n    ")}
),
actual_relational_constraints AS (
  SELECT
    relation.relname AS table_name,
    table_constraint.conname AS constraint_name,
    regexp_replace(lower(pg_get_constraintdef(table_constraint.oid)), '[[:space:]]+', '', 'g') AS definition
  FROM pg_constraint table_constraint
  JOIN pg_class relation ON relation.oid = table_constraint.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_constraint.conname IN (${EXPECTED_RELATIONAL_CONSTRAINTS.map((constraint) => `'${constraint.name}'`).join(", ")})
),
actual_outbox_event_document_identity_check AS (
  SELECT regexp_replace(lower(pg_get_constraintdef(table_constraint.oid)), '[^a-z0-9_]+', '', 'g') AS definition
  FROM pg_constraint table_constraint
  JOIN pg_class relation ON relation.oid = table_constraint.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'events_outbox'
    AND table_constraint.conname = '${OUTBOX_EVENT_DOCUMENT_IDENTITY_CHECK}'
    AND table_constraint.contype = 'c'
),
expected_cost_event_check_signatures(constraint_name, signature) AS (
  VALUES ${COST_EVENT_CHECK_SIGNATURES.map((entry) => `('${entry.name}', '${entry.signature}')`).join(", ")}
),
actual_cost_event_check_constraints AS (
  SELECT
    table_constraint.conname AS constraint_name,
    regexp_replace(lower(pg_get_constraintdef(table_constraint.oid)), '[^a-z0-9_]+', '', 'g') AS definition
  FROM pg_constraint table_constraint
  JOIN pg_class relation ON relation.oid = table_constraint.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'cost_events'
    AND table_constraint.contype = 'c'
    AND table_constraint.conname IN (${COST_EVENT_CHECK_CONSTRAINTS.map((constraint) => `'${constraint.name}'`).join(", ")})
),
actual_cost_event_unique_index AS (
  SELECT
    index_class.relname AS index_name,
    regexp_replace(lower(pg_get_indexdef(index_class.oid)), '[^a-z0-9_]+', '', 'g') AS definition
  FROM pg_index index
  JOIN pg_class index_class ON index_class.oid = index.indexrelid
  JOIN pg_class relation ON relation.oid = index.indrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'cost_events'
    AND index_class.relname = '${COST_EVENT_UNIQUE_INDEX.name}'
)
SELECT CASE WHEN
  (SELECT count(*) FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')) = 2
  AND EXISTS (
    SELECT 1
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'app' AND type.typname = 'uuid_v7' AND type.typtype = 'd'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    JOIN pg_constraint domain_constraint ON domain_constraint.contypid = type.oid
    WHERE namespace.nspname = 'app'
      AND type.typname = 'uuid_v7'
      AND domain_constraint.contype = 'c'
      AND regexp_replace(lower(pg_get_constraintdef(domain_constraint.oid)), '[^a-z0-9]+', '', 'g') = '${UUID_V7_CONSTRAINT_SIGNATURE}'
  )
  AND EXISTS (
    SELECT 1 FROM actual_app_functions
    WHERE function_name = 'current_tenant_id'
      AND language_name = 'sql'
      AND source_signature = '${CURRENT_TENANT_ID_FUNCTION_SIGNATURE}'
  )
  AND EXISTS (
    SELECT 1 FROM actual_app_functions
    WHERE function_name = 'prevent_mutation'
      AND language_name = 'plpgsql'
      AND source_signature = '${PREVENT_MUTATION_FUNCTION_SIGNATURE}'
  )
  AND EXISTS (
    SELECT 1 FROM actual_app_functions
    WHERE function_name = 'validate_cost_event_reconciliation'
      AND language_name = 'plpgsql'
      AND ${COST_RECONCILIATION_FUNCTION_SIGNATURES.map((signature) => `source_signature LIKE '%${signature}%'`).join("\n      AND ")}
  )
  AND NOT EXISTS (
    SELECT 1
    FROM expected_relational_constraints expected
    LEFT JOIN actual_relational_constraints actual
      ON actual.table_name = expected.table_name
      AND actual.constraint_name = expected.constraint_name
    WHERE actual.table_name IS NULL
      OR actual.definition IS DISTINCT FROM expected.definition
  )
  AND NOT EXISTS (
    SELECT 1
    FROM actual_relational_constraints actual
    LEFT JOIN expected_relational_constraints expected
      ON expected.table_name = actual.table_name
      AND expected.constraint_name = actual.constraint_name
    WHERE expected.table_name IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM expected_tables expected
    LEFT JOIN actual_tables actual ON actual.name = expected.name
    WHERE actual.name IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM actual_tables actual
    LEFT JOIN expected_tables expected ON expected.name = actual.name
    WHERE expected.name IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM actual_tables actual
    LEFT JOIN expected_rls_tables expected ON expected.name = actual.name
    WHERE actual.row_security IS DISTINCT FROM (expected.name IS NOT NULL)
      OR actual.force_row_security IS DISTINCT FROM (expected.name IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM expected_policies expected
    LEFT JOIN actual_policies actual
      ON actual.tablename = expected.tablename
      AND actual.policyname = expected.policyname
    WHERE actual.tablename IS NULL
      OR actual.cmd IS DISTINCT FROM 'ALL'
      OR actual.roles IS DISTINCT FROM 'public'
      OR actual.normalized_qual IS DISTINCT FROM expected.predicate
      OR actual.normalized_with_check IS DISTINCT FROM expected.predicate
  )
  AND NOT EXISTS (
    SELECT 1
    FROM actual_policies actual
    LEFT JOIN expected_policies expected
      ON expected.tablename = actual.tablename
      AND expected.policyname = actual.policyname
    WHERE expected.tablename IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM expected_triggers expected
    LEFT JOIN actual_triggers actual
      ON actual.table_name = expected.table_name
      AND actual.trigger_name = expected.trigger_name
    WHERE actual.table_name IS NULL
      OR actual.enabled IS DISTINCT FROM 'O'
      OR actual.trigger_type IS DISTINCT FROM expected.trigger_type
      OR actual.function_schema IS DISTINCT FROM 'app'
      OR actual.function_name IS DISTINCT FROM expected.function_name
  )
  AND NOT EXISTS (
    SELECT 1
    FROM actual_triggers actual
    LEFT JOIN expected_triggers expected
      ON expected.table_name = actual.table_name
      AND expected.trigger_name = actual.trigger_name
    WHERE expected.table_name IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM actual_outbox_event_document_identity_check
    WHERE ${OUTBOX_EVENT_DOCUMENT_IDENTITY_SIGNATURES.map((signature) => `definition LIKE '%${signature}%'`).join("\n      AND ")}
  )
  AND NOT EXISTS (
    SELECT 1
    FROM expected_cost_event_check_signatures expected
    LEFT JOIN actual_cost_event_check_constraints actual
      ON actual.constraint_name = expected.constraint_name
    WHERE actual.constraint_name IS NULL
      OR actual.definition NOT LIKE '%' || expected.signature || '%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM actual_cost_event_unique_index actual
    WHERE actual.index_name IS DISTINCT FROM '${COST_EVENT_UNIQUE_INDEX.name}'
      OR ${COST_EVENT_UNIQUE_INDEX.signatures.map((signature) => `actual.definition NOT LIKE '%${signature}%'`).join("\n      OR ")}
  )
  AND EXISTS (
    SELECT 1
    FROM actual_cost_event_unique_index actual
    WHERE actual.index_name = '${COST_EVENT_UNIQUE_INDEX.name}'
      AND ${COST_EVENT_UNIQUE_INDEX.signatures.map((signature) => `actual.definition LIKE '%${signature}%'`).join("\n      AND ")}
  )
THEN 'ok' ELSE 'drift' END;
`;

const CATALOG_FINGERPRINT_SQL = `
SELECT entry
FROM (
  SELECT 'extension:' || extname AS entry
  FROM pg_extension
  WHERE extname IN ('vector', 'pgcrypto')
  UNION ALL
  SELECT 'table:' || relation.relname || ':rls=' || relation.relrowsecurity || ':force=' || relation.relforcerowsecurity
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'r'
    AND relation.relname <> 'axtro_schema_migrations'
  UNION ALL
  SELECT
    'policy:' || tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':'
    || replace(regexp_replace(lower(coalesce(qual, '')), '[[:space:]()]', '', 'g'), '::uuid', '') || ':'
    || replace(regexp_replace(lower(coalesce(with_check, '')), '[[:space:]()]', '', 'g'), '::uuid', '')
  FROM pg_policies
  WHERE schemaname = 'public'
  UNION ALL
  SELECT 'trigger:' || relation.relname || ':' || trigger.tgname || ':' || trigger.tgenabled::text || ':' || trigger.tgtype::integer::text || ':' || function_namespace.nspname || '.' || procedure.proname
  FROM pg_trigger trigger
  JOIN pg_class relation ON relation.oid = trigger.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
  JOIN pg_namespace function_namespace ON function_namespace.oid = procedure.pronamespace
  WHERE NOT trigger.tgisinternal
    AND namespace.nspname = 'public'
  UNION ALL
  SELECT 'function:' || procedure.proname || ':' || language.lanname || ':' || regexp_replace(lower(procedure.prosrc), '[^a-z0-9_]+', '', 'g')
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  JOIN pg_language language ON language.oid = procedure.prolang
  WHERE namespace.nspname = 'app' AND procedure.proname IN ('current_tenant_id', 'prevent_mutation', 'validate_cost_event_reconciliation')
  UNION ALL
  SELECT 'uuid_v7_constraint:' || regexp_replace(lower(pg_get_constraintdef(domain_constraint.oid)), '[[:space:]]+', '', 'g')
  FROM pg_constraint domain_constraint
  JOIN pg_type type ON type.oid = domain_constraint.contypid
  JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
  WHERE namespace.nspname = 'app' AND type.typname = 'uuid_v7' AND domain_constraint.contype = 'c'
  UNION ALL
  SELECT 'constraint:' || relation.relname || ':' || table_constraint.conname || ':' || regexp_replace(lower(pg_get_constraintdef(table_constraint.oid)), '[[:space:]]+', '', 'g')
  FROM pg_constraint table_constraint
  JOIN pg_class relation ON relation.oid = table_constraint.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_constraint.conname IN (${[...EXPECTED_RELATIONAL_CONSTRAINTS.map((constraint) => `'${constraint.name}'`), `'${OUTBOX_EVENT_DOCUMENT_IDENTITY_CHECK}'`, ...COST_EVENT_CHECK_CONSTRAINTS.map((constraint) => `'${constraint.name}'`)].join(", ")})
  UNION ALL
  SELECT 'index:' || index_class.relname || ':' || regexp_replace(lower(pg_get_indexdef(index_class.oid)), '[^a-z0-9_]+', '', 'g')
  FROM pg_index index
  JOIN pg_class index_class ON index_class.oid = index.indexrelid
  JOIN pg_class relation ON relation.oid = index.indrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'cost_events'
    AND index_class.relname = '${COST_EVENT_UNIQUE_INDEX.name}'
) catalog_entries
ORDER BY entry;
`;

const CATALOG_DIAGNOSTIC_SQL = `
SELECT entry
FROM (
  SELECT 'cost_check:' || table_constraint.conname || ':' || regexp_replace(lower(pg_get_constraintdef(table_constraint.oid)), '[^a-z0-9_]+', '', 'g') AS entry
  FROM pg_constraint table_constraint
  JOIN pg_class relation ON relation.oid = table_constraint.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'cost_events'
    AND table_constraint.contype = 'c'
    AND table_constraint.conname IN (${COST_EVENT_CHECK_CONSTRAINTS.map((constraint) => `'${constraint.name}'`).join(", ")})
  UNION ALL
  SELECT 'trigger:' || relation.relname || ':' || trigger.tgname || ':' || trigger.tgtype::integer::text || ':' || function_namespace.nspname || '.' || procedure.proname
  FROM pg_trigger trigger
  JOIN pg_class relation ON relation.oid = trigger.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
  JOIN pg_namespace function_namespace ON function_namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'cost_events'
    AND NOT trigger.tgisinternal
  UNION ALL
  SELECT 'function:' || procedure.proname || ':' || regexp_replace(lower(procedure.prosrc), '[^a-z0-9_]+', '', 'g')
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'app'
    AND procedure.proname = 'validate_cost_event_reconciliation'
  UNION ALL
  SELECT 'relational:' || table_constraint.conname || ':' || regexp_replace(lower(pg_get_constraintdef(table_constraint.oid)), '[[:space:]]+', '', 'g')
  FROM pg_constraint table_constraint
  JOIN pg_class relation ON relation.oid = table_constraint.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_constraint.conname = 'cost_events_tenant_id_reconciles_cost_event_id_fkey'
  UNION ALL
  SELECT 'index:' || index_class.relname || ':' || regexp_replace(lower(pg_get_indexdef(index_class.oid)), '[^a-z0-9_]+', '', 'g')
  FROM pg_index index
  JOIN pg_class index_class ON index_class.oid = index.indexrelid
  JOIN pg_class relation ON relation.oid = index.indrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'cost_events'
    AND index_class.relname = '${COST_EVENT_UNIQUE_INDEX.name}'
) diagnostics
ORDER BY entry;
`;

/** Reject remote URLs and every form that could carry a credential. */
export function parseLocalDatabaseUrl(value: unknown): LocalDatabaseUrl {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new LocalDatabaseUrlError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalDatabaseUrlError();
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new LocalDatabaseUrlError();
  if (url.password.length > 0 || url.searchParams.has("password") || url.searchParams.has("passfile")) {
    throw new LocalDatabaseUrlError();
  }
  const databaseName = url.pathname.slice(1);
  if (
    !LOOPBACK_HOSTS.has(url.hostname)
    || url.search.length > 0
    || url.hash.length > 0
    || !LOCAL_IDENTIFIER.test(url.username)
    || !LOCAL_IDENTIFIER.test(databaseName)
  ) {
    throw new LocalDatabaseUrlError();
  }
  if (url.port.length > 0) {
    const port = Number(url.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new LocalDatabaseUrlError();
  }
  return value as LocalDatabaseUrl;
}

/** Discover the normative numbered SQL files and make any ordering drift terminal. */
export function discoverMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY): readonly MigrationFile[] {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { encoding: "utf8", withFileTypes: true });
  } catch {
    throw new MigrationManifestError("Migration directory is unavailable");
  }

  const migrations = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = MIGRATION_FILE.exec(entry.name);
      if (match === null) throw new MigrationManifestError("Migration filename is not numbered and normalized");
      const version = Number.parseInt(match[1]!, 10);
      const path = join(directory, entry.name);
      return Object.freeze({
        version,
        filename: entry.name,
        path,
        checksumSha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    })
    .sort((left, right) => left.version - right.version);

  if (migrations.length === 0) throw new MigrationManifestError("Migration manifest is empty");
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) throw new MigrationManifestError("Migration versions must be contiguous from 0001");
  }
  return Object.freeze(migrations);
}

/** Database writers accept only UUIDv7 values supplied by the application layer. */
export function assertApplicationUuidV7(value: unknown, field = "id"): UuidV7 {
  return parseUuidV7(value, field);
}

/** Apply a contiguous prefix of the normative migrations against a local-only database. */
export function applyLocalMigrations(options: LocalMigrationOptions): MigrationApplyResult {
  const databaseUrl = parseLocalDatabaseUrl(options.databaseUrl);
  const migrations = discoverMigrations(options.migrationsDirectory);
  const targetVersion = normalizeTargetVersion(options.targetVersion, migrations.at(-1)!.version);
  const executor = options.executor ?? executePsql;
  const psqlPath = normalizePsqlPath(options.psqlPath);
  const releaseLock = acquireLocalLock(databaseUrl);

  try {
    executeSql(executor, psqlPath, databaseUrl, HISTORY_BOOTSTRAP_SQL, "migration history bootstrap");
    const history = readAppliedMigrationsWith(executor, psqlPath, databaseUrl);
    assertHistoryPrefix(history, migrations);
    if (history.length > targetVersion) {
      throw new MigrationStateError("Requested migration target is behind applied history");
    }

    const applied: AppliedMigration[] = [];
    for (const migration of migrations) {
      if (migration.version <= history.length || migration.version > targetVersion) continue;
      assertMigrationHasNotBeenAppliedWithoutReceipt(executor, psqlPath, databaseUrl, migration.version);
      executeFile(executor, psqlPath, databaseUrl, migration.path, `migration ${migration.filename}`);
      executeSql(executor, psqlPath, databaseUrl, insertHistorySql(migration), `migration receipt ${migration.filename}`);
      applied.push(toAppliedMigration(migration));
    }
    const finalHistory = readAppliedMigrationsWith(executor, psqlPath, databaseUrl);
    assertHistoryPrefix(finalHistory, migrations);
    return Object.freeze({ applied: Object.freeze(applied), history: Object.freeze(finalHistory) });
  } finally {
    releaseLock();
  }
}

/** Fail if migration checksums or required PostgreSQL catalog invariants drift. */
export function checkLocalSchemaDrift(options: Omit<LocalMigrationOptions, "targetVersion">): SchemaDriftReport {
  const databaseUrl = parseLocalDatabaseUrl(options.databaseUrl);
  const migrations = discoverMigrations(options.migrationsDirectory);
  const executor = options.executor ?? executePsql;
  const psqlPath = normalizePsqlPath(options.psqlPath);
  const releaseLock = acquireLocalLock(databaseUrl);
  try {
    assertMigrationHistoryExists(executor, psqlPath, databaseUrl);
    const history = readAppliedMigrationsWith(executor, psqlPath, databaseUrl);
    assertHistoryExact(history, migrations);

    const catalogStatus = querySql(executor, psqlPath, databaseUrl, CATALOG_ASSERTION_SQL, "schema catalog verification").trim();
    if (catalogStatus !== "ok") {
      const diagnostics = querySql(executor, psqlPath, databaseUrl, CATALOG_DIAGNOSTIC_SQL, "schema catalog diagnostics").trim();
      throw new MigrationDriftError(`Database catalog does not match the normative migration contract: ${diagnostics}`);
    }
    const catalog = querySql(executor, psqlPath, databaseUrl, CATALOG_FINGERPRINT_SQL, "schema catalog fingerprint");
    return Object.freeze({
      migrationCount: history.length,
      catalogFingerprint: createHash("sha256").update(catalog.trim()).digest("hex"),
    });
  } finally {
    releaseLock();
  }
}

export function readAppliedMigrations(options: Omit<LocalMigrationOptions, "targetVersion">): readonly AppliedMigration[] {
  const databaseUrl = parseLocalDatabaseUrl(options.databaseUrl);
  const executor = options.executor ?? executePsql;
  const psqlPath = normalizePsqlPath(options.psqlPath);
  const releaseLock = acquireLocalLock(databaseUrl);
  try {
    assertMigrationHistoryExists(executor, psqlPath, databaseUrl);
    return Object.freeze(readAppliedMigrationsWith(executor, psqlPath, databaseUrl));
  } finally {
    releaseLock();
  }
}

function normalizeTargetVersion(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new MigrationStateError("Migration target version is outside the manifest");
  }
  return value;
}

function normalizePsqlPath(value: string | undefined): string {
  if (value === undefined) return "psql";
  if (value.length === 0 || value.trim() !== value) throw new MigrationStateError("psql path is invalid");
  return value;
}

function toAppliedMigration(migration: MigrationFile): AppliedMigration {
  return Object.freeze({
    version: migration.version,
    filename: migration.filename,
    checksumSha256: migration.checksumSha256,
  });
}

function assertHistoryPrefix(history: readonly AppliedMigration[], migrations: readonly MigrationFile[]): void {
  if (history.length > migrations.length) throw new MigrationDriftError("Migration history exceeds the local manifest");
  for (const [index, applied] of history.entries()) {
    const expected = migrations[index];
    if (
      expected === undefined
      || applied.version !== expected.version
      || applied.filename !== expected.filename
      || applied.checksumSha256 !== expected.checksumSha256
    ) {
      throw new MigrationDriftError("Migration history does not match the local manifest");
    }
  }
}

function assertHistoryExact(history: readonly AppliedMigration[], migrations: readonly MigrationFile[]): void {
  assertHistoryPrefix(history, migrations);
  if (history.length !== migrations.length) throw new MigrationDriftError("Database has unapplied migrations");
}

function assertMigrationHasNotBeenAppliedWithoutReceipt(
  executor: PsqlExecutor,
  psqlPath: string,
  databaseUrl: LocalDatabaseUrl,
  version: number,
): void {
  const sentinel = SENTINEL_SQL_BY_VERSION[version];
  if (sentinel === undefined) throw new MigrationManifestError("Migration sentinel is missing");
  const result = querySql(executor, psqlPath, databaseUrl, sentinel, "unrecorded migration check").trim();
  if (result === "1" || result === "t" || result === "true") {
    throw new MigrationStateError("Database contains an unrecorded migration state and requires manual repair");
  }
}

function assertMigrationHistoryExists(
  executor: PsqlExecutor,
  psqlPath: string,
  databaseUrl: LocalDatabaseUrl,
): void {
  const status = querySql(executor, psqlPath, databaseUrl, HISTORY_EXISTS_SQL, "migration history presence check").trim();
  if (status !== "1" && status !== "t" && status !== "true") {
    throw new MigrationStateError("Migration history is absent; run db:migrate before reading or checking drift");
  }
}

function readAppliedMigrationsWith(
  executor: PsqlExecutor,
  psqlPath: string,
  databaseUrl: LocalDatabaseUrl,
): AppliedMigration[] {
  const output = querySql(executor, psqlPath, databaseUrl, HISTORY_QUERY_SQL, "migration history read").trim();
  if (output.length === 0) return [];
  return output.split("\n").map((line) => {
    const [versionText, filename, checksumSha256, ...extra] = line.split("\t");
    const version = Number(versionText);
    if (
      extra.length > 0
      || filename === undefined
      || checksumSha256 === undefined
      || !Number.isSafeInteger(version)
      || version < 1
      || !MIGRATION_FILE.test(filename)
      || !/^[0-9a-f]{64}$/.test(checksumSha256)
    ) {
      throw new MigrationDriftError("Migration history contains an invalid receipt");
    }
    return Object.freeze({ version, filename, checksumSha256 });
  });
}

function insertHistorySql(migration: MigrationFile): string {
  return `INSERT INTO ${MIGRATION_HISTORY_TABLE} (version, filename, checksum_sha256) VALUES (${migration.version}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(migration.checksumSha256)});`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function executeFile(
  executor: PsqlExecutor,
  psqlPath: string,
  databaseUrl: LocalDatabaseUrl,
  file: string,
  phase: string,
): void {
  const result = executor(Object.freeze({
    executable: psqlPath,
    args: Object.freeze([...basePsqlArgs(databaseUrl), "--file", file]),
  }));
  if (result.status !== 0) throw new LocalDatabaseCommandError(phase);
}

function executeSql(
  executor: PsqlExecutor,
  psqlPath: string,
  databaseUrl: LocalDatabaseUrl,
  sql: string,
  phase: string,
): void {
  querySql(executor, psqlPath, databaseUrl, sql, phase);
}

function querySql(
  executor: PsqlExecutor,
  psqlPath: string,
  databaseUrl: LocalDatabaseUrl,
  sql: string,
  phase: string,
): string {
  const result = executor(Object.freeze({
    executable: psqlPath,
    args: Object.freeze([...basePsqlArgs(databaseUrl), "--tuples-only", "--no-align", "--command", sql]),
  }));
  if (result.status !== 0) throw new LocalDatabaseCommandError(phase);
  return result.stdout;
}

function basePsqlArgs(databaseUrl: LocalDatabaseUrl): string[] {
  return ["--no-psqlrc", "--no-password", "--set", "ON_ERROR_STOP=1", "--dbname", databaseUrl];
}

/**
 * Remove inherited libpq connection configuration so local commands cannot
 * silently borrow a password, service, host, or TLS configuration.
 */
export function createSanitizedPsqlEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["LANG", "LC_ALL", "LC_CTYPE", "PATH", "TEMP", "TMP", "TMPDIR", "TZ"]) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  // libpq otherwise falls back to ~/.pgpass, service files, or cached GSS credentials.
  environment.PGPASSFILE = "/dev/null";
  environment.PGSERVICEFILE = "/dev/null";
  environment.PGSSLMODE = "disable";
  environment.PGGSSENCMODE = "disable";
  environment.PGGSSDELEGATION = "0";
  environment.PGCHANNELBINDING = "disable";
  return environment;
}

function executePsql(command: PsqlCommand): PsqlResult {
  const result = spawnSync(command.executable, command.args, {
    encoding: "utf8",
    env: createSanitizedPsqlEnvironment(),
  });
  return Object.freeze({
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
}

function acquireLocalLock(databaseUrl: LocalDatabaseUrl): () => void {
  const directory = join(tmpdir(), LOCAL_LOCK_NAMESPACE);
  mkdirSync(directory, { recursive: true });
  const fingerprint = createHash("sha256").update(localDatabaseLockIdentity(databaseUrl)).digest("hex");
  const lockPath = join(directory, `${fingerprint}.lock`);
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch {
    throw new MigrationStateError("A local migration lock is already held and requires inspection");
  }
  try {
    writeFileSync(descriptor, "local migration runner\n", "utf8");
  } catch {
    closeSync(descriptor);
    unlinkSync(lockPath);
    throw new MigrationStateError("Unable to initialize the local migration lock");
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    unlinkSync(lockPath);
  };
}

function localDatabaseLockIdentity(databaseUrl: LocalDatabaseUrl): string {
  const url = new URL(databaseUrl);
  // Loopback aliases intentionally share a lock. This serializes runner
  // operations against one local database even when callers spell its URL differently.
  return `${LOCAL_LOCK_NAMESPACE}\u0000loopback\u0000${url.port || "5432"}\u0000${url.pathname.slice(1)}`;
}
