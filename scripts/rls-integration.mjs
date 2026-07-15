import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const database = await import(new URL("../packages/database/dist/index.js", import.meta.url));
const domain = await import(new URL("../packages/domain/dist/index.js", import.meta.url));
const externalDatabaseUrl = process.env.AXTRO_LOCAL_DATABASE_URL;
const postgresBin = resolvePostgresBin();
const psqlPath = process.env.AXTRO_PSQL_PATH ?? (postgresBin === null ? "psql" : join(postgresBin, "psql"));
const fixture = createFixture();
const developmentSeedScript = fileURLToPath(new URL("./development-seed.mjs", import.meta.url));
const developmentTenantAlpha = "0197c000-0000-7000-8000-000000000001";
const developmentTenantBeta = "0197c000-0000-7000-8000-000000000002";

const TENANT_TABLES = [
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
];

let cluster;
let temporaryDirectory;
let baseDatabaseUrl;
let testDatabaseName;
let runtimeRole;
let primaryError;
let cleanupStarted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    const cleanupErrors = cleanupResources();
    if (cleanupErrors.length > 0) console.error(`RLS INTEGRATION CLEANUP FAILED: ${cleanupErrors.join("; ")}`);
    process.exit(1);
  });
}

try {
  baseDatabaseUrl = await resolveBaseDatabaseUrl();
  const suffix = `${process.pid}_${Date.now()}`;
  testDatabaseName = `axtro_m0_rls_${suffix}`;
  runtimeRole = `axtro_m0_runtime_${suffix}`;
  createDatabase(baseDatabaseUrl, psqlPath, testDatabaseName);
  const testDatabaseUrl = databaseUrlFor(baseDatabaseUrl, testDatabaseName);
  const migrated = database.applyLocalMigrations({ databaseUrl: testDatabaseUrl, psqlPath });
  assert.equal(migrated.history.length, 9);
  assertSucceeded(runDevelopmentSeed(testDatabaseUrl), "deterministic development seed");
  assertSucceeded(runSql(testDatabaseUrl, psqlPath, seedSql(fixture)), "deterministic tenant fixture seed");
  assertSucceeded(provisionRuntimeRole(baseDatabaseUrl, testDatabaseUrl, psqlPath, runtimeRole), "least-privilege runtime role");
  const runtimeUrl = databaseUrlWithUser(testDatabaseUrl, runtimeRole);

  assert.notEqual(runDevelopmentSeed(runtimeUrl).status, 0, "runtime role must not execute the development seed");
  assertDevelopmentSeedIsolation(runtimeUrl);
  assertRlsMatrix(runtimeUrl);
  assertServiceIdentityIsolation(runtimeUrl);
  assertMissingContextFailsClosed(runtimeUrl);
  assertPoolContextReset(runtimeUrl);
  assertCrossTenantWritesAreDenied(runtimeUrl, testDatabaseUrl);
  assertCrossTenantRelationshipsAreRejected(runtimeUrl);
  assertAppendOnlyTablesRejectMutation(runtimeUrl);
  assertHistoricalSessionReferencesRejectDeletion(testDatabaseUrl);
  assertRuntimeRoleCannotAccessGlobalCatalogs(runtimeUrl);

  console.log("RLS INTEGRATION PASSED: matrix, missing context, pool reset, foreign keys, append-only, cache/object namespaces");
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = cleanupResources();
  if (cleanupErrors.length > 0) {
    console.error(`RLS INTEGRATION CLEANUP FAILED: ${cleanupErrors.join("; ")}`);
    if (primaryError === undefined) throw new Error("RLS integration cleanup failed");
  }
}

async function resolveBaseDatabaseUrl() {
  if (externalDatabaseUrl !== undefined) {
    if (process.env.AXTRO_ALLOW_LOCAL_DATABASE_URL !== "1") {
      throw new Error("AXTRO_LOCAL_DATABASE_URL requires AXTRO_ALLOW_LOCAL_DATABASE_URL=1");
    }
    return database.parseLocalDatabaseUrl(externalDatabaseUrl);
  }
  if (postgresBin === null) throw new Error("PostgreSQL 17 binaries are required for the local RLS integration test");
  assertPostgres17WithPgvector(postgresBin);
  temporaryDirectory = mkdtempSync(join(tmpdir(), "axtro-dhos-v2-rls-postgres-"));
  const port = await reserveLocalPort();
  run(join(postgresBin, "initdb"), [
    "--no-locale",
    "--encoding=UTF8",
    "--username=postgres",
    "--auth=trust",
    "--pgdata", temporaryDirectory,
  ], "cluster initialization");
  run(join(postgresBin, "pg_ctl"), [
    "--pgdata", temporaryDirectory,
    "--log", join(temporaryDirectory, "postgres.log"),
    "--options", `-h 127.0.0.1 -p ${port}`,
    "--wait",
    "start",
  ], "cluster startup");
  cluster = { pgCtl: join(postgresBin, "pg_ctl"), dataDirectory: temporaryDirectory };
  return `postgresql://postgres@127.0.0.1:${port}/postgres`;
}

