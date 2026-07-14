import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const database = await import(new URL("../packages/database/dist/index.js", import.meta.url));
const domain = await import(new URL("../packages/domain/dist/index.js", import.meta.url));
const externalDatabaseUrl = process.env.AXTRO_LOCAL_DATABASE_URL;
const postgresBin = resolvePostgresBin();
const psqlPath = process.env.AXTRO_PSQL_PATH ?? (postgresBin === null ? "psql" : join(postgresBin, "psql"));

let cluster;
let temporaryDirectory;
let baseDatabaseUrl;
const createdDatabases = [];
let primaryError;
let cleanupStarted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    const cleanupErrors = cleanupResources();
    if (cleanupErrors.length > 0) console.error(`DATABASE INTEGRATION CLEANUP FAILED: ${cleanupErrors.join("; ")}`);
    process.exit(1);
  });
}

try {
  if (externalDatabaseUrl === undefined) {
    if (postgresBin === null) throw new Error("PostgreSQL 17 binaries are required for the local pgvector integration test");
    assertPostgres17WithPgvector(postgresBin);
    temporaryDirectory = mkdtempSync(join(tmpdir(), "axtro-dhos-v2-postgres-"));
    const port = await reserveLocalPort();
    run(join(postgresBin, "initdb"), [
      "--no-locale",
      "--encoding=UTF8",
      "--username=postgres",
      "--auth=trust",
      "--pgdata", temporaryDirectory,
    ], "cluster initialization");
    const logPath = join(temporaryDirectory, "postgres.log");
    run(join(postgresBin, "pg_ctl"), [
      "--pgdata", temporaryDirectory,
      "--log", logPath,
      "--options", `-h 127.0.0.1 -p ${port}`,
      "--wait",
      "start",
    ], "cluster startup");
    cluster = { pgCtl: join(postgresBin, "pg_ctl"), dataDirectory: temporaryDirectory };
    baseDatabaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  } else {
    if (process.env.AXTRO_ALLOW_LOCAL_DATABASE_URL !== "1") {
      throw new Error("AXTRO_LOCAL_DATABASE_URL requires AXTRO_ALLOW_LOCAL_DATABASE_URL=1");
    }
    baseDatabaseUrl = database.parseLocalDatabaseUrl(externalDatabaseUrl);
  }

  const suffix = `${process.pid}_${Date.now()}`;
  const cleanName = `axtro_m0_clean_${suffix}`;
  const upgradeName = `axtro_m0_upgrade_${suffix}`;
  const invalidName = `axtro_m0_invalid_${suffix}`;
  for (const name of [cleanName, upgradeName, invalidName]) {
    createDatabase(baseDatabaseUrl, psqlPath, name);
    createdDatabases.push(name);
  }

  const cleanUrl = databaseUrlFor(baseDatabaseUrl, cleanName);
  const upgradeUrl = databaseUrlFor(baseDatabaseUrl, upgradeName);
  const invalidUrl = databaseUrlFor(baseDatabaseUrl, invalidName);
  const cleanResult = database.applyLocalMigrations({ databaseUrl: cleanUrl, psqlPath });
  assert.equal(cleanResult.applied.length, 8);
  const cleanDrift = database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath });

  const upgradePrelude = database.applyLocalMigrations({ databaseUrl: upgradeUrl, psqlPath, targetVersion: 5 });
  assert.equal(upgradePrelude.history.length, 5);
  const historical = outboxFixture(100);
  assert.equal(runSql(
    upgradeUrl,
    psqlPath,
    `${tenantInsertSql(historical.tenantId, "outbox-upgrade")} ${legacyOutboxInsertSql(historical)}`,
  ).status, 0);
  const upgradeResult = database.applyLocalMigrations({ databaseUrl: upgradeUrl, psqlPath });
  assert.deepEqual(upgradeResult.applied.map((migration) => migration.version), [6, 7, 8]);
  assert.equal(
    queryScalar(
      upgradeUrl,
      psqlPath,
      `SELECT event_id::text FROM events_outbox WHERE tenant_id = '${historical.tenantId}' AND id = '${historical.rowId}';`,
    ),
    historical.eventId,
  );
  const upgradeDrift = database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath });
  assert.equal(cleanDrift.catalogFingerprint, upgradeDrift.catalogFingerprint);
  assert.deepEqual(
    database.readAppliedMigrations({ databaseUrl: cleanUrl, psqlPath }),
    database.readAppliedMigrations({ databaseUrl: upgradeUrl, psqlPath }),
  );

  const validTenantId = domain.uuidV7FromParts(1_700_000_000_000, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(database.assertApplicationUuidV7(validTenantId, "tenant_id"), validTenantId);
  assert.equal(
    runSql(
      cleanUrl,
      psqlPath,
      `INSERT INTO tenants (id, slug, legal_name, status, home_region, default_language, default_timezone) VALUES ('${validTenantId}', 'uuidv7-tenant', 'UUIDv7 Tenant', 'active', 'local', 'en', 'UTC');`,
    ).status,
    0,
  );
  const mismatchedEnvelope = outboxFixture(200, { tenantId: domain.uuidV7FromParts(1_700_000_000_900, Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])) });
  const mismatchedOutboxWrite = runSql(
    cleanUrl,
    psqlPath,
    currentOutboxInsertSql({ ...outboxFixture(201), tenantId: validTenantId, eventDocument: mismatchedEnvelope.eventDocument }),
  );
  assert.notEqual(mismatchedOutboxWrite.status, 0);
  const eventIdentityFixture = outboxFixture(202, { tenantId: validTenantId });
  const wrongEventIdentityWrite = runSql(
    cleanUrl,
    psqlPath,
    currentOutboxInsertSql({
      ...eventIdentityFixture,
      eventDocument: { ...eventIdentityFixture.eventDocument, event_id: fixtureUuid(299) },
    }),
  );
  assert.notEqual(wrongEventIdentityWrite.status, 0);
  const nullTenantFixture = outboxFixture(203, { tenantId: validTenantId });
  assert.notEqual(runSql(
    cleanUrl,
    psqlPath,
    currentOutboxInsertSql({ ...nullTenantFixture, eventDocument: { ...nullTenantFixture.eventDocument, tenant_id: null } }),
  ).status, 0);
  const nullEventFixture = outboxFixture(204, { tenantId: validTenantId });
  assert.notEqual(runSql(
    cleanUrl,
    psqlPath,
    currentOutboxInsertSql({ ...nullEventFixture, eventDocument: { ...nullEventFixture.eventDocument, event_id: null } }),
  ).status, 0);

  const invalidPrelude = database.applyLocalMigrations({ databaseUrl: invalidUrl, psqlPath, targetVersion: 7 });
  assert.equal(invalidPrelude.history.length, 7);
  const invalidFixture = outboxFixture(300);
  assert.equal(runSql(invalidUrl, psqlPath, tenantInsertSql(invalidFixture.tenantId, "outbox-invalid")).status, 0);
  const missingEventDocument = { ...invalidFixture.eventDocument };
  delete missingEventDocument.event_id;
  assert.equal(runSql(
    invalidUrl,
    psqlPath,
    legacyOutboxInsertSql({ ...invalidFixture, eventDocument: missingEventDocument }),
  ).status, 0);
  assert.throws(
    () => database.applyLocalMigrations({ databaseUrl: invalidUrl, psqlPath }),
    database.LocalDatabaseCommandError,
  );
  assert.equal(database.readAppliedMigrations({ databaseUrl: invalidUrl, psqlPath }).length, 7);
  assert.equal(
    queryScalar(
      invalidUrl,
      psqlPath,
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events_outbox' AND column_name = 'event_id');",
    ),
    "f",
  );
  assert.equal(runSql(invalidUrl, psqlPath, "DELETE FROM events_outbox;").status, 0);
  const nullEventDocument = { ...invalidFixture.eventDocument, event_id: null };
  assert.equal(runSql(
    invalidUrl,
    psqlPath,
    legacyOutboxInsertSql({ ...invalidFixture, eventDocument: nullEventDocument }),
  ).status, 0);
  assert.throws(
    () => database.applyLocalMigrations({ databaseUrl: invalidUrl, psqlPath }),
    database.LocalDatabaseCommandError,
  );
  assert.equal(database.readAppliedMigrations({ databaseUrl: invalidUrl, psqlPath }).length, 7);
  assert.equal(runSql(invalidUrl, psqlPath, "DELETE FROM events_outbox;").status, 0);
  const nullTenantDocument = { ...invalidFixture.eventDocument, tenant_id: null };
  assert.equal(runSql(
    invalidUrl,
    psqlPath,
    legacyOutboxInsertSql({ ...invalidFixture, eventDocument: nullTenantDocument }),
  ).status, 0);
  assert.throws(
    () => database.applyLocalMigrations({ databaseUrl: invalidUrl, psqlPath }),
    database.LocalDatabaseCommandError,
  );
  assert.equal(database.readAppliedMigrations({ databaseUrl: invalidUrl, psqlPath }).length, 7);
  assert.equal(runSql(invalidUrl, psqlPath, "DELETE FROM events_outbox;").status, 0);
  const mismatchedHistorical = outboxFixture(301, { tenantId: invalidFixture.tenantId });
  const foreignEnvelope = outboxFixture(302);
  assert.equal(runSql(
    invalidUrl,
    psqlPath,
    legacyOutboxInsertSql({ ...mismatchedHistorical, eventDocument: foreignEnvelope.eventDocument }),
  ).status, 0);
  assert.throws(
    () => database.applyLocalMigrations({ databaseUrl: invalidUrl, psqlPath }),
    database.LocalDatabaseCommandError,
  );
  assert.equal(database.readAppliedMigrations({ databaseUrl: invalidUrl, psqlPath }).length, 7);
  const uuidV4Write = runSql(
    cleanUrl,
    psqlPath,
    "INSERT INTO tenants (id, slug, legal_name, status, home_region, default_language, default_timezone) VALUES ('550e8400-e29b-41d4-a716-446655440000', 'uuidv4-tenant', 'UUIDv4 Tenant', 'active', 'local', 'en', 'UTC');",
  );
  assert.notEqual(uuidV4Write.status, 0);
  const invalidVariantWrite = runSql(
    cleanUrl,
    psqlPath,
    "INSERT INTO tenants (id, slug, legal_name, status, home_region, default_language, default_timezone) VALUES ('018bcfe5-6800-7abc-0f01-020304050607', 'uuidv7-invalid-variant', 'Invalid UUIDv7 Variant', 'active', 'local', 'en', 'UTC');",
  );
  assert.notEqual(invalidVariantWrite.status, 0);

  const domainDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER DOMAIN app.uuid_v7 DROP CONSTRAINT uuid_v7_check; ALTER DOMAIN app.uuid_v7 ADD CONSTRAINT uuid_v7_check CHECK (VALUE IS NULL OR substring(VALUE::text from 15 for 1) = '7');",
  );
  assert.equal(domainDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const domainRestore = runSql(
    cleanUrl,
    psqlPath,
    "ALTER DOMAIN app.uuid_v7 DROP CONSTRAINT uuid_v7_check; ALTER DOMAIN app.uuid_v7 ADD CONSTRAINT uuid_v7_check CHECK (VALUE IS NULL OR (substring(VALUE::text from 15 for 1) = '7' AND substring(VALUE::text from 20 for 1) ~ '^[89ab]$'));",
  );
  assert.equal(domainRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const relationalConstraintDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE sessions DROP CONSTRAINT sessions_active_presenter_fk; ALTER TABLE sessions ADD CONSTRAINT sessions_active_presenter_fk FOREIGN KEY (tenant_id, active_presenter_id) REFERENCES session_participants(tenant_id, id) DEFERRABLE INITIALLY DEFERRED;",
  );
  assert.equal(relationalConstraintDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const relationalConstraintRestore = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE sessions DROP CONSTRAINT sessions_active_presenter_fk; ALTER TABLE sessions ADD CONSTRAINT sessions_active_presenter_fk FOREIGN KEY (tenant_id, id, active_presenter_id) REFERENCES session_participants(tenant_id, session_id, id) DEFERRABLE INITIALLY DEFERRED;",
  );
  assert.equal(relationalConstraintRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const outboxIdentityDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE events_outbox DROP CONSTRAINT events_outbox_tenant_event_id_key;",
  );
  assert.equal(outboxIdentityDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const outboxIdentityRestore = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE events_outbox ADD CONSTRAINT events_outbox_tenant_event_id_key UNIQUE (tenant_id, event_id);",
  );
  assert.equal(outboxIdentityRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));
  const outboxDocumentIdentityDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE events_outbox DROP CONSTRAINT events_outbox_event_document_identity_check;",
  );
  assert.equal(outboxDocumentIdentityDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const outboxDocumentIdentityRestore = runSql(
    cleanUrl,
    psqlPath,
    `ALTER TABLE events_outbox ADD CONSTRAINT events_outbox_event_document_identity_check ${outboxEventDocumentIdentityCheckSql()};`,
  );
  assert.equal(outboxDocumentIdentityRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const policyDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE sessions DISABLE ROW LEVEL SECURITY; ALTER TABLE sessions NO FORCE ROW LEVEL SECURITY; DROP POLICY tenant_isolation ON sessions; ALTER TABLE provider_catalog ENABLE ROW LEVEL SECURITY; ALTER TABLE provider_catalog FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON provider_catalog USING (true) WITH CHECK (true);",
  );
  assert.equal(policyDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );

  const triggerDrift = runSql(
    upgradeUrl,
    psqlPath,
    "ALTER TABLE session_timeline DISABLE TRIGGER session_timeline_append_only;",
  );
  assert.equal(triggerDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const triggerTimingDrift = runSql(
    upgradeUrl,
    psqlPath,
    "ALTER TABLE session_timeline ENABLE TRIGGER session_timeline_append_only; DROP TRIGGER session_timeline_append_only ON session_timeline; CREATE TRIGGER session_timeline_append_only AFTER UPDATE OR DELETE ON session_timeline FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();",
  );
  assert.equal(triggerTimingDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const triggerRestore = runSql(
    upgradeUrl,
    psqlPath,
    "DROP TRIGGER session_timeline_append_only ON session_timeline; CREATE TRIGGER session_timeline_append_only BEFORE UPDATE OR DELETE ON session_timeline FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();",
  );
  assert.equal(triggerRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath }));
  const functionDrift = runSql(
    upgradeUrl,
    psqlPath,
    "ALTER TABLE session_timeline ENABLE TRIGGER session_timeline_append_only; CREATE OR REPLACE FUNCTION app.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;",
  );
  assert.equal(functionDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const functionRestore = runSql(
    upgradeUrl,
    psqlPath,
    "CREATE OR REPLACE FUNCTION app.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END; $$;",
  );
  assert.equal(functionRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath }));
  const tenantContextDrift = runSql(
    upgradeUrl,
    psqlPath,
    "CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;",
  );
  assert.equal(tenantContextDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: upgradeUrl, psqlPath }),
    database.MigrationDriftError,
  );

  console.log("DATABASE INTEGRATION PASSED: clean apply, upgrade outbox backfill, invalid-envelope rollback, structural drift, and UUIDv7 rejection");
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = cleanupResources();
  if (cleanupErrors.length > 0) {
    console.error(`DATABASE INTEGRATION CLEANUP FAILED: ${cleanupErrors.join("; ")}`);
    if (primaryError === undefined) throw new Error("Local database integration cleanup failed");
  }
}

