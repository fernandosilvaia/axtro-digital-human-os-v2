import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const database = await import(new URL("../packages/database/dist/index.js", import.meta.url));
const domain = await import(new URL("../packages/domain/dist/index.js", import.meta.url));
const externalDatabaseUrl = process.env.AXTRO_LOCAL_DATABASE_URL;
const postgresBin = resolvePostgresBin();
const psqlPath = process.env.AXTRO_PSQL_PATH ?? (postgresBin === null ? "psql" : join(postgresBin, "psql"));
const developmentSeedScript = fileURLToPath(new URL("./development-seed.mjs", import.meta.url));
const developmentSeedTenantIds = [
  "0197c000-0000-7000-8000-000000000001",
  "0197c000-0000-7000-8000-000000000002",
];

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
  const invalidTimelineName = `axtro_m1_invalid_timeline_${suffix}`;
  for (const name of [cleanName, upgradeName, invalidName, invalidTimelineName]) {
    createDatabase(baseDatabaseUrl, psqlPath, name);
    createdDatabases.push(name);
  }

  const cleanUrl = databaseUrlFor(baseDatabaseUrl, cleanName);
  const upgradeUrl = databaseUrlFor(baseDatabaseUrl, upgradeName);
  const invalidUrl = databaseUrlFor(baseDatabaseUrl, invalidName);
  const invalidTimelineUrl = databaseUrlFor(baseDatabaseUrl, invalidTimelineName);
  const cleanResult = database.applyLocalMigrations({ databaseUrl: cleanUrl, psqlPath });
  assert.equal(cleanResult.applied.length, 12);
  const cleanDrift = database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath });
  assert.equal(runDevelopmentSeed(cleanUrl).status, 0);
  const firstSeedComposition = readDevelopmentSeedComposition(cleanUrl);
  assert.equal(runDevelopmentSeed(cleanUrl).status, 0);
  assert.deepEqual(readDevelopmentSeedComposition(cleanUrl), firstSeedComposition);
  assert.deepEqual(firstSeedComposition, [
    "0197c000-0000-7000-8000-000000000001:1:1:1:1:1:1:2:0:fake-catalog,fake-realtime",
    "0197c000-0000-7000-8000-000000000002:1:1:1:1:1:1:2:0:fake-catalog,fake-realtime",
  ]);
  assert.equal(runSql(
    cleanUrl,
    psqlPath,
    "UPDATE provider_connections SET secret_handle = 'ref_unexpected' WHERE tenant_id = '0197c000-0000-7000-8000-000000000001' AND id = '0197c000-0000-7000-8000-000000000061';",
  ).status, 0);
  assert.notEqual(runDevelopmentSeed(cleanUrl).status, 0);
  assert.equal(
    queryScalar(
      cleanUrl,
      psqlPath,
      "SELECT secret_handle FROM provider_connections WHERE tenant_id = '0197c000-0000-7000-8000-000000000001' AND id = '0197c000-0000-7000-8000-000000000061';",
    ),
    "ref_unexpected",
  );
  assert.equal(runSql(
    cleanUrl,
    psqlPath,
    "UPDATE provider_connections SET secret_handle = 'ref_fake_tenant_zero_alpha_realtime' WHERE tenant_id = '0197c000-0000-7000-8000-000000000001' AND id = '0197c000-0000-7000-8000-000000000061';",
  ).status, 0);
  assert.equal(runDevelopmentSeed(cleanUrl).status, 0);
  assert.deepEqual(readDevelopmentSeedComposition(cleanUrl), firstSeedComposition);
  assert.equal(runSql(cleanUrl, psqlPath, "DROP INDEX cost_events_tenant_source_provider_request_ref_unique;").status, 0);
  assert.notEqual(runDevelopmentSeed(cleanUrl).status, 0);
  assert.deepEqual(readDevelopmentSeedComposition(cleanUrl), firstSeedComposition);
  assert.equal(runSql(
    cleanUrl,
    psqlPath,
    "CREATE UNIQUE INDEX cost_events_tenant_source_provider_request_ref_unique ON cost_events (tenant_id, source, provider_request_ref) WHERE provider_request_ref IS NOT NULL;",
  ).status, 0);
  assert.equal(runDevelopmentSeed(cleanUrl).status, 0);

  const upgradePrelude = database.applyLocalMigrations({ databaseUrl: upgradeUrl, psqlPath, targetVersion: 5 });
  assert.equal(upgradePrelude.history.length, 5);
  const historical = outboxFixture(100);
  const historicalCompatibleCost = legacyCostEventFixture(106, historical.tenantId, "0.02");
  const historicalIncompatibleCost = legacyCostEventFixture(107, historical.tenantId, "0.03");
  assert.equal(runSql(
    upgradeUrl,
    psqlPath,
    `${tenantInsertSql(historical.tenantId, "outbox-upgrade")} ${legacyOutboxInsertSql(historical)} ${legacyCostEventInsertSql(historicalCompatibleCost)} ${legacyCostEventInsertSql(historicalIncompatibleCost)}`,
  ).status, 0);
  const upgradeThroughNine = database.applyLocalMigrations({ databaseUrl: upgradeUrl, psqlPath, targetVersion: 9 });
  assert.deepEqual(upgradeThroughNine.applied.map((migration) => migration.version), [6, 7, 8, 9]);
  assert.equal(
    queryScalar(
      upgradeUrl,
      psqlPath,
      `SELECT event_id::text FROM events_outbox WHERE tenant_id = '${historical.tenantId}' AND id = '${historical.rowId}';`,
    ),
    historical.eventId,
  );
  assert.equal(
    queryScalar(
      upgradeUrl,
      psqlPath,
      `SELECT amount_usd::text || ':' || currency FROM cost_events WHERE tenant_id = '${historical.tenantId}' AND id = '${historicalCompatibleCost.id}';`,
    ),
    "0.02000000:USD",
  );
  assert.equal(
    queryScalar(
      upgradeUrl,
      psqlPath,
      `SELECT amount_usd::text || ':' || currency FROM cost_events WHERE tenant_id = '${historical.tenantId}' AND id = '${historicalIncompatibleCost.id}';`,
    ),
    "0.03000000:USD",
  );
  const historicalTimeline = timelineFixture(120, { tenantId: historical.tenantId });
  assert.equal(runSql(
    upgradeUrl,
    psqlPath,
    `${timelinePrerequisiteSql(historicalTimeline)} ${legacyTimelineInsertSql(historicalTimeline)}`,
  ).status, 0);
  const upgradeResult = database.applyLocalMigrations({ databaseUrl: upgradeUrl, psqlPath });
  assert.deepEqual(upgradeResult.applied.map((migration) => migration.version), [10, 11, 12]);
  assert.equal(
    queryScalar(
      upgradeUrl,
      psqlPath,
      `SELECT event_id::text FROM session_timeline WHERE tenant_id = '${historicalTimeline.tenantId}' AND id = '${historicalTimeline.rowId}';`,
    ),
    historicalTimeline.eventId,
  );
  assert.equal(
    queryScalar(
      upgradeUrl,
      psqlPath,
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'session_timeline_append_only' AND NOT tgisinternal;",
    ),
    "O",
  );
  assert.notEqual(runSql(
    upgradeUrl,
    psqlPath,
    `UPDATE session_timeline SET event_type = 'tampered' WHERE tenant_id = '${historicalTimeline.tenantId}' AND id = '${historicalTimeline.rowId}';`,
  ).status, 0);
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
  const invalidTimelinePrelude = database.applyLocalMigrations({ databaseUrl: invalidTimelineUrl, psqlPath, targetVersion: 9 });
  assert.equal(invalidTimelinePrelude.history.length, 9);
  const invalidTimeline = timelineFixture(330);
  const malformedEventTimeline = {
    ...invalidTimeline,
    eventDocument: { ...invalidTimeline.eventDocument, event_id: "550e8400-e29b-41d4-a716-446655440000" },
  };
  assert.equal(runSql(
    invalidTimelineUrl,
    psqlPath,
    `${tenantInsertSql(invalidTimeline.tenantId, "timeline-invalid")} ${timelinePrerequisiteSql(invalidTimeline)} ${legacyTimelineInsertSql(malformedEventTimeline)}`,
  ).status, 0);
  assert.throws(
    () => database.applyLocalMigrations({ databaseUrl: invalidTimelineUrl, psqlPath }),
    database.LocalDatabaseCommandError,
  );
  assert.equal(database.readAppliedMigrations({ databaseUrl: invalidTimelineUrl, psqlPath }).length, 9);
  assert.equal(
    queryScalar(
      invalidTimelineUrl,
      psqlPath,
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'session_timeline' AND column_name = 'event_id');",
    ),
    "f",
  );
  assert.equal(
    queryScalar(
      invalidTimelineUrl,
      psqlPath,
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'session_timeline_append_only' AND NOT tgisinternal;",
    ),
    "O",
  );
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

  const validCostEventId = fixtureUuid(260);
  const validCostWrite = runSql(
    cleanUrl,
    psqlPath,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, currency, rate_card_ref, rate_card_as_of, reconciles_cost_event_id, trace_id, provider_request_ref) VALUES ('${validTenantId}', '${validCostEventId}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'estimated', '2026-07-14T00:00:00Z', 'USD', 'catalog/fake-realtime-2026-07-14', '2026-07-14T00:00:00Z', NULL, '0123456789abcdef0123456789abcdef', 'ppr_fake000001');`,
  );
  assert.equal(validCostWrite.status, 0);
  const sourceScopedProviderRequest = runSql(
    cleanUrl,
    psqlPath,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, provider_request_ref) VALUES ('${validTenantId}', '${fixtureUuid(267)}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'provider_reported', '2026-07-14T00:00:00Z', 'ppr_fake000001');`,
  );
  assert.equal(sourceScopedProviderRequest.status, 0);
  const duplicateProviderRequest = runSql(
    cleanUrl,
    psqlPath,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, provider_request_ref) VALUES ('${validTenantId}', '${fixtureUuid(268)}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'estimated', '2026-07-14T00:00:00Z', 'ppr_fake000001');`,
  );
  assert.notEqual(duplicateProviderRequest.status, 0);
  const idempotentCostRetry = runSql(
    cleanUrl,
    psqlPath,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, provider_request_ref) VALUES ('${validTenantId}', '${validCostEventId}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'estimated', '2026-07-14T00:00:00Z', 'ppr_fake000001') ON CONFLICT (tenant_id, id) DO NOTHING;`,
  );
  assert.equal(idempotentCostRetry.status, 0);
  assert.equal(
    queryScalar(
      cleanUrl,
      psqlPath,
      `SELECT count(*) FROM cost_events WHERE tenant_id = '${validTenantId}' AND source = 'estimated' AND provider_request_ref = 'ppr_fake000001';`,
    ),
    "1",
  );
  const validMeasuredCostEventId = fixtureUuid(264);
  assert.equal(runSql(
    cleanUrl,
    psqlPath,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${validTenantId}', '${validMeasuredCostEventId}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'measured', '2026-07-14T00:00:00Z', '${validCostEventId}');`,
  ).status, 0);
  for (const invalidCostSql of [
    `INSERT INTO cost_events (tenant_id, id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at) VALUES ('${validTenantId}', '${fixtureUuid(261)}', 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.03, 'estimated', now());`,
    `INSERT INTO cost_events (tenant_id, id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at) VALUES ('${validTenantId}', '${fixtureUuid(262)}', 'fake-realtime', 'model', 'gigabyte', 0.1, 0.2, 0.02, 'estimated', now());`,
    `INSERT INTO cost_events (tenant_id, id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, currency) VALUES ('${validTenantId}', '${fixtureUuid(263)}', 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'estimated', now(), 'EUR');`,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${validTenantId}', '${fixtureUuid(265)}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, 0.02, 'measured', now(), '${validMeasuredCostEventId}');`,
    `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at, reconciles_cost_event_id) VALUES ('${validTenantId}', '${fixtureUuid(266)}', NULL, 'fake-realtime', 'tts', 'token', 0.1, 0.2, 0.02, 'measured', now(), '${validCostEventId}');`,
  ]) {
    assert.notEqual(runSql(cleanUrl, psqlPath, invalidCostSql).status, 0);
  }

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
  const timelineDocumentIdentityDrift = runSql(
    cleanUrl,
    psqlPath,
    `ALTER TABLE session_timeline DROP CONSTRAINT session_timeline_event_document_identity_check; ALTER TABLE session_timeline ADD CONSTRAINT session_timeline_event_document_identity_check ${timelineEventDocumentIdentityCheckSql({ includeClosure: false })};`,
  );
  assert.equal(timelineDocumentIdentityDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const timelineDocumentIdentityRestore = runSql(
    cleanUrl,
    psqlPath,
    `ALTER TABLE session_timeline DROP CONSTRAINT session_timeline_event_document_identity_check; ALTER TABLE session_timeline ADD CONSTRAINT session_timeline_event_document_identity_check ${timelineEventDocumentIdentityCheckSql()};`,
  );
  assert.equal(timelineDocumentIdentityRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const workflowSourceForeignKeyDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE workflow_commands DROP CONSTRAINT workflow_commands_source_completion_fkey;",
  );
  assert.equal(workflowSourceForeignKeyDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const workflowSourceForeignKeyRestore = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE workflow_commands ADD CONSTRAINT workflow_commands_source_completion_fkey FOREIGN KEY (tenant_id, session_id, source_event_id, source_aggregate_version, source_event_type) REFERENCES session_timeline(tenant_id, session_id, event_id, aggregate_version, event_type) ON DELETE RESTRICT;",
  );
  assert.equal(workflowSourceForeignKeyRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const costReconciliationDrift = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE cost_events DROP CONSTRAINT cost_events_amount_reconciliation_check;",
  );
  assert.equal(costReconciliationDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const costReconciliationNoopRestore = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE cost_events ADD CONSTRAINT cost_events_amount_reconciliation_check CHECK (true);",
  );
  assert.equal(costReconciliationNoopRestore.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const costReconciliationRestore = runSql(
    cleanUrl,
    psqlPath,
    "ALTER TABLE cost_events DROP CONSTRAINT cost_events_amount_reconciliation_check; ALTER TABLE cost_events ADD CONSTRAINT cost_events_amount_reconciliation_check CHECK (amount_usd = round(quantity * unit_cost_usd, 8));",
  );
  assert.equal(costReconciliationRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const costReconciliationTriggerDrift = runSql(
    cleanUrl,
    psqlPath,
    "DROP TRIGGER cost_events_reconciliation_target ON cost_events;",
  );
  assert.equal(costReconciliationTriggerDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const costReconciliationTriggerRestore = runSql(
    cleanUrl,
    psqlPath,
    "CREATE TRIGGER cost_events_reconciliation_target BEFORE INSERT ON cost_events FOR EACH ROW EXECUTE FUNCTION app.validate_cost_event_reconciliation();",
  );
  assert.equal(costReconciliationTriggerRestore.status, 0);
  assert.doesNotThrow(() => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }));

  const providerRequestIndexDrift = runSql(
    cleanUrl,
    psqlPath,
    "DROP INDEX cost_events_tenant_source_provider_request_ref_unique;",
  );
  assert.equal(providerRequestIndexDrift.status, 0);
  assert.throws(
    () => database.checkLocalSchemaDrift({ databaseUrl: cleanUrl, psqlPath }),
    database.MigrationDriftError,
  );
  const providerRequestIndexRestore = runSql(
    cleanUrl,
    psqlPath,
    "CREATE UNIQUE INDEX cost_events_tenant_source_provider_request_ref_unique ON cost_events (tenant_id, source, provider_request_ref) WHERE provider_request_ref IS NOT NULL;",
  );
  assert.equal(providerRequestIndexRestore.status, 0);
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

  console.log("DATABASE INTEGRATION PASSED: clean apply, upgrade backfill, workflow source integrity, cost reconciliation, structural drift, and UUIDv7 rejection");
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

function timelineFixture(offset, overrides = {}) {
  const tenantId = overrides.tenantId ?? fixtureUuid(offset + 1);
  const agentId = overrides.agentId ?? fixtureUuid(offset + 2);
  const sessionId = overrides.sessionId ?? fixtureUuid(offset + 3);
  const rowId = overrides.rowId ?? fixtureUuid(offset + 4);
  const eventId = overrides.eventId ?? fixtureUuid(offset + 5);
  const correlationId = overrides.correlationId ?? fixtureUuid(offset + 6);
  const occurredAt = "2026-07-14T00:00:00.000Z";
  const payload = {
    agent_id: agentId,
    channel: { type: "api", external_session_ref: null, region: "local" },
    consent_status: "pending",
    disclosure_status: "pending",
    capabilities: { audio: false, video: false, avatar: false, screen_share: false, tools: true, handoff: true },
    role: {
      role_pack_id: "generic-assistant",
      role_pack_version: "1.0.0",
      objective: "Prove a canonical timeline backfill.",
      stage: "opening",
      milestones: [],
      missing_fields: [],
      next_best_action: {
        action_code: "listen",
        reason: "Await the next canonical event.",
        confidence: 1,
        expires_at: "2026-07-14T00:30:00.000Z",
      },
    },
    language: "en-US",
  };
  return {
    tenantId,
    agentId,
    sessionId,
    rowId,
    eventId,
    correlationId,
    occurredAt,
    eventDocument: overrides.eventDocument ?? {
      schema_version: "2.0.0",
      event_id: eventId,
      event_type: "session.created",
      event_version: 1,
      aggregate_type: "interaction_session",
      aggregate_id: sessionId,
      aggregate_version: 1,
      tenant_id: tenantId,
      session_id: sessionId,
      producer: "database-integration",
      trace_id: "0123456789abcdef0123456789abcdef",
      correlation_id: correlationId,
      causation_id: null,
      data_classification: "internal",
      payload_json: JSON.stringify(payload),
      occurred_at: occurredAt,
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

function timelinePrerequisiteSql(fixture) {
  return `INSERT INTO agents (tenant_id, id, name, role_type, status, disclosure_profile_id) VALUES ('${fixture.tenantId}', '${fixture.agentId}', 'Timeline Migration Agent', 'generic', 'active', 'default'); INSERT INTO sessions (tenant_id, id, agent_id, role_pack_id, role_pack_version, channel_type, status) VALUES ('${fixture.tenantId}', '${fixture.sessionId}', '${fixture.agentId}', 'generic-assistant', '1.0.0', 'api', 'preparing');`;
}

function legacyTimelineInsertSql(fixture) {
  return `INSERT INTO session_timeline (tenant_id, id, session_id, aggregate_version, event_type, event_version, event_document, trace_id, correlation_id, causation_id, occurred_at) VALUES ('${fixture.tenantId}', '${fixture.rowId}', '${fixture.sessionId}', 1, 'session.created', 1, '${sqlLiteral(JSON.stringify(fixture.eventDocument))}'::jsonb, '0123456789abcdef0123456789abcdef', '${fixture.correlationId}', NULL, '${fixture.occurredAt}');`;
}

function legacyCostEventFixture(offset, tenantId, amountUsd) {
  return {
    tenantId,
    id: fixtureUuid(offset),
    amountUsd,
  };
}

function legacyCostEventInsertSql(fixture) {
  return `INSERT INTO cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at) VALUES ('${fixture.tenantId}', '${fixture.id}', NULL, 'fake-realtime', 'model', 'token', 0.1, 0.2, ${fixture.amountUsd}, 'estimated', '2026-07-14T00:00:00Z');`;
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

function timelineEventDocumentIdentityCheckSql(options = {}) {
  const includeClosure = options.includeClosure ?? true;
  const closure = includeClosure ? `
    AND event_document - ARRAY[
      'schema_version', 'event_id', 'event_type', 'event_version',
      'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
      'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
      'data_classification', 'payload_json', 'occurred_at'
    ] = '{}'::jsonb` : "";
  return `CHECK (
    jsonb_typeof(event_document) = 'object'
    AND event_document ?& ARRAY[
      'schema_version', 'event_id', 'event_type', 'event_version',
      'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
      'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
      'data_classification', 'payload_json', 'occurred_at'
    ]${closure}
    AND event_document ->> 'schema_version' IS NOT DISTINCT FROM '2.0.0'
    AND event_document ->> 'tenant_id' IS NOT DISTINCT FROM tenant_id::text
    AND event_document ->> 'session_id' IS NOT DISTINCT FROM session_id::text
    AND event_document ->> 'aggregate_type' IS NOT DISTINCT FROM 'interaction_session'
    AND event_document ->> 'aggregate_id' IS NOT DISTINCT FROM session_id::text
    AND (event_document ->> 'event_id')::app.uuid_v7 IS NOT DISTINCT FROM event_id
    AND (event_document ->> 'aggregate_version')::bigint IS NOT DISTINCT FROM aggregate_version
    AND event_document ->> 'event_type' IS NOT DISTINCT FROM event_type
    AND (event_document ->> 'event_version')::integer IS NOT DISTINCT FROM event_version
    AND event_document ->> 'trace_id' IS NOT DISTINCT FROM trace_id
    AND (event_document ->> 'correlation_id')::app.uuid_v7 IS NOT DISTINCT FROM correlation_id
    AND (event_document ->> 'causation_id')::app.uuid_v7 IS NOT DISTINCT FROM causation_id
    AND (event_document ->> 'occurred_at')::timestamptz IS NOT DISTINCT FROM occurred_at
    AND jsonb_typeof(event_document -> 'payload_json') = 'string'
    AND jsonb_typeof((event_document ->> 'payload_json')::jsonb) = 'object'
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

function readDevelopmentSeedComposition(databaseUrl) {
  return developmentSeedTenantIds.map((tenantId) => queryScalar(
    databaseUrl,
    psqlPath,
    `SELECT '${tenantId}' || ':'
      || (SELECT count(*) FROM tenant_settings WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM service_identities WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM agents WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM agent_deployments WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM role_pack_installations WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM skill_pack_installations WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM provider_connections WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT count(*) FROM contact_profiles WHERE tenant_id = '${tenantId}') || ':'
      || (SELECT string_agg(provider_id, ',' ORDER BY provider_id) FROM provider_connections WHERE tenant_id = '${tenantId}');`,
  ));
}

function runDevelopmentSeed(databaseUrl) {
  return spawnSync(process.execPath, [developmentSeedScript], {
    encoding: "utf8",
    env: {
      ...childEnvironment(),
      AXTRO_ALLOW_LOCAL_DATABASE_URL: "1",
      AXTRO_LOCAL_DATABASE_URL: databaseUrl,
      AXTRO_PSQL_PATH: psqlPath,
    },
  });
}