function provisionRuntimeRole(baseUrl, databaseUrl, executable, role) {
  const roleIdentifier = quoteIdentifier(role);
  const databaseIdentifier = quoteIdentifier(testDatabaseName);
  const createRole = runSql(baseUrl, executable, `CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier};`);
  if (createRole.status !== 0) return createRole;
  return runSql(databaseUrl, executable, `
    GRANT USAGE ON SCHEMA public, app TO ${roleIdentifier};
    GRANT USAGE ON TYPE app.uuid_v7 TO ${roleIdentifier};
    GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO ${roleIdentifier};
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${TENANT_TABLES.join(", ")} TO ${roleIdentifier};
    REVOKE ALL ON TABLE public.axtro_schema_migrations FROM ${roleIdentifier};
  `);
}

function assertRlsMatrix(runtimeUrl) {
  for (const table of TENANT_TABLES) {
    const predicate = table === "tenants" ? `id = '${fixture.tenantAlpha}'` : `tenant_id = '${fixture.tenantAlpha}'`;
    const alpha = withTenant(runtimeUrl, fixture.tenantAlpha, `SELECT count(*) FROM ${table} WHERE ${predicate};`);
    assertSucceeded(alpha, `tenant alpha reads ${table}`);
    assert.equal(Number(alpha.stdout.trim()) >= 1, true, `tenant alpha should read its own ${table} row`);
    const beta = withTenant(runtimeUrl, fixture.tenantBeta, `SELECT count(*) FROM ${table} WHERE ${predicate};`);
    assertSucceeded(beta, `tenant beta reads ${table}`);
    assert.equal(beta.stdout.trim(), "0", `tenant beta must not read tenant alpha ${table}`);
  }
}

function assertMissingContextFailsClosed(runtimeUrl) {
  const read = runSql(runtimeUrl, psqlPath, "SELECT count(*) FROM sessions;");
  assertSucceeded(read, "missing context read");
  assert.equal(read.stdout.trim(), "0");
  const write = runSql(runtimeUrl, psqlPath, `INSERT INTO contact_profiles (tenant_id, id, display_name) VALUES ('${fixture.tenantAlpha}', '${fixture.missingContextWrite}', 'forbidden');`);
  assert.notEqual(write.status, 0, "missing tenant context must reject writes");
}

function assertServiceIdentityIsolation(runtimeUrl) {
  const own = withTenant(
    runtimeUrl,
    fixture.tenantAlpha,
    `SELECT id::text FROM service_identities WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.serviceIdentityAlpha}';`,
  );
  assertSucceeded(own, "tenant alpha reads its service identity");
  assert.equal(own.stdout.trim(), fixture.serviceIdentityAlpha);
  const crossTenant = withTenant(
    runtimeUrl,
    fixture.tenantBeta,
    `SELECT id::text FROM service_identities WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.serviceIdentityAlpha}';`,
  );
  assertSucceeded(crossTenant, "tenant beta service identity query");
  assert.equal(crossTenant.stdout.trim(), "", "tenant beta must not resolve tenant alpha service identity");
}

function assertDevelopmentSeedIsolation(runtimeUrl) {
  const alphaPack = withTenant(
    runtimeUrl,
    developmentTenantAlpha,
    `SELECT count(*) FROM role_pack_installations WHERE tenant_id = '${developmentTenantAlpha}' AND role_pack_id = 'sales-closer';`,
  );
  assertSucceeded(alphaPack, "development tenant alpha reads its Sales Closer pack");
  assert.equal(alphaPack.stdout.trim(), "1");
  const betaPack = withTenant(
    runtimeUrl,
    developmentTenantBeta,
    `SELECT count(*) FROM role_pack_installations WHERE tenant_id = '${developmentTenantBeta}' AND role_pack_id = 'sales-closer';`,
  );
  assertSucceeded(betaPack, "development tenant beta reads its Sales Closer pack");
  assert.equal(betaPack.stdout.trim(), "1");
  const betaProvider = withTenant(
    runtimeUrl,
    developmentTenantBeta,
    `SELECT count(*) FROM provider_connections WHERE tenant_id = '${developmentTenantBeta}' AND provider_id IN ('fake-realtime', 'fake-catalog');`,
  );
  assertSucceeded(betaProvider, "development tenant beta reads its fake providers");
  assert.equal(betaProvider.stdout.trim(), "2");
  const betaIdentity = withTenant(
    runtimeUrl,
    developmentTenantBeta,
    `SELECT count(*) FROM service_identities WHERE tenant_id = '${developmentTenantBeta}' AND name = 'tenant-zero-workflow';`,
  );
  assertSucceeded(betaIdentity, "development tenant beta reads its service identity");
  assert.equal(betaIdentity.stdout.trim(), "1");
  const betaAgent = withTenant(
    runtimeUrl,
    developmentTenantBeta,
    `SELECT count(*) FROM agents WHERE tenant_id = '${developmentTenantBeta}' AND name = 'Tenant Zero Sales Closer';`,
  );
  assertSucceeded(betaAgent, "development tenant beta reads its agent");
  assert.equal(betaAgent.stdout.trim(), "1");
  const betaCannotReadAlphaPack = withTenant(
    runtimeUrl,
    developmentTenantBeta,
    `SELECT count(*) FROM role_pack_installations WHERE tenant_id = '${developmentTenantAlpha}' AND role_pack_id = 'sales-closer';`,
  );
  assertSucceeded(betaCannotReadAlphaPack, "development tenant beta cross-tenant pack query");
  assert.equal(betaCannotReadAlphaPack.stdout.trim(), "0");
  const betaCannotReadAlphaProvider = withTenant(
    runtimeUrl,
    developmentTenantBeta,
    `SELECT count(*) FROM provider_connections WHERE tenant_id = '${developmentTenantAlpha}' AND provider_id = 'fake-realtime';`,
  );
  assertSucceeded(betaCannotReadAlphaProvider, "development tenant beta cross-tenant provider query");
  assert.equal(betaCannotReadAlphaProvider.stdout.trim(), "0");
  const alphaCannotReadBetaIdentity = withTenant(
    runtimeUrl,
    developmentTenantAlpha,
    `SELECT count(*) FROM service_identities WHERE tenant_id = '${developmentTenantBeta}' AND name = 'tenant-zero-workflow';`,
  );
  assertSucceeded(alphaCannotReadBetaIdentity, "development tenant alpha cross-tenant identity query");
  assert.equal(alphaCannotReadBetaIdentity.stdout.trim(), "0");
  const alphaCannotReadBetaAgent = withTenant(
    runtimeUrl,
    developmentTenantAlpha,
    `SELECT count(*) FROM agents WHERE tenant_id = '${developmentTenantBeta}' AND name = 'Tenant Zero Sales Closer';`,
  );
  assertSucceeded(alphaCannotReadBetaAgent, "development tenant alpha cross-tenant agent query");
  assert.equal(alphaCannotReadBetaAgent.stdout.trim(), "0");
}

