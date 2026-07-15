import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const database = await import(pathToFileURL(join(root, "packages/database/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);

const localUrl = "postgresql://postgres@127.0.0.1:54329/axtro_m0_test";
const equivalentLocalUrl = "postgres://postgres@localhost:54329/axtro_m0_test";

test("migration manifest is contiguous and local URLs cannot carry credentials or implicit identities", () => {
  const manifest = database.discoverMigrations();
  assert.deepEqual(manifest.map((migration) => migration.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(manifest.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksumSha256)), true);
  assert.equal(database.parseLocalDatabaseUrl(localUrl), localUrl);
  assert.equal(database.parseLocalDatabaseUrl(equivalentLocalUrl), equivalentLocalUrl);
  const firstMigration = readFileSync(manifest[0].path, "utf8");
  assert.match(firstMigration, /substring\(VALUE::text from 15 for 1\) = '7'/);
  assert.match(firstMigration, /substring\(VALUE::text from 20 for 1\) ~ '\^\[89ab\]\$'/);
  const outboxIdentityMigration = readFileSync(manifest.find((migration) => migration.version === 8).path, "utf8");
  assert.match(outboxIdentityMigration, /events_outbox_tenant_event_id_key UNIQUE \(tenant_id, event_id\)/);
  assert.match(outboxIdentityMigration, /events_outbox_event_document_identity_check CHECK/);
  assert.match(outboxIdentityMigration, /event_document ->> 'tenant_id' IS DISTINCT FROM tenant_id::text/);
  assert.match(outboxIdentityMigration, /IS NOT DISTINCT FROM event_id/);
  const costReconciliationMigration = readFileSync(manifest.find((migration) => migration.version === 9).path, "utf8");
  assert.match(costReconciliationMigration, /cost_events_amount_reconciliation_check/);
  assert.match(costReconciliationMigration, /amount_usd = round\(quantity \* unit_cost_usd, 8\)\) NOT VALID/);
  assert.match(costReconciliationMigration, /cost_events_tenant_id_reconciles_cost_event_id_fkey/);
  assert.match(costReconciliationMigration, /CREATE FUNCTION app\.validate_cost_event_reconciliation\(\)/);
  assert.match(costReconciliationMigration, /CREATE TRIGGER cost_events_reconciliation_target/);
  assert.match(costReconciliationMigration, /CREATE UNIQUE INDEX cost_events_tenant_source_provider_request_ref_unique/);
  const timelineIdentityMigration = readFileSync(manifest.find((migration) => migration.version === 10).path, "utf8");
  assert.match(timelineIdentityMigration, /session_timeline_tenant_event_id_key UNIQUE \(tenant_id, event_id\)/);
  assert.match(timelineIdentityMigration, /session_timeline_event_document_identity_check CHECK/);
  assert.match(timelineIdentityMigration, /event_document - ARRAY\[/);
  assert.match(timelineIdentityMigration, /\] = '\{\}'::jsonb/);
  assert.match(timelineIdentityMigration, /aggregate_id' IS NOT DISTINCT FROM session_id::text/);
  assert.match(timelineIdentityMigration, /DISABLE TRIGGER session_timeline_append_only/);
  assert.match(timelineIdentityMigration, /ENABLE TRIGGER session_timeline_append_only/);
  const workflowMigration = readFileSync(manifest.find((migration) => migration.version === 11).path, "utf8");
  assert.match(workflowMigration, /CREATE TABLE workflow_commands/);
  assert.match(workflowMigration, /CREATE TABLE workflow_step_receipts/);
  assert.match(workflowMigration, /CREATE TABLE post_call_workflow_results/);
  assert.match(workflowMigration, /CREATE TABLE post_call_workflow_result_evidence/);
  assert.match(workflowMigration, /session_timeline_completion_source_key/);
  assert.match(workflowMigration, /workflow_commands_source_completion_fkey/);
  assert.match(workflowMigration, /workflow_step_receipts_run_command_session_fkey/);
  assert.match(workflowMigration, /workflow_step_receipts_command_source_fkey/);
  assert.match(workflowMigration, /post_call_workflow_results_run_command_session_fkey/);
  assert.match(workflowMigration, /post_call_workflow_results_command_source_fkey/);
  assert.match(workflowMigration, /post_call_workflow_result_evidence_result_session_fkey/);
  assert.match(workflowMigration, /outcome = 'retry_scheduled'/);
  assert.match(workflowMigration, /status = 'failed' AND last_error_code IN/);
  assert.match(workflowMigration, /workflow_runs_post_call_lifecycle_check/);
  assert.match(workflowMigration, /status = 'queued' AND attempts = 0/);
  assert.match(workflowMigration, /status NOT IN \('running','waiting','completed','failed'\)[\s\S]*started_at IS NOT NULL/);
  assert.match(workflowMigration, /status <> 'completed' OR current_step = 'finalize'/);
  assert.match(workflowMigration, /status = 'completed'[\s\S]*cancelled_at IS NULL/);
  assert.match(workflowMigration, /status = 'cancelled'[\s\S]*completed_at IS NULL/);
  assert.match(workflowMigration, /workflow_runs_post_call_command_fkey[\s\S]*ON DELETE RESTRICT NOT VALID/);
  assert.match(workflowMigration, /follow_up_external_effect = false/);
  assert.match(workflowMigration, /CREATE UNIQUE INDEX workflow_runs_tenant_post_call_command_unique/);
  for (const table of [
    "workflow_commands",
    "workflow_step_receipts",
    "post_call_workflow_results",
    "post_call_workflow_result_evidence",
  ]) {
    assert.match(workflowMigration, new RegExp(`${table}_append_only`));
  }

  for (const value of [
    "postgresql://postgres@database.example.test/axtro_m0_test",
    "postgresql://postgres:password@127.0.0.1:54329/axtro_m0_test",
    "postgresql://127.0.0.1:54329/axtro_m0_test",
    "postgresql://postgres@127.0.0.1:54329/axtro_m0_test?sslmode=require",
    "postgresql://postgres@127.0.0.1:54329/axtro_m0_test#fragment",
  ]) {
    assert.throws(
      () => database.parseLocalDatabaseUrl(value),
      (error) => error instanceof database.LocalDatabaseUrlError && !error.message.includes(value),
    );
  }
});

test("psql child environment removes inherited connection sources and forces inert credential files", () => {
  const environment = database.createSanitizedPsqlEnvironment({
    PATH: "/usr/bin",
    PGPASSWORD: "must-not-survive",
    PGPASSFILE: "/tmp/passwords",
    PGSERVICE: "production",
    PGSERVICEFILE: "/tmp/services",
    PGHOST: "database.example.test",
    PGPORT: "5432",
    PGUSER: "service-user",
    PGDATABASE: "production",
    PGSSLMODE: "require",
    PGGSSENCMODE: "prefer",
    PGGSSDELEGATION: "1",
    PGGSSLIB: "gssapi",
    PGKRBSRVNAME: "postgres",
    PGREALM: "EXAMPLE.TEST",
    PGREQUIRESSL: "1",
    PGAPPNAME: "unexpected-client",
    UNRELATED_VALUE: "must-not-survive",
  });
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.PGPASSFILE, "/dev/null");
  assert.equal(environment.PGSERVICEFILE, "/dev/null");
  assert.equal(environment.PGSSLMODE, "disable");
  assert.equal(environment.PGGSSENCMODE, "disable");
  assert.equal(environment.PGGSSDELEGATION, "0");
  assert.equal(environment.PGCHANNELBINDING, "disable");
  for (const key of [
    "PGPASSWORD", "PGSERVICE", "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGREQUIRESSL", "PGAPPNAME",
    "PGGSSLIB", "PGKRBSRVNAME", "PGREALM", "UNRELATED_VALUE",
  ]) {
    assert.equal(environment[key], undefined);
  }
});

test("migration runner records files, blocks changed receipts, and releases normalized locks after failure", () => {
  const fixture = createMigrationFixture();
  try {
    const harness = createStatefulExecutor();
    const result = database.applyLocalMigrations({
      databaseUrl: localUrl,
      migrationsDirectory: fixture,
      targetVersion: 2,
      executor: harness.executor,
    });

    assert.equal(result.applied.length, 2);
    assert.equal(result.history.length, 2);
    assert.equal(harness.migrationFiles.length, 2);
    assert.equal(harness.commands.some((command) => command.args.includes("--no-password")), true);

    const driftExecutor = createStatefulExecutor({
      initialHistory: [{
        version: 1,
        filename: "0001_fixture.sql",
        checksumSha256: "f".repeat(64),
      }],
    });
    assert.throws(
      () => database.applyLocalMigrations({
        databaseUrl: localUrl,
        migrationsDirectory: fixture,
        executor: driftExecutor.executor,
      }),
      database.MigrationDriftError,
    );

    let nestedLockFailure = false;
    const failingExecutor = createStatefulExecutor({
      failMigrationVersion: 1,
      onHistoryBootstrap: () => {
        assert.throws(
          () => database.readAppliedMigrations({
            databaseUrl: equivalentLocalUrl,
            migrationsDirectory: fixture,
            executor: createStatefulExecutor().executor,
          }),
          database.MigrationStateError,
        );
        nestedLockFailure = true;
      },
    });
    assert.throws(
      () => database.applyLocalMigrations({
        databaseUrl: localUrl,
        migrationsDirectory: fixture,
        executor: failingExecutor.executor,
      }),
      database.LocalDatabaseCommandError,
    );
    assert.equal(nestedLockFailure, true);

    const retry = database.applyLocalMigrations({
      databaseUrl: equivalentLocalUrl,
      migrationsDirectory: fixture,
      executor: createStatefulExecutor().executor,
    });
    assert.equal(retry.history.length, 2);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a migration applied without a receipt fails closed and is never replayed", () => {
  const fixture = createMigrationFixture();
  try {
    const harness = createStatefulExecutor({ failReceiptVersion: 1 });
    assert.throws(
      () => database.applyLocalMigrations({
        databaseUrl: localUrl,
        migrationsDirectory: fixture,
        executor: harness.executor,
      }),
      database.LocalDatabaseCommandError,
    );
    assert.equal(harness.migrationFiles.length, 1);
    assert.throws(
      () => database.applyLocalMigrations({
        databaseUrl: localUrl,
        migrationsDirectory: fixture,
        executor: harness.executor,
      }),
      database.MigrationStateError,
    );
    assert.equal(harness.migrationFiles.length, 1);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("read and drift fail closed without mutating an uninitialized database or accepting catalog drift", () => {
  const fixture = createMigrationFixture();
  try {
    const absent = createStatefulExecutor({ historyExists: false });
    assert.throws(
      () => database.readAppliedMigrations({ databaseUrl: localUrl, migrationsDirectory: fixture, executor: absent.executor }),
      database.MigrationStateError,
    );
    assert.equal(absent.commands.some((command) => command.args.join(" ").includes("CREATE TABLE IF NOT EXISTS public.axtro_schema_migrations")), false);

    const absentDrift = createStatefulExecutor({ historyExists: false });
    assert.throws(
      () => database.checkLocalSchemaDrift({ databaseUrl: localUrl, migrationsDirectory: fixture, executor: absentDrift.executor }),
      database.MigrationStateError,
    );
    assert.equal(absentDrift.commands.some((command) => command.args.join(" ").includes("CREATE TABLE IF NOT EXISTS public.axtro_schema_migrations")), false);

    const manifest = database.discoverMigrations(fixture);
    const catalogDrift = createStatefulExecutor({
      historyExists: true,
      initialHistory: manifest.map((migration) => ({
        version: migration.version,
        filename: migration.filename,
        checksumSha256: migration.checksumSha256,
      })),
      catalogStatus: "drift",
    });
    assert.throws(
      () => database.checkLocalSchemaDrift({ databaseUrl: localUrl, migrationsDirectory: fixture, executor: catalogDrift.executor }),
      database.MigrationDriftError,
    );
    assert.equal(catalogDrift.commands.some((command) => command.args.join(" ").includes("CREATE TABLE IF NOT EXISTS public.axtro_schema_migrations")), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("application UUIDv7 boundary rejects UUIDv4 before any database command", () => {
  const valid = domain.uuidV7FromParts(1_700_000_000_000, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(database.assertApplicationUuidV7(valid, "tenant_id"), valid);
  assert.throws(() => database.assertApplicationUuidV7("550e8400-e29b-41d4-a716-446655440000", "tenant_id"));
  assert.throws(() => database.assertApplicationUuidV7("018bcfe5-6800-7abc-0f01-020304050607", "tenant_id"));
});

function createMigrationFixture() {
  const directory = mkdtempSync(join(tmpdir(), "axtro-migrations-fixture-"));
  writeFileSync(join(directory, "0001_fixture.sql"), "BEGIN;\nSELECT 1;\nCOMMIT;\n", "utf8");
  writeFileSync(join(directory, "0002_fixture.sql"), "BEGIN;\nSELECT 2;\nCOMMIT;\n", "utf8");
  return directory;
}

function createStatefulExecutor(options = {}) {
  const history = [...(options.initialHistory ?? [])];
  const commands = [];
  const migrationFiles = [];
  const sentinels = new Set(options.appliedWithoutReceipt ?? []);
  let historyExists = options.historyExists ?? false;
  let failedReceipt = false;
  return {
    commands,
    migrationFiles,
    executor(command) {
      commands.push(command);
      const commandIndex = command.args.indexOf("--command");
      const sql = commandIndex >= 0 ? command.args[commandIndex + 1] : "";
      if (sql.includes("CREATE TABLE IF NOT EXISTS public.axtro_schema_migrations")) {
        historyExists = true;
        options.onHistoryBootstrap?.();
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command.args.includes("--file")) {
        const file = command.args.at(-1);
        migrationFiles.push(file);
        const version = Number(/\/(\d{4})_/.exec(file)?.[1]);
        if (options.failMigrationVersion === version) return { status: 1, stdout: "", stderr: "fixture migration failure" };
        sentinels.add(version);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (sql.includes("to_regclass('public.axtro_schema_migrations')")) {
        return { status: 0, stdout: historyExists ? "1\n" : "0\n", stderr: "" };
      }
      if (sql.includes("SELECT version ||")) {
        return {
          status: 0,
          stdout: history.map((entry) => `${entry.version}\t${entry.filename}\t${entry.checksumSha256}`).join("\n"),
          stderr: "",
        };
      }
      if (sql.includes("INSERT INTO public.axtro_schema_migrations")) {
        const match = /VALUES \((\d+), '([^']+)', '([0-9a-f]{64})'\)/.exec(sql);
        assert.notEqual(match, null);
        const version = Number(match[1]);
        if (!failedReceipt && options.failReceiptVersion === version) {
          failedReceipt = true;
          return { status: 1, stdout: "", stderr: "fixture receipt failure" };
        }
        history.push({ version, filename: match[2], checksumSha256: match[3] });
        return { status: 0, stdout: "", stderr: "" };
      }
      if (sql.includes("uuid_v7")) return { status: 0, stdout: sentinels.has(1) ? "1\n" : "0\n", stderr: "" };
      if (sql.includes("public.tenants")) return { status: 0, stdout: sentinels.has(2) ? "1\n" : "0\n", stderr: "" };
      if (sql.includes("WITH expected_tables")) return { status: 0, stdout: `${options.catalogStatus ?? "ok"}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}