function cleanupResources() {
  if (cleanupStarted) return [];
  cleanupStarted = true;
  const cleanupErrors = [];
  if (baseDatabaseUrl !== undefined) {
    for (const name of createdDatabases.reverse()) {
      try {
        dropDatabase(baseDatabaseUrl, psqlPath, name);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : "database cleanup failed");
      }
    }
  }
  let clusterStopped = cluster === undefined;
  if (cluster !== undefined) {
    const stop = spawnSync(cluster.pgCtl, ["--pgdata", cluster.dataDirectory, "--wait", "--mode", "immediate", "stop"], {
      encoding: "utf8",
      env: childEnvironment(),
    });
    if (stop.status === 0) clusterStopped = true;
    else cleanupErrors.push("temporary PostgreSQL cluster did not stop cleanly");
  }
  if (temporaryDirectory !== undefined && clusterStopped) {
    try {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : "temporary directory cleanup failed");
    }
  } else if (temporaryDirectory !== undefined) {
    cleanupErrors.push(`temporary PostgreSQL directory retained for inspection: ${temporaryDirectory}`);
  }
  return cleanupErrors;
}

function resolvePostgresBin() {
  const configured = process.env.AXTRO_POSTGRES_BIN;
  if (configured !== undefined) return configured;
  const homebrewPostgres17 = "/opt/homebrew/opt/postgresql@17/bin";
  return existsSync(join(homebrewPostgres17, "initdb")) ? homebrewPostgres17 : null;
}