function assertPoolContextReset(runtimeUrl) {
  const result = runSql(runtimeUrl, psqlPath, `
    BEGIN;
    SELECT set_config('app.tenant_id', '${fixture.tenantAlpha}', true);
    SELECT count(*) FROM sessions WHERE tenant_id = '${fixture.tenantAlpha}';
    COMMIT;
    SELECT CASE WHEN app.current_tenant_id() IS NULL THEN 'reset' ELSE 'leaked' END;
    SELECT count(*) FROM sessions WHERE tenant_id = '${fixture.tenantAlpha}';
    BEGIN;
    SELECT set_config('app.tenant_id', '${fixture.tenantBeta}', true);
    SELECT count(*) FROM sessions WHERE tenant_id = '${fixture.tenantAlpha}';
    ROLLBACK;
    SELECT CASE WHEN app.current_tenant_id() IS NULL THEN 'reset' ELSE 'leaked' END;
  `);
  assertSucceeded(result, "transaction-local tenant context reset");
  assert.deepEqual(result.stdout.trim().split("\n"), [fixture.tenantAlpha, "3", "reset", "0", fixture.tenantBeta, "0", "reset"]);
}

function assertCrossTenantWritesAreDenied(runtimeUrl, adminUrl) {
  const ownWrite = withTenant(runtimeUrl, fixture.tenantBeta, `INSERT INTO contact_profiles (tenant_id, id, display_name) VALUES ('${fixture.tenantBeta}', '${fixture.tenantBetaContact}', 'Tenant Beta');`);
  assertSucceeded(ownWrite, "tenant beta own insert");
  const crossInsert = withTenant(runtimeUrl, fixture.tenantBeta, `INSERT INTO contact_profiles (tenant_id, id, display_name) VALUES ('${fixture.tenantAlpha}', '${fixture.crossTenantWrite}', 'forbidden');`);
  assert.notEqual(crossInsert.status, 0, "tenant beta must not insert a tenant alpha row");
  const crossUpdate = withTenant(runtimeUrl, fixture.tenantBeta, `UPDATE contact_profiles SET display_name = 'tampered' WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.contactAlpha}' RETURNING id;`);
  assertSucceeded(crossUpdate, "cross-tenant update must be filtered");
  assert.equal(crossUpdate.stdout.trim(), "");
  const crossDelete = withTenant(runtimeUrl, fixture.tenantBeta, `DELETE FROM contact_profiles WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.contactAlpha}' RETURNING id;`);
  assertSucceeded(crossDelete, "cross-tenant delete must be filtered");
  assert.equal(crossDelete.stdout.trim(), "");
  const source = runSql(adminUrl, psqlPath, `SELECT display_name FROM contact_profiles WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.contactAlpha}';`);
  assertSucceeded(source, "admin confirms tenant alpha row");
  assert.equal(source.stdout.trim(), "Tenant Alpha");
}

function assertCrossTenantRelationshipsAreRejected(runtimeUrl) {
  const crossSessionAgent = withTenant(runtimeUrl, fixture.tenantBeta, `INSERT INTO sessions (tenant_id, id, agent_id, role_pack_id, role_pack_version, channel_type, status) VALUES ('${fixture.tenantBeta}', '${fixture.crossSession}', '${fixture.agentAlpha}', 'sales-closer', '1.0.0', 'api', 'ready');`);
  assert.notEqual(crossSessionAgent.status, 0, "cross-tenant composite agent foreign key must reject a session");
  const crossForeignKey = withTenant(runtimeUrl, fixture.tenantBeta, `INSERT INTO session_participants (tenant_id, id, session_id, participant_type, display_name) VALUES ('${fixture.tenantBeta}', '${fixture.crossParticipant}', '${fixture.sessionAlpha}', 'customer', 'cross tenant');`);
  assert.notEqual(crossForeignKey.status, 0, "cross-tenant composite foreign key must reject a participant");
  const floorOtherSession = withTenant(runtimeUrl, fixture.tenantAlpha, `UPDATE sessions SET active_presenter_id = '${fixture.participantAlphaOtherSession}' WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.sessionAlpha}';`);
  assert.notEqual(floorOtherSession.status, 0, "presenter from another session must fail at commit");
  const turnOtherSession = withTenant(runtimeUrl, fixture.tenantAlpha, `INSERT INTO conversation_turns (tenant_id, id, session_id, participant_id, turn_index, role, language, started_at) VALUES ('${fixture.tenantAlpha}', '${fixture.crossTurn}', '${fixture.sessionAlpha}', '${fixture.participantAlphaOtherSession}', 99, 'participant', 'en', now());`);
  assert.notEqual(turnOtherSession.status, 0, "turn participant must belong to the same session");
  const handoffOtherSession = withTenant(runtimeUrl, fixture.tenantAlpha, `INSERT INTO handoffs (tenant_id, id, session_id, from_presenter_id, target_type, reason_code, priority, packet_document, status, requested_at) VALUES ('${fixture.tenantAlpha}', '${fixture.crossHandoff}', '${fixture.sessionAlpha}', '${fixture.participantAlphaOtherSession}', 'human', 'fixture', 'normal', '{}'::jsonb, 'requested', now());`);
  assert.notEqual(handoffOtherSession.status, 0, "handoff presenter must belong to the same session");
  const crossTenantCostSession = withTenant(runtimeUrl, fixture.tenantBeta, `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at) VALUES ('${fixture.tenantBeta}', '${fixture.crossCostSession}', '${fixture.sessionAlpha}', 'fake-realtime', 'model', 'token', 1, 0.1, 0.1, 'estimated', now());`);
  assert.notEqual(crossTenantCostSession.status, 0, "cost event session must belong to the same tenant");
  const crossTenantCostReconciliation = withTenant(runtimeUrl, fixture.tenantBeta, `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${fixture.tenantBeta}', '${fixture.crossCost}', NULL, 'fake-realtime', 'model', 'token', 1, 0.1, 0.1, 'measured', now(), '${fixture.costAlpha}');`);
  assert.notEqual(crossTenantCostReconciliation.status, 0, "cost reconciliation must not reference another tenant's evidence");
  const matchingMeasuredCost = withTenant(runtimeUrl, fixture.tenantAlpha, `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${fixture.tenantAlpha}', '${fixture.costMeasuredAlpha}', '${fixture.sessionAlpha}', 'fake-realtime', 'model', 'token', 1, 0.1, 0.1, 'measured', now(), '${fixture.costAlpha}');`);
  assertSucceeded(matchingMeasuredCost, "matching measured cost reconciliation");
  const measuredToMeasured = withTenant(runtimeUrl, fixture.tenantAlpha, `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${fixture.tenantAlpha}', '${fixture.costInvalidReconciliation}', '${fixture.sessionAlpha}', 'fake-realtime', 'model', 'token', 1, 0.1, 0.1, 'measured', now(), '${fixture.costMeasuredAlpha}');`);
  assert.notEqual(measuredToMeasured.status, 0, "cost reconciliation target must be estimated evidence");
  const mismatchedCostDimension = withTenant(runtimeUrl, fixture.tenantAlpha, `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${fixture.tenantAlpha}', '${fixture.costInvalidDimension}', '${fixture.sessionAlpha}', 'fake-realtime', 'tts', 'token', 1, 0.1, 0.1, 'measured', now(), '${fixture.costAlpha}');`);
  assert.notEqual(mismatchedCostDimension.status, 0, "cost reconciliation must retain matching attribution dimensions");
}

function assertAppendOnlyTablesRejectMutation(runtimeUrl) {
  const mutations = [
    ["session_timeline", fixture.timelineAlpha, "UPDATE session_timeline SET event_type = 'tampered'"],
    ["consent_evidence", fixture.consentAlpha, "UPDATE consent_evidence SET status = 'denied'"],
    ["disclosure_records", fixture.disclosureAlpha, "UPDATE disclosure_records SET acknowledged = true"],
    ["tool_receipts", fixture.receiptAlpha, "UPDATE tool_receipts SET status = 'failed'"],
    ["audit_log", fixture.auditAlpha, "UPDATE audit_log SET outcome = 'tampered'"],
    ["cost_events", fixture.costAlpha, "UPDATE cost_events SET amount_usd = 999"],
  ];
  for (const [table, id, statement] of mutations) {
    const result = withTenant(runtimeUrl, fixture.tenantAlpha, `${statement} WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${id}';`);
    assert.notEqual(result.status, 0, `${table} must reject updates`);
  }
  const deletion = withTenant(runtimeUrl, fixture.tenantAlpha, `DELETE FROM session_timeline WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.timelineAlpha}';`);
  assert.notEqual(deletion.status, 0, "session_timeline must reject deletes");
  const costDeletion = withTenant(runtimeUrl, fixture.tenantAlpha, `DELETE FROM cost_events WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.costAlpha}';`);
  assert.notEqual(costDeletion.status, 0, "cost_events must reject deletes");
}