function assertPostgres17WithPgvector(postgresDirectory) {
  const version = spawnSync(join(postgresDirectory, "postgres"), ["--version"], {
    encoding: "utf8",
    env: childEnvironment(),
  });
  if (version.status !== 0 || !/\b17\./.test(version.stdout ?? "")) {
    throw new Error("AXTRO_POSTGRES_BIN must contain PostgreSQL 17 binaries");
  }
  const sharedir = spawnSync(join(postgresDirectory, "pg_config"), ["--sharedir"], {
    encoding: "utf8",
    env: childEnvironment(),
  });
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

function createDatabase(baseUrl, executable, name) {
  const result = runSql(baseUrl, executable, `CREATE DATABASE ${quoteIdentifier(name)};`);
  if (result.status !== 0) throw new Error("Unable to create local integration database");
}

function dropDatabase(baseUrl, executable, name) {
  const result = runSql(baseUrl, executable, `DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE);`);
  if (result.status !== 0) throw new Error("Unable to drop local integration database");
}

function databaseUrlFor(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return database.parseLocalDatabaseUrl(url.toString());
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Local integration database name is invalid");
  return `"${value}"`;
}

function outboxFixture(offset, overrides = {}) {
  const tenantId = overrides.tenantId ?? fixtureUuid(offset + 1);
  const rowId = overrides.rowId ?? fixtureUuid(offset + 2);
  const eventId = overrides.eventId ?? fixtureUuid(offset + 3);
  const aggregateId = overrides.aggregateId ?? fixtureUuid(offset + 4);
  const correlationId = overrides.correlationId ?? fixtureUuid(offset + 5);
  return {
    tenantId,
    rowId,
    eventId,
    aggregateId,
    eventDocument: overrides.eventDocument ?? {
      schema_version: "2.0.0",
      event_id: eventId,
      event_type: "session.created",
      event_version: 1,
      aggregate_type: "interaction_session",
      aggregate_id: aggregateId,
      aggregate_version: 1,
      tenant_id: tenantId,
      session_id: aggregateId,
      producer: "database-integration",
      trace_id: "0123456789abcdef0123456789abcdef",
      correlation_id: correlationId,
      causation_id: null,
      data_classification: "internal",
      payload_json: "{}",
      occurred_at: "2026-07-14T00:00:00.000Z",
    },
  };
}

function fixtureUuid(offset) {
  return domain.uuidV7FromParts(
    1_700_000_100_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

function tenantInsertSql(tenantId, slug) {
  return `INSERT INTO tenants (id, slug, legal_name, status, home_region, default_language, default_timezone) VALUES ('${tenantId}', '${slug}', 'Outbox Migration Tenant', 'active', 'local', 'en', 'UTC');`;
}

function legacyOutboxInsertSql(fixture) {
  return `INSERT INTO events_outbox (tenant_id, id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, event_document) VALUES ('${fixture.tenantId}', '${fixture.rowId}', 'interaction_session', '${fixture.aggregateId}', 1, 'session.created', 1, '${sqlLiteral(JSON.stringify(fixture.eventDocument))}'::jsonb);`;
}

function currentOutboxInsertSql(fixture) {
  return `INSERT INTO events_outbox (tenant_id, id, event_id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, event_document) VALUES ('${fixture.tenantId}', '${fixture.rowId}', '${fixture.eventId}', 'interaction_session', '${fixture.aggregateId}', 1, 'session.created', 1, '${sqlLiteral(JSON.stringify(fixture.eventDocument))}'::jsonb);`;
}

function sqlLiteral(value) {
  return value.replaceAll("'", "''");
}

function outboxEventDocumentIdentityCheckSql() {
  return `CHECK (
    jsonb_typeof(event_document) = 'object'
    AND event_document ?& ARRAY[
      'schema_version', 'event_id', 'event_type', 'event_version',
      'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
      'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
      'data_classification', 'payload_json', 'occurred_at'
    ]
    AND event_document ->> 'tenant_id' IS NOT DISTINCT FROM tenant_id::text
    AND (event_document ->> 'event_id')::app.uuid_v7 IS NOT DISTINCT FROM event_id
  )`;
}

function runSql(databaseUrl, executable, sql) {
  return spawnSync(executable, [
    "--no-psqlrc",
    "--no-password",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    databaseUrl,
    "--command",
    sql,
  ], { encoding: "utf8", env: childEnvironment() });
}

function queryScalar(databaseUrl, executable, sql) {
  const result = spawnSync(executable, [
    "--no-psqlrc",
    "--no-password",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    databaseUrl,
    "--command",
    sql,
  ], { encoding: "utf8", env: childEnvironment() });
  if (result.status !== 0) throw new Error("Local PostgreSQL scalar query failed");
  return result.stdout.trim();
}

function run(executable, args, phase) {
  const result = spawnSync(executable, args, { encoding: "utf8", env: childEnvironment() });
  if (result.status !== 0) throw new Error(`Local PostgreSQL ${phase} failed`);
}

function childEnvironment() {
  return database.createSanitizedPsqlEnvironment(process.env);
}