function assertHistoricalSessionReferencesRejectDeletion(adminUrl) {
  const deletion = runSql(adminUrl, psqlPath, `DELETE FROM sessions WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${fixture.sessionForDeletion}';`);
  assert.notEqual(deletion.status, 0, "session deletion must reject mutation of historical references");
  for (const [table, id] of [["cost_events", fixture.costForDeletion], ["evaluation_runs", fixture.evaluationForDeletion]]) {
    const result = runSql(adminUrl, psqlPath, `SELECT tenant_id::text || ':' || session_id::text FROM ${table} WHERE tenant_id = '${fixture.tenantAlpha}' AND id = '${id}';`);
    assertSucceeded(result, `${table} retains its original session reference`);
    assert.equal(result.stdout.trim(), `${fixture.tenantAlpha}:${fixture.sessionForDeletion}`);
  }
}

function assertRuntimeRoleCannotAccessGlobalCatalogs(runtimeUrl) {
  const catalogRead = withTenant(runtimeUrl, fixture.tenantAlpha, "SELECT count(*) FROM provider_catalog;");
  assert.notEqual(catalogRead.status, 0, "runtime role must not read global catalogs without an explicit grant");
  const ledgerRead = withTenant(runtimeUrl, fixture.tenantAlpha, "SELECT count(*) FROM public.axtro_schema_migrations;");
  assert.notEqual(ledgerRead.status, 0, "runtime role must not access migration receipts");
}

function withTenant(databaseUrl, tenantId, sql) {
  return runSql(databaseUrl, psqlPath, `BEGIN; SET LOCAL app.tenant_id = '${tenantId}'; ${sql} COMMIT;`);
}

function seedSql(f) {
  const hash = "a".repeat(64);
  return `
    INSERT INTO tenants (id, slug, legal_name, status, home_region, default_language, default_timezone) VALUES
      ('${f.tenantAlpha}', 'tenant-alpha', 'Tenant Alpha', 'active', 'local', 'en', 'UTC'),
      ('${f.tenantBeta}', 'tenant-beta', 'Tenant Beta', 'active', 'local', 'en', 'UTC');
    INSERT INTO tenant_settings (tenant_id) VALUES ('${f.tenantAlpha}');
    INSERT INTO service_identities (tenant_id, id, name, identity_type, status) VALUES ('${f.tenantAlpha}', '${f.serviceIdentityAlpha}', 'runtime', 'service', 'active');
    INSERT INTO agents (tenant_id, id, name, role_type, status, disclosure_profile_id) VALUES
      ('${f.tenantAlpha}', '${f.agentAlpha}', 'Alpha Agent', 'sales_closer', 'active', 'default'),
      ('${f.tenantBeta}', '${f.agentBeta}', 'Beta Agent', 'sales_closer', 'active', 'default');
    INSERT INTO agent_deployments (tenant_id, id, agent_id, environment, version, configuration, status) VALUES ('${f.tenantAlpha}', '${f.deploymentAlpha}', '${f.agentAlpha}', 'development', '1.0.0', '{}'::jsonb, 'active');
    INSERT INTO role_pack_installations (tenant_id, id, role_pack_id, version, manifest_checksum, status) VALUES ('${f.tenantAlpha}', '${f.rolePackAlpha}', 'sales-closer', '1.0.0', '${hash}', 'active');
    INSERT INTO skill_pack_installations (tenant_id, id, skill_pack_id, version, manifest_checksum, status) VALUES ('${f.tenantAlpha}', '${f.skillPackAlpha}', 'qualification', '1.0.0', '${hash}', 'active');
    INSERT INTO provider_connections (tenant_id, id, provider_id, region, secret_handle, status) VALUES ('${f.tenantAlpha}', '${f.providerConnectionAlpha}', 'fake-realtime', 'local', 'ref_fake_alpha', 'active');
    INSERT INTO contact_profiles (tenant_id, id, display_name) VALUES ('${f.tenantAlpha}', '${f.contactAlpha}', 'Tenant Alpha');
    INSERT INTO sessions (tenant_id, id, agent_id, deployment_id, contact_profile_id, role_pack_id, role_pack_version, channel_type, status) VALUES
      ('${f.tenantAlpha}', '${f.sessionAlpha}', '${f.agentAlpha}', '${f.deploymentAlpha}', '${f.contactAlpha}', 'sales-closer', '1.0.0', 'api', 'ready'),
      ('${f.tenantAlpha}', '${f.sessionAlphaOther}', '${f.agentAlpha}', '${f.deploymentAlpha}', '${f.contactAlpha}', 'sales-closer', '1.0.0', 'api', 'ready'),
      ('${f.tenantAlpha}', '${f.sessionForDeletion}', '${f.agentAlpha}', '${f.deploymentAlpha}', '${f.contactAlpha}', 'sales-closer', '1.0.0', 'api', 'ready'),
      ('${f.tenantBeta}', '${f.sessionBeta}', '${f.agentBeta}', NULL, NULL, 'sales-closer', '1.0.0', 'api', 'ready');
    INSERT INTO session_participants (tenant_id, id, session_id, participant_type, display_name) VALUES
      ('${f.tenantAlpha}', '${f.participantAlpha}', '${f.sessionAlpha}', 'digital_presenter', 'Alpha Presenter'),
      ('${f.tenantAlpha}', '${f.participantAlphaOtherSession}', '${f.sessionAlphaOther}', 'digital_presenter', 'Other Alpha Presenter'),
      ('${f.tenantBeta}', '${f.participantBeta}', '${f.sessionBeta}', 'digital_presenter', 'Beta Presenter');
    INSERT INTO session_state_snapshots (tenant_id, id, session_id, aggregate_version, schema_id, schema_version, state_document, state_hash) VALUES ('${f.tenantAlpha}', '${f.snapshotAlpha}', '${f.sessionAlpha}', 1, 'interaction_session_state', '1.0.0', '{}'::jsonb, '${hash}');
    INSERT INTO session_timeline (tenant_id, id, session_id, aggregate_version, event_type, event_version, event_document, trace_id, correlation_id, occurred_at) VALUES ('${f.tenantAlpha}', '${f.timelineAlpha}', '${f.sessionAlpha}', 1, 'session.created', 1, '{}'::jsonb, 'trace-alpha', '${f.correlationAlpha}', now());
    INSERT INTO conversation_turns (tenant_id, id, session_id, participant_id, turn_index, role, language, started_at) VALUES ('${f.tenantAlpha}', '${f.turnAlpha}', '${f.sessionAlpha}', '${f.participantAlpha}', 0, 'presenter', 'en', now());
    INSERT INTO consent_evidence (tenant_id, id, session_id, subject_ref, consent_type, purpose, status, method, jurisdiction, disclosure_version, evidence_hash, captured_at) VALUES ('${f.tenantAlpha}', '${f.consentAlpha}', '${f.sessionAlpha}', 'subject-alpha', 'essential', 'conversation', 'granted', 'fixture', 'local', '1.0.0', '${hash}', now());
    INSERT INTO disclosure_records (tenant_id, id, session_id, disclosure_type, version, content_hash, delivery_channel, language, delivered_at) VALUES ('${f.tenantAlpha}', '${f.disclosureAlpha}', '${f.sessionAlpha}', 'ai_identity', '1.0.0', '${hash}', 'api', 'en', now());
    INSERT INTO session_health (tenant_id, id, session_id, overall_status, degradation_level, metrics, provider_statuses, observed_at) VALUES ('${f.tenantAlpha}', '${f.healthAlpha}', '${f.sessionAlpha}', 'healthy', 'none', '{}'::jsonb, '{}'::jsonb, now());
    INSERT INTO action_intents (tenant_id, id, session_id, actor_id, actor_type, tool_contract_id, action_name, arguments_document, purpose, idempotency_key, status, requested_at, expires_at) VALUES ('${f.tenantAlpha}', '${f.intentAlpha}', '${f.sessionAlpha}', '${f.actorAlpha}', 'service', 'fixture.read', 'lookup', '{}'::jsonb, 'conversation', 'fixture-alpha', 'completed', now(), now() + interval '1 hour');
    INSERT INTO policy_decisions (tenant_id, id, intent_id, outcome, reasons, policy_version, evaluated_at, expires_at) VALUES ('${f.tenantAlpha}', '${f.decisionAlpha}', '${f.intentAlpha}', 'allow', ARRAY['fixture'], '1.0.0', now(), now() + interval '1 hour');
    INSERT INTO human_approvals (tenant_id, id, intent_id, status, requested_at) VALUES ('${f.tenantAlpha}', '${f.approvalAlpha}', '${f.intentAlpha}', 'approved', now());
    INSERT INTO tool_executions (tenant_id, id, intent_id, provider_id, attempt, status, started_at, completed_at) VALUES ('${f.tenantAlpha}', '${f.executionAlpha}', '${f.intentAlpha}', 'fake-realtime', 1, 'succeeded', now(), now());
    INSERT INTO tool_receipts (tenant_id, id, execution_id, intent_id, status, result_document) VALUES ('${f.tenantAlpha}', '${f.receiptAlpha}', '${f.executionAlpha}', '${f.intentAlpha}', 'succeeded', '{}'::jsonb);
    INSERT INTO handoffs (tenant_id, id, session_id, from_presenter_id, target_type, reason_code, priority, packet_document, status, requested_at) VALUES ('${f.tenantAlpha}', '${f.handoffAlpha}', '${f.sessionAlpha}', '${f.participantAlpha}', 'human', 'fixture', 'normal', '{}'::jsonb, 'requested', now());
    INSERT INTO knowledge_sources (tenant_id, id, source_type, display_name, data_classification, status) VALUES ('${f.tenantAlpha}', '${f.sourceAlpha}', 'fixture', 'Fixture Source', 'internal', 'active');
    INSERT INTO knowledge_versions (tenant_id, id, source_id, version, content_hash) VALUES ('${f.tenantAlpha}', '${f.versionAlpha}', '${f.sourceAlpha}', '1.0.0', '${hash}');
    INSERT INTO knowledge_chunks (tenant_id, id, version_id, chunk_index, content_text) VALUES ('${f.tenantAlpha}', '${f.chunkAlpha}', '${f.versionAlpha}', 0, 'fixture');
    INSERT INTO knowledge_embeddings (tenant_id, id, chunk_id, embedding_model, embedding_dimensions, embedding) VALUES ('${f.tenantAlpha}', '${f.embeddingAlpha}', '${f.chunkAlpha}', 'fake-embedding', 2, '[0.1,0.2]'::vector);
    INSERT INTO workflow_runs (tenant_id, id, command_id, workflow_type, workflow_version, aggregate_type, aggregate_id, idempotency_key, status, current_step, input_document) VALUES ('${f.tenantAlpha}', '${f.workflowAlpha}', '${f.commandAlpha}', 'fixture', '1.0.0', 'session', '${f.sessionAlpha}', 'workflow-alpha', 'completed', 'done', '{}'::jsonb);
    INSERT INTO audit_log (tenant_id, id, actor_id, action, resource_type, resource_id, outcome, trace_id, occurred_at) VALUES ('${f.tenantAlpha}', '${f.auditAlpha}', '${f.actorAlpha}', 'fixture', 'session', '${f.sessionAlpha}', 'allowed', 'trace-alpha', now());
    INSERT INTO events_outbox (tenant_id, id, event_id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, event_document) VALUES ('${f.tenantAlpha}', '${f.outboxAlpha}', '${f.outboxAlpha}', 'session', '${f.sessionAlpha}', 1, 'session.created', 1, jsonb_build_object('schema_version', '2.0.0', 'event_id', '${f.outboxAlpha}', 'event_type', 'session.created', 'event_version', 1, 'aggregate_type', 'interaction_session', 'aggregate_id', '${f.sessionAlpha}', 'aggregate_version', 1, 'tenant_id', '${f.tenantAlpha}', 'session_id', '${f.sessionAlpha}', 'producer', 'rls-fixture', 'trace_id', '0123456789abcdef0123456789abcdef', 'correlation_id', '${f.correlationAlpha}', 'causation_id', NULL, 'data_classification', 'internal', 'payload_json', '{}', 'occurred_at', '2026-07-14T00:00:00.000Z'));
    INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at) VALUES
      ('${f.tenantAlpha}', '${f.costAlpha}', '${f.sessionAlpha}', 'fake-realtime', 'model', 'token', 1, 0.1, 0.1, 'estimated', now()),
      ('${f.tenantAlpha}', '${f.costForDeletion}', '${f.sessionForDeletion}', 'fake-realtime', 'model', 'token', 1, 0.1, 0.1, 'estimated', now());
    INSERT INTO usage_ledger (tenant_id, id, period_start, period_end, metric, quantity, source_event_count) VALUES ('${f.tenantAlpha}', '${f.usageAlpha}', now(), now() + interval '1 hour', 'tokens', 1, 1);
    INSERT INTO evaluation_runs (tenant_id, id, session_id, evaluator_version, scorecard_id, results, status) VALUES
      ('${f.tenantAlpha}', '${f.evaluationAlpha}', '${f.sessionAlpha}', '1.0.0', 'fixture', '{}'::jsonb, 'completed'),
      ('${f.tenantAlpha}', '${f.evaluationForDeletion}', '${f.sessionForDeletion}', '1.0.0', 'fixture', '{}'::jsonb, 'completed');
    INSERT INTO experiment_candidates (tenant_id, id, component, hypothesis, baseline_version, candidate_version, target_metrics, guardrails, status) VALUES ('${f.tenantAlpha}', '${f.experimentAlpha}', 'fixture', 'fixture', '1.0.0', '1.0.1', ARRAY['quality'], ARRAY['safety'], 'accepted');
    INSERT INTO deployment_promotions (tenant_id, id, experiment_id, component, from_version, to_version, environment, rollout_percentage, decision, decision_reasons, rollback_plan, approved_by, promoted_at) VALUES ('${f.tenantAlpha}', '${f.promotionAlpha}', '${f.experimentAlpha}', 'fixture', '1.0.0', '1.0.1', 'development', 100, 'promote', ARRAY['fixture'], 'rollback', '${f.actorAlpha}', now());
  `;
}

function createFixture() {
  let sequence = 0;
  const nextId = () => {
    sequence += 1;
    return domain.uuidV7FromParts(
      1_700_100_000_000 + sequence,
      Uint8Array.from(Array.from({ length: 10 }, (_, index) => (sequence + index + 1) & 0xff)),
    );
  };
  return Object.freeze({
    tenantAlpha: nextId(), tenantBeta: nextId(), serviceIdentityAlpha: nextId(), agentAlpha: nextId(), agentBeta: nextId(),
    deploymentAlpha: nextId(), rolePackAlpha: nextId(), skillPackAlpha: nextId(), providerConnectionAlpha: nextId(), contactAlpha: nextId(),
    sessionAlpha: nextId(), sessionAlphaOther: nextId(), sessionForDeletion: nextId(), sessionBeta: nextId(), participantAlpha: nextId(),
    participantAlphaOtherSession: nextId(), participantBeta: nextId(), snapshotAlpha: nextId(), timelineAlpha: nextId(), correlationAlpha: nextId(),
    turnAlpha: nextId(), consentAlpha: nextId(), disclosureAlpha: nextId(), healthAlpha: nextId(), intentAlpha: nextId(), actorAlpha: nextId(),
    decisionAlpha: nextId(), approvalAlpha: nextId(), executionAlpha: nextId(), receiptAlpha: nextId(), handoffAlpha: nextId(), sourceAlpha: nextId(),
    versionAlpha: nextId(), chunkAlpha: nextId(), embeddingAlpha: nextId(), workflowAlpha: nextId(), commandAlpha: nextId(), auditAlpha: nextId(),
    outboxAlpha: nextId(), costAlpha: nextId(), costForDeletion: nextId(), usageAlpha: nextId(), evaluationAlpha: nextId(), evaluationForDeletion: nextId(),
    experimentAlpha: nextId(), promotionAlpha: nextId(), missingContextWrite: nextId(), tenantBetaContact: nextId(), crossTenantWrite: nextId(),
    crossSession: nextId(), crossParticipant: nextId(), crossTurn: nextId(), crossHandoff: nextId(), crossCostSession: nextId(), crossCost: nextId(),
    costMeasuredAlpha: nextId(), costInvalidReconciliation: nextId(), costInvalidDimension: nextId(),
  });
}

function createDatabase(baseUrl, executable, name) {
  assertSucceeded(runSql(baseUrl, executable, `CREATE DATABASE ${quoteIdentifier(name)};`), "test database creation");
}

function dropDatabase(baseUrl, executable, name) {
  assertSucceeded(runSql(baseUrl, executable, `DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE);`), "test database cleanup");
}

function dropRole(baseUrl, executable, role) {
  assertSucceeded(runSql(baseUrl, executable, `DROP ROLE IF EXISTS ${quoteIdentifier(role)};`), "runtime role cleanup");
}

function databaseUrlFor(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return database.parseLocalDatabaseUrl(url.toString());
}

function databaseUrlWithUser(baseUrl, username) {
  const url = new URL(baseUrl);
  url.username = username;
  url.password = "";
  return database.parseLocalDatabaseUrl(url.toString());
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Local test identifier is invalid");
  return `"${value}"`;
}

function runSql(databaseUrl, executable, sql) {
  return spawnSync(executable, [
    "--no-psqlrc",
    "--no-password",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    databaseUrl,
    "--command",
    sql,
  ], { encoding: "utf8", env: database.createSanitizedPsqlEnvironment(process.env) });
}

function runDevelopmentSeed(databaseUrl) {
  return spawnSync(process.execPath, [developmentSeedScript], {
    encoding: "utf8",
    env: {
      ...database.createSanitizedPsqlEnvironment(process.env),
      AXTRO_ALLOW_LOCAL_DATABASE_URL: "1",
      AXTRO_LOCAL_DATABASE_URL: databaseUrl,
      AXTRO_PSQL_PATH: psqlPath,
    },
  });
}

function assertSucceeded(result, phase) {
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`RLS integration failed during ${phase}${details === "" ? "" : `: ${details}`}`);
  }
}

function resolvePostgresBin() {
  const configured = process.env.AXTRO_POSTGRES_BIN;
  if (configured !== undefined) return configured;
  const homebrewPostgres17 = "/opt/homebrew/opt/postgresql@17/bin";
  return existsSync(join(homebrewPostgres17, "initdb")) ? homebrewPostgres17 : null;
}

function assertPostgres17WithPgvector(postgresDirectory) {
  const version = spawnSync(join(postgresDirectory, "postgres"), ["--version"], { encoding: "utf8", env: database.createSanitizedPsqlEnvironment(process.env) });
  if (version.status !== 0 || !/\b17\./.test(version.stdout ?? "")) throw new Error("AXTRO_POSTGRES_BIN must contain PostgreSQL 17 binaries");
  const sharedir = spawnSync(join(postgresDirectory, "pg_config"), ["--sharedir"], { encoding: "utf8", env: database.createSanitizedPsqlEnvironment(process.env) });
  if (sharedir.status !== 0 || !existsSync(join((sharedir.stdout ?? "").trim(), "extension", "vector.control"))) {
    throw new Error("PostgreSQL 17 with pgvector is required. Install matching pgvector or set AXTRO_POSTGRES_BIN.");
  }
}

function reserveLocalPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => rejectPort(new Error("Unable to reserve a local PostgreSQL port")));
        return;
      }
      server.close((error) => error === undefined ? resolvePort(address.port) : rejectPort(error));
    });
  });
}

function run(executable, args, phase) {
  const result = spawnSync(executable, args, { encoding: "utf8", env: database.createSanitizedPsqlEnvironment(process.env) });
  if (result.status !== 0) throw new Error(`Local PostgreSQL ${phase} failed`);
}

function cleanupResources() {
  if (cleanupStarted) return [];
  cleanupStarted = true;
  const errors = [];
  if (baseDatabaseUrl !== undefined && testDatabaseName !== undefined) {
    try {
      dropDatabase(baseDatabaseUrl, psqlPath, testDatabaseName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "test database cleanup failed");
    }
  }
  if (baseDatabaseUrl !== undefined && runtimeRole !== undefined) {
    try {
      dropRole(baseDatabaseUrl, psqlPath, runtimeRole);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "runtime role cleanup failed");
    }
  }
  let clusterStopped = cluster === undefined;
  if (cluster !== undefined) {
    const stop = spawnSync(cluster.pgCtl, ["--pgdata", cluster.dataDirectory, "--wait", "--mode", "immediate", "stop"], {
      encoding: "utf8",
      env: database.createSanitizedPsqlEnvironment(process.env),
    });
    if (stop.status === 0) clusterStopped = true;
    else errors.push("temporary PostgreSQL cluster did not stop cleanly");
  }
  if (temporaryDirectory !== undefined && clusterStopped) {
    try {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "temporary directory cleanup failed");
    }
  } else if (temporaryDirectory !== undefined) {
    errors.push(`temporary PostgreSQL directory retained for inspection: ${temporaryDirectory}`);
  }
  return errors;
}
