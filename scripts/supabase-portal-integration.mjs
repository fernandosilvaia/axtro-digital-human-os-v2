import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const database = await import(new URL("../packages/database/dist/index.js", import.meta.url));
const domain = await import(new URL("../packages/domain/dist/index.js", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseMigrationDirectory = join(repositoryRoot, "database", "supabase-only");
const externalDatabaseUrl = process.env.AXTRO_LOCAL_DATABASE_URL;
const postgresBin = resolvePostgresBin();
const psqlPath = process.env.AXTRO_PSQL_PATH ?? (postgresBin === null ? "psql" : join(postgresBin, "psql"));

const fixture = Object.freeze({
  tenantAlpha: "019f0000-0000-7000-8000-000000000001",
  tenantBeta: "019f0000-0000-7000-8000-000000000002",
  tenantGamma: "019f0000-0000-7000-8000-000000000003",
  tenantDelta: "019f0000-0000-7000-8000-000000000004",
  tenantEpsilon: "019f0000-0000-7000-8000-000000000005",
  tenantZeta: "019f0000-0000-7000-8000-000000000006",
  agentAlpha: "019f0000-0000-7000-8000-000000000101",
  agentBeta: "019f0000-0000-7000-8000-000000000102",
  agentGamma: "019f0000-0000-7000-8000-000000000103",
  agentDelta: "019f0000-0000-7000-8000-000000000104",
  agentEpsilon: "019f0000-0000-7000-8000-000000000105",
  agentZeta: "019f0000-0000-7000-8000-000000000106",
  actorAlpha: "019f0000-0000-7000-8000-000000000201",
  actorBeta: "019f0000-0000-7000-8000-000000000202",
  actorGamma: "019f0000-0000-7000-8000-000000000203",
  actorDelta: "019f0000-0000-7000-8000-000000000204",
  userAlpha: "10000000-0000-4000-8000-000000000001",
  userBeta: "10000000-0000-4000-8000-000000000002",
  userGamma: "10000000-0000-4000-8000-000000000003",
  userDelta: "10000000-0000-4000-8000-000000000004",
  transcriptBase: "019f0000-0000-7000-8000-000000001000",
  providerTranscript: "019f0000-0000-7000-8000-000000001100",
});

function parseCanonicalOutboxInteractionEvent(envelope) {
  const { payload_json: payloadJson, ...event } = envelope;
  return domain.parseInteractionEvent({ ...event, payload: JSON.parse(payloadJson) });
}

let cluster;
let temporaryDirectory;
let baseDatabaseUrl;
let testDatabaseName;
let primaryError;
let cleanupStarted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    const cleanupErrors = cleanupResources();
    if (cleanupErrors.length > 0) console.error(`SUPABASE PORTAL CLEANUP FAILED: ${cleanupErrors.join("; ")}`);
    process.exit(1);
  });
}

try {
  baseDatabaseUrl = await resolveBaseDatabaseUrl();
  testDatabaseName = `axtro_portal_${process.pid}_${Date.now()}`;
  createDatabase(baseDatabaseUrl, psqlPath, testDatabaseName);
  const databaseUrl = databaseUrlFor(baseDatabaseUrl, testDatabaseName);

  // The portal layer was built on the stable portable 0001-0011 contract.
  // Newer portable migrations have their own gate and are intentionally not
  // pulled into this Supabase-only upgrade harness implicitly.
  const portable = database.applyLocalMigrations({ databaseUrl, psqlPath, targetVersion: 11 });
  assert.equal(portable.history.length, 11, "portable migrations 0001-0011 must apply first");
  assertSucceeded(runSql(databaseUrl, authPreludeSql()), "Supabase auth and role prelude");
  assertSucceeded(runSql(databaseUrl, postPortablePreludeSql()), "post-portable grants and deterministic fixtures");
  assertSucceeded(runSql(databaseUrl, vaultPreludeSql()), "Supabase Vault schema stub for local testing");

  const preExpandApplied = applySupabaseMigrations(databaseUrl, 1, 39);
  assert.deepEqual(preExpandApplied, Array.from({ length: 39 }, (_, index) => String(index + 1).padStart(4, "0")));
  assertProductionIntegrityMigrationRollback(databaseUrl);
  const expandApplied = [...preExpandApplied, ...applySupabaseMigrations(databaseUrl, 40, 40)];
  assert.deepEqual(expandApplied, Array.from({ length: 40 }, (_, index) => String(index + 1).padStart(4, "0")));
  assertExpandPhase(databaseUrl);
  const contractApplied = applySupabaseMigrations(databaseUrl, 41, 41);
  assert.deepEqual(contractApplied, ["0041"]);
  assertContractPhase(databaseUrl);
  const ledgerContractApplied = applySupabaseMigrations(databaseUrl, 42, 42);
  assert.deepEqual(ledgerContractApplied, ["0042"]);
  assertLedgerContractPhase(databaseUrl);
  const runtimeBridgeApplied = applySupabaseMigrations(databaseUrl, 43, 43);
  assert.deepEqual(runtimeBridgeApplied, ["0043"]);
  assertRuntimeBridgeContractPhase(databaseUrl);
  const runtimeBridgeIntegrityApplied = applySupabaseMigrations(databaseUrl, 44, 44);
  assert.deepEqual(runtimeBridgeIntegrityApplied, ["0044"]);
  assertRuntimeBridgeIntegrityRepairPhase(databaseUrl);
  const meetingStatusOverloadApplied = applySupabaseMigrations(databaseUrl, 45, 45);
  assert.deepEqual(meetingStatusOverloadApplied, ["0045"]);
  assertMeetingStatusOverloadRepairPhase(databaseUrl);
  const terminationFenceApplied = applySupabaseMigrations(databaseUrl, 46, 46);
  assert.deepEqual(terminationFenceApplied, ["0046"]);
  const appSchemaPrivilegesBefore = appSchemaPrivilegeSnapshot(databaseUrl);
  assert.equal(queryScalar(databaseUrl, "SELECT has_schema_privilege('service_role','app','USAGE');"), "f",
    "the harness must not mask the production service-role app-schema ACL gap before 0047");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_runtime_channel_status_service(
      '${fixture.tenantAlpha}'::app.uuid_v7,'${fixture.agentAlpha}'::app.uuid_v7,'bootstrap_probe','bootstrap_probe'
    );
  `)), "service role cannot invoke an explicitly typed app.uuid_v7 service RPC before the schema/type grant", /permission denied for schema app/);
  const serviceRoleSchemaUsageApplied = applySupabaseMigrations(databaseUrl, 47, 47);
  assert.deepEqual(serviceRoleSchemaUsageApplied, ["0047"]);
  assertServiceRoleAppSchemaUsagePhase(databaseUrl, appSchemaPrivilegesBefore);
  await assertPreV48TavusStageTimestampRegression(databaseUrl);
  const tavusStageTimestampApplied = applySupabaseMigrations(databaseUrl, 48, 48);
  assert.deepEqual(tavusStageTimestampApplied, ["0048"]);
  assertTavusStageSettlementTimestampPhase(databaseUrl);
  await assertTerminationFencePhase(databaseUrl, { expectedSchemaVersion: 48, expectTimestampFence: true });
  assertFailed(runFile(databaseUrl, join(supabaseMigrationDirectory, "0040_production_integrity_hardening.sql")), "non-idempotent 0040 cannot be replayed without a migration receipt gate");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.axtro_supabase_test_migrations;"), "48");
  seedPreV49CanonicalOutboxPayloadShapes(databaseUrl);
  const textPreviewApplied = applySupabaseMigrations(databaseUrl, 49, 49);
  assert.deepEqual(textPreviewApplied, ["0049"]);
  assertPortalTextPreviewCapabilityPhase(databaseUrl);
  assertSchemaLineageCapabilities(databaseUrl, 49, { textPreview: true, terminalNotification: false, businessActions: false });
  const terminalNotificationApplied = applySupabaseMigrations(databaseUrl, 50, 50);
  assert.deepEqual(terminalNotificationApplied, ["0050"]);
  await assertMeetingTerminalNotificationClaimPhase(databaseUrl);
  assertSchemaLineageCapabilities(databaseUrl, 50, { textPreview: true, terminalNotification: true, businessActions: false });
  const businessActionApplied = applySupabaseMigrations(databaseUrl, 51, 51);
  assert.deepEqual(businessActionApplied, ["0051"]);
  assertBusinessActionBridgeContractPhase(databaseUrl);
  const calendarSchedulingApplied = applySupabaseMigrations(databaseUrl, 52, 52);
  assert.deepEqual(calendarSchedulingApplied, ["0052"]);
  assertBusinessActionCalendarSchedulingPhase(databaseUrl);
  const calendarCredentialReadApplied = applySupabaseMigrations(databaseUrl, 53, 53);
  assert.deepEqual(calendarCredentialReadApplied, ["0053"]);
  assertBusinessActionCalendarCredentialReadPhase(databaseUrl);
  const liveCallContextApplied = applySupabaseMigrations(databaseUrl, 54, 54);
  assert.deepEqual(liveCallContextApplied, ["0054"]);
  assertBusinessActionLiveCallContextPhase(databaseUrl);
  // 0055 has no dedicated "phase" assertion function (see assertMigrationCapabilities'
  // comment on why portal_schema_capabilities_service() was deliberately
  // left untouched); its behavior is instead proven as an extension of
  // assertBusinessActionAdmissionAndLeads/assertBusinessActionCalendarScheduling
  // below, the same functions that already exercise every RPC it touches.
  const emailLengthBoundApplied = applySupabaseMigrations(databaseUrl, 55, 55);
  assert.deepEqual(emailLengthBoundApplied, ["0055"]);
  const lineageRepairApplied = applySupabaseMigrations(databaseUrl, 56, 56);
  assert.deepEqual(lineageRepairApplied, ["0056"]);
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.axtro_supabase_test_migrations;"), "56");
  assertSchemaLineageCapabilities(databaseUrl, 56, { textPreview: true, terminalNotification: true, businessActions: true });
  assertMigrationReceiptLineage(databaseUrl);

  assertMigrationCapabilities(databaseUrl);
  assertLeastPrivilege(databaseUrl);
  assertWorkerHeartbeatLifecycle(databaseUrl);
  assertTranscriptValidation(databaseUrl);
  assertTranscriptTenantBoundaryAndLimit(databaseUrl);
  await assertProviderTranscriptConcurrency(databaseUrl);
  await assertBillingCheckoutContract(databaseUrl);
  await assertBillingCheckoutP1Hardening(databaseUrl);
  assertUsageSummaryLedgerTotals(databaseUrl);
  assertKnowledgeSourceDeletionRetention(databaseUrl);
  await assertReservationContract(databaseUrl);
  await assertAiUsageConcurrencyCap(databaseUrl);
  await assertTavusWebhookCapabilityFencing(databaseUrl);
  assertTavusDeliveryAndStageCapabilities(databaseUrl);
  await assertTavusNoDeliveryBudget(databaseUrl);
  assertProviderReconciliationLease(databaseUrl);
  assertRecallWebhookLeaseFencing(databaseUrl);
  assertProviderCommitPeriodBoundary(databaseUrl);
  assertAiCommitPeriodBoundary(databaseUrl);
  await assertStaleReservedSweepFencing(databaseUrl);
  assertRecallDailyPaidAttemptBudget(databaseUrl);
  assertCostEventSchemaVersion(databaseUrl);
  await assertRuntimeChannelBridge(databaseUrl);
  await assertPortalTextPreviewAdmission(databaseUrl);
  // assertBusinessActionAdmissionAndLeads is `async function` (unlike its
  // sibling assertBusinessActionCalendarScheduling right below, which is
  // synchronous) -- missing this `await` let the harness race ahead into
  // the next assertion before this one's internal awaited steps (including
  // its kill-switch admission/restore sequence) actually finished, since
  // Node only yields back to a caller's own continuation at each `await`
  // point. Found while verifying a kill-switch test fixture fix: reverting
  // that fix on its own produced a confusing, unrelated-looking failure
  // inside assertBusinessActionCalendarScheduling instead of the expected
  // one right here -- exactly the symptom of two assertions running
  // out of order against the same fixture tenant.
  await assertBusinessActionAdmissionAndLeads(databaseUrl);
  assertBusinessActionCalendarScheduling(databaseUrl);
  assertBusinessActionCalendarCredentialRead(databaseUrl);
  assertBusinessActionLiveCallContext(databaseUrl);

  console.log("SUPABASE PORTAL INTEGRATION PASSED: migrations 0001-0056 in contiguous order, immutable checksums, grants, RLS, transcripts, reservations and readiness capability");
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = cleanupResources();
  if (cleanupErrors.length > 0) {
    console.error(`SUPABASE PORTAL CLEANUP FAILED: ${cleanupErrors.join("; ")}`);
    if (primaryError === undefined) throw new Error("Supabase portal integration cleanup failed");
  }
}

function applySupabaseMigrations(databaseUrl, firstVersion, lastVersion) {
  const migrations = supabaseMigrationInventory();
  const applied = [];
  for (const migration of migrations) {
    const numericVersion = Number(migration.slice(0, 4));
    if (numericVersion < firstVersion || numericVersion > lastVersion) continue;
    const result = runFile(databaseUrl, join(supabaseMigrationDirectory, migration));
    assertSucceeded(result, `Supabase-only migration ${migration}`);
    const version = migration.slice(0, 4);
    const checksum = migrationChecksum(migration);
    assertSucceeded(runSql(databaseUrl, `INSERT INTO public.axtro_supabase_test_migrations (version, filename, checksum_sha256) VALUES (${Number(version)}, '${sqlLiteral(migration)}', '${checksum}');`), `migration test receipt ${migration}`);
    applied.push(version);
  }
  return applied;
}

function migrationChecksum(filename) {
  return createHash("sha256")
    .update(readFileSync(join(supabaseMigrationDirectory, filename)))
    .digest("hex");
}

function supabaseMigrationInventory() {
  const migrations = readdirSync(supabaseMigrationDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assert.equal(migrations.length, 56, "the harness must cover every Supabase-only migration through 0056");
  assert.deepEqual(
    migrations.map((migration) => Number(migration.slice(0, 4))),
    Array.from({ length: 56 }, (_, index) => index + 1),
    "Supabase-only migration versions must be contiguous and unique from 0001 through 0056",
  );
  assert.equal(migrations[48], "0049_portal_text_preview_admission.sql");
  assert.equal(migrations[49], "0050_meeting_terminal_notification_claim.sql");
  assert.equal(migrationChecksum(migrations[48]), "79b24e7fdc768a30b02d3596b71799fae484043e37561ddfcd435f46076b3100");
  assert.equal(migrationChecksum(migrations[49]), "262e033328175f704f8cfef1cafdcb0a2ef9b9aac7e4cc86f2b33890044c7224");
  return migrations;
}

function assertMigrationReceiptLineage(databaseUrl) {
  const expected = supabaseMigrationInventory().map((filename, index) => (
    `${index + 1}|${filename}|${migrationChecksum(filename)}`
  ));
  const actual = queryRows(databaseUrl, `
    SELECT version::text || '|' || filename || '|' || checksum_sha256
    FROM public.axtro_supabase_test_migrations
    ORDER BY version;
  `);
  assert.deepEqual(actual, expected, "migration receipts preserve exact name, checksum and numeric order");
}

function assertSchemaLineageCapabilities(databaseUrl, expectedVersion, expected) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, expectedVersion);
  for (const capability of [
    "portalTextPreviewAdmission",
    "portalTextPreviewTurnFence",
    "portalTextPreviewEgressAuthorization",
    "portalTextPreviewProviderFailureReceipt",
    "portalTextTranscriptOptIn",
    "portalTextPreviewCleanup",
    "portalTextPreviewCanonicalOutbox",
    "portalTextPreviewSecurityBoundary",
    "legacyAuthenticatedChatTranscriptWriterAvailable",
  ]) assert.equal(capabilities[capability] === true, expected.textPreview, capability);
  assert.equal(capabilities.meetingTerminalNotificationClaim === true, expected.terminalNotification);
  if (expected.businessActions) {
    for (const capability of [
      "businessActionKillSwitches",
      "businessActionGrants",
      "businessActionReceipts",
      "businessActionLeads",
      "businessActionProposals",
      "businessActionCalendarReservations",
      "businessActionCalendarConnections",
      "businessActionCalendarCredentialRead",
      "businessActionLiveCallContext",
      "businessActionEmailLengthBound",
    ]) assert.equal(capabilities[capability], true, capability);
  }
}

function assertProductionIntegrityMigrationRollback(databaseUrl) {
  assertSucceeded(runSql(databaseUrl, "CREATE TABLE public.billing_usage_outbox (rollback_sentinel boolean NOT NULL);"),
    "0040 mid-migration failure sentinel");
  assertFailed(runFile(databaseUrl, join(supabaseMigrationDirectory, "0040_production_integrity_hardening.sql")),
    "0040 injected mid-migration conflict");
  assert.equal(queryScalar(databaseUrl, "SELECT to_regclass('public.provider_effect_reservations') IS NULL;"), "t",
    "0040 transaction rolls back objects created before the injected failure");
  assert.equal(queryScalar(databaseUrl, "SELECT to_regclass('public.ai_usage_reservations') IS NULL;"), "t",
    "0040 transaction does not leak objects created after the injected failure");
  assert.equal(queryScalar(databaseUrl, "SELECT to_regclass('public.billing_checkout_intents') IS NULL;"), "t",
    "0040 transaction does not leak checkout financial evidence");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.axtro_supabase_test_migrations;"), "39",
    "failed 0040 never receives a migration receipt");
  assertSucceeded(runSql(databaseUrl, "DROP TABLE public.billing_usage_outbox;"), "remove 0040 failure sentinel");
}

function assertExpandPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 40, "0040 is an explicit additive expand capability");
  assert.equal(capabilities.authenticatedProviderTranscriptPreclaimBlocked, undefined);
  assert.equal(capabilities.authenticatedMeetingBotPreclaimBlocked, undefined);
  assert.equal(capabilities.billingCheckoutIntents, true);
  assert.equal(capabilities.strictSubscriptionIdentity, true);
  assert.equal(capabilities.legacySubscriptionWriterRevoked, false);
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.user_tenant_memberships (user_id, tenant_id, actor_id, role)
    VALUES ('${fixture.userAlpha}', '${fixture.tenantAlpha}', '${fixture.actorAlpha}', 'tenant_admin');
  `), "expand-phase authenticated membership fixture");
  assertSucceeded(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `
    SELECT public.portal_upsert_conversation_transcript(
      '019f0000-0000-7000-8000-000000001090', '${fixture.agentAlpha}', 'video', 'expand-provider-preclaim', '[]'::jsonb, null
    );
  `)), "0040 preserves the legacy authenticated provider transcript writer");
  assertSucceeded(runSql(databaseUrl, `SELECT app.validate_transcript_turns('[{"role":"user","content":"hello","legacy_timestamp":"2026-08-13T00:00:00Z"}]'::jsonb);`),
    "0040 preserves the historical transcript extra-key compatibility");
}

function assertContractPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 41, "0041 closes the provider transcript contract");
  assert.equal(capabilities.authenticatedProviderTranscriptPreclaimBlocked, true);
  assert.equal(capabilities.authenticatedMeetingBotPreclaimBlocked, true);
  assert.equal(capabilities.billingCheckoutIntents, true);
  assert.equal(capabilities.strictSubscriptionIdentity, true);
  assert.equal(capabilities.legacySubscriptionWriterRevoked, true);
  assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('service_role',
    'public.portal_upsert_tenant_subscription_service(app.uuid_v7,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)','EXECUTE');`), "f");
  assertFailed(runSql(databaseUrl, `SELECT app.validate_transcript_turns('[{"role":"user","content":"hello","legacy_timestamp":"2026-08-13T00:00:00Z"}]'::jsonb);`),
    "0041 activates the strict exact transcript contract");
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `
    SELECT public.portal_upsert_conversation_transcript(
      '019f0000-0000-7000-8000-000000001091', '${fixture.agentAlpha}', 'video', 'contract-provider-preclaim', '[]'::jsonb, null
    );
  `)), "0041 rejects authenticated provider transcript preclaim");
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `
    SELECT public.portal_record_meeting_bot_session(
      '019f0000-0000-7000-8000-000000001092', '${fixture.agentAlpha}',
      '11111111-1111-4111-8111-111111111111', 'https://meet.example.test/private', null
    );
  `)), "0041 rejects authenticated meeting-bot provider-ref preclaim");
  assert.equal(queryScalar(databaseUrl, `SELECT coalesce(bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE')),false)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='portal_record_meeting_bot_session';`), "t");
}

function assertLedgerContractPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 42, "0042 closes the direct legacy cost-writer contract");
  assert.equal(capabilities.costEventSchemaVersion, true);
  assert.equal(capabilities.legacyCostWritersRevoked, true);
  assert.equal(queryScalar(databaseUrl, `SELECT column_default IS NOT NULL AND is_nullable = 'NO'
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cost_events' AND column_name='schema_version';`), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT exists(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.cost_events'::regclass
      AND conname='cost_events_schema_version_check'
      AND contype='c'
  );`), "t");

  const legacyWriters = [
    {
      label: "legacy authenticated AI ledger writer",
      signature: "public.portal_log_ai_usage(app.uuid_v7,text,integer,integer,numeric)",
      invocation: "SELECT public.portal_log_ai_usage('019f0000-0000-7000-8000-000000009421','portal.legacy.ai',1,1,null);",
      costEventId: "019f0000-0000-7000-8000-000000009421",
    },
    {
      label: "legacy service AI ledger writer",
      signature: "public.portal_log_ai_usage_service(app.uuid_v7,app.uuid_v7,integer,integer)",
      invocation: `SELECT public.portal_log_ai_usage_service('${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009424',1,1);`,
      costEventId: "019f0000-0000-7000-8000-000000009424",
    },
    {
      label: "legacy authenticated video ledger writer",
      signature: "public.portal_log_video_usage(app.uuid_v7)",
      invocation: "SELECT public.portal_log_video_usage('019f0000-0000-7000-8000-000000009422');",
      costEventId: "019f0000-0000-7000-8000-000000009422",
    },
    {
      label: "legacy service video ledger writer",
      signature: "public.portal_log_video_usage_service(app.uuid_v7,app.uuid_v7)",
      invocation: `SELECT public.portal_log_video_usage_service('${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009423');`,
      costEventId: "019f0000-0000-7000-8000-000000009423",
    },
  ];
  for (const writer of legacyWriters) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('${role}','${writer.signature}','EXECUTE');`), "f",
        `${writer.label} is revoked for ${role}`);
    }
    assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, writer.invocation)),
      `${writer.label} cannot write under authenticated`);
    assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, writer.invocation)),
      `${writer.label} cannot write under service_role`);
    assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.cost_events WHERE id='${writer.costEventId}';`), "0",
      `${writer.label} failure writes no cost event`);
  }
}

function assertRuntimeBridgeContractPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 43, "0043 enables the runtime bridge contract");
  for (const capability of ["runtimeChannelAdmission", "runtimeChannelGrantFences", "runtimeProviderBindingReceipts", "runtimeSceneReceipts", "runtimeKillSwitches", "runtimeDualOperatorReconciliation"]) {
    assert.equal(capabilities[capability], true, capability);
  }
}

function assertRuntimeBridgeIntegrityRepairPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 44, "0044 enables the runtime bridge receipt-integrity contract");
  assert.equal(capabilities.runtimeBridgeReceiptIntegrity, true);
}

function assertBusinessActionBridgeContractPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 51, "0051 enables the ADR-039 wave 1a business action admission contract");
  for (const capability of ["businessActionKillSwitches", "businessActionGrants", "businessActionReceipts", "businessActionLeads"]) {
    assert.equal(capabilities[capability], true, capability);
  }
}

function assertBusinessActionCalendarSchedulingPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 52, "0052 enables the ADR-039 wave 1b calendar scheduling contract");
  for (const capability of ["businessActionProposals", "businessActionCalendarReservations", "businessActionCalendarConnections"]) {
    assert.equal(capabilities[capability], true, capability);
  }
}

function assertBusinessActionCalendarCredentialReadPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 53, "0053 enables the ADR-039 wave 1b-iii decrypted refresh token read contract");
  assert.equal(capabilities.businessActionCalendarCredentialRead, true);
}

function assertBusinessActionLiveCallContextPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 54, "0054 enables the ADR-041 live-call-context read contract");
  assert.equal(capabilities.businessActionLiveCallContext, true);
  assert.equal(queryScalar(databaseUrl,
    "SELECT to_regprocedure('public.portal_business_action_call_context_service(app.uuid_v7,app.uuid_v7,text)') IS NOT NULL;"), "t");
}

function assertMeetingStatusOverloadRepairPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 45, "0045 drops the ambiguous 2-arg meeting status overload");
  assert.equal(capabilities.meetingBotStatusUpdateUnambiguous, true);
  // Reproduces the exact production failure (42725: function ... is not
  // unique) found 2026-08-18 while investigating the media-boundary P0: the
  // PostgREST calling convention for a non-terminal status omits
  // p_delivery_id/p_claim_token entirely, which was ambiguous between the
  // 0021 2-arg overload and the 0040 4-arg-with-defaults overload before
  // 0045. Asserting the call now succeeds (not just that the capability flag
  // says so) is the only way this regression would be caught again.
  assert.equal(
    queryJson(databaseUrl, asRoleSql("service_role", null,
      "SELECT public.portal_update_meeting_bot_session_status_service(p_recall_bot_id => 'nonexistent-diagnostic-probe', p_status => 'joining');")).found,
    false,
    "the 2-arg calling convention must resolve unambiguously to the surviving 4-arg overload",
  );
}

async function assertPreV48TavusStageTimestampRegression(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 47, "the pre-v48 fixture must execute the legacy settlement function");
  const tenantId = "019f0000-0000-7000-8000-000000000009";
  const agentId = "019f0000-0000-7000-8000-000000000109";
  const userId = "10000000-0000-4000-8000-000000000007";
  const actorId = "019f0000-0000-7000-8000-000000000210";
  const reservationId = "019f0000-0000-7000-8000-000000004800";
  const costEventId = "019f0000-0000-7000-8000-000000004801";
  const subscriptionId = "019f0000-0000-7000-8000-000000004802";
  const receiptId = "019f0000-0000-7000-8000-000000004803";
  const leaseToken = "019f0000-0000-7000-8000-000000004804";
  const stageTokenHash = "d".repeat(64);
  const raceBarrierLockId = 48_047;

  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users(id,email) VALUES ('${userId}','v48-pre-race@example.test');
    INSERT INTO public.tenants(id,slug,legal_name,status,home_region,default_language,default_timezone)
      VALUES ('${tenantId}','v48-pre-race','V48 Pre Race','active','local','en','UTC');
    INSERT INTO public.agents(tenant_id,id,name,role_type,status,disclosure_profile_id)
      VALUES ('${tenantId}','${agentId}','V48 Pre Race Agent','sales','active','default');
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
      VALUES ('${userId}','${tenantId}','${actorId}','tenant_admin');
    INSERT INTO public.tenant_subscriptions(
    id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end
  ) VALUES ('${subscriptionId}','${tenantId}','cus_V48PreRace','sub_V48PreRace','piloto','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');`),
  "pre-v48 Tavus stage race subscription");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, "v48-pre-stage-race", reservationId, costEventId, "tavus",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','tavus-v48-pre-race-ref','https://tavus.daily.co/v48-pre-race',null);`)).committed, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_begin_provider_effect_termination_service(
      '${receiptId}','${leaseToken}','${tenantId}','${userId}','${actorId}','${agentId}',
      'v48-pre-stage-race','tavus',60
    );
  `)).outcome, "dispatch_granted");

  const legacySettle = runSqlAsync(databaseUrl, asRoleSql("service_role", null, `
    BEGIN;
    SELECT pg_advisory_xact_lock(${raceBarrierLockId});
    SELECT pg_sleep(0.2);
    SELECT public.portal_settle_provider_effect_termination_service('${tenantId}','${receiptId}','${leaseToken}','provider_accepted');
    COMMIT;
  `));
  await waitForAdvisoryLockHolder(databaseUrl, raceBarrierLockId);
  const creator = await runSqlAsync(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_create_tavus_stage_capability_service('${tenantId}','${agentId}','${reservationId}','${stageTokenHash}','https://tavus.daily.co/v48-pre-race');`));
  assertSucceeded(creator, "pre-v48 stage creator after the settle transaction has started");
  assert.equal(parseLastJson(creator.stdout).created, true);
  assertFailed(await legacySettle, "pre-v48 settle must fail the expiry constraint under the observed transaction ordering", /tavus_stage_expiry_chk/);
  assert.equal(queryScalar(databaseUrl, `SELECT expires_at<=updated_at+interval '45 minutes' FROM public.tavus_stage_capabilities WHERE reservation_id='${reservationId}';`), "t",
    "the legacy failure preserves the existing constraint instead of weakening it");
  assertSucceeded(runSql(databaseUrl, `
    DELETE FROM public.tavus_stage_capabilities WHERE reservation_id='${reservationId}';
    DELETE FROM public.provider_effect_termination_receipts WHERE reservation_id='${reservationId}';
    DELETE FROM public.provider_effect_reservations WHERE id='${reservationId}';
    DELETE FROM public.tenant_subscriptions WHERE id='${subscriptionId}';
  `), "isolate the pre-v48 regression fixture without deleting append-only cost evidence");
}

async function assertTerminationFencePhase(databaseUrl, { expectedSchemaVersion, expectTimestampFence }) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, expectedSchemaVersion, "the termination fence phase must observe its explicit migration version");
  assert.equal(capabilities.providerEffectTerminationFence, true);
  assert.equal(queryScalar(databaseUrl, "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.provider_effect_termination_receipts'::regclass;"), "t");
  assert.equal(queryScalar(databaseUrl, "SELECT has_function_privilege('authenticated','public.portal_begin_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,text,text,integer)','EXECUTE');"), "f");

  // tenantAlpha/userAlpha/actorAlpha already has a tenant_admin membership
  // from the base prelude (line ~178) — reusing it avoids inventing a new
  // membership fixture just for this phase. This phase runs immediately
  // after migrations, before any other test has given a tenant a
  // subscription — portal_begin_provider_effect_service returns
  // outcome:"capped"/bucket:"billing_status" for a tenant with none (0040
  // line ~856), identical in shape to a cap-bucket exhaustion. The
  // subscription/reservation fixtures are deleted at the end of this
  // function, same isolation pattern already used at the end of
  // assertBillingCheckoutContract.
  const tenantId = fixture.tenantAlpha;
  const agentId = fixture.agentAlpha;
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.tenant_subscriptions
      (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004602','${tenantId}','cus_HarnessAlphaTermination','sub_HarnessAlphaTermination','piloto','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
  `), "termination-fence subscription fixture");

  const reservationId = "019f0000-0000-7000-8000-000000004600";
  const idempotencyKey = "termination-fence-fixture";
  assert.equal(
    queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
      tenantId, agentId, idempotencyKey, reservationId, "019f0000-0000-7000-8000-000000004601", "recall",
    ))).outcome,
    "reserved",
  );
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, true);
  const providerRef = "recall-bot-termination-fixture";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','${providerRef}',null,null);`)).committed, true,
  "the fence only ever begins termination for a committed reservation with a real provider ref");

  const beginTerminationSql = (receiptId, leaseToken, overrides = {}) => `
    SELECT public.portal_begin_provider_effect_termination_service(
      '${receiptId}','${leaseToken}','${overrides.tenantId ?? tenantId}','${overrides.userId ?? fixture.userAlpha}',
      '${overrides.actorId ?? fixture.actorAlpha}','${overrides.agentId ?? agentId}','${overrides.idempotencyKey ?? idempotencyKey}',
      '${overrides.provider ?? "recall"}'${overrides.leaseSeconds ? `,${overrides.leaseSeconds}` : ""}
    );
  `;
  const beginTermination = (receiptId, leaseToken, overrides = {}) => queryJson(databaseUrl, asRoleSql("service_role", null,
    beginTerminationSql(receiptId, leaseToken, overrides)));

  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_begin_provider_effect_termination_service(
      '019f0000-0000-7000-8000-000000004603','019f0000-0000-7000-8000-000000004604','${tenantId}','${fixture.userBeta}',
      '${fixture.actorBeta}','${agentId}','${idempotencyKey}','recall'
    );`)),
  "termination requires the CALLER's actor to hold a tenant_admin membership on the target tenant — a foreign actor cannot even attempt it", /tenant admin membership required/);
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    beginTerminationSql("019f0000-0000-7000-8000-000000004615", "019f0000-0000-7000-8000-000000004616", { actorId: fixture.actorBeta }))),
  "a user-to-actor mismatch is rejected with the same tenant-admin boundary", /tenant admin membership required/);
  for (const [overrides, expected] of [
    [{ agentId: fixture.agentBeta }, "not_stoppable"],
    [{ provider: "tavus" }, "not_stoppable"],
    [{ idempotencyKey: "wrong-termination-key" }, "not_started"],
  ]) {
    const result = beginTermination("019f0000-0000-7000-8000-000000004617", "019f0000-0000-7000-8000-000000004618", overrides);
    assert.deepEqual(result, { outcome: expected }, "wrong/missing target remains ref-free");
  }

  const firstReceiptId = "019f0000-0000-7000-8000-000000004605";
  const firstLeaseToken = "019f0000-0000-7000-8000-000000004606";
  const contenderReceiptId = "019f0000-0000-7000-8000-000000004607";
  const contenderLeaseToken = "019f0000-0000-7000-8000-000000004608";
  const concurrentBegins = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, beginTerminationSql(firstReceiptId, firstLeaseToken))),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, beginTerminationSql(contenderReceiptId, contenderLeaseToken))),
  ]);
  for (const result of concurrentBegins) assertSucceeded(result, "concurrent termination begin");
  const concurrentOutcomes = concurrentBegins.map((result) => parseLastJson(result.stdout));
  assert.equal(concurrentOutcomes.filter((result) => result.outcome === "dispatch_granted").length, 1, "two database connections yield exactly one dispatch lease");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_termination_receipts WHERE reservation_id='${reservationId}';`), "1", "one concurrent receipt row");
  const grantedIndex = concurrentOutcomes.findIndex((result) => result.outcome === "dispatch_granted");
  const granted = concurrentOutcomes[grantedIndex];
  assert.equal(granted.providerRef, providerRef, "the fence hands back the exact provider ref only to the winning server process");
  const winningReceiptId = grantedIndex === 0 ? firstReceiptId : contenderReceiptId;
  const winningLeaseToken = grantedIndex === 0 ? firstLeaseToken : contenderLeaseToken;

  const failedSettle = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_settle_provider_effect_termination_service('${tenantId}','${winningReceiptId}','${winningLeaseToken}','retryable_failure','provider_unavailable');
  `));
  assert.equal(failedSettle.outcome, "retry_after");
  assert.equal(
    beginTermination("019f0000-0000-7000-8000-000000004609", "019f0000-0000-7000-8000-000000004610").outcome,
    "retry_after",
    "a begin attempt inside the exponential backoff window must not dispatch a second provider call",
  );
  assert.equal(queryScalar(databaseUrl, `SELECT retry_after > now() FROM public.provider_effect_termination_receipts WHERE id='${winningReceiptId}';`), "t");

  const staleSettle = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_settle_provider_effect_termination_service('${tenantId}','${winningReceiptId}','${winningLeaseToken}','provider_accepted');
  `));
  assert.equal(staleSettle.outcome, "stale", "a lease already settled by the retryable-failure branch cannot be re-settled with a stale token");

  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_termination_receipts SET retry_after=now()-interval '1 second' WHERE id='${winningReceiptId}';`),
    "fast-forward past the backoff window to exercise the accepted path without a real 15s wait");
  const secondReceiptId = "019f0000-0000-7000-8000-000000004611";
  const secondLeaseToken = "019f0000-0000-7000-8000-000000004612";
  const secondAttempt = beginTermination(secondReceiptId, secondLeaseToken);
  assert.equal(secondAttempt.outcome, "dispatch_granted");
  const accepted = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_settle_provider_effect_termination_service('${tenantId}','${secondReceiptId}','${secondLeaseToken}','provider_accepted');
  `));
  assert.equal(accepted.outcome, "accepted");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "completed",
    "a provider-accepted termination is the only path that marks the reservation completed");
  assert.match(
    queryScalar(databaseUrl, `SELECT provider_receipt_ref FROM public.provider_effect_termination_receipts WHERE id='${secondReceiptId}';`),
    /^termination:recall:sha256:[0-9a-f]{64}$/,
  );

  assert.equal(beginTermination("019f0000-0000-7000-8000-000000004613", "019f0000-0000-7000-8000-000000004614").outcome, "accepted",
    "a replayed begin after acceptance is idempotent, never a second dispatch");

  const expiredReservationId = "019f0000-0000-7000-8000-000000004626";
  const expiredKey = "termination-expired-lease";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, expiredKey, expiredReservationId, "019f0000-0000-7000-8000-000000004627", "recall",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${expiredReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${expiredReservationId}','recall-expired-lease-ref',null,null);`)).committed, true);
  const expiredBegin = (receiptId, leaseToken) => beginTermination(receiptId, leaseToken, { idempotencyKey: expiredKey });
  const expiredFirstId = "019f0000-0000-7000-8000-000000004628";
  const expiredFirstLease = "019f0000-0000-7000-8000-000000004629";
  assert.equal(expiredBegin(expiredFirstId, expiredFirstLease).outcome, "dispatch_granted");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_termination_receipts SET lease_until=now()-interval '1 second' WHERE id='${expiredFirstId}';`), "expire live termination lease");
  const expiredSecondId = "019f0000-0000-7000-8000-000000004630";
  assert.equal(expiredBegin(expiredSecondId, "019f0000-0000-7000-8000-000000004631").outcome, "dispatch_granted", "an expired live lease creates attempt 2");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_termination_receipts WHERE reservation_id='${expiredReservationId}';`), "2");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_settle_provider_effect_termination_service('${tenantId}','${expiredFirstId}','${expiredFirstLease}','provider_accepted');`)).outcome, "stale",
  "stale settle after a replaced lease cannot mutate the reservation");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${expiredReservationId}';`), "committed");

  const tavusReservationId = "019f0000-0000-7000-8000-000000004632";
  const tavusTokenHash = "a".repeat(64);
  const tavusTenantId = expectTimestampFence
    ? "019f0000-0000-7000-8000-000000000008"
    : "019f0000-0000-7000-8000-000000000007";
  const tavusAgentId = expectTimestampFence
    ? "019f0000-0000-7000-8000-000000000108"
    : "019f0000-0000-7000-8000-000000000107";
  const tavusUserId = expectTimestampFence
    ? "10000000-0000-4000-8000-000000000006"
    : "10000000-0000-4000-8000-000000000005";
  const tavusActorId = expectTimestampFence
    ? "019f0000-0000-7000-8000-000000000209"
    : "019f0000-0000-7000-8000-000000000208";
  const tavusSlug = expectTimestampFence ? "termination-stage-v48" : "termination-stage-v47";
  const tavusEmail = expectTimestampFence ? "termination-stage-v48@example.test" : "termination-stage-v47@example.test";
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users(id,email) VALUES ('${tavusUserId}','${tavusEmail}');
    INSERT INTO public.tenants(id,slug,legal_name,status,home_region,default_language,default_timezone)
      VALUES ('${tavusTenantId}','${tavusSlug}','Termination Stage Harness','active','local','en','UTC');
    INSERT INTO public.agents(tenant_id,id,name,role_type,status,disclosure_profile_id)
      VALUES ('${tavusTenantId}','${tavusAgentId}','Termination Stage Agent','sales','active','default');
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role) VALUES ('${tavusUserId}','${tavusTenantId}','${tavusActorId}','tenant_admin');
    INSERT INTO public.tenant_subscriptions(id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
      VALUES ('019f0000-0000-7000-8000-000000004636','${tavusTenantId}','cus_TerminationStage','sub_TerminationStage','piloto','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
  `), "isolated Tavus termination fixture tenant");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tavusTenantId, tavusAgentId, "termination-tavus-stage", tavusReservationId, "019f0000-0000-7000-8000-000000004633", "tavus",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${tavusReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${tavusReservationId}','tavus-termination-stage-ref','https://tavus.daily.co/termination-stage',null);`)).committed, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_create_tavus_stage_capability_service('${tavusTenantId}','${tavusAgentId}','${tavusReservationId}','${tavusTokenHash}','https://tavus.daily.co/termination-stage');`)).created, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${tavusTokenHash}');`)).found, true);
  if (expectTimestampFence) {
    const resolverExpiryLockId = 48_049;
    assertSucceeded(runSql(databaseUrl, `UPDATE public.tavus_stage_capabilities
      SET expires_at=clock_timestamp()+interval '120 milliseconds',updated_at=clock_timestamp()
      WHERE reservation_id='${tavusReservationId}';`), "make a live stage capability expire while its row is locked");
    const resolverLocker = runSqlAsync(databaseUrl, `
      BEGIN;
      SELECT 1 FROM public.tavus_stage_capabilities WHERE reservation_id='${tavusReservationId}' FOR UPDATE;
      SELECT pg_advisory_xact_lock(${resolverExpiryLockId});
      SELECT pg_sleep(0.3);
      COMMIT;
    `);
    await waitForAdvisoryLockHolder(databaseUrl, resolverExpiryLockId);
    const delayedResolver = runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_resolve_tavus_stage_capability_service('${tavusTokenHash}');`));
    assertSucceeded(await resolverLocker, "release the stage row after its wall-clock expiry");
    assertSucceeded(await delayedResolver, "resolver waits safely for the expired stage row");
    assert.deepEqual(parseLastJson((await delayedResolver).stdout), { found: false },
      "a resolver that waited past expiry never returns a room URL based on transaction-start now()");
  }
  const tavusTermination = beginTermination("019f0000-0000-7000-8000-000000004634", "019f0000-0000-7000-8000-000000004635", { tenantId: tavusTenantId, userId: tavusUserId, actorId: tavusActorId, agentId: tavusAgentId, idempotencyKey: "termination-tavus-stage", provider: "tavus" });
  assert.equal(tavusTermination.outcome, "dispatch_granted");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_settle_provider_effect_termination_service('${tavusTenantId}','019f0000-0000-7000-8000-000000004634','019f0000-0000-7000-8000-000000004635','provider_accepted');`)).outcome, "accepted");
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${tavusTokenHash}');`)), { found: false }, "accepted Tavus termination never returns a room URL");
  assert.equal(queryScalar(databaseUrl, `SELECT revoked_at is not null FROM public.tavus_stage_capabilities WHERE reservation_id='${tavusReservationId}';`), "t");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_create_tavus_stage_capability_service('${tavusTenantId}','${tavusAgentId}','${tavusReservationId}','${"b".repeat(64)}','https://tavus.daily.co/termination-stage');`)),
  "a completed terminated Tavus reservation cannot re-open a stage capability");

  const naturalReservationId = "019f0000-0000-7000-8000-000000004637";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tavusTenantId, tavusAgentId, "termination-natural-complete", naturalReservationId, "019f0000-0000-7000-8000-000000004638", "tavus",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_mark_provider_effect_in_flight_service('${naturalReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_commit_provider_effect_service('${naturalReservationId}','tavus-natural-complete-ref','https://tavus.daily.co/natural-complete',null);`)).committed, true);
  const naturalReceiptId = "019f0000-0000-7000-8000-000000004639";
  const naturalLeaseToken = "019f0000-0000-7000-8000-000000004640";
  assert.equal(beginTermination(naturalReceiptId, naturalLeaseToken, { tenantId: tavusTenantId, userId: tavusUserId, actorId: tavusActorId, agentId: tavusAgentId, idempotencyKey: "termination-natural-complete", provider: "tavus" }).outcome, "dispatch_granted");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_reservations SET state='completed',completed_at=now() WHERE id='${naturalReservationId}';`), "natural completion before termination settle");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_settle_provider_effect_termination_service('${tavusTenantId}','${naturalReceiptId}','${naturalLeaseToken}','provider_accepted');`)).outcome, "accepted", "natural completion settles the already-dispatched receipt without another provider call");

  const raceReservationId = "019f0000-0000-7000-8000-000000004641";
  const raceTokenHash = "c".repeat(64);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tavusTenantId, tavusAgentId, "termination-stage-race", raceReservationId, "019f0000-0000-7000-8000-000000004642", "tavus",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_mark_provider_effect_in_flight_service('${raceReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_commit_provider_effect_service('${raceReservationId}','tavus-stage-race-ref','https://tavus.daily.co/stage-race',null);`)).committed, true);
  const raceReceiptId = "019f0000-0000-7000-8000-000000004643";
  const raceLeaseToken = "019f0000-0000-7000-8000-000000004644";
  assert.equal(beginTermination(raceReceiptId, raceLeaseToken, { tenantId: tavusTenantId, userId: tavusUserId, actorId: tavusActorId, agentId: tavusAgentId, idempotencyKey: "termination-stage-race", provider: "tavus" }).outcome, "dispatch_granted");
  const raceBarrierLockId = 48_048;
  const raceBarrierName = expectTimestampFence ? "stage-race-v48-created" : "stage-race-v47-created";
  const raceSettlePromise = runSqlAsync(databaseUrl, asRoleSql("service_role", null, `
    BEGIN;
    SELECT pg_advisory_xact_lock(${raceBarrierLockId});
    DO $barrier$
    DECLARE
      deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (
          SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${raceBarrierName}'
        );
        IF clock_timestamp() >= deadline THEN
          RAISE EXCEPTION 'stage race barrier timeout';
        END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    SELECT public.portal_settle_provider_effect_termination_service('${tavusTenantId}','${raceReceiptId}','${raceLeaseToken}','provider_accepted');
    COMMIT;
  `));
  await waitForAdvisoryLockHolder(databaseUrl, raceBarrierLockId);
  let raceCreate;
  try {
    raceCreate = await runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_create_tavus_stage_capability_service('${tavusTenantId}','${tavusAgentId}','${raceReservationId}','${raceTokenHash}','https://tavus.daily.co/stage-race');`));
  } finally {
    assertSucceeded(runSql(databaseUrl,
      `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${raceBarrierName}') ON CONFLICT DO NOTHING;`),
    "release Tavus stage race barrier");
  }
  const raceSettle = await raceSettlePromise;
  assertSucceeded(runSql(databaseUrl,
    `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${raceBarrierName}';`),
  "clear Tavus stage race barrier");
  assertSucceeded(raceCreate, "Tavus stage creator after the settle transaction has started");
  assert.equal(parseLastJson(raceCreate.stdout).created, true);
  if (!expectTimestampFence) {
    assertFailed(raceSettle, "pre-v48 Tavus stage/termination race must expose the expiry constraint failure", /tavus_stage_expiry_chk/);
  } else {
    assertSucceeded(raceSettle, "Tavus stage/termination settle with a transaction-start timestamp older than the stage");
    assert.equal(parseLastJson(raceSettle.stdout).outcome, "accepted");
    assert.equal(queryScalar(databaseUrl, `SELECT expires_at<=updated_at+interval '45 minutes' FROM public.tavus_stage_capabilities WHERE reservation_id='${raceReservationId}';`), "t",
      "the deterministic older-settle/newer-stage ordering preserves tavus_stage_expiry_chk without extending expiry");
    assert.equal(queryScalar(databaseUrl, `SELECT revoked_at is not null FROM public.tavus_stage_capabilities WHERE reservation_id='${raceReservationId}';`), "t");
    assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_resolve_tavus_stage_capability_service('${raceTokenHash}');`)), { found: false }, "the create/settle race cannot leave a live stage URL");
  }

  assertSucceeded(runSql(databaseUrl, `
    DELETE FROM public.provider_effect_termination_receipts WHERE reservation_id='${reservationId}';
    DELETE FROM public.provider_effect_termination_receipts WHERE reservation_id='${expiredReservationId}';
    DELETE FROM public.provider_effect_reservations WHERE id='${reservationId}';
    DELETE FROM public.provider_effect_reservations WHERE id='${expiredReservationId}';
    DELETE FROM public.tavus_stage_capabilities WHERE reservation_id='${tavusReservationId}';
    DELETE FROM public.provider_effect_termination_receipts WHERE reservation_id='${tavusReservationId}';
    DELETE FROM public.provider_effect_reservations WHERE id='${tavusReservationId}';
    DELETE FROM public.provider_effect_termination_receipts WHERE reservation_id='${naturalReservationId}';
    DELETE FROM public.provider_effect_reservations WHERE id='${naturalReservationId}';
    DELETE FROM public.tavus_stage_capabilities WHERE reservation_id='${raceReservationId}';
    DELETE FROM public.provider_effect_termination_receipts WHERE reservation_id='${raceReservationId}';
    DELETE FROM public.provider_effect_reservations WHERE id='${raceReservationId}';
    DELETE FROM public.tenant_subscriptions WHERE tenant_id='${tenantId}';
  `), "isolate termination-fence fixtures from later provider-budget scenarios");
}

function appSchemaPrivilegeSnapshot(databaseUrl) {
  const roles = ["anon", "authenticated", "service_role"];
  return Object.fromEntries(roles.map((role) => [role, Object.freeze({
    schemaUsage: queryScalar(databaseUrl, `SELECT has_schema_privilege('${role}','app','USAGE');`),
    uuidV7Usage: queryScalar(databaseUrl, `SELECT has_type_privilege('${role}','app.uuid_v7','USAGE');`),
    tableGrants: queryRows(databaseUrl, `
      SELECT grantee || ':' || table_name || ':' || privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee='${role}' AND table_schema='app'
      ORDER BY 1;
    `),
    functionGrants: queryRows(databaseUrl, `
      SELECT grantee || ':' || routine_name || ':' || privilege_type
      FROM information_schema.role_routine_grants
      WHERE grantee='${role}' AND routine_schema='app'
      ORDER BY 1;
    `),
  })]));
}

function assertServiceRoleAppSchemaUsagePhase(databaseUrl, before) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 47, "0047 makes the service-role app schema/type grant an explicit capability");
  assert.equal(capabilities.serviceRoleAppSchemaUsage, true);
  assert.equal(queryScalar(databaseUrl, "SELECT has_schema_privilege('service_role','app','USAGE');"), "t");
  assert.equal(queryScalar(databaseUrl, "SELECT has_type_privilege('service_role','app.uuid_v7','USAGE');"), "t");
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_runtime_channel_status_service(
      '${fixture.tenantAlpha}'::app.uuid_v7,'${fixture.agentAlpha}'::app.uuid_v7,'bootstrap_probe','bootstrap_probe'
    );
  `)), { enabled: false }, "the typed, inert service RPC becomes callable after only the schema/type grant");
  assert.equal(queryScalar(databaseUrl, "SELECT has_function_privilege('service_role','public.portal_record_worker_heartbeat_service(text,app.uuid_v7,text,text,text,text,jsonb)','EXECUTE');"), "t",
    "service_role retains the heartbeat RPC boundary without a direct table grant");

  const after = appSchemaPrivilegeSnapshot(databaseUrl);
  for (const role of ["anon", "authenticated"]) {
    assert.deepEqual(after[role], before[role], `0047 does not alter app schema, type, table, or function privileges for ${role}`);
  }
  assert.deepEqual(after.service_role.tableGrants, before.service_role.tableGrants,
    "0047 grants no service-role table privilege in app");
  assert.deepEqual(after.service_role.functionGrants, before.service_role.functionGrants,
    "0047 grants no service-role function privilege in app");
}

function assertTavusStageSettlementTimestampPhase(databaseUrl) {
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 48, "0048 makes the Tavus settle timestamp fence an explicit capability");
  assert.equal(capabilities.tavusStageExpiryConcurrencyFence, true);
  for (const signature of [
    "public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)",
    "public.portal_resolve_tavus_stage_capability_service(text)",
    "public.portal_revoke_tavus_stage_capability_service(app.uuid_v7)",
  ]) {
    const definition = queryRows(databaseUrl, "SELECT regexp_replace(pg_get_functiondef('" + signature + "'::regprocedure), '\\s+', '', 'g');").join("");
    assert.match(definition, /v_stage_mutation_at:=clock_timestamp\(\)/,
      `${signature} captures a wall-clock timestamp after its locks`);
    assert.match(definition, /updated_at=greatest\(updated_at,v_stage_mutation_at,expires_at-interval'45minutes'\)/,
      `${signature} retains the 45-minute expiry bound while preventing a stale transaction timestamp from moving updated_at backwards`);
    if (signature === "public.portal_resolve_tavus_stage_capability_service(text)") {
      assert.match(definition, /c\.expires_at<=v_stage_mutation_at/,
        "the resolver compares expiry to wall time captured after acquiring its row lock");
    }
  }
}

function assertPortalTextPreviewCapabilityPhase(databaseUrl) {
  const serverVersionNum = Number(queryScalar(databaseUrl,
    "SELECT current_setting('server_version_num');"));
  assert.ok(Number.isInteger(serverVersionNum)
      && serverVersionNum >= 170000 && serverVersionNum < 180000,
  `canonical-envelope fingerprint requires PostgreSQL 17, received ${serverVersionNum}`);
  assert.equal(queryScalar(databaseUrl, `
    SELECT md5(regexp_replace(lower(pg_get_constraintdef(oid)),'\\s+','','g'))
    FROM pg_constraint
    WHERE conrelid='public.events_outbox'::regclass
      AND conname='events_outbox_event_document_canonical_check';
  `), "d9b3dba3ee3f690c55df3d1001446d9b",
  "PostgreSQL exposes the exact normalized canonical-envelope constraint fingerprint");
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 49, "0049 publishes the Portal text preview capability version");
  assert.equal(capabilities.portalTextPreviewAdmission, true);
  assert.equal(capabilities.portalTextPreviewTurnFence, true);
  assert.equal(capabilities.portalTextTranscriptOptIn, true);
  assert.equal(capabilities.portalTextPreviewCleanup, true);
  assert.equal(capabilities.portalTextPreviewCanonicalOutbox, true);
  assert.equal(capabilities.portalTextPreviewSecurityBoundary, true);
  assert.equal(capabilities.portalTextPreviewEgressAuthorization, true);
  assert.equal(capabilities.portalTextPreviewProviderFailureReceipt, true);
  assert.equal(capabilities.legacyAuthenticatedChatTranscriptWriterAvailable, true);
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*)
    FROM (VALUES
      ('public.portal_begin_ai_usage_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)'::regprocedure),
      ('public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)'::regprocedure),
      ('public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)'::regprocedure),
      ('public.portal_release_ai_usage_service(app.uuid_v7,text)'::regprocedure),
      ('public.portal_mark_ai_usage_unknown_service(app.uuid_v7,text)'::regprocedure)
    ) AS expected(oid)
    JOIN pg_proc p ON p.oid=expected.oid
    WHERE coalesce(p.proconfig,'{}'::text[])
      @> ARRAY['lock_timeout=2s','statement_timeout=15s'];
  `), "5", "all AI ledger mutation RPCs publish bounded server-side timeouts");
  for (const table of [
    "portal_text_preview_privacy_policies",
    "portal_text_preview_admissions",
    "portal_text_preview_turn_claims",
    "portal_text_preview_egress_authorizations",
    "portal_text_preview_transcript_writes",
  ]) {
    assert.equal(queryScalar(databaseUrl,
      `SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.${table}'::regclass;`), "t",
    `${table} must enforce RLS before the runtime can use it`);
  }
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    ALTER TABLE public.portal_text_preview_admissions NO FORCE ROW LEVEL SECURITY;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewSecurityBoundary, false, "RLS mutation closes the capability");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    GRANT EXECUTE ON FUNCTION public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text) TO authenticated;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewSecurityBoundary, false, "execute-grant mutation closes the capability");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    GRANT SELECT ON TABLE public.portal_text_preview_admissions TO authenticated;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewSecurityBoundary, false, "direct-table-grant mutation closes the capability");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    DROP INDEX public.portal_text_preview_turn_claims_generation_fence_uidx;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewTurnFence, false, "generation-fence mutation closes the capability");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    ALTER TABLE public.events_outbox DROP CONSTRAINT events_outbox_event_document_canonical_check;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewCanonicalOutbox, false, "canonical-envelope mutation closes the capability");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    ALTER TABLE public.events_outbox DROP CONSTRAINT events_outbox_event_document_canonical_check;
    ALTER TABLE public.events_outbox
      ADD CONSTRAINT events_outbox_event_document_canonical_check CHECK (true);
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewCanonicalOutbox, false, "CHECK(true) cannot impersonate the canonical-envelope capability");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    DO $mutation$
    DECLARE v_definition text;
    BEGIN
      SELECT pg_get_constraintdef(oid) INTO v_definition
      FROM pg_constraint
      WHERE conrelid='public.events_outbox'::regclass
        AND conname='events_outbox_event_document_canonical_check';
      ALTER TABLE public.events_outbox DROP CONSTRAINT events_outbox_event_document_canonical_check;
      EXECUTE 'ALTER TABLE public.events_outbox ADD CONSTRAINT events_outbox_event_document_canonical_check '
        ||v_definition||' NOT VALID';
    END
    $mutation$;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewCanonicalOutbox, false, "an exact but unvalidated CHECK cannot publish readiness");
  assert.equal(queryJson(databaseUrl, `
    BEGIN;
    GRANT EXECUTE ON FUNCTION app.portal_enqueue_text_preview_event(
      app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,
      app.uuid_v7,app.uuid_v7,jsonb,timestamptz
    ) TO service_role;
    SELECT public.portal_schema_capabilities_service();
    ROLLBACK;
  `).portalTextPreviewCanonicalOutbox, false, "direct event-writer grant closes the capability");
  assert.equal(queryScalar(databaseUrl,
    "SELECT has_function_privilege('authenticated','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE');"), "t",
  "v49 preserves the exact authenticated v48 transcript writer for expand/contract rollback");
  assert.equal(queryScalar(databaseUrl,
    "SELECT has_function_privilege('anon','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE') OR has_function_privilege('service_role','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE');"), "f",
  "v49 does not broaden the legacy writer beyond its authenticated caller");
  assert.deepEqual(queryRows(databaseUrl, `
    SELECT jsonb_typeof((event_document->>'payload_json')::jsonb)
    FROM public.events_outbox
    WHERE id in (
      '019f0000-0000-7000-8000-000000009480',
      '019f0000-0000-7000-8000-000000009484'
    )
    ORDER BY id;
  `), ["array", "number"], "v49 keeps valid historical scalar and array payload envelopes");
  assertFailed(runSql(databaseUrl, `
    INSERT INTO public.events_outbox(
      tenant_id,id,event_id,aggregate_type,aggregate_id,aggregate_version,
      event_type,event_version,event_document,status,attempts,available_at,created_at
    )
    SELECT tenant_id,'019f0000-0000-7000-8000-000000009488',
      '019f0000-0000-7000-8000-00000000abcd',aggregate_type,aggregate_id,
      aggregate_version,event_type,event_version,
      event_document||jsonb_build_object(
        'event_id',upper('019f0000-0000-7000-8000-00000000abcd')
      ),status,attempts,available_at,created_at
    FROM public.events_outbox WHERE id='019f0000-0000-7000-8000-000000009480';
  `), "uppercase UUID strings are rejected for new outbox rows",
  /events_outbox_event_document_canonical_check/);
  assertFailed(runSql(databaseUrl, `
    INSERT INTO public.events_outbox(
      tenant_id,id,event_id,aggregate_type,aggregate_id,aggregate_version,
      event_type,event_version,event_document,status,attempts,available_at,created_at
    )
    SELECT tenant_id,'019f0000-0000-7000-8000-000000009489',
      '019f0000-0000-7000-8000-00000000abce',aggregate_type,aggregate_id,
      aggregate_version,event_type,event_version,
      event_document||jsonb_build_object(
        'event_id','019f0000-0000-7000-8000-00000000abce',
        'occurred_at','2026-08-25'
      ),status,attempts,available_at,created_at
    FROM public.events_outbox WHERE id='019f0000-0000-7000-8000-000000009480';
  `), "date-only timestamps are rejected for new outbox rows",
  /events_outbox_event_document_canonical_check/);
  assertFailed(runSql(databaseUrl, `
    INSERT INTO public.events_outbox(
      tenant_id,id,event_id,aggregate_type,aggregate_id,aggregate_version,
      event_type,event_version,event_document,status,attempts,available_at,created_at
    )
    SELECT tenant_id,'019f0000-0000-7000-8000-00000000948a',
      '019f0000-0000-7000-8000-00000000abcf','888',aggregate_id,
      aggregate_version,'777',event_version,
      event_document||jsonb_build_object(
        'schema_version',2,
        'event_id','019f0000-0000-7000-8000-00000000abcf',
        'event_type',777,
        'event_version',event_version::text,
        'aggregate_type',888,
        'aggregate_version',aggregate_version::text
      ),status,attempts,available_at,created_at
    FROM public.events_outbox WHERE id='019f0000-0000-7000-8000-000000009480';
  `), "matching SQL columns cannot mask incompatible JSON scalar types",
  /events_outbox_event_document_canonical_check/);
}

function seedPreV49CanonicalOutboxPayloadShapes(databaseUrl) {
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.events_outbox(
      tenant_id,id,event_id,aggregate_type,aggregate_id,aggregate_version,
      event_type,event_version,event_document,status,attempts,available_at,created_at
    ) VALUES
    (
      '${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009480',
      '019f0000-0000-7000-8000-000000009481','legacy_fixture',
      '019f0000-0000-7000-8000-000000009482',1,'legacy.shape',1,
      jsonb_build_object(
        'schema_version','2.0.0','event_id','019f0000-0000-7000-8000-000000009481',
        'event_type','legacy.shape','event_version',1,'aggregate_type','legacy_fixture',
        'aggregate_id','019f0000-0000-7000-8000-000000009482','aggregate_version',1,
        'tenant_id','${fixture.tenantAlpha}','session_id',null,'producer','portal.v48.fixture',
        'trace_id','0123456789abcdef0123456789abcdef',
        'correlation_id','019f0000-0000-7000-8000-000000009483','causation_id',null,
        'data_classification','internal','payload_json','[]',
        'occurred_at','2026-08-25T12:00:00.000Z'
      ),'pending',0,'2026-08-25T12:00:00.000Z','2026-08-25T12:00:00.000Z'
    ),
    (
      '${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009484',
      '019f0000-0000-7000-8000-000000009485','legacy_fixture',
      '019f0000-0000-7000-8000-000000009486',1,'legacy.shape',1,
      jsonb_build_object(
        'schema_version','2.0.0','event_id','019f0000-0000-7000-8000-000000009485',
        'event_type','legacy.shape','event_version',1,'aggregate_type','legacy_fixture',
        'aggregate_id','019f0000-0000-7000-8000-000000009486','aggregate_version',1,
        'tenant_id','${fixture.tenantAlpha}','session_id',null,'producer','portal.v48.fixture',
        'trace_id','fedcba9876543210fedcba9876543210',
        'correlation_id','019f0000-0000-7000-8000-000000009487','causation_id',null,
        'data_classification','internal','payload_json','42',
        'occurred_at','2026-08-25T12:00:01.000Z'
      ),'pending',0,'2026-08-25T12:00:01.000Z','2026-08-25T12:00:01.000Z'
    );
  `), "seed valid v48 array and scalar outbox envelopes before the v49 global constraint");
}

function assertMigrationCapabilities(databaseUrl) {
  assert.equal(queryScalar(databaseUrl, "SELECT to_regprocedure('public.portal_schema_capabilities_service()') IS NOT NULL;"), "t");
  const capabilities = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(capabilities.version, 56);
  assert.equal(capabilities.providerEffectReservations, true);
  assert.equal(capabilities.billingUsageOutbox, true);
  assert.equal(capabilities.recallWebhookDedupe, true);
  assert.equal(capabilities.tavusWebhookCapabilities, true);
  assert.equal(capabilities.tavusWebhookCapabilityLifecycle, true);
  assert.equal(capabilities.providerEffectReconciliation, true);
  assert.equal(capabilities.aiUsageReservations, true);
  assert.equal(capabilities.aiUsageReconciliation, true);
  assert.equal(capabilities.tavusCustomerDeliveryReceipts, true);
  assert.equal(capabilities.tavusStageCapabilities, true);
  assert.equal(capabilities.recallTenantBinding, true);
  assert.equal(capabilities.workerHeartbeats, true);
  assert.equal(capabilities.providerTranscriptService, true);
  assert.equal(capabilities.billingCheckoutIntents, true);
  assert.equal(capabilities.strictSubscriptionIdentity, true);
  assert.equal(capabilities.legacySubscriptionWriterRevoked, true);
  assert.equal(capabilities.costEventSchemaVersion, true);
  assert.equal(capabilities.legacyCostWritersRevoked, true);
  assert.equal(capabilities.authenticatedProviderTranscriptPreclaimBlocked, true);
  assert.equal(capabilities.authenticatedMeetingBotPreclaimBlocked, true);
  assert.equal(capabilities.runtimeChannelAdmission, true);
  assert.equal(capabilities.runtimeChannelGrantFences, true);
  assert.equal(capabilities.runtimeProviderBindingReceipts, true);
  assert.equal(capabilities.runtimeSceneReceipts, true);
  assert.equal(capabilities.runtimeKillSwitches, true);
  assert.equal(capabilities.runtimeDualOperatorReconciliation, true);
  assert.equal(capabilities.runtimeBridgeReceiptIntegrity, true);
  assert.equal(capabilities.meetingBotStatusUpdateUnambiguous, true);
  assert.equal(capabilities.providerEffectTerminationFence, true);
  assert.equal(capabilities.serviceRoleAppSchemaUsage, true);
  assert.equal(capabilities.tavusStageExpiryConcurrencyFence, true);
  assert.equal(capabilities.businessActionKillSwitches, true);
  assert.equal(capabilities.businessActionGrants, true);
  assert.equal(capabilities.businessActionReceipts, true);
  assert.equal(capabilities.businessActionLeads, true);
  assert.equal(capabilities.businessActionProposals, true);
  assert.equal(capabilities.businessActionCalendarReservations, true);
  assert.equal(capabilities.businessActionCalendarConnections, true);
  assert.equal(capabilities.businessActionCalendarCredentialRead, true);
  assert.equal(capabilities.businessActionLiveCallContext, true);
  assert.equal(capabilities.businessActionEmailLengthBound, true);
  assert.equal(capabilities.portalTextPreviewAdmission, true);
  assert.equal(capabilities.portalTextPreviewTurnFence, true);
  assert.equal(capabilities.portalTextPreviewEgressAuthorization, true);
  assert.equal(capabilities.portalTextPreviewProviderFailureReceipt, true);
  assert.equal(capabilities.portalTextTranscriptOptIn, true);
  assert.equal(capabilities.portalTextPreviewCleanup, true);
  assert.equal(capabilities.portalTextPreviewCanonicalOutbox, true);
  assert.equal(capabilities.portalTextPreviewSecurityBoundary, true);
  assert.equal(capabilities.legacyAuthenticatedChatTranscriptWriterAvailable, true);
  assert.equal(capabilities.meetingTerminalNotificationClaim, true);
  assertBusinessActionCapabilityAclDrift(databaseUrl);
  assert.equal(queryScalar(databaseUrl, "SELECT to_regclass('public.provider_effect_reservations') IS NOT NULL;"), "t");
  assert.equal(queryScalar(databaseUrl, "SELECT to_regclass('public.billing_usage_outbox') IS NOT NULL;"), "t");
  for (const signature of [
    "public.portal_begin_billing_checkout_intent_service(app.uuid_v7,app.uuid_v7,uuid,text,text,text,boolean,integer,integer,text,text,text,text,timestamp with time zone)",
    "public.portal_mark_billing_checkout_dispatched_service(app.uuid_v7)",
    "public.portal_bind_billing_checkout_session_service(app.uuid_v7,text,text,timestamp with time zone)",
    "public.portal_release_billing_checkout_intent_service(app.uuid_v7,text)",
    "public.portal_apply_billing_checkout_event_service(text,text,timestamp with time zone,app.uuid_v7,text,app.uuid_v7,text,text,text,text)",
    "public.portal_apply_tenant_subscription_event_service(text,text,timestamp with time zone,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,app.uuid_v7)",
  ]) assert.equal(queryScalar(databaseUrl, `SELECT to_regprocedure('${signature}') IS NOT NULL;`), "t", `${signature} capability procedure`);
  assertSucceeded(runSql(databaseUrl, "DROP INDEX public.billing_checkout_intents_subscription_uidx;"),
    "strict subscription capability live-computation fixture");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_schema_capabilities_service();")).strictSubscriptionIdentity, false,
  "strict subscription capability reflects a missing ownership index instead of a migration constant");
  assertSucceeded(runSql(databaseUrl, `CREATE UNIQUE INDEX billing_checkout_intents_subscription_uidx
    ON public.billing_checkout_intents(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;`),
  "restore strict subscription ownership index");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_schema_capabilities_service();")).strictSubscriptionIdentity, true);
}

async function assertMeetingTerminalNotificationClaimPhase(databaseUrl) {
  const pendingBotId = "40000000-0000-4000-8000-000000000050";
  const terminalBotId = "40000000-0000-4000-8000-000000000051";
  const concurrentBotId = "40000000-0000-4000-8000-000000000052";
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.meeting_bot_sessions
      (id,tenant_id,agent_id,recall_bot_id,meeting_url,status)
    VALUES
      ('019f0000-0000-7000-8000-000000005050','${fixture.tenantAlpha}','${fixture.agentAlpha}','${pendingBotId}','https://meet.example.test/pending','in_call'),
      ('019f0000-0000-7000-8000-000000005051','${fixture.tenantAlpha}','${fixture.agentAlpha}','${terminalBotId}','https://meet.example.test/terminal','ended'),
      ('019f0000-0000-7000-8000-000000005052','${fixture.tenantAlpha}','${fixture.agentAlpha}','${concurrentBotId}','https://meet.example.test/concurrent','failed');
  `), "meeting terminal notification claim fixtures");

  const claim = (botId) => queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_meeting_terminal_notification_service('${botId}');`));
  assert.equal(claim("40000000-0000-4000-8000-000000000099"), "f",
    "an unknown Recall bot cannot claim a notification");
  assert.equal(claim(pendingBotId), "f",
    "a nonterminal meeting cannot claim a terminal notification");
  assert.equal(claim(terminalBotId), "t",
    "the first terminal claim atomically consumes the notification slot");
  assert.equal(claim(terminalBotId), "f",
    "a replay cannot claim the same terminal notification twice");
  assert.equal(queryScalar(databaseUrl,
    `SELECT terminal_notification_claimed_at IS NOT NULL FROM public.meeting_bot_sessions WHERE recall_bot_id='${terminalBotId}';`), "t");

  const concurrentBarrierName = "terminal-notification-claim-v50";
  const concurrentClaimSql = (lockId) => asRoleSql("service_role", null, `
    BEGIN;
    SELECT pg_advisory_xact_lock(${lockId});
    DO $barrier$
    DECLARE
      deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (
          SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${concurrentBarrierName}'
        );
        IF clock_timestamp() >= deadline THEN
          RAISE EXCEPTION 'terminal notification claim barrier timeout';
        END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    SELECT public.portal_claim_meeting_terminal_notification_service('${concurrentBotId}');
    COMMIT;
  `);
  const concurrentClaimPromises = [
    runSqlAsync(databaseUrl, concurrentClaimSql(50_050)),
    runSqlAsync(databaseUrl, concurrentClaimSql(50_051)),
  ];
  let concurrentClaims;
  try {
    await Promise.all([
      waitForAdvisoryLockHolder(databaseUrl, 50_050),
      waitForAdvisoryLockHolder(databaseUrl, 50_051),
    ]);
    assertSucceeded(runSql(databaseUrl,
      `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${concurrentBarrierName}') ON CONFLICT DO NOTHING;`),
    "release terminal notification claim barrier");
    concurrentClaims = await Promise.all(concurrentClaimPromises);
  } finally {
    runSql(databaseUrl,
      `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${concurrentBarrierName}') ON CONFLICT DO NOTHING;`);
    await Promise.allSettled(concurrentClaimPromises);
    runSql(databaseUrl,
      `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${concurrentBarrierName}';`);
  }
  for (const result of concurrentClaims) {
    assertSucceeded(result, "concurrent terminal notification claim");
  }
  const concurrentOutcomes = concurrentClaims.map((result) => (
    result.stdout.trim().split("\n").filter((line) => line === "t" || line === "f").at(-1)
  )).sort();
  assert.deepEqual(concurrentOutcomes, ["f", "t"],
    "two concurrent connections produce exactly one terminal notification claim winner");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.meeting_bot_sessions WHERE recall_bot_id='${concurrentBotId}' AND terminal_notification_claimed_at IS NOT NULL;`), "1");

  for (const role of ["anon", "authenticated"]) {
    assertFailed(runSql(databaseUrl, asRoleSql(role, null,
      `SELECT public.portal_claim_meeting_terminal_notification_service('${terminalBotId}');`)),
    `${role} cannot claim a terminal notification`, /permission denied for function portal_claim_meeting_terminal_notification_service/);
  }
}

function assertBusinessActionCapabilityAclDrift(databaseUrl) {
  const probes = [
    ["businessActionKillSwitches", "public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text)"],
    ["businessActionGrants", "public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer)"],
    ["businessActionLeads", "public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)"],
    ["businessActionProposals", "public.portal_propose_business_meeting_slots_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,jsonb,text,text)"],
    ["businessActionCalendarReservations", "public.portal_reserve_business_meeting_slot_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)"],
    ["businessActionCalendarConnections", "public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)"],
    ["businessActionCalendarCredentialRead", "public.portal_google_calendar_decrypted_refresh_token_service(app.uuid_v7)"],
    ["businessActionLiveCallContext", "public.portal_business_action_call_context_service(app.uuid_v7,app.uuid_v7,text)"],
  ];
  for (const [capability, signature] of probes) {
    for (const role of ["anon", "authenticated"]) {
      assertSucceeded(runSql(databaseUrl, `GRANT EXECUTE ON FUNCTION ${signature} TO ${role};`), `${capability} ${role} ACL drift fixture`);
      const drifted = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
      assert.equal(drifted[capability], false, `${capability} detects an accidental ${role} grant`);
      assertSucceeded(runSql(databaseUrl, `REVOKE EXECUTE ON FUNCTION ${signature} FROM ${role};`), `${capability} ${role} ACL restore`);
      const restored = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
      assert.equal(restored[capability], true, `${capability} recovers after ${role} grant removal`);
    }
  }
  assertSucceeded(runSql(databaseUrl, "GRANT SELECT ON TABLE public.portal_business_action_receipts TO authenticated;"), "businessActionReceipts table ACL drift fixture");
  const tableDrifted = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(tableDrifted.businessActionReceipts, false, "businessActionReceipts detects an accidental authenticated table grant");
  assertSucceeded(runSql(databaseUrl, "REVOKE SELECT ON TABLE public.portal_business_action_receipts FROM authenticated;"), "businessActionReceipts table ACL restore");
  const tableRestored = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_schema_capabilities_service();"));
  assert.equal(tableRestored.businessActionReceipts, true, "businessActionReceipts recovers after table grant removal");
}

function assertLeastPrivilege(databaseUrl) {
  const revokedLegacyServiceFunctions = new Set([
    "portal_upsert_tenant_subscription_service(",
    "portal_log_ai_usage_service(",
    "portal_log_video_usage_service(",
  ]);
  const serviceFunctions = queryRows(databaseUrl, `
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname LIKE 'portal\\_%\\_service' ESCAPE '\\'
    ORDER BY 1;
  `);
  assert.ok(serviceFunctions.length >= 40, "every SECURITY DEFINER service boundary is discovered from the catalog");
  for (const signature of serviceFunctions) {
    if ([...revokedLegacyServiceFunctions].some((prefix) => signature.startsWith(prefix))) {
      assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('service_role', '${sqlLiteral(signature)}', 'EXECUTE');`), "f", `${signature} legacy service revoke`);
      continue;
    }
    assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('service_role', '${sqlLiteral(signature)}', 'EXECUTE');`), "t", `${signature} service grant`);
    assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('authenticated', '${sqlLiteral(signature)}', 'EXECUTE');`), "f", `${signature} authenticated revoke`);
    assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('anon', '${sqlLiteral(signature)}', 'EXECUTE');`), "f", `${signature} anon revoke`);
  }

  const m5Tables = [
    "provider_effect_reservations",
    "provider_effect_termination_receipts",
    "provider_effect_reconciliation_receipts",
    "billing_usage_outbox",
    "recall_webhook_deliveries",
    "tavus_webhook_deliveries",
    "tavus_customer_delivery_receipts",
    "tavus_stage_capabilities",
    "worker_heartbeats",
    "ai_usage_reservations",
    "ai_usage_reconciliation_receipts",
    "billing_checkout_intents",
    "billing_stripe_event_receipts",
    "tenant_subscriptions",
    "portal_runtime_kill_switches",
    "portal_runtime_kill_switch_events",
    "portal_runtime_channel_bindings",
    "portal_runtime_channel_dispatches",
    "portal_runtime_provider_channel_receipts",
    "portal_runtime_scene_execution_receipts",
    "portal_runtime_operator_approvals",
    "portal_runtime_operator_reconciliation_receipts",
    "portal_business_action_kill_switches",
    "portal_business_action_kill_switch_events",
    "portal_business_action_agent_settings",
    "portal_business_action_grants",
    "portal_business_action_receipts",
    "portal_business_action_leads",
    "portal_text_preview_privacy_policies",
    "portal_text_preview_admissions",
    "portal_text_preview_turn_claims",
    "portal_text_preview_egress_authorizations",
    "portal_text_preview_transcript_writes",
  ];
  for (const table of [...m5Tables, "conversation_transcripts", "meeting_bot_sessions"]) {
    assert.equal(queryScalar(databaseUrl, `SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.${table}'::regclass;`), "t");
    assert.equal(queryScalar(databaseUrl, `SELECT has_table_privilege('authenticated', 'public.${table}', 'SELECT');`), "f");
    assert.equal(queryScalar(databaseUrl, `SELECT has_table_privilege('anon', 'public.${table}', 'SELECT');`), "f");
  }

  for (const table of m5Tables) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.equal(queryScalar(databaseUrl, `SELECT has_table_privilege('service_role', 'public.${table}', '${privilege}');`), "f",
        `${table} must be reachable by service_role only through SECURITY DEFINER RPCs (${privilege})`);
    }
  }
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    "UPDATE public.provider_effect_reservations SET updated_at=updated_at;")),
  "service_role cannot bypass provider state transitions with direct DML");

  assert.equal(queryScalar(databaseUrl, "SELECT has_function_privilege('authenticated', 'public.portal_schema_capabilities_service()', 'EXECUTE');"), "f");
  assert.equal(queryScalar(databaseUrl, "SELECT has_function_privilege('service_role', 'public.portal_schema_capabilities_service()', 'EXECUTE');"), "t");

  assertSucceeded(runSql(databaseUrl, `CREATE ROLE portal_runtime_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    GRANT CONNECT ON DATABASE ${quoteIdentifier(testDatabaseName)} TO portal_runtime_probe;
    GRANT USAGE ON SCHEMA public TO portal_runtime_probe;
    GRANT SELECT ON TABLE ${m5Tables.map((table) => `public.${table}`).join(", ")} TO portal_runtime_probe;`), "least-privilege direct table probe role");
  const probeUrl = databaseUrlWithUser(databaseUrl, "portal_runtime_probe");
  for (const table of m5Tables) {
    assert.equal(queryScalar(probeUrl, `SELECT count(*) FROM public.${table};`), "0", `forced RLS hides ${table} from a direct non-bypass role`);
  }
}

function assertCostEventSchemaVersion(databaseUrl) {
  const m5CostEventId = "019f0000-0000-7000-8000-000000003892";
  assert.equal(queryScalar(databaseUrl, `SELECT schema_version FROM public.cost_events WHERE id='${m5CostEventId}';`), "2.1.0",
    "a reservation-backed M5 cost event receives the immutable contract version");

  const legacyFixtureId = "019f0000-0000-7000-8000-000000009424";
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.cost_events
    (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
    VALUES ('${fixture.tenantAlpha}','${legacyFixtureId}','legacy','legacy.fixture','flat',1,0,0,'estimated',now());`),
  "historical ledger fixture receives the v2.1.0 default");
  assert.equal(queryScalar(databaseUrl, `SELECT schema_version FROM public.cost_events WHERE id='${legacyFixtureId}';`), "2.1.0",
    "a historical ledger fixture receives the immutable contract version");
  assertFailed(runSql(databaseUrl, `INSERT INTO public.cost_events
    (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,schema_version)
    VALUES ('${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009425','legacy','legacy.invalid-version','flat',1,0,0,'estimated',now(),'2.0.0');`),
  "cost event contract version rejects an unsupported schema");
}

async function assertRuntimeChannelBridge(databaseUrl) {
  const bindingId = "019f0000-0000-7000-8000-000000008001";
  const sessionId = "019f0000-0000-7000-8000-000000008002";
  const presenterId = "019f0000-0000-7000-8000-000000008003";
  const disclosureId = "019f0000-0000-7000-8000-000000008004";
  const consentId = "019f0000-0000-7000-8000-000000008005";
  const commandFingerprint = "a".repeat(64);
  const evidenceHash = "b".repeat(64);
  const disclosureHash = "c".repeat(64);
  const essential = JSON.stringify({
    id: consentId,
    subjectRef: "runtime-operator-confirmation",
    jurisdiction: "BR",
    evidenceHash,
    method: "click",
  });
  const admission = () => queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '${bindingId}','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}',
      '${sessionId}','${presenterId}','recall_meeting',array['scene_presentation'],'${commandFingerprint}',0,
      '${disclosureId}','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(essential)}'::jsonb,'[]'::jsonb
    );
  `));
  const raceSessionId = "019f0000-0000-7000-8000-000000008050";
  const raceInputs = [
    {
      bindingId: "019f0000-0000-7000-8000-000000008051",
      presenterId: "019f0000-0000-7000-8000-000000008052",
      disclosureId: "019f0000-0000-7000-8000-000000008053",
      consentId: "019f0000-0000-7000-8000-000000008054",
      fingerprint: "2".repeat(64),
    },
    {
      bindingId: "019f0000-0000-7000-8000-000000008055",
      presenterId: "019f0000-0000-7000-8000-000000008056",
      disclosureId: "019f0000-0000-7000-8000-000000008057",
      consentId: "019f0000-0000-7000-8000-000000008058",
      fingerprint: "3".repeat(64),
    },
  ];
  const raceAdmissionSql = (input) => asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '${input.bindingId}','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}',
      '${raceSessionId}','${input.presenterId}','recall_meeting',array['scene_presentation'],'${input.fingerprint}',0,
      '${input.disclosureId}','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(JSON.stringify({ id: input.consentId, subjectRef: "runtime-race-operator", jurisdiction: "BR", evidenceHash, method: "click" }))}'::jsonb,'[]'::jsonb
    );
  `);
  const raceResults = await Promise.all(raceInputs.map((input) => runSqlAsync(databaseUrl, raceAdmissionSql(input))));
  for (const result of raceResults) assertSucceeded(result, "parallel runtime admission contender");
  const raceOutcomes = raceResults.map((result) => parseLastJson(result.stdout));
  assert.deepEqual(raceOutcomes.map((outcome) => outcome.outcome).sort(), ["issued", "one_mouth_conflict"],
    "two real database connections serialize distinct presenters to one issued admission and one one-mouth conflict");
  const raceWinner = raceOutcomes.find((outcome) => outcome.outcome === "issued");
  assert.ok(raceWinner, "parallel admission has exactly one winner");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${raceSessionId}';`), "1",
    "parallel admission creates one durable session");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_channel_bindings WHERE tenant_id='${fixture.tenantAlpha}' AND session_id='${raceSessionId}';`), "1",
    "parallel admission creates only the winner binding");
  assert.equal(queryScalar(databaseUrl, `SELECT active_presenter_id::text FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${raceSessionId}';`), raceWinner.grantId === raceInputs[0].bindingId ? raceInputs[0].presenterId : raceInputs[1].presenterId,
    "the session floor belongs to the issued presenter");
  const raceLoser = raceInputs.find((input) => input.bindingId !== raceWinner.grantId);
  assert.ok(raceLoser, "parallel admission identifies the losing presenter");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_channel_dispatches WHERE tenant_id='${fixture.tenantAlpha}' AND binding_id='${raceLoser.bindingId}';`), "0",
    "the losing presenter has no provider or scene dispatch");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND binding_id='${raceLoser.bindingId}';`), "0",
    "the losing presenter has no provider receipt");
  const crossTenantActorAdmission = runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '019f0000-0000-7000-8000-000000008012','${fixture.tenantAlpha}','${fixture.actorBeta}','${fixture.agentAlpha}',
      '019f0000-0000-7000-8000-000000008013','019f0000-0000-7000-8000-000000008014','recall_meeting',array['scene_presentation'],'${"e".repeat(64)}',0,
      '019f0000-0000-7000-8000-000000008015','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(JSON.stringify({ id: "019f0000-0000-7000-8000-000000008016", subjectRef: "runtime-operator-confirmation", jurisdiction: "BR", evidenceHash, method: "click" }))}'::jsonb,'[]'::jsonb
    );
  `));
  assertFailed(crossTenantActorAdmission, "runtime admission rejects a beta actor for tenant alpha (42501)");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_runtime_channel_bindings WHERE id='019f0000-0000-7000-8000-000000008012';"), "0");
  const crossTenantAgentAdmission = runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '019f0000-0000-7000-8000-000000008017','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentBeta}',
      '019f0000-0000-7000-8000-000000008018','019f0000-0000-7000-8000-000000008019','recall_meeting',array['scene_presentation'],'${"f".repeat(64)}',0,
      '019f0000-0000-7000-8000-000000008020','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(JSON.stringify({ id: "019f0000-0000-7000-8000-000000008021", subjectRef: "runtime-operator-confirmation", jurisdiction: "BR", evidenceHash, method: "click" }))}'::jsonb,'[]'::jsonb
    );
  `));
  assertFailed(crossTenantAgentAdmission, "runtime admission rejects a beta agent for tenant alpha (42501)");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_runtime_channel_bindings WHERE id='019f0000-0000-7000-8000-000000008017';"), "0");
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `SELECT public.portal_admit_runtime_channel_service(
    '${bindingId}','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}','${sessionId}','${presenterId}',
    'recall_meeting',array['scene_presentation'],'${commandFingerprint}',0,'${disclosureId}','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(essential)}'::jsonb,'[]'::jsonb
  );`)), "authenticated callers cannot directly admit a runtime channel");
  const issued = admission();
  assert.equal(issued.outcome, "issued");
  assert.equal(issued.grantId, bindingId);
  assert.equal(queryScalar(databaseUrl, `SELECT active_presenter_id::text||':'||disclosure_status||':'||consent_status FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${sessionId}';`), `${presenterId}:delivered:granted`);
  assert.equal(admission().outcome, "replayed", "same server-derived admission is idempotent");
  const secondPresenter = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '019f0000-0000-7000-8000-000000008022','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}',
      '${sessionId}','019f0000-0000-7000-8000-000000008023','recall_meeting',array['scene_presentation'],'${"1".repeat(64)}',0,
      '019f0000-0000-7000-8000-000000008024','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(JSON.stringify({ id: "019f0000-0000-7000-8000-000000008025", subjectRef: "runtime-operator-confirmation", jurisdiction: "BR", evidenceHash, method: "click" }))}'::jsonb,'[]'::jsonb
    );
  `));
  assert.equal(secondPresenter.outcome, "one_mouth_conflict", "a second presenter cannot acquire the same session floor");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_runtime_channel_bindings WHERE id='019f0000-0000-7000-8000-000000008022';"), "0", "one-mouth conflict writes no runtime binding");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE binding_id='019f0000-0000-7000-8000-000000008022';"), "0", "one-mouth conflict writes no provider receipt");
  const consume = (kind) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_consume_runtime_channel_grant_service('${bindingId}','${commandFingerprint}','${kind}');`));
  assert.equal(consume("tavus").outcome, "acquired");
  assert.equal(consume("recall").outcome, "acquired", "one bridge grant permits the second paid provider fence");
  assert.equal(consume("scene").outcome, "acquired", "scene has its own constrained consume fence");
  assert.equal(consume("tavus").outcome, "replayed", "same provider cannot consume a grant twice");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_channel_dispatches WHERE tenant_id='${fixture.tenantAlpha}' AND binding_id='${bindingId}';`), "3");
  const reservationId = "019f0000-0000-7000-8000-000000008026";
  const costEventId = "019f0000-0000-7000-8000-000000008027";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantAlpha, fixture.agentAlpha, "runtime-bridge-receipt", reservationId, costEventId, "recall"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','runtime-recall-actual','https://recall.example.test/runtime-bridge');`)).committed, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000008028','${bindingId}','${reservationId}','recall','runtime-recall-wrong','https://recall.example.test/runtime-bridge');`)), "f",
  "a mismatched provider reference cannot bind a receipt");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE reservation_id='${reservationId}';`), "0", "mismatched provider reference writes zero receipts");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000008029','${bindingId}','${reservationId}','recall','runtime-recall-actual','https://recall.example.test/wrong-url');`)), "f",
  "a mismatched provider URL cannot bind a receipt");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE reservation_id='${reservationId}';`), "0", "mismatched provider URL writes zero receipts");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000008030','${bindingId}','${reservationId}','recall','runtime-recall-actual','https://recall.example.test/runtime-bridge');`)), "t",
  "the exact committed provider resource receives one durable receipt");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE reservation_id='${reservationId}';`), "1");
  const betaReservationId = "019f0000-0000-7000-8000-000000008032";
  const betaCostEventId = "019f0000-0000-7000-8000-000000008033";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantBeta, fixture.agentBeta, "runtime-bridge-beta-receipt", betaReservationId, betaCostEventId, "recall"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${betaReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${betaReservationId}','runtime-recall-beta','https://recall.example.test/beta-bridge');`)).committed, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000008034','${bindingId}','${betaReservationId}','recall','runtime-recall-beta','https://recall.example.test/beta-bridge');`)), "f",
  "a beta reservation cannot bind to an alpha runtime grant");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE reservation_id='${betaReservationId}';`), "0",
    "cross-tenant reservation attempt writes no receipt");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000008035','${bindingId}','${reservationId}','recall','runtime-recall-actual','https://recall.example.test/runtime-bridge');`)), "t",
  "an exact alpha receipt replays true after a rejected cross-tenant attempt");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_provider_channel_receipts WHERE reservation_id='${reservationId}';`), "1",
    "exact receipt replay never creates a second alpha row");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_set_runtime_kill_switch_service(
    '019f0000-0000-7000-8000-000000008006','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}','recall_meeting','provider_dispatch',false,'incident_hold'
  );`)), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_kill_switch_events WHERE tenant_id='${fixture.tenantAlpha}' AND reason_code='incident_hold';`), "1", "kill switch state transition leaves durable audit evidence");
  assertFailed(runSql(databaseUrl, `INSERT INTO public.portal_runtime_kill_switch_events
    (id,tenant_id,kill_switch_id,actor_id,enabled,reason_code)
    VALUES ('019f0000-0000-7000-8000-000000008031','${fixture.tenantBeta}','019f0000-0000-7000-8000-000000008006','${fixture.actorBeta}',false,'cross_tenant_switch');`),
  "composite kill-switch FK rejects a cross-tenant event");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_runtime_kill_switch_events WHERE id='019f0000-0000-7000-8000-000000008031';"), "0");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_runtime_channel_status_service('${fixture.tenantAlpha}','${fixture.agentAlpha}','recall_meeting','provider_dispatch');`)).enabled, false);
  const blockedId = "019f0000-0000-7000-8000-000000008007";
  const blockedSession = "019f0000-0000-7000-8000-000000008008";
  const blockedPresenter = "019f0000-0000-7000-8000-000000008009";
  const blockedDisclosure = "019f0000-0000-7000-8000-000000008010";
  const blockedConsent = "019f0000-0000-7000-8000-000000008011";
  const noPurpose = JSON.stringify({ id: blockedConsent, subjectRef: "runtime-operator-confirmation", jurisdiction: "BR", evidenceHash, method: "click" });
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_admit_runtime_channel_service(
    '${blockedId}','${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}','${blockedSession}','${blockedPresenter}',
    'tavus_video',array['recording'],'${"d".repeat(64)}',0,'${blockedDisclosure}','runtime-v1','${disclosureHash}','spoken','pt-BR','${sqlLiteral(noPurpose)}'::jsonb,'[]'::jsonb
  );`)), "an optional capability without purpose evidence fails before disclosure/session persistence");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_runtime_channel_bindings WHERE id='${blockedId}';`), "0");
}

// ADR-039 wave 1a. Unlike portal_admit_runtime_channel_service, admission
// here never creates the session/disclosure/consent evidence it checks, so
// every fixture session below is inserted directly (the same durable shape
// ADR-038's channel admission would have left behind), never through a
// business-action RPC.
function businessActionSessionFixtureSql(tenantId, agentId, sessionId, presenterId, disclosureStatus, consentStatus) {
  return `
    INSERT INTO public.sessions (tenant_id,id,agent_id,role_pack_id,role_pack_version,channel_type,status,active_presenter_id,disclosure_status,consent_status)
    VALUES ('${tenantId}','${sessionId}','${agentId}','sales','business-action-harness-v1','api','ready','${presenterId}','${disclosureStatus}','${consentStatus}');
    INSERT INTO public.session_participants (tenant_id,id,session_id,participant_type,display_name,joined_at)
    VALUES ('${tenantId}','${presenterId}','${sessionId}','digital_presenter','Business Action Harness Presenter',now());
  `;
}

function leadDataCaptureConsentSql(tenantId, sessionId, consentId) {
  return `
    INSERT INTO public.consent_evidence (tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,jurisdiction,disclosure_version,evidence_hash,captured_at)
    VALUES ('${tenantId}','${consentId}','${sessionId}','business-action-harness-subject','lead_data_capture','lead_data_capture','granted','click','BR','business-action-harness-v1','${"e".repeat(64)}',now());
  `;
}

async function assertBusinessActionAdmissionAndLeads(databaseUrl) {
  const fp = "9".repeat(64);
  const admit = (overrides = {}) => {
    const p = {
      grantId: "019f0000-0000-7000-8000-000000009100", tenantId: fixture.tenantAlpha, agentId: fixture.agentAlpha,
      sessionId: "019f0000-0000-7000-8000-000000009101", presenterId: "019f0000-0000-7000-8000-000000009102",
      actionKind: "register_lead", fingerprint: fp, generation: 0,
      ...overrides,
    };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_admit_business_action_service(
      '${p.grantId}','${p.tenantId}','${p.agentId}','${p.sessionId}','${p.presenterId}','${p.actionKind}','${p.fingerprint}',${p.generation}
    );`));
  };
  const register = (overrides = {}) => {
    const p = {
      leadId: "019f0000-0000-7000-8000-000000009200", receiptId: "019f0000-0000-7000-8000-000000009201",
      grantId: "019f0000-0000-7000-8000-000000009100", contactName: "Ana Prospect",
      contactEmail: "ana@example.test", contactPhone: null, summary: "Interessada no plano anual",
      ...overrides,
    };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_register_business_lead_service(
      '${p.leadId}','${p.receiptId}','${p.grantId}','${sqlLiteral(p.contactName)}',
      ${p.contactEmail === null ? "null" : `'${sqlLiteral(p.contactEmail)}'`},
      ${p.contactPhone === null ? "null" : `'${sqlLiteral(p.contactPhone)}'`},
      '${sqlLiteral(p.summary)}'
    );`));
  };

  // -- flag independence: bridge disabled without any read/write --
  assert.equal(queryScalar(databaseUrl, "SELECT to_regprocedure('public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer)') IS NOT NULL;"), "t",
    "the service RPC itself has no PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED concept -- the flag is enforced by apps/portal/src/lib/runtime/portal-business-action-bridge.ts before any RPC call, proven by tests/portal/business-action-bridge.test.mjs");

  // -- disclosure / essential consent / purpose consent rejections --
  const pendingSession = "019f0000-0000-7000-8000-000000009110";
  const pendingPresenter = "019f0000-0000-7000-8000-000000009111";
  assertSucceeded(runSql(databaseUrl, businessActionSessionFixtureSql(fixture.tenantAlpha, fixture.agentAlpha, pendingSession, pendingPresenter, "pending", "pending")), "pending disclosure/consent session fixture");
  assert.equal(admit({ grantId: "019f0000-0000-7000-8000-000000009112", sessionId: pendingSession, presenterId: pendingPresenter, fingerprint: "1".repeat(64) }).outcome, "denied_disclosure");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_business_action_grants WHERE id='019f0000-0000-7000-8000-000000009112';"), "0", "a denied admission never persists a grant");

  const consentPendingSession = "019f0000-0000-7000-8000-000000009120";
  const consentPendingPresenter = "019f0000-0000-7000-8000-000000009121";
  assertSucceeded(runSql(databaseUrl, businessActionSessionFixtureSql(fixture.tenantAlpha, fixture.agentAlpha, consentPendingSession, consentPendingPresenter, "delivered", "pending")), "delivered disclosure, pending consent session fixture");
  assert.equal(admit({ grantId: "019f0000-0000-7000-8000-000000009122", sessionId: consentPendingSession, presenterId: consentPendingPresenter, fingerprint: "2".repeat(64) }).outcome, "denied_essential_consent");

  const noPurposeSession = "019f0000-0000-7000-8000-000000009130";
  const noPurposePresenter = "019f0000-0000-7000-8000-000000009131";
  assertSucceeded(runSql(databaseUrl, businessActionSessionFixtureSql(fixture.tenantAlpha, fixture.agentAlpha, noPurposeSession, noPurposePresenter, "delivered", "granted")), "essential-only session fixture");
  assert.equal(admit({ grantId: "019f0000-0000-7000-8000-000000009132", sessionId: noPurposeSession, presenterId: noPurposePresenter, fingerprint: "3".repeat(64) }).outcome, "denied_purpose_consent",
    "essential_processing alone never authorizes register_lead -- lead_data_capture is a distinct Art. 5 purpose");

  // -- presenter mismatch (One Mouth Rule read, ADR-039) --
  const wrongPresenter = "019f0000-0000-7000-8000-000000009133";
  assert.equal(admit({ grantId: "019f0000-0000-7000-8000-000000009134", sessionId: noPurposeSession, presenterId: wrongPresenter, fingerprint: "4".repeat(64) }).outcome, "presenter_mismatch");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_business_action_grants WHERE id='019f0000-0000-7000-8000-000000009134';"), "0");

  // -- fully satisfied session: issuance, replay and register_lead idempotency --
  const readySession = "019f0000-0000-7000-8000-000000009140";
  const readyPresenter = "019f0000-0000-7000-8000-000000009141";
  assertSucceeded(runSql(databaseUrl, businessActionSessionFixtureSql(fixture.tenantAlpha, fixture.agentAlpha, readySession, readyPresenter, "delivered", "granted")), "fully satisfied session fixture");
  assertSucceeded(runSql(databaseUrl, leadDataCaptureConsentSql(fixture.tenantAlpha, readySession, "019f0000-0000-7000-8000-000000009142")), "lead_data_capture consent fixture");
  const grantId = "019f0000-0000-7000-8000-000000009150";
  const issued = admit({ grantId, sessionId: readySession, presenterId: readyPresenter, fingerprint: "5".repeat(64) });
  assert.equal(issued.outcome, "issued");
  assert.equal(issued.grantId, grantId);
  const replayed = admit({ grantId, sessionId: readySession, presenterId: readyPresenter, fingerprint: "5".repeat(64) });
  assert.equal(replayed.outcome, "replayed", "an identical admission command is idempotent");
  assert.equal(replayed.grantId, grantId);
  assert.equal(replayed.generation, 0);

  // A caller that (correctly or not) generates a fresh grantId per retry --
  // exactly what apps/portal/src/lib/runtime/portal-business-action-bridge.ts
  // does by default when nothing threads the first attempt's grantId through
  // -- must still replay gracefully via (tenant_id, session_id,
  // command_fingerprint), never a raw unique_violation surfacing to the
  // caller.
  const replayedFreshId = admit({ grantId: "019f0000-0000-7000-8000-0000000091ff", sessionId: readySession, presenterId: readyPresenter, fingerprint: "5".repeat(64) });
  assert.equal(replayedFreshId.outcome, "replayed", "a retry with a different grantId but the same session+fingerprint replays the original grant instead of raising a constraint violation");
  assert.equal(replayedFreshId.grantId, grantId, "the replay reports the FIRST grant's id, never the fresh one the retry generated");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_business_action_grants WHERE id='019f0000-0000-7000-8000-0000000091ff';"), "0",
    "the fresh grantId from the retry attempt is never actually persisted as a second row");

  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `SELECT public.portal_admit_business_action_service(
    '019f0000-0000-7000-8000-000000009151','${fixture.tenantAlpha}','${fixture.agentAlpha}','${readySession}','${readyPresenter}','register_lead','${"6".repeat(64)}',0
  );`)), "authenticated callers cannot directly admit a business action");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_business_action_grants WHERE id='019f0000-0000-7000-8000-000000009151';"), "0");

  const firstRegistration = register({ leadId: "019f0000-0000-7000-8000-000000009152", receiptId: "019f0000-0000-7000-8000-000000009153", grantId });
  assert.equal(firstRegistration.outcome, "succeeded");
  assert.equal(firstRegistration.leadId, "019f0000-0000-7000-8000-000000009152");
  const secondRegistration = register({ leadId: "019f0000-0000-7000-8000-000000009154", receiptId: "019f0000-0000-7000-8000-000000009155", grantId, contactName: "Ana Prospect (retry)" });
  assert.equal(secondRegistration.outcome, "succeeded", "a retried register_lead call against the same grant replays the existing receipt");
  assert.equal(secondRegistration.leadId, firstRegistration.leadId, "the same idempotency key (the grant's command_fingerprint) never creates a second lead");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_leads WHERE tenant_id='${fixture.tenantAlpha}' AND session_id='${readySession}';`), "1");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${grantId}';`), "1");
  assert.equal(queryScalar(databaseUrl, `SELECT contact_name FROM public.portal_business_action_leads WHERE id='${firstRegistration.leadId}';`), "Ana Prospect",
    "the replayed retry never overwrites the durable lead row");

  // A genuinely distinct intent (its own commandFingerprint) on the same
  // session is a second lead, never collapsed with the first.
  const secondGrantId = "019f0000-0000-7000-8000-000000009160";
  const secondIssued = admit({ grantId: secondGrantId, sessionId: readySession, presenterId: readyPresenter, fingerprint: "7".repeat(64) });
  assert.equal(secondIssued.outcome, "issued");
  const secondDistinctRegistration = register({ leadId: "019f0000-0000-7000-8000-000000009161", receiptId: "019f0000-0000-7000-8000-000000009162", grantId: secondGrantId, contactName: "Bruno Prospect", contactEmail: null, contactPhone: "+55 11 90000-0000" });
  assert.equal(secondDistinctRegistration.outcome, "succeeded");
  assert.notEqual(secondDistinctRegistration.leadId, firstRegistration.leadId);
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_leads WHERE tenant_id='${fixture.tenantAlpha}' AND session_id='${readySession}';`), "2");

  assertFailed(runSql(databaseUrl, `INSERT INTO public.portal_business_action_leads
    (id,tenant_id,agent_id,session_id,contact_name,idempotency_key) VALUES
    ('019f0000-0000-7000-8000-000000009163','${fixture.tenantAlpha}','${fixture.agentAlpha}','${readySession}','No Contact Channel','${"8".repeat(64)}');`),
  "register_lead requires at least one of contactEmail/contactPhone at the database boundary, not only in the application layer");

  // -- kill switch: scoped to one tenant, never leaking to another --
  const betaSession = "019f0000-0000-7000-8000-000000009170";
  const betaPresenter = "019f0000-0000-7000-8000-000000009171";
  assertSucceeded(runSql(databaseUrl, businessActionSessionFixtureSql(fixture.tenantBeta, fixture.agentBeta, betaSession, betaPresenter, "delivered", "granted")), "beta fully satisfied session fixture");
  assertSucceeded(runSql(databaseUrl, leadDataCaptureConsentSql(fixture.tenantBeta, betaSession, "019f0000-0000-7000-8000-000000009172")), "beta lead_data_capture consent fixture");

  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_business_action_status_service('${fixture.tenantAlpha}','${fixture.agentAlpha}','register_lead');`)).enabled, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_set_business_action_kill_switch_service(
    '019f0000-0000-7000-8000-000000009180','${fixture.tenantAlpha}','${fixture.actorAlpha}',null,'register_lead',false,'incident_hold'
  );`)), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_kill_switch_events WHERE tenant_id='${fixture.tenantAlpha}' AND reason_code='incident_hold';`), "1");
  assertFailed(runSql(databaseUrl, `INSERT INTO public.portal_business_action_kill_switch_events
    (id,tenant_id,kill_switch_id,actor_id,enabled,reason_code) VALUES
    ('019f0000-0000-7000-8000-000000009181','${fixture.tenantBeta}','019f0000-0000-7000-8000-000000009180','${fixture.actorBeta}',false,'cross_tenant_switch');`),
  "composite kill-switch FK rejects a cross-tenant event");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_business_action_status_service('${fixture.tenantAlpha}','${fixture.agentAlpha}','register_lead');`)).enabled, false);

  const blockedGrantId = "019f0000-0000-7000-8000-000000009182";
  assert.equal(admit({ grantId: blockedGrantId, sessionId: readySession, presenterId: readyPresenter, fingerprint: "a".repeat(64) }).outcome, "blocked_kill_switch");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_grants WHERE id='${blockedGrantId}';`), "0");

  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_business_action_status_service('${fixture.tenantBeta}','${fixture.agentBeta}','register_lead');`)).enabled, true,
    "a tenant-scoped kill switch never blocks a different tenant");
  const betaGrantId = "019f0000-0000-7000-8000-000000009183";
  const betaIssued = admit({ grantId: betaGrantId, tenantId: fixture.tenantBeta, agentId: fixture.agentBeta, sessionId: betaSession, presenterId: betaPresenter, fingerprint: "b".repeat(64) });
  assert.equal(betaIssued.outcome, "issued", "tenant beta admits register_lead while tenant alpha stays blocked");
  const betaRegistration = register({ leadId: "019f0000-0000-7000-8000-000000009184", receiptId: "019f0000-0000-7000-8000-000000009185", grantId: betaGrantId, contactName: "Carla Prospect", contactEmail: "carla@example.test" });
  assert.equal(betaRegistration.outcome, "succeeded");

  // Latent bug found while implementing the 0055 e-mail-bound migration: this
  // restore call used to reuse the SAME event id (...9180) as the disable
  // call above. portal_set_business_action_kill_switch_service's own
  // idempotency guard (`if exists(select 1 from
  // portal_business_action_kill_switch_events where id=p_id) then return
  // true`) then treated the "restore" as a replay of the "disable" and
  // silently no-op'ed it -- the switch stayed enabled=false even though the
  // call returned `true` and this assertion never noticed, because it only
  // checked the return value, never the actual switch state afterward. A
  // fresh event id here (...9186, never used before in this suite) is what
  // makes this a genuinely new event instead of a replay; the assertion
  // right after now also confirms the switch state itself, not just the
  // RPC's return value.
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_set_business_action_kill_switch_service(
    '019f0000-0000-7000-8000-000000009186','${fixture.tenantAlpha}','${fixture.actorAlpha}',null,'register_lead',true,'incident_resolved'
  );`)), "t", "restore the kill switch so it never leaks state into a later test run of this suite");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_business_action_status_service('${fixture.tenantAlpha}','${fixture.agentAlpha}','register_lead');`)).enabled, true,
    "the restore call above must have actually re-enabled the switch, not silently no-op'ed as a replay of the disable event");

  // -- register_lead RPC requires the agent settings/kill switch setters to stay tenant_admin gated --
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_set_business_action_agent_settings_service('${fixture.tenantAlpha}','${fixture.actorBeta}','${fixture.agentAlpha}',true);`)));
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_set_business_action_agent_settings_service('${fixture.tenantAlpha}','${fixture.actorAlpha}','${fixture.agentAlpha}',true);`)), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT auto_confirm_scheduling FROM public.portal_business_action_agent_settings WHERE tenant_id='${fixture.tenantAlpha}' AND agent_id='${fixture.agentAlpha}';`), "t");

  // -- ADR-041 defense-in-depth (0055): contactEmail gets the same
  // char_length(...) <= 320 (RFC 5321 sec. 4.5.3.1.3) bound at the database
  // boundary that apps/portal/src/lib/google-calendar/id-token.ts's
  // MAX_EMAIL_CHARS already enforces in the application layer. Both emails
  // below are valid per the format regex alone -- only the new length
  // branch can possibly reject the oversized one, proving this is a real
  // bound, not just a stricter format check in disguise. Runs against
  // tenantBeta/betaSession (never kill-switched anywhere in this function,
  // unlike tenantAlpha/readySession above) so it cannot depend on the
  // kill-switch restore a few lines up staying correctly applied.
  const boundaryEmail = `${"a".repeat(307)}@example.test`; // exactly 320 chars
  const oversizedEmail = `${"a".repeat(308)}@example.test`; // 321 chars
  assert.equal(boundaryEmail.length, 320);
  assert.equal(oversizedEmail.length, 321);

  const boundaryGrantId = "019f0000-0000-7000-8000-0000000091a0";
  assert.equal(admit({ grantId: boundaryGrantId, tenantId: fixture.tenantBeta, agentId: fixture.agentBeta, sessionId: betaSession, presenterId: betaPresenter, fingerprint: "c".repeat(64) }).outcome, "issued");
  const boundaryRegistration = register({
    leadId: "019f0000-0000-7000-8000-0000000091a1", receiptId: "019f0000-0000-7000-8000-0000000091a2",
    grantId: boundaryGrantId, contactName: "Boundary Email Prospect", contactEmail: boundaryEmail, contactPhone: null,
  });
  assert.equal(boundaryRegistration.outcome, "succeeded", "a 320-char e-mail (the RFC 5321 bound) still registers exactly as before -- non-regression");
  assert.equal(queryScalar(databaseUrl, `SELECT char_length(contact_email) FROM public.portal_business_action_leads WHERE id='${boundaryRegistration.leadId}';`), "320");

  const oversizedGrantId = "019f0000-0000-7000-8000-0000000091a3";
  assert.equal(admit({ grantId: oversizedGrantId, tenantId: fixture.tenantBeta, agentId: fixture.agentBeta, sessionId: betaSession, presenterId: betaPresenter, fingerprint: "d".repeat(64) }).outcome, "issued");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_register_business_lead_service(
    '019f0000-0000-7000-8000-0000000091a4','019f0000-0000-7000-8000-0000000091a5','${oversizedGrantId}','Oversized Email Prospect',
    '${oversizedEmail}',null,''
  );`)), "portal_register_business_lead_service rejects a 321-char e-mail even though its format regex alone would accept it");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_business_action_leads WHERE id='019f0000-0000-7000-8000-0000000091a4';"), "0",
    "the rejected oversized-email registration never persists a lead row");

  // Bypass the RPC entirely: proves the char_length bound is enforced by the
  // table's own CHECK constraint, not only by portal_register_business_lead_service's
  // plpgsql guard -- the actual defense-in-depth property this migration exists for.
  assertFailed(runSql(databaseUrl, `INSERT INTO public.portal_business_action_leads
    (id,tenant_id,agent_id,session_id,contact_name,contact_email,idempotency_key) VALUES
    ('019f0000-0000-7000-8000-0000000091a6','${fixture.tenantBeta}','${fixture.agentBeta}','${betaSession}','Direct Insert Prospect','${oversizedEmail}','${"e".repeat(64)}');`),
  "portal_business_action_leads_email_chk rejects a >320-char e-mail on a direct INSERT, proving the bound is a database invariant and not only an RPC-layer one");
}

// ADR-039 wave 1b: propose_meeting_slots / confirm_meeting_slot calendar
// scheduling (0052). Runs after assertBusinessActionAdmissionAndLeads, whose
// last statement already flipped auto_confirm_scheduling=true for
// (tenantAlpha, agentAlpha) -- deliberately reused here for the happy-path
// reserve flow instead of re-flipping it, and exercised as still-false by
// default for (tenantBeta, agentBeta), which this function never touches.
function assertBusinessActionCalendarScheduling(databaseUrl) {
  let seq = 0x9500;
  const nextId = () => `019f0000-0000-7000-8000-${(seq++).toString(16).padStart(12, "0")}`;
  let fpSeq = 0;
  const nextFingerprint = () => (fpSeq++).toString(16).padStart(64, "0");

  const connect = (overrides = {}) => {
    const p = {
      id: nextId(), tenantId: fixture.tenantAlpha, actorId: fixture.actorAlpha,
      email: "closer-calendar@example.test", calendarId: "primary", timezone: "America/Sao_Paulo",
      refreshToken: "1//harness-refresh-token-alpha",
      ...overrides,
    };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_connect_google_calendar_service(
      '${p.id}','${p.tenantId}','${p.actorId}','${sqlLiteral(p.email)}','${sqlLiteral(p.calendarId)}','${p.timezone}','${sqlLiteral(p.refreshToken)}'
    );`));
  };
  const disconnect = (tenantId, actorId) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_disconnect_google_calendar_service('${tenantId}','${actorId}');`));
  const context = (tenantId) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_google_calendar_connection_context_service('${tenantId}');`));
  const admitAction = (overrides = {}) => {
    const p = {
      grantId: nextId(), tenantId: fixture.tenantAlpha, agentId: fixture.agentAlpha,
      sessionId: null, presenterId: null, actionKind: "propose_meeting_slots", fingerprint: nextFingerprint(), generation: 0,
      ...overrides,
    };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_admit_business_action_service(
      '${p.grantId}','${p.tenantId}','${p.agentId}','${p.sessionId}','${p.presenterId}','${p.actionKind}','${p.fingerprint}',${p.generation}
    );`));
  };
  const propose = (overrides = {}) => {
    const p = {
      receiptId: nextId(), proposalId: nextId(), grantId: null,
      tenantId: fixture.tenantAlpha, agentId: fixture.agentAlpha, sessionId: null, presenterId: null,
      durationMinutes: 30, timezone: "America/Sao_Paulo", slots: [], contactName: null, contactEmail: null,
      ...overrides,
    };
    const slotsJson = sqlLiteral(JSON.stringify(p.slots));
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_propose_business_meeting_slots_service(
      '${p.receiptId}','${p.proposalId}','${p.grantId}','${p.tenantId}','${p.agentId}','${p.sessionId}','${p.presenterId}',
      ${p.durationMinutes},'${p.timezone}','${slotsJson}'::jsonb,
      ${p.contactName === null ? "null" : `'${sqlLiteral(p.contactName)}'`},
      ${p.contactEmail === null ? "null" : `'${sqlLiteral(p.contactEmail)}'`}
    );`));
  };
  const reserve = (overrides = {}) => {
    const p = {
      reservationId: nextId(), receiptId: nextId(), grantId: null,
      tenantId: fixture.tenantAlpha, agentId: fixture.agentAlpha, sessionId: null, presenterId: null,
      proposalId: null, slotId: null, contactEmail: "prospect@example.test", contactName: "Prospect Harness",
      ...overrides,
    };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reserve_business_meeting_slot_service(
      '${p.reservationId}','${p.receiptId}','${p.grantId}','${p.tenantId}','${p.agentId}','${p.sessionId}','${p.presenterId}',
      '${p.proposalId}','${p.slotId}','${sqlLiteral(p.contactEmail)}','${sqlLiteral(p.contactName)}'
    );`));
  };
  const dispatch = (tenantId, reservationId) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_dispatch_business_meeting_reservation_service('${tenantId}','${reservationId}');`));
  const commit = (overrides = {}) => {
    const p = { tenantId: fixture.tenantAlpha, reservationId: null, receiptId: nextId(), htmlLink: null, ...overrides };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_commit_business_meeting_reservation_service(
      '${p.tenantId}','${p.reservationId}','${p.receiptId}',${p.htmlLink === null ? "null" : `'${sqlLiteral(p.htmlLink)}'`}
    );`));
  };
  const release = (overrides = {}) => {
    const p = { tenantId: fixture.tenantAlpha, reservationId: null, receiptId: nextId(), evidence: "proposal_expired", ...overrides };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_release_business_meeting_reservation_service(
      '${p.tenantId}','${p.reservationId}','${p.receiptId}','${p.evidence}'
    );`));
  };
  const markUnknown = (tenantId, reservationId, failureCode = "google_timeout") => queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_business_meeting_reservation_unknown_service('${tenantId}','${reservationId}','${failureCode}');`));
  const reconcile = (overrides = {}) => {
    const p = {
      approvalId: nextId(), tenantId: fixture.tenantAlpha, reservationId: null, operatorActorId: null,
      fingerprint: null, outcome: "released", releaseEvidenceCode: "operator_reconciliation_absent", htmlLink: null,
      ...overrides,
    };
    return queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reconcile_business_meeting_reservation_service(
      '${p.approvalId}','${p.tenantId}','${p.reservationId}','${p.operatorActorId}','${p.fingerprint}','${p.outcome}',
      ${p.releaseEvidenceCode === null ? "null" : `'${p.releaseEvidenceCode}'`},
      ${p.htmlLink === null ? "null" : `'${sqlLiteral(p.htmlLink)}'`}
    );`));
  };

  // -- connection lifecycle (tenantBeta, isolated from the scheduling flow below) --
  assert.equal(context(fixture.tenantBeta).outcome, "not_connected");
  const firstConnect = connect({ tenantId: fixture.tenantBeta, actorId: fixture.actorBeta, refreshToken: "1//harness-refresh-token-beta-v1" });
  assert.equal(firstConnect.outcome, "connected");
  const firstContext = context(fixture.tenantBeta);
  assert.equal(firstContext.outcome, "found");
  assert.equal(firstContext.status, "connected");
  assert.equal(firstContext.calendarId, "primary");
  assert.ok(firstContext.vaultSecretId, "connection context exposes the opaque vault secret reference");
  const rawConnectionRow = queryRows(databaseUrl, `SELECT * FROM public.portal_business_action_calendar_connections WHERE tenant_id='${fixture.tenantBeta}';`).join("\n");
  assert.ok(!rawConnectionRow.includes("harness-refresh-token-beta"), "the raw refresh token never appears in any column of the connections table");
  const firstSecretId = firstContext.vaultSecretId;
  assert.equal(queryScalar(databaseUrl, `SELECT secret FROM vault.secrets WHERE id='${firstSecretId}';`), "1//harness-refresh-token-beta-v1",
    "sanity check on the local Vault stub itself: the secret really is stored, just never read back through the connections table");

  const reconnect = connect({ tenantId: fixture.tenantBeta, actorId: fixture.actorBeta, refreshToken: "1//harness-refresh-token-beta-v2" });
  assert.equal(reconnect.outcome, "connected");
  const secondContext = context(fixture.tenantBeta);
  assert.notEqual(secondContext.vaultSecretId, firstSecretId, "reconnecting rotates to a fresh Vault secret");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM vault.secrets WHERE id='${firstSecretId}';`), "0", "the prior secret is deleted from Vault on reconnect, never left orphaned");
  assert.equal(queryScalar(databaseUrl, `SELECT secret FROM vault.secrets WHERE id='${secondContext.vaultSecretId}';`), "1//harness-refresh-token-beta-v2");

  // The exact self-recovery path ADR-039 describes for reauth_required: a
  // worker (out of scope here) would flip status without touching
  // vault_secret_id (the CHECK constraint requires it stay non-null for any
  // non-revoked status). Reconnecting must still succeed -- this is the
  // concrete scenario the original create-before-delete ordering bug broke,
  // since the Vault secret name is deterministic per tenant and the stale
  // row under that name was still present when create_secret ran.
  runSql(databaseUrl, `UPDATE public.portal_business_action_calendar_connections SET status='reauth_required' WHERE tenant_id='${fixture.tenantBeta}';`);
  const reauthReconnect = connect({ tenantId: fixture.tenantBeta, actorId: fixture.actorBeta, refreshToken: "1//harness-refresh-token-beta-v3" });
  assert.equal(reauthReconnect.outcome, "connected", "reconnecting from reauth_required succeeds instead of colliding on the Vault secret name");
  const thirdContext = context(fixture.tenantBeta);
  assert.equal(thirdContext.status, "connected");
  assert.notEqual(thirdContext.vaultSecretId, secondContext.vaultSecretId, "the reauth_required reconnect also rotates to a fresh Vault secret");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM vault.secrets WHERE id='${secondContext.vaultSecretId}';`), "0", "the stale reauth_required secret is deleted, never left orphaned");

  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_disconnect_google_calendar_service('${fixture.tenantBeta}','${nextId()}');`)),
  "an actor with no tenant_admin membership cannot disconnect a calendar");

  const disconnected = disconnect(fixture.tenantBeta, fixture.actorBeta);
  assert.equal(disconnected.outcome, "revoked");
  const revokedContext = context(fixture.tenantBeta);
  assert.equal(revokedContext.outcome, "found", "a revoked connection row still exists -- context distinguishes never-connected from revoked");
  assert.equal(revokedContext.status, "revoked");
  assert.equal(revokedContext.vaultSecretId, null, "no dangling Vault reference survives revocation");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM vault.secrets WHERE id='${thirdContext.vaultSecretId}';`), "0", "disconnect deletes the live Vault secret");
  assert.equal(disconnect(fixture.tenantBeta, fixture.actorBeta).outcome, "revoked", "disconnecting an already-revoked connection is idempotent, never an error");

  // -- ADR-041 defense-in-depth (0055): google_account_email gets the same
  // 320-char bound as contactEmail elsewhere in this domain. Not named in
  // the original task list, but this RPC's own p_google_account_email check
  // had the identical gap (format regex only, no char_length) -- same fix,
  // same reasoning, isolated on tenantGamma so it never disturbs tenantBeta's
  // already-exercised connect/reconnect/revoke state above.
  const boundaryGoogleEmail = `${"g".repeat(307)}@example.test`; // exactly 320 chars
  const oversizedGoogleEmail = `${"g".repeat(308)}@example.test`; // 321 chars
  assert.equal(boundaryGoogleEmail.length, 320);
  assert.equal(oversizedGoogleEmail.length, 321);
  const boundaryConnect = connect({ tenantId: fixture.tenantGamma, actorId: fixture.actorGamma, email: boundaryGoogleEmail, refreshToken: "1//harness-refresh-token-gamma-boundary" });
  assert.equal(boundaryConnect.outcome, "connected", "a 320-char google_account_email (the RFC 5321 bound) still connects exactly as before -- non-regression");
  assert.equal(queryScalar(databaseUrl, `SELECT char_length(google_account_email) FROM public.portal_business_action_calendar_connections WHERE tenant_id='${fixture.tenantGamma}';`), "320");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_connect_google_calendar_service(
    '${nextId()}','${fixture.tenantGamma}','${fixture.actorGamma}','${oversizedGoogleEmail}','primary','America/Sao_Paulo','1//harness-refresh-token-gamma-oversized'
  );`)), "portal_connect_google_calendar_service rejects a 321-char google_account_email even though its format regex alone would accept it");
  assert.equal(queryScalar(databaseUrl, `SELECT google_account_email FROM public.portal_business_action_calendar_connections WHERE tenant_id='${fixture.tenantGamma}';`), boundaryGoogleEmail,
    "the rejected oversized-email reconnect attempt never overwrites the tenant's live connection row");

  // -- scheduling flow (tenantAlpha/agentAlpha, auto_confirm_scheduling already true) --
  assert.equal(connect({ tenantId: fixture.tenantAlpha, actorId: fixture.actorAlpha, refreshToken: "1//harness-refresh-token-alpha-scheduling" }).outcome, "connected");

  const calSession = nextId();
  const calPresenter = nextId();
  assertSucceeded(runSql(databaseUrl, businessActionSessionFixtureSql(fixture.tenantAlpha, fixture.agentAlpha, calSession, calPresenter, "delivered", "granted")), "calendar scheduling session fixture");

  // propose_meeting_slots never needs a purpose-consent beyond essential --
  // ADR-039's explicit exemption, distinct from confirm_meeting_slot below.
  const proposeGrantId = nextId();
  const proposeIssued = admitAction({ grantId: proposeGrantId, actionKind: "propose_meeting_slots", sessionId: calSession, presenterId: calPresenter });
  assert.equal(proposeIssued.outcome, "issued");

  const slot1Id = nextId();
  const slot2Id = nextId();
  const firstProposal = propose({
    grantId: proposeGrantId, sessionId: calSession, presenterId: calPresenter,
    slots: [
      { id: slot1Id, startAt: "2026-09-01T14:00:00Z", endAt: "2026-09-01T14:30:00Z" },
      { id: slot2Id, startAt: "2026-09-01T15:00:00Z", endAt: "2026-09-01T15:30:00Z" },
    ],
  });
  assert.equal(firstProposal.outcome, "succeeded");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_proposal_slots WHERE tenant_id='${fixture.tenantAlpha}' AND proposal_id='${firstProposal.proposalId}';`), "2");
  const replayedProposal = propose({
    grantId: proposeGrantId, sessionId: calSession, presenterId: calPresenter,
    slots: [{ id: nextId(), startAt: "2026-09-01T16:00:00Z", endAt: "2026-09-01T16:30:00Z" }],
  });
  assert.equal(replayedProposal.outcome, "succeeded");
  assert.equal(replayedProposal.proposalId, firstProposal.proposalId, "a retried propose_meeting_slots call against the same grant replays the existing proposal");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_proposals WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${proposeGrantId}';`), "1");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_proposal_slots WHERE tenant_id='${fixture.tenantAlpha}' AND proposal_id='${firstProposal.proposalId}';`), "2", "a replayed propose call never appends a third slot row");

  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_propose_business_meeting_slots_service('${nextId()}','${nextId()}','019f0000-0000-7000-8000-000000009150','${fixture.tenantAlpha}','${fixture.agentAlpha}','${calSession}','${calPresenter}',30,'UTC','[]'::jsonb,null,null);`)),
  "a grant issued for register_lead (from assertBusinessActionAdmissionAndLeads) cannot be spent against propose_meeting_slots");

  // -- ADR-041 defense-in-depth (0055): propose_meeting_slots' contactEmail
  // gets the same 320-char bound.
  const proposeBoundaryEmail = `${"p".repeat(307)}@example.test`; // exactly 320 chars
  const proposeOversizedEmail = `${"p".repeat(308)}@example.test`; // 321 chars
  assert.equal(proposeBoundaryEmail.length, 320);
  assert.equal(proposeOversizedEmail.length, 321);

  const proposeBoundaryGrantId = nextId();
  assert.equal(admitAction({ grantId: proposeBoundaryGrantId, actionKind: "propose_meeting_slots", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const boundaryProposal = propose({
    grantId: proposeBoundaryGrantId, sessionId: calSession, presenterId: calPresenter, contactEmail: proposeBoundaryEmail,
    slots: [{ id: nextId(), startAt: "2026-09-03T14:00:00Z", endAt: "2026-09-03T14:30:00Z" }],
  });
  assert.equal(boundaryProposal.outcome, "succeeded", "a 320-char proposal contactEmail still proposes exactly as before -- non-regression");
  assert.equal(queryScalar(databaseUrl, `SELECT char_length(contact_email) FROM public.portal_business_action_proposals WHERE id='${boundaryProposal.proposalId}';`), "320");

  const proposeOversizedGrantId = nextId();
  assert.equal(admitAction({ grantId: proposeOversizedGrantId, actionKind: "propose_meeting_slots", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_propose_business_meeting_slots_service(
    '${nextId()}','${nextId()}','${proposeOversizedGrantId}','${fixture.tenantAlpha}','${fixture.agentAlpha}','${calSession}','${calPresenter}',
    30,'America/Sao_Paulo','[{"id":"${nextId()}","startAt":"2026-09-03T15:00:00Z","endAt":"2026-09-03T15:30:00Z"}]'::jsonb,null,'${proposeOversizedEmail}'
  );`)), "portal_propose_business_meeting_slots_service rejects a 321-char contactEmail even though its format regex alone would accept it");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_proposals WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${proposeOversizedGrantId}';`), "0",
    "the rejected oversized-email proposal never persists");

  // confirm_meeting_slot requires the meeting_scheduling purpose consent
  // ADR-039 adds -- denied before it is captured, issued once it is.
  const preConsentConfirmGrant = admitAction({ grantId: nextId(), actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter });
  assert.equal(preConsentConfirmGrant.outcome, "denied_purpose_consent");
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.consent_evidence (tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,jurisdiction,disclosure_version,evidence_hash,captured_at)
    VALUES ('${fixture.tenantAlpha}','${nextId()}','${calSession}','business-action-harness-subject','meeting_scheduling','meeting_scheduling','granted','click','BR','business-action-harness-v1','${"f".repeat(64)}',now());
  `), "meeting_scheduling consent fixture");

  const confirmGrant1 = nextId();
  assert.equal(admitAction({ grantId: confirmGrant1, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");

  const reservation1 = reserve({ grantId: confirmGrant1, sessionId: calSession, presenterId: calPresenter, proposalId: firstProposal.proposalId, slotId: slot1Id });
  assert.equal(reservation1.outcome, "reserved");
  assert.equal(reservation1.googleEventId, reservation1.reservationId.replaceAll("-", ""), "google_event_id is deterministically derived from the reservation's own id");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${reservation1.reservationId}';`), "reserved");

  const reservation1Replay = reserve({ grantId: confirmGrant1, sessionId: calSession, presenterId: calPresenter, proposalId: firstProposal.proposalId, slotId: slot1Id });
  assert.equal(reservation1Replay.outcome, "replayed");
  assert.equal(reservation1Replay.reservationId, reservation1.reservationId);

  // -- slot conflict: a second, independently admitted confirm_meeting_slot
  // grant racing for the same slot loses at the database's own partial
  // unique index, not by a pre-check that a concurrent caller could race past --
  const confirmGrant2 = nextId();
  assert.equal(admitAction({ grantId: confirmGrant2, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const conflictAttempt = reserve({ grantId: confirmGrant2, sessionId: calSession, presenterId: calPresenter, proposalId: firstProposal.proposalId, slotId: slot1Id });
  assert.equal(conflictAttempt.outcome, "rejected");
  assert.equal(conflictAttempt.reason, "slot_conflict");
  assert.equal(queryScalar(databaseUrl, `SELECT outcome FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${confirmGrant2}';`), "rejected");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_calendar_reservations WHERE tenant_id='${fixture.tenantAlpha}' AND slot_id='${slot1Id}' AND state<>'released';`), "1", "the slot never ends up with two live reservations");

  // -- dispatch/commit fence --
  const firstDispatch = dispatch(fixture.tenantAlpha, reservation1.reservationId);
  assert.equal(firstDispatch.acquired, true);
  assert.equal(firstDispatch.state, "provider_in_flight");
  const secondDispatch = dispatch(fixture.tenantAlpha, reservation1.reservationId);
  assert.equal(secondDispatch.acquired, false, "dispatching an already in-flight reservation never re-fires nor fails");
  assert.equal(secondDispatch.state, "provider_in_flight");

  const committed = commit({ reservationId: reservation1.reservationId, htmlLink: "https://calendar.google.com/event?eid=harness1" });
  assert.equal(committed.outcome, "succeeded");
  assert.equal(committed.state, "committed");
  const commitReceipt = queryRows(databaseUrl, `SELECT outcome,effect_hash FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${confirmGrant1}';`)[0];
  assert.match(commitReceipt, /succeeded/);
  const replayedCommit = commit({ reservationId: reservation1.reservationId });
  assert.equal(replayedCommit.outcome, "succeeded", "a retried commit call against the same grant replays the existing receipt instead of erroring on the provider_in_flight precondition");

  const proposeGrant2 = nextId();
  assert.equal(admitAction({ grantId: proposeGrant2, actionKind: "propose_meeting_slots", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const slot3Id = nextId();
  const slot4Id = nextId();
  const slot5Id = nextId();
  const slot6Id = nextId();
  const secondProposal = propose({
    grantId: proposeGrant2, sessionId: calSession, presenterId: calPresenter,
    slots: [
      { id: slot3Id, startAt: "2026-09-02T14:00:00Z", endAt: "2026-09-02T14:30:00Z" },
      { id: slot4Id, startAt: "2026-09-02T15:00:00Z", endAt: "2026-09-02T15:30:00Z" },
      { id: slot5Id, startAt: "2026-09-02T16:00:00Z", endAt: "2026-09-02T16:30:00Z" },
      { id: slot6Id, startAt: "2026-09-02T17:00:00Z", endAt: "2026-09-02T17:30:00Z" },
    ],
  });
  assert.equal(secondProposal.outcome, "succeeded");

  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_business_meeting_reservation_service('${fixture.tenantAlpha}','${nextId()}','${nextId()}');`)),
  "commit on a nonexistent reservation raises, never silently succeeds");

  // -- release: only ever pre-dispatch --
  const releaseGrant = nextId();
  assert.equal(admitAction({ grantId: releaseGrant, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const releaseReservation = reserve({ grantId: releaseGrant, sessionId: calSession, presenterId: calPresenter, proposalId: secondProposal.proposalId, slotId: slot3Id });
  assert.equal(releaseReservation.outcome, "reserved");
  const released = release({ reservationId: releaseReservation.reservationId, evidence: "proposal_expired" });
  assert.equal(released.outcome, "released");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${releaseReservation.reservationId}';`), "released");
  assert.equal(queryScalar(databaseUrl, `SELECT outcome FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${releaseGrant}';`), "rejected");
  const releasedReplay = release({ reservationId: releaseReservation.reservationId, evidence: "proposal_expired" });
  assert.equal(releasedReplay.outcome, "released", "a retried release call against the same grant replays the existing receipt");

  const notReleasableGrant = nextId();
  assert.equal(admitAction({ grantId: notReleasableGrant, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const notReleasableReservation = reserve({ grantId: notReleasableGrant, sessionId: calSession, presenterId: calPresenter, proposalId: secondProposal.proposalId, slotId: slot4Id });
  assert.equal(dispatch(fixture.tenantAlpha, notReleasableReservation.reservationId).acquired, true);
  const notReleasable = release({ reservationId: notReleasableReservation.reservationId, evidence: "proposal_expired" });
  assert.equal(notReleasable.outcome, "not_releasable", "the release RPC explicitly refuses to release a reservation past 'reserved', never after a dispatch");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${notReleasableReservation.reservationId}';`), "provider_in_flight");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${notReleasableGrant}';`), "0", "a refused release never writes a receipt -- the attempt is still open, headed for mark-unknown/reconcile instead");

  // -- unknown + dual-operator reconciliation --
  assert.equal(markUnknown(fixture.tenantAlpha, notReleasableReservation.reservationId), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${notReleasableReservation.reservationId}';`), "unknown");
  assert.equal(markUnknown(fixture.tenantAlpha, notReleasableReservation.reservationId), "f", "marking an already-unknown reservation unknown again is a no-op, never an error");

  const secondOperatorUserId = "10000000-0000-4000-8000-000000000090";
  const secondOperatorActorId = nextId();
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users (id, email) VALUES ('${secondOperatorUserId}', 'second-operator@example.test');
    INSERT INTO public.user_tenant_memberships (user_id, tenant_id, actor_id, role) VALUES ('${secondOperatorUserId}', '${fixture.tenantAlpha}', '${secondOperatorActorId}', 'tenant_admin');
  `), "second tenant_admin operator fixture for dual-approval reconciliation");

  const releaseEvidenceFp = "a".repeat(64);
  const firstApproval = reconcile({ reservationId: notReleasableReservation.reservationId, operatorActorId: fixture.actorAlpha, fingerprint: releaseEvidenceFp, outcome: "released" });
  assert.equal(firstApproval.outcome, "awaiting_second_operator");
  assert.equal(firstApproval.approvals, 1);
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${notReleasableReservation.reservationId}';`), "unknown");

  const sameOperatorRetry = reconcile({ reservationId: notReleasableReservation.reservationId, operatorActorId: fixture.actorAlpha, fingerprint: releaseEvidenceFp, outcome: "released" });
  assert.equal(sameOperatorRetry.outcome, "awaiting_second_operator");
  assert.equal(sameOperatorRetry.approvals, 1, "the same operator approving twice never advances the count -- dual approval requires two genuinely distinct people");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${notReleasableReservation.reservationId}';`), "unknown");

  const secondApproval = reconcile({ reservationId: notReleasableReservation.reservationId, operatorActorId: secondOperatorActorId, fingerprint: releaseEvidenceFp, outcome: "released" });
  assert.equal(secondApproval.outcome, "released");
  assert.equal(secondApproval.state, "released");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${notReleasableReservation.reservationId}';`), "released");
  assert.equal(queryScalar(databaseUrl, `SELECT outcome FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${notReleasableGrant}';`), "failed",
    "a reservation reconciled to released after a real dispatch attempt is a failed confirm_meeting_slot, not a pre-dispatch rejection");

  const idempotentReplay = reconcile({ reservationId: notReleasableReservation.reservationId, operatorActorId: fixture.actorAlpha, fingerprint: releaseEvidenceFp, outcome: "released" });
  assert.equal(idempotentReplay.outcome, "released", "reconciling an already-settled reservation with the same evidence/outcome replays idempotently");
  const conflictingReplay = reconcile({ reservationId: notReleasableReservation.reservationId, operatorActorId: fixture.actorAlpha, fingerprint: "b".repeat(64), outcome: "released" });
  assert.equal(conflictingReplay.outcome, "already_settled", "reconciling a settled reservation with different evidence is a reported conflict, never a silent overwrite");

  // -- the 'committed' reconciliation outcome, which the runtime dual-approval pattern (0043) never allows --
  const committedGrant = nextId();
  assert.equal(admitAction({ grantId: committedGrant, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const committedReservation = reserve({ grantId: committedGrant, sessionId: calSession, presenterId: calPresenter, proposalId: secondProposal.proposalId, slotId: slot5Id });
  assert.equal(dispatch(fixture.tenantAlpha, committedReservation.reservationId).acquired, true);
  assert.equal(markUnknown(fixture.tenantAlpha, committedReservation.reservationId), "t");
  const commitEvidenceFp = "c".repeat(64);
  assert.equal(reconcile({ reservationId: committedReservation.reservationId, operatorActorId: fixture.actorAlpha, fingerprint: commitEvidenceFp, outcome: "committed", releaseEvidenceCode: null }).outcome, "awaiting_second_operator");
  const committedFinal = reconcile({ reservationId: committedReservation.reservationId, operatorActorId: secondOperatorActorId, fingerprint: commitEvidenceFp, outcome: "committed", releaseEvidenceCode: null, htmlLink: "https://calendar.google.com/event?eid=harness-reconciled" });
  assert.equal(committedFinal.outcome, "committed");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${committedReservation.reservationId}';`), "committed");
  assert.equal(queryScalar(databaseUrl, `SELECT committed_at IS NOT NULL FROM public.portal_business_action_calendar_reservations WHERE id='${committedReservation.reservationId}';`), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT outcome FROM public.portal_business_action_receipts WHERE tenant_id='${fixture.tenantAlpha}' AND grant_id='${committedGrant}';`), "succeeded",
    "reconciling to committed produces the same succeeded outcome a direct commit would");

  // -- not reconcilable: a reservation still 'reserved' was never dispatched, so it is not this RPC's problem --
  const notReconcilableGrant = nextId();
  assert.equal(admitAction({ grantId: notReconcilableGrant, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const notReconcilableReservation = reserve({ grantId: notReconcilableGrant, sessionId: calSession, presenterId: calPresenter, proposalId: secondProposal.proposalId, slotId: slot6Id });
  const notReconcilable = reconcile({ reservationId: notReconcilableReservation.reservationId, operatorActorId: fixture.actorAlpha, fingerprint: "d".repeat(64), outcome: "released" });
  assert.equal(notReconcilable.outcome, "not_reconcilable");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.portal_business_action_calendar_reservations WHERE id='${notReconcilableReservation.reservationId}';`), "reserved");

  // -- ADR-041 defense-in-depth (0055): confirm_meeting_slot's reserve step
  // (contactEmail) gets the same 320-char bound. Its own fresh proposal/
  // slots so it never disturbs the slot bookkeeping any test above depends on.
  const emailBoundProposeGrant = nextId();
  assert.equal(admitAction({ grantId: emailBoundProposeGrant, actionKind: "propose_meeting_slots", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const emailBoundSlotA = nextId();
  const emailBoundSlotB = nextId();
  const emailBoundProposal = propose({
    grantId: emailBoundProposeGrant, sessionId: calSession, presenterId: calPresenter,
    slots: [
      { id: emailBoundSlotA, startAt: "2026-09-04T14:00:00Z", endAt: "2026-09-04T14:30:00Z" },
      { id: emailBoundSlotB, startAt: "2026-09-04T15:00:00Z", endAt: "2026-09-04T15:30:00Z" },
    ],
  });
  assert.equal(emailBoundProposal.outcome, "succeeded");

  const reserveBoundaryEmail = `${"r".repeat(307)}@example.test`; // exactly 320 chars
  const reserveOversizedEmail = `${"r".repeat(308)}@example.test`; // 321 chars
  assert.equal(reserveBoundaryEmail.length, 320);
  assert.equal(reserveOversizedEmail.length, 321);

  const reserveBoundaryGrant = nextId();
  assert.equal(admitAction({ grantId: reserveBoundaryGrant, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  const reserveBoundary = reserve({
    grantId: reserveBoundaryGrant, sessionId: calSession, presenterId: calPresenter,
    proposalId: emailBoundProposal.proposalId, slotId: emailBoundSlotA, contactEmail: reserveBoundaryEmail,
  });
  assert.equal(reserveBoundary.outcome, "reserved", "a 320-char confirm contactEmail still reserves exactly as before -- non-regression");
  assert.equal(queryScalar(databaseUrl, `SELECT char_length(contact_email) FROM public.portal_business_action_calendar_reservations WHERE id='${reserveBoundary.reservationId}';`), "320");

  const reserveOversizedGrant = nextId();
  assert.equal(admitAction({ grantId: reserveOversizedGrant, actionKind: "confirm_meeting_slot", sessionId: calSession, presenterId: calPresenter }).outcome, "issued");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reserve_business_meeting_slot_service(
    '${nextId()}','${nextId()}','${reserveOversizedGrant}','${fixture.tenantAlpha}','${fixture.agentAlpha}','${calSession}','${calPresenter}',
    '${emailBoundProposal.proposalId}','${emailBoundSlotB}','${reserveOversizedEmail}',null
  );`)), "portal_reserve_business_meeting_slot_service rejects a 321-char confirm contactEmail even though its format regex alone would accept it");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.portal_business_action_calendar_reservations WHERE slot_id='${emailBoundSlotB}';`), "0",
    "the rejected oversized-email reserve attempt never creates a reservation, leaving the slot free");

  // -- cross-tenant isolation: a real reservation id guessed under the wrong tenant is simply not found --
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_dispatch_business_meeting_reservation_service('${fixture.tenantBeta}','${notReconcilableReservation.reservationId}');`)),
  "a reservation cannot be dispatched under a tenant that does not own it");

  // -- RLS proof: even service_role has no direct table access, only the SECURITY DEFINER RPCs above do --
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, "SELECT 1 FROM public.portal_business_action_calendar_reservations LIMIT 1;")),
    "service_role has no direct SELECT on the calendar reservations table");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, "SELECT 1 FROM public.portal_business_action_calendar_connections LIMIT 1;")),
    "service_role has no direct SELECT on the calendar connections table");
}

// ADR-039 wave 1b-iii (0053): portal_google_calendar_decrypted_refresh_token_service
// is the only RPC in this schema that ever reads a decrypted Vault secret
// back out (0052's portal_google_calendar_connection_context_service
// deliberately never does -- see that function's own comment in the
// migration). Reuses tenants/actors earlier phases already made
// tenant_admin (tenantZeta needs no membership at all -- the RPC only ever
// takes p_tenant_id; tenantDelta/actorDelta and tenantGamma/actorGamma were
// already granted tenant_admin by assertUsageSummaryLedgerTotals and
// assertBillingCheckoutContract) instead of adding new membership fixtures,
// but creates and tears down its own calendar connections here rather than
// depending on whatever state assertBusinessActionCalendarScheduling
// happened to leave tenantAlpha/tenantBeta in.
function assertBusinessActionCalendarCredentialRead(databaseUrl) {
  const readToken = (tenantId) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_google_calendar_decrypted_refresh_token_service('${tenantId}');`));

  // -- (1) a tenant that never connected a calendar at all --
  assert.equal(readToken(fixture.tenantZeta).outcome, "not_connected",
    "a tenant with no calendar connection row has no decrypted credential to read");

  // -- (2) a tenant whose connection exists but is revoked: the dead
  // connection's secret must never surface -- same declared not_connected
  // outcome as a tenant that never connected at all, never an exception and
  // never a shape that would let a caller tell the two cases apart --
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_connect_google_calendar_service(
    '019f0000-0000-7000-8000-0000000a6600','${fixture.tenantDelta}','${fixture.actorDelta}',
    '${sqlLiteral("revoked-credential-read@example.test")}','${sqlLiteral("primary")}','UTC',
    '${sqlLiteral("1//harness-refresh-token-delta-credential-read")}'
  );`)), "connect fixture for the revoked-connection credential-read scenario");
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_disconnect_google_calendar_service('${fixture.tenantDelta}','${fixture.actorDelta}');`)),
  "disconnect fixture for the revoked-connection credential-read scenario");
  assert.equal(queryScalar(databaseUrl, `SELECT status FROM public.portal_business_action_calendar_connections WHERE tenant_id='${fixture.tenantDelta}';`), "revoked",
    "sanity check on the fixture itself: the connection row must really be revoked, not merely absent");
  assert.equal(readToken(fixture.tenantDelta).outcome, "not_connected",
    "a revoked connection's secret is never exposed, even though its row still exists");

  // -- (3) a tenant with a live connection: the RPC must return exactly the
  // raw value portal_connect_google_calendar_service wrote, proving the
  // write -> Vault -> decrypted-read roundtrip, not merely that some string
  // comes back --
  const liveRefreshToken = "1//harness-refresh-token-gamma-credential-read";
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_connect_google_calendar_service(
    '019f0000-0000-7000-8000-0000000a6601','${fixture.tenantGamma}','${fixture.actorGamma}',
    '${sqlLiteral("live-credential-read@example.test")}','${sqlLiteral("primary")}','UTC','${sqlLiteral(liveRefreshToken)}'
  );`)), "connect fixture for the live-connection credential-read roundtrip");
  const found = readToken(fixture.tenantGamma);
  assert.equal(found.outcome, "found");
  assert.equal(found.refreshToken, liveRefreshToken,
    "the RPC returns exactly the raw refresh token portal_connect_google_calendar_service wrote, proving the write -> Vault -> decrypted read roundtrip");

  // -- (4) least privilege: only service_role may ever call this RPC --
  const signature = "public.portal_google_calendar_decrypted_refresh_token_service(app.uuid_v7)";
  assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('service_role', '${signature}', 'EXECUTE');`), "t", "service_role grant");
  assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`), "f", "authenticated revoke");
  assert.equal(queryScalar(databaseUrl, `SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`), "f", "anon revoke");
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userGamma,
    `SELECT public.portal_google_calendar_decrypted_refresh_token_service('${fixture.tenantGamma}');`)),
  "an authenticated caller cannot invoke the decrypted-refresh-token RPC directly, not even for its own tenant");
}


// ADR-041 "Resolver sessão, presenter e geração de uma chamada já viva sem
// recriar o acoplamento que ADR-039 já proíbe" (migration 0054). Builds the
// exact durable trail a live call leaves behind -- portal_admit_runtime_channel_service
// (0043) for the session/binding, portal_consume_runtime_channel_grant_service
// for the provider dispatch fence, portal_begin_provider_effect_service /
// portal_mark_provider_effect_in_flight_service / portal_commit_provider_effect_service
// (0040) for the reservation, portal_bind_runtime_provider_channel_service
// (0043) for the receipt that ties the reservation to the binding -- then
// resolves it back purely by (tenantId, agentId, idempotencyKey), never by
// calling any admission RPC a second time.
function assertBusinessActionLiveCallContext(databaseUrl) {
  // An isolated tenant/agent/subscription fixture, not fixture.tenantAlpha:
  // by this point in the suite tenantAlpha has already accumulated 'tavus'
  // reservations from many earlier phases, and portal_begin_provider_effect_service's
  // own tavus_no_delivery_period budget (cap 3, 0040) has no notion of "this
  // is just a harness fixture" -- reusing tenantAlpha here intermittently
  // returns 'capped' depending on suite ordering, not the 'reserved' outcome
  // this test needs to set up its fixture. A dedicated tenant with an
  // 'active' subscription (never 'trialing', so the separate monthly-trial
  // cap never applies) keeps this test's cap budget entirely its own.
  const harnessUserId = "10000000-0000-4000-8000-00000000c001";
  const tenantId = "019f0000-0000-7000-8000-00000000c000";
  const agentId = "019f0000-0000-7000-8000-00000000c002";
  const actorId = "019f0000-0000-7000-8000-00000000c003";
  const mismatchAgentId = "019f0000-0000-7000-8000-00000000c004";
  const subscriptionId = "019f0000-0000-7000-8000-00000000c005";
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users(id,email) VALUES ('${harnessUserId}','live-call-context-harness@example.test');
    INSERT INTO public.tenants(id,slug,legal_name,status,home_region,default_language,default_timezone)
      VALUES ('${tenantId}','live-call-context-harness','Live Call Context Harness','active','local','pt','America/Sao_Paulo');
    INSERT INTO public.agents(tenant_id,id,name,role_type,status,disclosure_profile_id)
      VALUES ('${tenantId}','${agentId}','Live Call Context Harness Agent','sales','active','default');
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role) VALUES ('${harnessUserId}','${tenantId}','${actorId}','tenant_admin');
    INSERT INTO public.tenant_subscriptions(id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
      VALUES ('${subscriptionId}','${tenantId}','cus_LiveCallContext','sub_LiveCallContext','piloto','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
  `), "isolated live call context harness tenant");

  const bindingId = "019f0000-0000-7000-8000-000000009601";
  const sessionId = "019f0000-0000-7000-8000-000000009602";
  const presenterId = "019f0000-0000-7000-8000-000000009603";
  const disclosureId = "019f0000-0000-7000-8000-000000009604";
  const consentId = "019f0000-0000-7000-8000-000000009605";
  const commandFingerprint = "7".repeat(64);
  const evidenceHash = "8".repeat(64);
  const disclosureHash = "9".repeat(64);
  const essential = JSON.stringify({
    id: consentId,
    subjectRef: "live-call-context-operator",
    jurisdiction: "BR",
    evidenceHash,
    method: "click",
  });

  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '${bindingId}','${tenantId}','${actorId}','${agentId}',
      '${sessionId}','${presenterId}','tavus_video',array['scene_presentation'],'${commandFingerprint}',0,
      '${disclosureId}','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(essential)}'::jsonb,'[]'::jsonb
    );
  `)), "live call context runtime admission");

  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_consume_runtime_channel_grant_service('${bindingId}','${commandFingerprint}','tavus');`)).outcome, "acquired",
  "live call context tavus dispatch fence");

  const idempotencyKey = "live-call-context-alpha";
  const reservationId = "019f0000-0000-7000-8000-000000009607";
  const costEventId = "019f0000-0000-7000-8000-000000009608";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(tenantId, agentId, idempotencyKey, reservationId, costEventId, "tavus"))).outcome, "reserved",
  "live call context provider reservation");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','live-call-context-actual','https://tavus.daily.co/live-call-context');`)).committed, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000009606','${bindingId}','${reservationId}','tavus','live-call-context-actual','https://tavus.daily.co/live-call-context');`)), "t",
  "live call context provider channel receipt");

  const call = (tenant, agent, key) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_business_action_call_context_service('${tenant}','${agent}','${sqlLiteral(key)}');`));

  const found = call(tenantId, agentId, idempotencyKey);
  assert.equal(found.outcome, "found");
  assert.equal(found.sessionId, sessionId);
  assert.equal(found.presenterId, presenterId, "presenter matches the admission-time presenter before any handoff");
  assert.equal(found.generation, 0);

  // -- handoff: sessions.active_presenter_id moves to a new presenter; the
  // binding's own presenter_id column is never touched. A second read must
  // reflect the new floor, proving the RPC reads sessions fresh instead of
  // the stale value captured on the binding at admission time --
  const handoffPresenterId = "019f0000-0000-7000-8000-000000009609";
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.session_participants (tenant_id,id,session_id,participant_type,display_name,joined_at)
    VALUES ('${tenantId}','${handoffPresenterId}','${sessionId}','human_presenter','Live Call Context Handoff Presenter',now());
    UPDATE public.sessions SET active_presenter_id='${handoffPresenterId}', updated_at=now() WHERE tenant_id='${tenantId}' AND id='${sessionId}';
  `), "live call context handoff presenter swap");
  const foundAfterHandoff = call(tenantId, agentId, idempotencyKey);
  assert.equal(foundAfterHandoff.outcome, "found");
  assert.equal(foundAfterHandoff.presenterId, handoffPresenterId,
    "presenterId is read fresh from sessions.active_presenter_id, never the static presenter_id captured on the binding at admission time");
  assert.notEqual(
    queryScalar(databaseUrl, `SELECT presenter_id::text FROM public.portal_runtime_channel_bindings WHERE tenant_id='${tenantId}' AND id='${bindingId}';`),
    handoffPresenterId,
    "the binding's own presenter_id column is never mutated by handoff, confirming the RPC does not read it",
  );

  // -- agentId mismatch collapses into the same not_found outcome as a
  // missing reservation/binding/session: no message or shape difference --
  assert.equal(call(tenantId, mismatchAgentId, idempotencyKey).outcome, "not_found", "agentId mismatch never reveals that the reservation/binding exist");

  // -- unknown idempotencyKey --
  assert.equal(call(tenantId, agentId, "live-call-context-unknown-key").outcome, "not_found", "unknown idempotencyKey collapses into not_found");

  // -- cross-tenant lookup never finds another tenant's reservation --
  assert.equal(call(fixture.tenantBeta, agentId, idempotencyKey).outcome, "not_found", "cross-tenant lookup never finds another tenant's reservation");

  // -- terminal session: a tool call arriving after the session already
  // ended/failed gets a declared outcome, never treated as a live call --
  const terminalBindingId = "019f0000-0000-7000-8000-000000009610";
  const terminalSessionId = "019f0000-0000-7000-8000-000000009611";
  const terminalPresenterId = "019f0000-0000-7000-8000-000000009612";
  const terminalDisclosureId = "019f0000-0000-7000-8000-000000009613";
  const terminalConsentId = "019f0000-0000-7000-8000-000000009614";
  const terminalFingerprint = "1".repeat(64);
  const terminalEssential = JSON.stringify({
    id: terminalConsentId,
    subjectRef: "live-call-context-terminal-operator",
    jurisdiction: "BR",
    evidenceHash,
    method: "click",
  });
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_admit_runtime_channel_service(
      '${terminalBindingId}','${tenantId}','${actorId}','${agentId}',
      '${terminalSessionId}','${terminalPresenterId}','tavus_video',array['scene_presentation'],'${terminalFingerprint}',0,
      '${terminalDisclosureId}','runtime-v1','${disclosureHash}','visual','pt-BR','${sqlLiteral(terminalEssential)}'::jsonb,'[]'::jsonb
    );
  `)), "live call context terminal-session runtime admission");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_consume_runtime_channel_grant_service('${terminalBindingId}','${terminalFingerprint}','tavus');`)).outcome, "acquired");
  const terminalIdempotencyKey = "live-call-context-terminal";
  const terminalReservationId = "019f0000-0000-7000-8000-000000009616";
  const terminalCostEventId = "019f0000-0000-7000-8000-000000009617";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(tenantId, agentId, terminalIdempotencyKey, terminalReservationId, terminalCostEventId, "tavus"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${terminalReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${terminalReservationId}','live-call-context-terminal-actual','https://tavus.daily.co/live-call-context-terminal');`)).committed, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_runtime_provider_channel_service('019f0000-0000-7000-8000-000000009615','${terminalBindingId}','${terminalReservationId}','tavus','live-call-context-terminal-actual','https://tavus.daily.co/live-call-context-terminal');`)), "t");

  assertSucceeded(runSql(databaseUrl,
    `UPDATE public.sessions SET status='completed', ended_at=now(), updated_at=now() WHERE tenant_id='${tenantId}' AND id='${terminalSessionId}';`),
  "live call context terminal session status transition to completed");
  assert.equal(call(tenantId, agentId, terminalIdempotencyKey).outcome, "session_terminal", "a completed session is a declared outcome, never treated as a live call");

  // sessions' own status enum (database/migrations/0003_interaction_and_actions.sql)
  // has two terminal values, 'completed' and 'failed' -- prove both collapse
  // into the same outcome, not just the first one tried.
  assertSucceeded(runSql(databaseUrl,
    `UPDATE public.sessions SET status='failed', updated_at=now() WHERE tenant_id='${tenantId}' AND id='${terminalSessionId}';`),
  "live call context terminal session status transition to failed");
  assert.equal(call(tenantId, agentId, terminalIdempotencyKey).outcome, "session_terminal", "a failed session is also a declared session_terminal outcome");

  // -- least privilege: never executable by authenticated/anon. Explicit
  // here in addition to assertLeastPrivilege's catalog-wide sweep, because
  // the task gate calls this out by name --
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha,
    `SELECT public.portal_business_action_call_context_service('${tenantId}','${agentId}','${idempotencyKey}');`)),
  "authenticated callers cannot resolve live call context directly");
  assertFailed(runSql(databaseUrl, asRoleSql("anon", null,
    `SELECT public.portal_business_action_call_context_service('${tenantId}','${agentId}','${idempotencyKey}');`)),
  "anon callers cannot resolve live call context directly");
}


async function assertPortalTextPreviewAdmission(databaseUrl) {
  const essentialProfileFingerprint = "sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173";
  const persistedProfileFingerprint = "sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8";
  const providerFingerprint = "sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de";
  const policyFingerprint = `sha256:${"a".repeat(64)}`;
  const policyId = "019f0000-0000-7000-8000-000000009480";
  const replacementPolicyFingerprint = `sha256:${"b".repeat(64)}`;
  const replacementPolicyId = "019f0000-0000-7000-8000-000000009481";
  const identityHash = "5".repeat(64);
  const dataUseHash = "6".repeat(64);
  const defaultIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009500",
    session: "019f0000-0000-7000-8000-000000009501",
    presenter: "019f0000-0000-7000-8000-000000009502",
    identity: "019f0000-0000-7000-8000-000000009503",
    dataUse: "019f0000-0000-7000-8000-000000009504",
    essential: "019f0000-0000-7000-8000-000000009505",
  });
  const reservedId = (baseId, slot) => `${(0x0200 + slot).toString(16).padStart(4, "0")}${baseId.slice(4)}`;
  const admissionSql = ({
    ids,
    userId = fixture.userAlpha,
    agentId = fixture.agentAlpha,
    clientHash = "1".repeat(64),
    profileId = "openrouter_portal_text_essential_v1",
    commandFingerprint = "2".repeat(64),
    transcriptConsent = null,
    transcript = null,
    persistent = false,
    expectExisting = false,
    correlationId = ids.admission,
    profileFingerprint = persistent ? persistedProfileFingerprint : essentialProfileFingerprint,
  }) => {
    const reserved = Array.from({ length: 12 }, (_, slot) => reservedId(ids.admission, slot));
    return asRoleSql("service_role", null, `
    SELECT public.portal_admit_text_preview_service(
      '${ids.admission}','${userId}','${agentId}','${ids.session}','${ids.presenter}',
      '${clientHash}','${profileId}','1.0.0','${profileFingerprint}','${providerFingerprint}',
      '${commandFingerprint}','${ids.identity}','portal-text-preview-v1','${identityHash}',
      '${ids.dataUse}','portal-text-preview-v1','${dataUseHash}','${ids.essential}',
      ${transcriptConsent === null ? "null" : `'${transcriptConsent}'`},
      ${transcript === null ? "null" : `'${transcript}'`},${persistent},${expectExisting},
      '0123456789abcdef0123456789abcdef','${correlationId}',
      '${reserved[0]}','${reserved[1]}','${reserved[2]}','${reserved[3]}',
      '${reserved[4]}','${reserved[5]}','${reserved[6]}','${reserved[7]}',
      '${reserved[8]}','${reserved[9]}','${reserved[10]}','${reserved[11]}'
    );
  `);
  };
  const admit = (input) => queryJson(databaseUrl, admissionSql(input));
  const provisionPolicy = (tenantId, id = policyId) => queryJson(databaseUrl,
    asRoleSql("service_role", null, `SELECT public.portal_provision_text_preview_privacy_policy_service(
      '${id}','${tenantId}','US-FL','1.0.0','${policyFingerprint}',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 days'
    );`));

  assertFailed(runSql(databaseUrl, admissionSql({ ids: defaultIds })),
    "admission fails closed before a server-owned legal policy exists", /active text preview privacy policy required/);
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.portal_text_preview_admissions;"), "0");
  assert.deepEqual(provisionPolicy(fixture.tenantAlpha), { outcome: "provisioned", policyId });
  assert.equal(queryScalar(databaseUrl,
    `SELECT jurisdiction FROM public.portal_text_preview_privacy_policies WHERE tenant_id='${fixture.tenantAlpha}' AND id='${policyId}';`), "US-FL");
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `
    SELECT public.portal_provision_text_preview_privacy_policy_service(
      '${policyId}','${fixture.tenantAlpha}','US-FL','1.0.0','${policyFingerprint}',now(),now()+interval '1 day'
    );
  `)), "authenticated callers cannot provision legal policy");

  const rowsBeforeDefault = queryScalar(databaseUrl, "SELECT count(*) FROM public.conversation_transcripts;");
  const defaultAdmission = admit({ ids: defaultIds });
  assert.equal(defaultAdmission.status, "issued");
  assert.equal(defaultAdmission.ttl_seconds, 3600);
  assert.equal(defaultAdmission.persistent_transcript, false);
  assert.equal(defaultAdmission.tenant_id, fixture.tenantAlpha);
  assert.equal(defaultAdmission.actor_id, fixture.actorAlpha);
  assert.equal(defaultAdmission.agent_id, fixture.agentAlpha);
  assert.equal(defaultAdmission.admission_id, defaultIds.admission);
  assert.equal(defaultAdmission.privacy_policy_id, policyId);
  assert.equal(defaultAdmission.jurisdiction, "US-FL");
  assert.equal(defaultAdmission.privacy_policy_version, "1.0.0");
  assert.equal(defaultAdmission.privacy_policy_fingerprint, policyFingerprint);
  assert.equal(defaultAdmission.transcript_id, null);
  assert.equal(defaultAdmission.transcript_consent_id, null);
  assert.equal(queryScalar(databaseUrl,
    `SELECT status||':'||state_version::text||':'||disclosure_status||':'||consent_status
     FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${defaultIds.session}';`),
  "active:5:acknowledged:granted", "admission projection reaches the same canonical aggregate version");
  const admissionEvents = queryJson(databaseUrl, `
    SELECT jsonb_agg(event_document ORDER BY aggregate_version)
    FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}'
      AND aggregate_type='interaction_session'
      AND aggregate_id='${defaultIds.session}';
  `);
  const canonicalEnvelopeKeys = [
    "aggregate_id", "aggregate_type", "aggregate_version", "causation_id",
    "correlation_id", "data_classification", "event_id", "event_type",
    "event_version", "occurred_at", "payload_json", "producer",
    "schema_version", "session_id", "tenant_id", "trace_id",
  ];
  assert.deepEqual(admissionEvents.map((event) => event.event_type), [
    "session.created", "session.prepared", "disclosure.delivered",
    "consent.recorded", "session.activated",
  ]);
  assert.deepEqual(admissionEvents.map((event) => event.aggregate_version), [1, 2, 3, 4, 5]);
  assert.deepEqual(admissionEvents.map((event) => parseCanonicalOutboxInteractionEvent(event).event_type), [
    "session.created", "session.prepared", "disclosure.delivered",
    "consent.recorded", "session.activated",
  ], "the compiled domain consumer parses every admission event emitted by PostgreSQL");
  for (const [index, event] of admissionEvents.entries()) {
    assert.deepEqual(Object.keys(event).sort(), canonicalEnvelopeKeys);
    assert.equal(event.schema_version, "2.0.0");
    assert.equal(event.aggregate_type, "interaction_session");
    assert.equal(event.aggregate_id, defaultIds.session);
    assert.equal(event.session_id, defaultIds.session);
    assert.equal(event.tenant_id, fixture.tenantAlpha);
    assert.equal(event.producer, "portal.text_preview");
    assert.equal(event.data_classification, "internal");
    assert.equal(event.correlation_id, defaultIds.admission);
    assert.equal(typeof event.payload_json, "string");
    assert.doesNotThrow(() => JSON.parse(event.payload_json));
    assert.equal(event.causation_id, index === 0 ? null : admissionEvents[index - 1].event_id);
  }
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id='${defaultIds.session}'
      AND (id=event_id OR status<>'pending' OR attempts<>0 OR published_at is not null);
  `), "0", "outbox row IDs differ from event IDs and remain pending for the relay");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.session_timeline WHERE tenant_id='${fixture.tenantAlpha}' AND session_id='${defaultIds.session}';`),
  "0", "the preview writer never bypasses the relay into session_timeline");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.conversation_transcripts;"), rowsBeforeDefault,
    "default-off admission creates no transcript row");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.consent_evidence WHERE tenant_id='${fixture.tenantAlpha}' AND session_id='${defaultIds.session}' AND consent_type='persistent_transcription';`), "0",
  "default-off admission creates no optional transcript authority");
  assertFailed(runSql(databaseUrl, admissionSql({
    ids: {
      admission: "019f0000-0000-7000-8000-000000009506",
      session: "019f0000-0000-7000-8000-000000009507",
      presenter: "019f0000-0000-7000-8000-000000009508",
      identity: "019f0000-0000-7000-8000-000000009509",
      dataUse: "019f0000-0000-7000-8000-00000000950a",
      essential: "019f0000-0000-7000-8000-00000000950b",
    },
    clientHash: "a".repeat(64),
    correlationId: "019f0000-0000-7000-8000-00000000950c",
  })), "admission rejects correlation IDs that are not the admission ID", /invalid text preview admission/);
  for (const [field, value, constraint] of [
    ["profile_version", "9.9.9", "portal_text_preview_admissions_profile_version_chk"],
    ["profile_fingerprint", `sha256:${"f".repeat(64)}`, "portal_text_preview_admissions_persistence_chk"],
    ["provider_configuration_fingerprint", `sha256:${"e".repeat(64)}`, "portal_text_preview_admissions_provider_configuration_chk"],
  ]) {
    assertFailed(runSql(databaseUrl, `
      INSERT INTO public.portal_text_preview_admissions
      SELECT (jsonb_populate_record(a,'${sqlLiteral(JSON.stringify({ [field]: value }))}'::jsonb)).*
      FROM public.portal_text_preview_admissions a
      WHERE a.tenant_id='${fixture.tenantAlpha}' AND a.id='${defaultIds.admission}';
    `), `direct insert cannot drift ${field}`, new RegExp(constraint));
  }

  const concurrentIds = [
    {
      admission: "019f0000-0000-7000-8000-000000009516",
      session: "019f0000-0000-7000-8000-000000009517",
      presenter: "019f0000-0000-7000-8000-000000009518",
      identity: "019f0000-0000-7000-8000-000000009519",
      dataUse: "019f0000-0000-7000-8000-00000000951a",
      essential: "019f0000-0000-7000-8000-00000000951b",
    },
    {
      admission: "019f0000-0000-7000-8000-00000000951c",
      session: "019f0000-0000-7000-8000-00000000951d",
      presenter: "019f0000-0000-7000-8000-00000000951e",
      identity: "019f0000-0000-7000-8000-00000000951f",
      dataUse: "019f0000-0000-7000-8000-000000009520",
      essential: "019f0000-0000-7000-8000-000000009521",
    },
  ];
  const concurrentAdmissions = await runConcurrentSqlBehindBarrier(databaseUrl,
    concurrentIds.map((ids, index) => ({
      lockId: 49_160 + index,
      sql: admissionSql({ ids, clientHash: "c".repeat(64) }),
    })),
    "text-preview-natural-admission-race");
  for (const result of concurrentAdmissions) assertSucceeded(result, "concurrent natural admission");
  const storedConcurrentAdmissionId = queryScalar(databaseUrl,
    `SELECT id FROM public.portal_text_preview_admissions WHERE tenant_id='${fixture.tenantAlpha}' AND client_session_ref_hash='${"c".repeat(64)}';`);
  assert.deepEqual(
    concurrentAdmissions.map((result) => parseLastJson(result.stdout).admission_id),
    [storedConcurrentAdmissionId, storedConcurrentAdmissionId],
    "both concurrent admission receipts resolve to the one durable admission",
  );
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_admissions WHERE tenant_id='${fixture.tenantAlpha}' AND client_session_ref_hash='${"c".repeat(64)}';`), "1",
  "concurrent natural admission creates one durable row");

  const expectedOnlyIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009522",
    session: "019f0000-0000-7000-8000-000000009523",
    presenter: "019f0000-0000-7000-8000-000000009524",
    identity: "019f0000-0000-7000-8000-000000009525",
    dataUse: "019f0000-0000-7000-8000-000000009526",
    essential: "019f0000-0000-7000-8000-000000009527",
  });
  const expectedOnlyCounts = queryRows(databaseUrl, `
    SELECT count(*) FROM public.sessions;
    SELECT count(*) FROM public.disclosure_records;
    SELECT count(*) FROM public.consent_evidence;
    SELECT count(*) FROM public.portal_text_preview_admissions;
  `);
  assertFailed(runSql(databaseUrl, admissionSql({
    ids: expectedOnlyIds,
    clientHash: "3".repeat(64),
    expectExisting: true,
  })), "expect-existing miss fails before any durable insert", /admission expected but not found/);
  assert.deepEqual(queryRows(databaseUrl, `
    SELECT count(*) FROM public.sessions;
    SELECT count(*) FROM public.disclosure_records;
    SELECT count(*) FROM public.consent_evidence;
    SELECT count(*) FROM public.portal_text_preview_admissions;
  `), expectedOnlyCounts, "expect-existing miss has zero inserts across the admission boundary");

  const replay = admit({
    ids: {
      admission: "019f0000-0000-7000-8000-000000009510",
      session: "019f0000-0000-7000-8000-000000009511",
      presenter: "019f0000-0000-7000-8000-000000009512",
      identity: "019f0000-0000-7000-8000-000000009513",
      dataUse: "019f0000-0000-7000-8000-000000009514",
      essential: "019f0000-0000-7000-8000-000000009515",
    },
  });
  assert.equal(replay.admission_id, defaultIds.admission, "natural replay keeps the original server resources");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_admissions WHERE tenant_id='${fixture.tenantAlpha}' AND client_session_ref_hash='${"1".repeat(64)}';`), "1");

  assertFailed(runSql(databaseUrl, admissionSql({
    ids: {
      admission: "019f0000-0000-7000-8000-000000009520",
      session: "019f0000-0000-7000-8000-000000009521",
      presenter: "019f0000-0000-7000-8000-000000009522",
      identity: "019f0000-0000-7000-8000-000000009523",
      dataUse: "019f0000-0000-7000-8000-000000009524",
      essential: "019f0000-0000-7000-8000-000000009525",
    },
    profileId: "openrouter_portal_text_persisted_v1",
    transcriptConsent: "019f0000-0000-7000-8000-000000009526",
    transcript: "019f0000-0000-7000-8000-000000009527",
    persistent: true,
    profileFingerprint: persistedProfileFingerprint,
  })), "semantic admission replay conflict is rejected");
  assertFailed(runSql(databaseUrl, admissionSql({
    ids: {
      admission: "019f0000-0000-7000-8000-000000009530",
      session: "019f0000-0000-7000-8000-000000009531",
      presenter: "019f0000-0000-7000-8000-000000009532",
      identity: "019f0000-0000-7000-8000-000000009533",
      dataUse: "019f0000-0000-7000-8000-000000009534",
      essential: "019f0000-0000-7000-8000-000000009535",
    },
    agentId: fixture.agentBeta,
    clientHash: "7".repeat(64),
  })), "user cannot admit an agent from another tenant");
  assert.equal(queryScalar(databaseUrl,
    "SELECT count(*) FROM public.portal_text_preview_admissions WHERE id='019f0000-0000-7000-8000-000000009530';"), "0",
  "cross-tenant denial writes no admission");
  assertFailed(runSql(databaseUrl, admissionSql({
    ids: {
      admission: "019f0000-0000-7000-8000-000000009536",
      session: "019f0000-0000-7000-8000-000000009537",
      presenter: "019f0000-0000-7000-8000-000000009538",
      identity: "019f0000-0000-7000-8000-000000009539",
      dataUse: "019f0000-0000-7000-8000-00000000953a",
      essential: "019f0000-0000-7000-8000-00000000953b",
    },
    userId: fixture.userBeta,
    agentId: fixture.agentBeta,
    clientHash: "f".repeat(64),
  })), "a tenant without a legal policy cannot be admitted", /active text preview privacy policy required/);
  const betaPolicyId = "019f0000-0000-7000-8000-000000009482";
  const betaIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009580",
    session: "019f0000-0000-7000-8000-000000009581",
    presenter: "019f0000-0000-7000-8000-000000009582",
    identity: "019f0000-0000-7000-8000-000000009583",
    dataUse: "019f0000-0000-7000-8000-000000009584",
    essential: "019f0000-0000-7000-8000-000000009585",
  });
  assert.deepEqual(provisionPolicy(fixture.tenantBeta, betaPolicyId),
    { outcome: "provisioned", policyId: betaPolicyId });
  assert.equal(admit({
    ids: betaIds,
    userId: fixture.userBeta,
    agentId: fixture.agentBeta,
    clientHash: "f".repeat(64),
  }).tenant_id, fixture.tenantBeta);
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `
    SELECT public.portal_admit_text_preview_service(
      '${defaultIds.admission}','${fixture.userAlpha}','${fixture.agentAlpha}','${defaultIds.session}','${defaultIds.presenter}',
      '${"1".repeat(64)}','openrouter_portal_text_essential_v1','1.0.0','${essentialProfileFingerprint}','${providerFingerprint}',
      '${"2".repeat(64)}','${defaultIds.identity}','portal-text-preview-v1','${identityHash}',
      '${defaultIds.dataUse}','portal-text-preview-v1','${dataUseHash}','${defaultIds.essential}',null,null,false,true,
      '0123456789abcdef0123456789abcdef','${defaultIds.admission}',
      ${Array.from({ length: 12 }, (_, slot) => `'${reservedId(defaultIds.admission, slot)}'`).join(",")}
    );
  `)), "authenticated callers cannot invoke the service admission boundary");

  const grants = new Map();
  const attemptForClaim = (claimId) => `019e${claimId.slice(4)}`;
  const acquireSql = (claimId, admissionId, commandRefHash, commandFingerprint, generation) => {
    const attemptId = attemptForClaim(claimId);
    const outcomeEventId = `0400${claimId.slice(4)}`;
    const outcomeOutboxId = `0401${claimId.slice(4)}`;
    grants.set(claimId, Object.freeze({
      admissionId, attemptId, commandFingerprint, generation, outcomeEventId, outcomeOutboxId,
    }));
    return asRoleSql("service_role", null, `SELECT public.portal_acquire_text_preview_turn_service(
      '${claimId}','${attemptId}','${admissionId}','${commandRefHash}','${commandFingerprint}',${generation},
      '${outcomeEventId}','${outcomeOutboxId}'
    );`);
  };
  const acquire = (claimId, admissionId, commandRefHash, commandFingerprint, generation) => queryJson(databaseUrl,
    acquireSql(claimId, admissionId, commandRefHash, commandFingerprint, generation));
  const complete = (admissionId, claimId, userTurn, assistantTurn, persistContent = false, options = {}) => {
    const grant = grants.get(claimId);
    assert.ok(grant, `missing test grant for ${claimId}`);
    assert.equal(grant.admissionId, admissionId);
    const completionFingerprint = options.completionFingerprint ?? `hmac-sha256:${"c".repeat(64)}`;
    const providerRequestId = Object.hasOwn(options, "providerRequestId") ? options.providerRequestId : null;
    return queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_complete_text_preview_turn_service(
        '${admissionId}','${claimId}','${grant.attemptId}',${grant.generation},'${grant.commandFingerprint}',
        '${completionFingerprint}',${providerRequestId === null ? "null" : `'${sqlLiteral(providerRequestId)}'`},
        ${persistContent ? `'${sqlLiteral(userTurn)}'` : "null"},
        ${persistContent ? `'${sqlLiteral(assistantTurn)}'` : "null"}
      );`));
  };
  const fail = (claimId, reason, providerRequestId = null, options = {}) => {
    const grant = grants.get(claimId);
    assert.ok(grant, `missing test grant for ${claimId}`);
    const admissionId = options.admissionId ?? grant.admissionId;
    const attemptId = options.attemptId ?? grant.attemptId;
    return queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_fail_text_preview_turn_service(
        '${admissionId}','${claimId}','${attemptId}',${grant.generation},'${grant.commandFingerprint}','${reason}',
        ${providerRequestId === null ? "null" : `'${sqlLiteral(providerRequestId)}'`}
      );`));
  };
  const reconcileProviderResponse = (claimId, providerRequestId, options = {}) => {
    const grant = grants.get(claimId);
    assert.ok(grant, `missing test grant for ${claimId}`);
    const admissionId = options.admissionId ?? grant.admissionId;
    const attemptId = options.attemptId ?? grant.attemptId;
    const generation = options.generation ?? grant.generation;
    return queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_reconcile_text_preview_provider_response_service(
        '${admissionId}','${claimId}','${attemptId}',${generation},'${grant.commandFingerprint}',
        '${sqlLiteral(providerRequestId)}'
      );`));
  };
  const reservationsByEgress = new Map();
  const reserveForEgress = (egressId, claimId, kind, options = {}) => {
    const grant = grants.get(claimId);
    assert.ok(grant, `missing test grant for ${claimId}`);
    const reservationId = `0500${egressId.slice(4)}`;
    const costEventId = `0501${egressId.slice(4)}`;
    const operation = kind === "embedding" ? "knowledge_query_embedding" : "chat_generation";
    const maxInput = kind === "embedding" ? 1000 : 20000;
    const maxOutput = kind === "embedding" ? 0 : 512;
    const maxCost = kind === "embedding" ? "0.001" : "0.05";
    const reserved = queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_begin_ai_usage_reservation_service(
        '${reservationId}','${costEventId}','${options.tenantId ?? fixture.tenantAlpha}',
        '${options.agentId ?? fixture.agentAlpha}',null,
        'portal-text:${egressId}','${operation}',${maxInput},${maxOutput},${maxCost}
      );`));
    assert.ok(["reserved", "replayed"].includes(reserved.outcome),
      `AI reservation failed for ${egressId}: ${JSON.stringify(reserved)}`);
    reservationsByEgress.set(egressId, reservationId);
    return reservationId;
  };
  const releaseEgressReservation = (egressId) => {
    const reservationId = reservationsByEgress.get(egressId);
    assert.ok(reservationId, `missing AI reservation for ${egressId}`);
    assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_release_ai_usage_service('${reservationId}','not_dispatched');`)), "t");
  };
  const authorizeEgress = (egressId, claimId, kind, options = {}) => {
    const grant = grants.get(claimId);
    assert.ok(grant, `missing test grant for ${claimId}`);
    const admissionId = options.admissionId ?? grant.admissionId;
    const attemptId = options.attemptId ?? grant.attemptId;
    const generation = options.generation ?? grant.generation;
    const reservationId = options.reservationId ?? reserveForEgress(egressId, claimId, kind, options);
    return queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_authorize_text_preview_egress_service(
        '${egressId}','${admissionId}','${claimId}','${attemptId}',${generation},'${kind}','${reservationId}'
      );`));
  };
  const firstClaim = "019f0000-0000-7000-8000-000000009540";
  const firstAcquire = acquire(firstClaim, defaultIds.admission, "a".repeat(64), "b".repeat(64), 0);
  assert.equal(firstAcquire.outcome, "acquired");
  assert.equal(firstAcquire.claimId, firstClaim);
  assert.equal(firstAcquire.attemptId, attemptForClaim(firstClaim));
  assert.equal(firstAcquire.generation, 0);
  assert.ok(Date.parse(firstAcquire.leaseExpiresAt) > Date.now());
  const firstEmbeddingEgress = "019f0000-0000-7000-8000-0000000095a0";
  const boundaryEmbeddingEgress = "019f0000-0000-7000-8000-0000000095cf";
  assertSucceeded(runSql(databaseUrl, `
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_turn_claims
    SET acquired_at=boundary.at-interval '55 seconds',
        lease_expires_at=boundary.at+interval '35 seconds'
    FROM boundary
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${firstClaim}';
  `), "set the exact database-clock egress denial boundary");
  assert.equal(authorizeEgress(boundaryEmbeddingEgress, firstClaim, "embedding").outcome, "expired",
    "PostgreSQL denies egress when at most the 30-second provider deadline plus five-second margin remains");
  releaseEgressReservation(boundaryEmbeddingEgress);
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations WHERE claim_id='${firstClaim}';`), "0");
  assertSucceeded(runSql(databaseUrl, `
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_turn_claims
    SET acquired_at=boundary.at-interval '54 seconds',
        lease_expires_at=boundary.at+interval '36 seconds'
    FROM boundary
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${firstClaim}';
  `), "set the database-clock egress acceptance side of the boundary");
  const embeddingGrant = authorizeEgress(firstEmbeddingEgress, firstClaim, "embedding");
  assert.equal(embeddingGrant.outcome, "authorized");
  assert.equal(embeddingGrant.egressId, firstEmbeddingEgress);
  assert.equal(embeddingGrant.kind, "embedding");
  assert.ok(Date.parse(embeddingGrant.expiresAt) > Date.parse(embeddingGrant.authorizedAt));
  assert.ok(Date.parse(embeddingGrant.expiresAt) - Date.parse(embeddingGrant.authorizedAt) <= 15_000);
  assert.equal(queryScalar(databaseUrl,
    `SELECT state FROM public.ai_usage_reservations WHERE id='${reservationsByEgress.get(firstEmbeddingEgress)}';`),
  "provider_in_flight", "authorized atomically crosses the AI dispatch fence");
  assert.equal(authorizeEgress(firstEmbeddingEgress, firstClaim, "embedding", {
    reservationId: reservationsByEgress.get(firstEmbeddingEgress),
  }).outcome, "already_authorized",
    "a lost grant response never authorizes a replayed dispatch");
  assertSucceeded(runSql(databaseUrl, `
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_turn_claims
    SET acquired_at=boundary.at-interval '70 seconds',
        lease_expires_at=boundary.at+interval '20 seconds'
    FROM boundary
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${firstClaim}';
  `), "cross the new-dispatch margin while the existing grant remains valid");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095a1", firstClaim, "embedding", {
    reservationId: reservationsByEgress.get(firstEmbeddingEgress),
  }).outcome, "already_authorized",
  "a response-loss retry below the 35-second new-dispatch margin recovers only the still-valid original grant");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(firstEmbeddingEgress)}',1,0,null);`)).committed,
  true, "embedding usage settles before generation authorization");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095a2", firstClaim, "generation", {
    admissionId: betaIds.admission,
  }).outcome, "not_authorized", "a cross-tenant admission cannot authorize another tenant claim");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095a2");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations WHERE id='019f0000-0000-7000-8000-0000000095a2';`), "0");
  assertSucceeded(runSql(databaseUrl, `
    WITH restored AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_turn_claims
    SET acquired_at=restored.at,lease_expires_at=restored.at+interval '90 seconds'
    FROM restored
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${firstClaim}';
  `), "restore a full claim lease after the exact boundary test");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095a3", firstClaim, "generation").outcome,
    "authorized", "the separately revalidated generation egress receives its own one-use grant");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get("019f0000-0000-7000-8000-0000000095a3")}',1,1,null);`)).committed,
  true, "generation usage settles after the atomic egress grant");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `
    INSERT INTO public.portal_text_preview_egress_authorizations(
      id,tenant_id,admission_id,claim_id,attempt_id,generation,kind,authorized_at,expires_at
    ) VALUES (
      '019f0000-0000-7000-8000-0000000095a4','${fixture.tenantAlpha}','${defaultIds.admission}',
      '${firstClaim}','${attemptForClaim(firstClaim)}',0,'generation',clock_timestamp(),clock_timestamp()+interval '1 second'
    );
  `)), "service role cannot bypass the egress RPC with direct DML");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_fail_text_preview_turn_service(
      '${betaIds.admission}','${firstClaim}','${attemptForClaim(firstClaim)}',0,'${"b".repeat(64)}','generation_failed'
      ,null
    );`)).outcome, "not_authorized", "fail cannot mix a claim with another tenant admission");
  assert.equal(acquire(firstClaim, defaultIds.admission, "a".repeat(64), "b".repeat(64), 0).outcome, "acquired");
  assert.equal(acquire("019f0000-0000-7000-8000-000000009541", defaultIds.admission,
    "c".repeat(64), "d".repeat(64), 0).outcome, "conflict", "generation zero has one in-flight owner");
  assert.equal(complete(defaultIds.admission, firstClaim, "Não enviar", "Não enviar", true).outcome,
    "conflict", "default-off completion rejects content before any database write");
  assert.equal(complete(defaultIds.admission, firstClaim, "", "", false, {
    providerRequestId: "requisição-não-ascii",
  }).outcome, "conflict", "provider request IDs are bounded to opaque ASCII");
  const firstProviderRequestId = `openrouter-request-${firstClaim.slice(-12)}`;
  assert.deepEqual(complete(defaultIds.admission, firstClaim, "Olá", "Olá, como posso ajudar?", false, {
    providerRequestId: firstProviderRequestId,
  }), { outcome: "succeeded", persistence: "disabled", providerRequestId: firstProviderRequestId });
  assert.deepEqual(complete(defaultIds.admission, firstClaim, "Olá", "Olá, como posso ajudar?", false, {
    providerRequestId: firstProviderRequestId,
  }), { outcome: "succeeded", persistence: "disabled", providerRequestId: firstProviderRequestId },
  "turn completion replays structurally");
  assert.equal(complete(defaultIds.admission, firstClaim, "Olá", "Olá, como posso ajudar?", false, {
    completionFingerprint: `hmac-sha256:${"d".repeat(64)}`,
    providerRequestId: firstProviderRequestId,
  }).outcome, "conflict", "completion HMAC drift cannot replay a succeeded claim");
  assert.equal(complete(defaultIds.admission, firstClaim, "Olá", "Olá, como posso ajudar?", false, {
    providerRequestId: "fake-request-divergent",
  }).outcome, "conflict", "provider request drift cannot replay a succeeded claim");
  assert.deepEqual(reconcileProviderResponse(firstClaim, firstProviderRequestId),
    { outcome: "succeeded", providerRequestId: firstProviderRequestId },
  "ambiguous transport after a committed completion reconciles to succeeded");
  const firstOutcomeEvent = queryJson(databaseUrl, `
    SELECT event_document FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}' AND event_id='${grants.get(firstClaim).outcomeEventId}';
  `);
  assert.equal(parseCanonicalOutboxInteractionEvent(firstOutcomeEvent).event_type, "turn.outcome_recorded",
    "the compiled domain consumer parses a successful PostgreSQL outcome");
  assert.deepEqual(Object.keys(firstOutcomeEvent).sort(), canonicalEnvelopeKeys);
  assert.equal(firstOutcomeEvent.aggregate_version, 6);
  assert.equal(firstOutcomeEvent.causation_id, admissionEvents[4].event_id);
  assert.equal(firstOutcomeEvent.correlation_id, firstClaim);
  assert.equal(firstOutcomeEvent.data_classification, "internal");
  const firstOutcomePayload = JSON.parse(firstOutcomeEvent.payload_json);
  assert.deepEqual(firstOutcomePayload, {
    schema_version: "2.0.0",
    claim_id: firstClaim,
    generation: 0,
    outcome: "succeeded",
    reason_code: "generation_succeeded",
    persistence: "disabled",
    resulting_turn_index: 2,
  });
  assert.equal(firstOutcomeEvent.payload_json.includes("provider"), false);
  assert.equal(firstOutcomeEvent.payload_json.includes("Olá"), false);
  assert.equal(queryScalar(databaseUrl,
    `SELECT state_version FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${defaultIds.session}';`),
  "6", "claim success and canonical outbox advance the projection atomically");
  assert.equal(acquire(firstClaim, defaultIds.admission, "a".repeat(64), "b".repeat(64), 0).outcome,
    "already_processed");
  assert.equal(acquire("019f0000-0000-7000-8000-000000009542", defaultIds.admission,
    "e".repeat(64), "f".repeat(64), 0).outcome, "stale_generation");

  const failedClaim = "019f0000-0000-7000-8000-000000009543";
  assert.equal(acquire(failedClaim, defaultIds.admission, "0".repeat(64), "1".repeat(64), 1).outcome, "acquired");
  assert.equal(fail(failedClaim, "generation_failed").outcome, "failed");
  const failedOutcomeEvent = queryJson(databaseUrl, `
    SELECT event_document FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}' AND event_id='${grants.get(failedClaim).outcomeEventId}';
  `);
  assert.equal(parseCanonicalOutboxInteractionEvent(failedOutcomeEvent).event_type, "turn.outcome_recorded",
    "the compiled domain consumer parses a failed PostgreSQL outcome");
  assert.equal(failedOutcomeEvent.event_type, "turn.outcome_recorded");
  assert.equal(failedOutcomeEvent.aggregate_version, 7);
  assert.equal(failedOutcomeEvent.correlation_id, failedClaim);
  assert.equal(failedOutcomeEvent.causation_id, firstOutcomeEvent.event_id);
  assert.deepEqual(JSON.parse(failedOutcomeEvent.payload_json), {
    schema_version: "2.0.0",
    claim_id: failedClaim,
    generation: 1,
    outcome: "failed",
    reason_code: "generation_failed",
    persistence: null,
    resulting_turn_index: 2,
  });
  const providerFailureClaim = "019f0000-0000-7000-8000-000000009544";
  const providerFailureId = "openrouter-response-uncommitted-9544";
  assert.equal(acquire(providerFailureClaim, defaultIds.admission,
    "2".repeat(64), "3".repeat(64), 1).outcome, "acquired");
  const providerFailureEgress = "019f0000-0000-7000-8000-0000000095d0";
  assert.equal(authorizeEgress(providerFailureEgress, providerFailureClaim, "generation").outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(providerFailureEgress)}',1,1,null);`)).committed,
  true, "the provider receipt follows a generation dispatch grant");
  assert.equal(fail(providerFailureClaim, "provider_response_uncommitted").outcome, "conflict",
    "provider response failure requires the opaque provider response ID");
  assert.equal(fail(providerFailureClaim, "generation_failed", providerFailureId).outcome, "conflict",
    "ordinary failures cannot retain a provider response ID");
  assert.equal(fail(providerFailureClaim, "provider_response_uncommitted", providerFailureId, {
    admissionId: betaIds.admission,
  }).outcome, "not_authorized", "cross-tenant admission cannot record provider evidence");
  assert.equal(fail(providerFailureClaim, "provider_response_uncommitted", providerFailureId, {
    attemptId: "019f0000-0000-7000-8000-0000000095af",
  }).outcome, "conflict", "an old attempt cannot record provider evidence");
  const providerFailureBefore = queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'stateVersion',(SELECT state_version FROM public.sessions
        WHERE tenant_id='${fixture.tenantAlpha}' AND id='${defaultIds.session}'),
      'outboxCount',(SELECT count(*) FROM public.events_outbox
        WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id='${defaultIds.session}')
    );
  `);
  assert.equal(fail(providerFailureClaim, "provider_response_uncommitted", providerFailureId).outcome, "failed");
  assert.equal(fail(providerFailureClaim, "provider_response_uncommitted", providerFailureId).outcome, "failed",
    "the exact provider failure receipt replays idempotently");
  assert.equal(fail(providerFailureClaim, "provider_response_uncommitted", "openrouter-response-divergent").outcome,
    "conflict", "a divergent provider response ID cannot replay the receipt");
  assert.deepEqual(reconcileProviderResponse(providerFailureClaim, providerFailureId), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: providerFailureId,
  }, "the reconciliation boundary replays the durable provider failure receipt");
  assert.equal(reconcileProviderResponse(providerFailureClaim, "openrouter-response-divergent").outcome, "conflict");
  assert.equal(queryScalar(databaseUrl, `
    SELECT state||':'||reason_code||':'||provider_request_id
    FROM public.portal_text_preview_turn_claims
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${providerFailureClaim}';
  `), `failed:provider_response_uncommitted:${providerFailureId}`);
  const providerFailureEvent = queryJson(databaseUrl, `
    SELECT event_document FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}'
      AND event_id='${grants.get(providerFailureClaim).outcomeEventId}';
  `);
  assert.equal(parseCanonicalOutboxInteractionEvent(providerFailureEvent).event_type, "turn.outcome_recorded");
  assert.equal(providerFailureEvent.payload_json.includes(providerFailureId), false,
    "provider response IDs remain claim evidence and never enter the event payload");
  assert.equal(JSON.parse(providerFailureEvent.payload_json).reason_code, "provider_response_uncommitted");
  assert.deepEqual(queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'stateVersion',(SELECT state_version FROM public.sessions
        WHERE tenant_id='${fixture.tenantAlpha}' AND id='${defaultIds.session}'),
      'outboxCount',(SELECT count(*) FROM public.events_outbox
        WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id='${defaultIds.session}')
    );
  `), {
    stateVersion: providerFailureBefore.stateVersion + 1,
    outboxCount: providerFailureBefore.outboxCount + 1,
  }, "provider response failure updates claim, projection and canonical outbox atomically once");
  const leaseClaim = "019f0000-0000-7000-8000-000000009545";
  assert.equal(acquire(leaseClaim, defaultIds.admission, "7".repeat(64), "1".repeat(64), 1).outcome, "acquired");
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.portal_text_preview_turn_claims
    SET acquired_at=aged.now_at-interval '91 seconds',
        lease_expires_at=aged.now_at-interval '1 second'
    FROM (SELECT clock_timestamp() AS now_at) aged
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${leaseClaim}';
  `), "age a local turn lease without breaking its exact ninety-second window");
  assert.deepEqual(complete(defaultIds.admission, leaseClaim, "Descartar", "Descartada"),
    { outcome: "failed", reasonCode: "worker_lost" }, "expired owner cannot complete");
  const workerLostEvent = queryJson(databaseUrl, `
    SELECT event_document FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}' AND event_id='${grants.get(leaseClaim).outcomeEventId}';
  `);
  assert.equal(workerLostEvent.event_type, "turn.outcome_recorded");
  assert.equal(workerLostEvent.correlation_id, leaseClaim);
  assert.equal(JSON.parse(workerLostEvent.payload_json).reason_code, "worker_lost");
  assert.equal(fail(leaseClaim, "generation_failed").outcome, "conflict",
    "expired owner cannot replace worker_lost with a caller-selected failure");
  assert.deepEqual(acquire(leaseClaim, defaultIds.admission, "7".repeat(64), "1".repeat(64), 1),
    { outcome: "failed" }, "same command reference remains terminal after worker loss");
  const recoveredClaim = "019f0000-0000-7000-8000-000000009546";
  assert.equal(acquire(recoveredClaim, defaultIds.admission, "6".repeat(64), "2".repeat(64), 1).outcome,
    "acquired", "a new command reference may retry an unconsumed generation after worker loss");
  assert.equal(fail(recoveredClaim, "generation_failed").outcome, "failed");
  const retriedClaim = "019f0000-0000-7000-8000-000000009548";
  const competingClaim = "019f0000-0000-7000-8000-000000009547";
  const generationRace = await runConcurrentSqlBehindBarrier(databaseUrl, [
    { lockId: 49_170, sql: acquireSql(retriedClaim, defaultIds.admission, "8".repeat(64), "3".repeat(64), 1) },
    { lockId: 49_171, sql: acquireSql(competingClaim, defaultIds.admission, "9".repeat(64), "5".repeat(64), 1) },
  ], "text-preview-generation-race");
  for (const result of generationRace) assertSucceeded(result, "same-generation acquire race");
  const raceOutcomes = generationRace.map((result) => parseLastJson(result.stdout));
  assert.deepEqual(raceOutcomes.map((result) => result.outcome).sort(), ["acquired", "conflict"],
    "same-generation concurrency has one winner");
  const generationWinner = raceOutcomes.find((result) => result.outcome === "acquired").claimId;
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_turn_claims WHERE tenant_id='${fixture.tenantAlpha}' AND admission_id='${defaultIds.admission}' AND generation=1 AND state='acquired';`), "1");
  assert.equal(complete(defaultIds.admission, generationWinner, "Nova tentativa", "Concluída").persistence, "disabled");

  const oldPolicyIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009550",
    session: "019f0000-0000-7000-8000-000000009551",
    presenter: "019f0000-0000-7000-8000-000000009552",
    identity: "019f0000-0000-7000-8000-000000009553",
    dataUse: "019f0000-0000-7000-8000-000000009554",
    essential: "019f0000-0000-7000-8000-000000009555",
  });
  admit({ ids: oldPolicyIds, clientHash: "9".repeat(64) });
  const oldPolicyClaim = "019f0000-0000-7000-8000-000000009556";
  assert.equal(acquire(oldPolicyClaim, oldPolicyIds.admission,
    "6".repeat(64), "7".repeat(64), 0).outcome, "acquired");
  const oldPolicyGenerationEgress = "019f0000-0000-7000-8000-0000000095d1";
  const oldPolicyProviderId = "openrouter-policy-drift-9556";
  assert.equal(authorizeEgress(oldPolicyGenerationEgress, oldPolicyClaim, "generation").outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(oldPolicyGenerationEgress)}',1,1,null);`)).committed,
  true);
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_provision_text_preview_privacy_policy_service(
      '${replacementPolicyId}','${fixture.tenantAlpha}','US-FL','1.0.1','${replacementPolicyFingerprint}',
      clock_timestamp(),clock_timestamp()+interval '30 days'
    );
  `)), { outcome: "provisioned", policyId: replacementPolicyId });
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095a5", oldPolicyClaim, "embedding").outcome,
    "not_authorized", "policy supersession after acquire blocks the next provider egress");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095a5");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations WHERE claim_id='${oldPolicyClaim}';`), "1");
  assert.deepEqual(complete(oldPolicyIds.admission, oldPolicyClaim, "Policy antiga", "Não entregar", false, {
    providerRequestId: oldPolicyProviderId,
  }), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: oldPolicyProviderId,
  }, "policy drift after generation dispatch preserves the provider receipt without reply content");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||reason_code FROM public.portal_text_preview_turn_claims WHERE id='${oldPolicyClaim}';`),
  "failed:provider_response_uncommitted");
  assert.equal(acquire("019f0000-0000-7000-8000-000000009558", oldPolicyIds.admission,
    "8".repeat(64), "9".repeat(64), 0).outcome, "not_authorized",
  "a newer active tenant policy invalidates an older admission before generation");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_provision_text_preview_privacy_policy_service(
      '019f0000-0000-7000-8000-000000009557','${fixture.tenantAlpha}','BR','1.0.2',
      'sha256:${"c".repeat(64)}',now()-interval '2 minutes',now()+interval '1 day'
    );
  `)), "policy effective time cannot move backwards", /must advance effective time/);

  const consentIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009560",
    session: "019f0000-0000-7000-8000-000000009561",
    presenter: "019f0000-0000-7000-8000-000000009562",
    identity: "019f0000-0000-7000-8000-000000009563",
    dataUse: "019f0000-0000-7000-8000-000000009564",
    essential: "019f0000-0000-7000-8000-000000009565",
  });
  const currentPolicyAdmission = admit({ ids: consentIds, clientHash: "0".repeat(64) });
  assert.equal(currentPolicyAdmission.privacy_policy_id, replacementPolicyId);
  const revokedClaim = "019f0000-0000-7000-8000-000000009567";
  assert.equal(acquire(revokedClaim, consentIds.admission, "4".repeat(64), "5".repeat(64), 0).outcome,
    "acquired", "the grant exists before the later essential revocation");
  const revokedGenerationEgress = "019f0000-0000-7000-8000-0000000095d2";
  const revokedProviderId = "openrouter-consent-drift-9567";
  assert.equal(authorizeEgress(revokedGenerationEgress, revokedClaim, "generation").outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(revokedGenerationEgress)}',1,1,null);`)).committed,
  true);
  const essentialSubject = queryScalar(databaseUrl,
    `SELECT subject_ref FROM public.consent_evidence WHERE tenant_id='${fixture.tenantAlpha}' AND id='${consentIds.essential}';`);
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.consent_evidence(
    tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,jurisdiction,
    disclosure_version,evidence_hash,captured_at,revoked_at
  ) VALUES (
    '${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009566','${consentIds.session}','${sqlLiteral(essentialSubject)}',
    'essential_processing','portal_text_preview','revoked','click','US-FL','portal-text-preview-v1',
    '${"8".repeat(64)}',clock_timestamp(),clock_timestamp()
  );`), "append a newer essential consent revocation");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095a6", revokedClaim, "embedding").outcome,
    "not_authorized", "a newer essential revocation blocks embedding after claim acquisition");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095a6");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations WHERE claim_id='${revokedClaim}';`), "1");
  assert.deepEqual(complete(consentIds.admission, revokedClaim, "Revogado", "Não entregar", false, {
    providerRequestId: revokedProviderId,
  }), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: revokedProviderId,
  }, "consent drift after generation dispatch preserves the provider receipt without reply content");

  const guardIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009570",
    session: "019f0000-0000-7000-8000-000000009571",
    presenter: "019f0000-0000-7000-8000-000000009572",
    identity: "019f0000-0000-7000-8000-000000009573",
    dataUse: "019f0000-0000-7000-8000-000000009574",
    essential: "019f0000-0000-7000-8000-000000009575",
  });
  admit({ ids: guardIds, clientHash: "a".repeat(63) + "1" });
  const guardClaim = "019f0000-0000-7000-8000-000000009576";
  const transferredPresenter = "019f0000-0000-7000-8000-000000009577";
  assert.equal(acquire(guardClaim, guardIds.admission, "a".repeat(64), "b".repeat(64), 0).outcome, "acquired");
  const lockTimeoutEgress = "019f0000-0000-7000-8000-0000000095d4";
  const lockTimeoutReservation = reserveForEgress(lockTimeoutEgress, guardClaim, "embedding");
  const admissionLockBarrier = "text-preview-admission-lock-timeout";
  const admissionLockHolder = runSqlAsync(databaseUrl, `
    BEGIN;
    SELECT id FROM public.portal_text_preview_admissions
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.admission}' FOR UPDATE;
    SELECT pg_advisory_xact_lock(49_180);
    DO $barrier$
    DECLARE deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${admissionLockBarrier}');
        IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'admission lock barrier timeout'; END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    COMMIT;
  `);
  await waitForAdvisoryLockHolder(databaseUrl, 49_180);
  const lockWaitStartedAt = Date.now();
  const timedOutEgress = await runSqlAsync(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_authorize_text_preview_egress_service(
      '${lockTimeoutEgress}','${guardIds.admission}','${guardClaim}','${attemptForClaim(guardClaim)}',0,
      'embedding','${lockTimeoutReservation}'
    );`));
  const lockWaitElapsedMs = Date.now() - lockWaitStartedAt;
  assertSucceeded(runSql(databaseUrl,
    `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${admissionLockBarrier}') ON CONFLICT DO NOTHING;`),
  "release preview admission lock holder");
  assertFailed(timedOutEgress, "bounded preview lock wait", /lock timeout|canceling statement/);
  assert.ok(lockWaitElapsedMs >= 1_500 && lockWaitElapsedMs < 3_500,
    `preview lock wait must stay within the 2s lock bound, observed ${lockWaitElapsedMs}ms`);
  assertSucceeded(await admissionLockHolder, "release the deterministic admission lock holder");
  assertSucceeded(runSql(databaseUrl,
    `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${admissionLockBarrier}';`),
  "clear preview admission lock barrier");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state FROM public.ai_usage_reservations WHERE id='${lockTimeoutReservation}';`), "reserved");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations WHERE id='${lockTimeoutEgress}';`), "0");
  releaseEgressReservation(lockTimeoutEgress);
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.session_participants(
      tenant_id,id,session_id,participant_type,display_name,joined_at
    ) VALUES (
      '${fixture.tenantAlpha}','${transferredPresenter}','${guardIds.session}',
      'digital_presenter','Transferred presenter',clock_timestamp()
    );
    UPDATE public.sessions SET active_presenter_id='${transferredPresenter}'
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.session}';
  `), "transfer Presenter after claim acquisition");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095b0", guardClaim, "embedding").outcome,
    "not_authorized", "Presenter transfer blocks embedding after claim acquisition");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095b0");
  assert.equal(complete(guardIds.admission, guardClaim, "Não usar", "Não usar").outcome,
    "not_authorized", "Presenter transfer also blocks completion");
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.sessions SET active_presenter_id='${guardIds.presenter}'
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.session}';
    UPDATE public.session_participants SET left_at=clock_timestamp()
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transferredPresenter}';
    UPDATE public.sessions SET active_presenter_id=null
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.session}';
  `), "clear Presenter after restoring a single live presenter");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095b1", guardClaim, "generation").outcome,
    "not_authorized", "cleared Presenter blocks generation after claim acquisition");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095b1");
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.sessions SET active_presenter_id='${guardIds.presenter}'
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.session}';
    UPDATE public.session_participants SET left_at=clock_timestamp()
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.presenter}';
  `), "mark the admitted Presenter as left after claim acquisition");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095b2", guardClaim, "embedding").outcome,
    "not_authorized", "a left Presenter blocks embedding after claim acquisition");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095b2");
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.session_participants SET left_at=null
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.presenter}';
    UPDATE public.agents SET status='disabled'
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${fixture.agentAlpha}';
  `), "disable the agent after claim acquisition");
  assert.equal(authorizeEgress("019f0000-0000-7000-8000-0000000095b3", guardClaim, "generation").outcome,
    "not_authorized", "a disabled agent blocks generation after claim acquisition");
  releaseEgressReservation("019f0000-0000-7000-8000-0000000095b3");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations WHERE claim_id='${guardClaim}';`), "0",
  "every Presenter and agent derivation failure produces zero egress grants");
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.agents SET status='active'
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${fixture.agentAlpha}';
  `), "restore the agent fixture after derivation checks");
  const presenterDriftEgress = "019f0000-0000-7000-8000-0000000095d3";
  const presenterDriftProviderId = "openrouter-presenter-drift-9576";
  assert.equal(authorizeEgress(presenterDriftEgress, guardClaim, "generation").outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(presenterDriftEgress)}',1,1,null);`)).committed,
  true);
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.sessions SET active_presenter_id=null
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${guardIds.session}';
  `), "clear Presenter after generation dispatch");
  assert.deepEqual(complete(guardIds.admission, guardClaim, "Não usar", "Não usar", false, {
    providerRequestId: presenterDriftProviderId,
  }), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: presenterDriftProviderId,
  }, "Presenter drift after generation dispatch preserves the provider receipt without reply content");

  const persistedIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009600",
    session: "019f0000-0000-7000-8000-000000009601",
    presenter: "019f0000-0000-7000-8000-000000009602",
    identity: "019f0000-0000-7000-8000-000000009603",
    dataUse: "019f0000-0000-7000-8000-000000009604",
    essential: "019f0000-0000-7000-8000-000000009605",
  });
  const transcriptConsent = "019f0000-0000-7000-8000-000000009606";
  const transcriptId = "019f0000-0000-7000-8000-000000009607";
  const persisted = admit({
    ids: persistedIds,
    clientHash: "8".repeat(64),
    profileId: "openrouter_portal_text_persisted_v1",
    transcriptConsent,
    transcript: transcriptId,
    persistent: true,
    profileFingerprint: persistedProfileFingerprint,
  });
  assert.equal(persisted.persistent_transcript, true);
  assert.equal(persisted.transcript_id, transcriptId);
  assert.equal(queryScalar(databaseUrl,
    `SELECT jsonb_array_length(turns) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`), "0");

  const persistedClaim = "019f0000-0000-7000-8000-000000009610";
  assert.equal(acquire(persistedClaim, persistedIds.admission, "6".repeat(64), "7".repeat(64), 0).outcome, "acquired");
  const persistedBeforeFailure = queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'stateVersion',(SELECT state_version FROM public.sessions
        WHERE tenant_id='${fixture.tenantAlpha}' AND id='${persistedIds.session}'),
      'outboxCount',(SELECT count(*) FROM public.events_outbox
        WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id='${persistedIds.session}')
    );
  `);
  assertSucceeded(runSql(databaseUrl, `
    CREATE FUNCTION public.axtro_test_reject_text_preview_receipt() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END; $$;
    CREATE TRIGGER axtro_test_reject_text_preview_receipt
    BEFORE INSERT ON public.portal_text_preview_transcript_writes
    FOR EACH ROW EXECUTE FUNCTION public.axtro_test_reject_text_preview_receipt();
  `), "install local atomicity failure injection");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_complete_text_preview_turn_service(
    '${persistedIds.admission}','${persistedClaim}','${grants.get(persistedClaim).attemptId}',0,'${"7".repeat(64)}',
    'hmac-sha256:${"c".repeat(64)}',null,'Olá','Como posso ajudar?'
  );`)), "receipt failure rolls back transcript and claim", /injected receipt failure/);
  assert.equal(queryScalar(databaseUrl,
    `SELECT jsonb_array_length(turns) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`), "0");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state FROM public.portal_text_preview_turn_claims WHERE tenant_id='${fixture.tenantAlpha}' AND id='${persistedClaim}';`), "acquired");
  assert.deepEqual(queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'stateVersion',(SELECT state_version FROM public.sessions
        WHERE tenant_id='${fixture.tenantAlpha}' AND id='${persistedIds.session}'),
      'outboxCount',(SELECT count(*) FROM public.events_outbox
        WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id='${persistedIds.session}')
    );
  `), persistedBeforeFailure, "transcript, claim, projection and outbox roll back as one transaction");
  assertSucceeded(runSql(databaseUrl, `
    DROP TRIGGER axtro_test_reject_text_preview_receipt ON public.portal_text_preview_transcript_writes;
    DROP FUNCTION public.axtro_test_reject_text_preview_receipt();
  `), "remove local atomicity failure injection");
  assert.deepEqual(complete(persistedIds.admission, persistedClaim, "Olá", "Como posso ajudar?", true),
    { outcome: "succeeded", persistence: "saved", providerRequestId: null });
  assert.deepEqual(complete(persistedIds.admission, persistedClaim, "Olá", "Como posso ajudar?", true),
    { outcome: "succeeded", persistence: "saved", providerRequestId: null });
  const ambiguousClaim = "019f0000-0000-7000-8000-000000009611";
  const ambiguousEgress = "019f0000-0000-7000-8000-000000009612";
  const ambiguousProviderId = "openrouter-ambiguous-before-commit-9611";
  assert.equal(acquire(ambiguousClaim, persistedIds.admission,
    "1".repeat(64), "2".repeat(64), 1).outcome, "acquired");
  assert.equal(authorizeEgress(ambiguousEgress, ambiguousClaim, "generation").outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(ambiguousEgress)}',1,1,null);`)).committed,
  true);
  assert.deepEqual(reconcileProviderResponse(ambiguousClaim, ambiguousProviderId), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: ambiguousProviderId,
  }, "ambiguous transport before completion creates the durable content-free provider receipt");
  assert.deepEqual(reconcileProviderResponse(ambiguousClaim, ambiguousProviderId), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: ambiguousProviderId,
  }, "before-commit reconciliation is idempotent");
  assert.deepEqual(complete(persistedIds.admission, ambiguousClaim, "Nunca gravar", "Nunca gravar", true, {
    providerRequestId: ambiguousProviderId,
  }), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: ambiguousProviderId,
  });
  assert.equal(queryScalar(databaseUrl,
    `SELECT jsonb_array_length(turns) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`),
  "2", "reconciliation before completion never appends transcript content");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.events_outbox WHERE tenant_id='${fixture.tenantAlpha}' AND event_id='${grants.get(ambiguousClaim).outcomeEventId}';`),
  "1", "ambiguous reconciliation emits exactly one terminal outcome");
  const lateTranscriptClaim = "019f0000-0000-7000-8000-000000009613";
  const lateTranscriptEgress = "019f0000-0000-7000-8000-000000009614";
  const lateTranscriptProviderId = "openrouter-late-transcript-lock-9613";
  assert.equal(acquire(lateTranscriptClaim, persistedIds.admission,
    "3".repeat(64), "4".repeat(64), 1).outcome, "acquired");
  assert.equal(authorizeEgress(lateTranscriptEgress, lateTranscriptClaim, "generation").outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(lateTranscriptEgress)}',1,1,null);`)).committed,
  true);
  assertSucceeded(runSql(databaseUrl, `
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_turn_claims
    SET acquired_at=boundary.at-interval '89 seconds',lease_expires_at=boundary.at+interval '1 second'
    FROM boundary WHERE tenant_id='${fixture.tenantAlpha}' AND id='${lateTranscriptClaim}';
  `), "move the persisted claim close to lease expiry without breaking its exact window");
  const transcriptLockBarrier = "text-preview-transcript-lock";
  const lateCompletionApplication = "axtro-text-preview-late-completion";
  const transcriptLockHolder = runSqlAsync(databaseUrl, `
    BEGIN;
    SELECT id FROM public.conversation_transcripts
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}' FOR UPDATE;
    SELECT pg_advisory_xact_lock(49_181);
    DO $barrier$
    DECLARE deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${transcriptLockBarrier}');
        IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'transcript lock barrier timeout'; END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    COMMIT;
  `);
  await waitForAdvisoryLockHolder(databaseUrl, 49_181);
  const lateCompletionPromise = runSqlAsync(databaseUrl, `
    SET application_name='${lateCompletionApplication}';
    ${asRoleSql("service_role", null,
    `SELECT public.portal_complete_text_preview_turn_service(
      '${persistedIds.admission}','${lateTranscriptClaim}','${attemptForClaim(lateTranscriptClaim)}',1,
      '${"4".repeat(64)}','hmac-sha256:${"d".repeat(64)}','${lateTranscriptProviderId}',
      'Não publicar','Não publicar'
    );`)}
  `);
  await waitForBlockedApplicationLocks(databaseUrl, [lateCompletionApplication]);
  const leaseExpiryDeadline = Date.now() + 3_000;
  while (queryScalar(databaseUrl,
    `SELECT lease_expires_at<=clock_timestamp() FROM public.portal_text_preview_turn_claims WHERE id='${lateTranscriptClaim}';`) !== "t") {
    if (Date.now() >= leaseExpiryDeadline) throw new Error("timed out waiting for preview claim lease expiry");
    await waitForMilliseconds(10);
  }
  assertSucceeded(runSql(databaseUrl,
    `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${transcriptLockBarrier}') ON CONFLICT DO NOTHING;`),
  "release preview transcript lock holder");
  const [lateCompletionResult, releasedTranscriptLock] = await Promise.all([
    lateCompletionPromise,
    transcriptLockHolder,
  ]);
  assertSucceeded(lateCompletionResult, "late completion waits behind the transcript row lock within the bounded wait");
  assertSucceeded(releasedTranscriptLock, "release the transcript lock after the claim lease boundary");
  assertSucceeded(runSql(databaseUrl,
    `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${transcriptLockBarrier}';`),
  "clear preview transcript lock barrier");
  assert.deepEqual(parseLastJson(lateCompletionResult.stdout), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: lateTranscriptProviderId,
  }, "completion refreshes PostgreSQL time after transcript lock wait and cannot succeed past lease expiry");
  assert.equal(queryScalar(databaseUrl,
    `SELECT jsonb_array_length(turns) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`),
  "2", "late completion publishes no transcript content");
  assert.equal(queryScalar(databaseUrl,
    `SELECT jsonb_array_length(turns) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`), "2",
  "one opted-in exchange stores one user and one assistant turn");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_transcript_writes WHERE tenant_id='${fixture.tenantAlpha}' AND claim_id='${persistedClaim}';`), "1",
  "exchange replay creates one append-only write receipt");
  assert.equal(queryScalar(databaseUrl,
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='portal_text_preview_transcript_writes' AND column_name='exchange_fingerprint';"), "0",
  "write receipts retain no plain content digest");
  assertFailed(runSql(databaseUrl, `INSERT INTO public.portal_text_preview_transcript_writes(
    claim_id,tenant_id,admission_id,transcript_id,generation
  ) VALUES ('${persistedClaim}','${fixture.tenantAlpha}','${defaultIds.admission}','${transcriptId}',0);`),
  "mixed admission and claim receipt is rejected by the composite foreign key");

  const transcriptSubject = queryScalar(databaseUrl,
    `SELECT subject_ref FROM public.consent_evidence WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptConsent}';`);
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.consent_evidence(
    tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,jurisdiction,
    disclosure_version,evidence_hash,captured_at,revoked_at
  ) VALUES (
    '${fixture.tenantAlpha}','019f0000-0000-7000-8000-000000009611','${persistedIds.session}','${sqlLiteral(transcriptSubject)}',
    'persistent_transcription','portal_text_preview','revoked','click','local','portal-text-preview-v1',
    '${"9".repeat(64)}',clock_timestamp(),clock_timestamp()
  );`), "append a newer transcript consent revocation");
  const postRevocationClaim = "019f0000-0000-7000-8000-000000009612";
  assert.equal(acquire(postRevocationClaim, persistedIds.admission, "8".repeat(64), "9".repeat(64), 1).outcome,
    "acquired", "optional revocation does not remove the essential text channel");
  assert.deepEqual(complete(persistedIds.admission, postRevocationClaim, "Não salve", "Entendido", true),
    { outcome: "succeeded", persistence: "not_saved", providerRequestId: null },
  "optional revocation preserves essential delivery and blocks transcript persistence");
  assert.equal(queryScalar(databaseUrl,
    `SELECT jsonb_array_length(turns) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`), "2");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_transcript_writes WHERE claim_id='${postRevocationClaim}';`), "0");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state FROM public.portal_text_preview_turn_claims WHERE id='${postRevocationClaim}';`), "succeeded");

  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_delete_conversation_transcript_service('${fixture.tenantAlpha}','${transcriptId}');`)),
    { ok: true, id: transcriptId });
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.conversation_transcripts WHERE tenant_id='${fixture.tenantAlpha}' AND id='${transcriptId}';`), "0");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_transcript_writes WHERE claim_id='${persistedClaim}';`), "1",
  "deletion removes PII while preserving the content-free write receipt");

  const purgeIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009620",
    session: "019f0000-0000-7000-8000-000000009621",
    presenter: "019f0000-0000-7000-8000-000000009622",
    identity: "019f0000-0000-7000-8000-000000009623",
    dataUse: "019f0000-0000-7000-8000-000000009624",
    essential: "019f0000-0000-7000-8000-000000009625",
  });
  const purgeConsent = "019f0000-0000-7000-8000-000000009626";
  const purgeTranscript = "019f0000-0000-7000-8000-000000009627";
  admit({ ids: purgeIds, clientHash: "d".repeat(64), profileId: "openrouter_portal_text_persisted_v1",
    profileFingerprint: persistedProfileFingerprint, transcriptConsent: purgeConsent,
    transcript: purgeTranscript, persistent: true });
  const purgeClaim = "019f0000-0000-7000-8000-000000009628";
  assert.equal(acquire(purgeClaim, purgeIds.admission, "d".repeat(64), "e".repeat(64), 0).outcome, "acquired");
  assert.equal(complete(purgeIds.admission, purgeClaim, "Expurgue", "Expurgarei", true).persistence, "saved");
  assertSucceeded(runSql(databaseUrl,
    `UPDATE public.conversation_transcripts SET started_at=now()-interval '31 days',ended_at=now()-interval '31 days' WHERE tenant_id='${fixture.tenantAlpha}' AND id='${purgeTranscript}';`),
  "age a local transcript for deterministic purge");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_purge_old_conversation_transcripts_service(30);" )).deleted, 1);
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_transcript_writes WHERE claim_id='${purgeClaim}';`), "1",
  "retention purge preserves the content-free write receipt");

  assertSucceeded(runSql(databaseUrl, `
    ALTER TABLE public.portal_text_preview_admissions DISABLE TRIGGER portal_text_preview_admissions_append_only;
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_admissions
    SET issued_at=boundary.at-interval '61 minutes',expires_at=boundary.at-interval '1 minute'
    FROM boundary
    WHERE tenant_id='${fixture.tenantAlpha}' AND id IN ('${oldPolicyIds.admission}','${consentIds.admission}');
    ALTER TABLE public.portal_text_preview_admissions ENABLE TRIGGER portal_text_preview_admissions_append_only;
    UPDATE public.sessions SET status='completed',ended_at=clock_timestamp()
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${oldPolicyIds.session}';
    UPDATE public.sessions SET status='failed',ended_at=clock_timestamp()
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${consentIds.session}';
  `), "inject completed and failed dangling terminal sessions outside the canonical cleanup path");
  const poisonRowsBefore = queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'versions',jsonb_agg(state_version ORDER BY id),
      'outboxCount',(SELECT count(*) FROM public.events_outbox
        WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id IN ('${oldPolicyIds.session}','${consentIds.session}'))
    ) FROM public.sessions
    WHERE tenant_id='${fixture.tenantAlpha}' AND id IN ('${oldPolicyIds.session}','${consentIds.session}');
  `);

  const cleanupIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009630",
    session: "019f0000-0000-7000-8000-000000009631",
    presenter: "019f0000-0000-7000-8000-000000009632",
    identity: "019f0000-0000-7000-8000-000000009633",
    dataUse: "019f0000-0000-7000-8000-000000009634",
    essential: "019f0000-0000-7000-8000-000000009635",
  });
  admit({ ids: cleanupIds, clientHash: "e".repeat(64) });
  const cleanupClaim = "019f0000-0000-7000-8000-000000009636";
  assert.equal(acquire(cleanupClaim, cleanupIds.admission, "e".repeat(64), "f".repeat(64), 0).outcome, "acquired");
  const freeCleanupIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009637",
    session: "019f0000-0000-7000-8000-000000009638",
    presenter: "019f0000-0000-7000-8000-000000009639",
    identity: "019f0000-0000-7000-8000-00000000963a",
    dataUse: "019f0000-0000-7000-8000-00000000963b",
    essential: "019f0000-0000-7000-8000-00000000963c",
  });
  const freeCleanupClientHash = "01".repeat(32);
  admit({ ids: freeCleanupIds, clientHash: freeCleanupClientHash });
  const freeCleanupClaim = "019f0000-0000-7000-8000-00000000963d";
  assert.equal(acquire(freeCleanupClaim, freeCleanupIds.admission,
    freeCleanupClientHash, "1".repeat(64), 0).outcome, "acquired");
  assertSucceeded(runSql(databaseUrl, `
    ALTER TABLE public.portal_text_preview_admissions DISABLE TRIGGER portal_text_preview_admissions_append_only;
    UPDATE public.portal_text_preview_admissions
    SET issued_at=now()-interval '61 minutes',expires_at=now()-interval '1 minute'
    WHERE tenant_id='${fixture.tenantAlpha}'
      AND id IN ('${cleanupIds.admission}','${freeCleanupIds.admission}');
    ALTER TABLE public.portal_text_preview_admissions ENABLE TRIGGER portal_text_preview_admissions_append_only;
  `), "inject local expiry for terminal cleanup");
  const occupiedCleanupBefore = queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'claimState',c.state,
      'sessionStatus',s.status,
      'sessionVersion',s.state_version,
      'outboxCount',(SELECT count(*) FROM public.events_outbox e
        WHERE e.tenant_id=a.tenant_id AND e.aggregate_id=a.session_id)
    )
    FROM public.portal_text_preview_admissions a
    JOIN public.portal_text_preview_turn_claims c
      ON c.tenant_id=a.tenant_id AND c.admission_id=a.id
    JOIN public.sessions s ON s.tenant_id=a.tenant_id AND s.id=a.session_id
    WHERE a.id='${cleanupIds.admission}' AND c.id='${cleanupClaim}';
  `);
  const cleanupLockBarrier = "text-preview-cleanup-lock";
  const cleanupLockHolder = runSqlAsync(databaseUrl, `
    BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended('portal-text-turn:${cleanupIds.admission}',0));
    SELECT pg_advisory_xact_lock(49_182);
    DO $barrier$
    DECLARE deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${cleanupLockBarrier}');
        IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'cleanup lock barrier timeout'; END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    COMMIT;
  `);
  await waitForAdvisoryLockHolder(databaseUrl, 49_182);
  const cleanupResult = queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_cleanup_expired_text_preview_sessions_service(100);"));
  assertSucceeded(runSql(databaseUrl,
    `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${cleanupLockBarrier}') ON CONFLICT DO NOTHING;`),
  "release preview cleanup lock holder");
  assert.deepEqual({
    outcome: cleanupResult.outcome,
    sessionsClosed: cleanupResult.sessionsClosed,
    participantsClosed: cleanupResult.participantsClosed,
    claimsFailed: cleanupResult.claimsFailed,
  }, { outcome: "completed", sessionsClosed: 1, participantsClosed: 1, claimsFailed: 1 });
  assert.equal(cleanupResult.busySkipped, 1,
    "a contended candidate is bounded and reported without aborting the cleanup batch");
  assertSucceeded(await cleanupLockHolder, "release preview cleanup advisory lock");
  assertSucceeded(runSql(databaseUrl,
    `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${cleanupLockBarrier}';`),
  "clear preview cleanup lock barrier");
  assert.ok(cleanupResult.operatorRequired >= 2 && cleanupResult.operatorRequired <= 100,
    "terminal poison rows and provider receipts remain bounded operator-visible without automatic mutation");
  assert.deepEqual(queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'claimState',c.state,
      'sessionStatus',s.status,
      'sessionVersion',s.state_version,
      'outboxCount',(SELECT count(*) FROM public.events_outbox e
        WHERE e.tenant_id=a.tenant_id AND e.aggregate_id=a.session_id)
    )
    FROM public.portal_text_preview_admissions a
    JOIN public.portal_text_preview_turn_claims c
      ON c.tenant_id=a.tenant_id AND c.admission_id=a.id
    JOIN public.sessions s ON s.tenant_id=a.tenant_id AND s.id=a.session_id
    WHERE a.id='${cleanupIds.admission}' AND c.id='${cleanupClaim}';
  `), occupiedCleanupBefore, "cleanup performs zero mutation on the busy admission");
  assert.equal(queryScalar(databaseUrl,
    `SELECT c.state||':'||s.status FROM public.portal_text_preview_turn_claims c
     JOIN public.portal_text_preview_admissions a ON a.tenant_id=c.tenant_id AND a.id=c.admission_id
     JOIN public.sessions s ON s.tenant_id=a.tenant_id AND s.id=a.session_id
     WHERE c.id='${freeCleanupClaim}';`), "failed:completed",
  "a free candidate progresses in the same cleanup batch");
  assert.deepEqual(queryJson(databaseUrl, `
    SELECT jsonb_build_object(
      'versions',jsonb_agg(state_version ORDER BY id),
      'outboxCount',(SELECT count(*) FROM public.events_outbox
        WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id IN ('${oldPolicyIds.session}','${consentIds.session}'))
    ) FROM public.sessions
    WHERE tenant_id='${fixture.tenantAlpha}' AND id IN ('${oldPolicyIds.session}','${consentIds.session}');
  `), poisonRowsBefore, "cleanup never auto-mutates dangling completed or failed terminal sessions");
  const retryCleanup = queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_cleanup_expired_text_preview_sessions_service(100);"));
  assert.equal(retryCleanup.sessionsClosed, 1,
    "the formerly busy candidate is processed on a later bounded cleanup pass");
  assert.equal(retryCleanup.busySkipped, 0);
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||reason_code FROM public.portal_text_preview_turn_claims WHERE id='${cleanupClaim}';`), "failed:session_expired");
  assert.equal(queryScalar(databaseUrl,
    `SELECT status||':'||(active_presenter_id is null)::text||':'||(ended_at is not null)::text FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${cleanupIds.session}';`),
    "completed:true:true");
  const cleanupEvents = queryJson(databaseUrl, `
    SELECT jsonb_agg(event_document ORDER BY aggregate_version)
    FROM public.events_outbox
    WHERE tenant_id='${fixture.tenantAlpha}' AND aggregate_id='${cleanupIds.session}';
  `);
  assert.deepEqual(cleanupEvents.map((event) => event.event_type), [
    "session.created", "session.prepared", "disclosure.delivered",
    "consent.recorded", "session.activated", "turn.outcome_recorded", "session.completed",
  ]);
  assert.deepEqual(cleanupEvents.map((event) => event.aggregate_version), [1, 2, 3, 4, 5, 6, 7]);
  const parsedCleanupEvents = cleanupEvents.map((event) => parseCanonicalOutboxInteractionEvent(event));
  assert.deepEqual(parsedCleanupEvents.map((event) => event.event_type), [
    "session.created", "session.prepared", "disclosure.delivered",
    "consent.recorded", "session.activated", "turn.outcome_recorded", "session.completed",
  ], "the compiled domain consumer parses the full PostgreSQL cleanup sequence");
  assert.deepEqual(
    domain.replayInteraction(parsedCleanupEvents),
    domain.replayInteraction(JSON.parse(JSON.stringify(parsedCleanupEvents))),
    "real PostgreSQL events reduce identically before and after a JSON round trip",
  );
  assert.equal(cleanupEvents[5].correlation_id, cleanupClaim);
  assert.equal(cleanupEvents[6].correlation_id, cleanupIds.admission);
  assert.equal(cleanupEvents[6].causation_id, cleanupEvents[5].event_id);
  assert.equal(cleanupEvents[6].event_id, reservedId(cleanupIds.admission, 10));
  assert.equal(queryScalar(databaseUrl,
    `SELECT state_version FROM public.sessions WHERE tenant_id='${fixture.tenantAlpha}' AND id='${cleanupIds.session}';`),
  "7", "cleanup failure and session completion advance projection with canonical events");
  const idempotentCleanup = queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_cleanup_expired_text_preview_sessions_service(100);"));
  assert.deepEqual({
    outcome: idempotentCleanup.outcome,
    sessionsClosed: idempotentCleanup.sessionsClosed,
    participantsClosed: idempotentCleanup.participantsClosed,
    claimsFailed: idempotentCleanup.claimsFailed,
  }, { outcome: "completed", sessionsClosed: 0, participantsClosed: 0, claimsFailed: 0 },
  "terminal cleanup is idempotent");
  assert.equal(idempotentCleanup.busySkipped, 0);
  assert.equal(idempotentCleanup.operatorRequired, retryCleanup.operatorRequired,
    "bounded operatorRequired telemetry is stable across idempotent cleanup replay");

  const revocationAuthority = Object.freeze({
    tenantId: "019f0000-0000-7000-8000-00000000000a",
    agentId: "019f0000-0000-7000-8000-00000000010a",
    actorId: "019f0000-0000-7000-8000-00000000020a",
    userId: "10000000-0000-4000-8000-00000000000a",
  });
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users(id,email)
      VALUES ('${revocationAuthority.userId}','portal-revocation-race@example.test');
    INSERT INTO public.tenants(id,slug,legal_name,status,home_region,default_language,default_timezone)
      VALUES ('${revocationAuthority.tenantId}','portal-revocation-race','Portal Revocation Race','active','local','en','UTC');
    INSERT INTO public.agents(tenant_id,id,name,role_type,status,disclosure_profile_id)
      VALUES ('${revocationAuthority.tenantId}','${revocationAuthority.agentId}','Revocation Race Agent','sales','active','default');
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
      VALUES ('${revocationAuthority.userId}','${revocationAuthority.tenantId}','${revocationAuthority.actorId}','tenant_admin');
  `), "create an isolated authority with no prior financial history for membership revocation");
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.billing_checkout_intents
    WHERE tenant_id='${revocationAuthority.tenantId}' OR actor_id='${revocationAuthority.actorId}';
  `), "0", "the revocation race identity has no financial FK dependents");
  const revocationPolicyId = "019f0000-0000-7000-8000-0000000096af";
  assert.deepEqual(provisionPolicy(revocationAuthority.tenantId, revocationPolicyId),
    { outcome: "provisioned", policyId: revocationPolicyId });
  const revocationIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-0000000096a0",
    session: "019f0000-0000-7000-8000-0000000096a1",
    presenter: "019f0000-0000-7000-8000-0000000096a2",
    identity: "019f0000-0000-7000-8000-0000000096a3",
    dataUse: "019f0000-0000-7000-8000-0000000096a4",
    essential: "019f0000-0000-7000-8000-0000000096a5",
  });
  admit({
    ids: revocationIds,
    userId: revocationAuthority.userId,
    agentId: revocationAuthority.agentId,
    clientHash: "8".repeat(64),
  });
  const revocationClaim = "019f0000-0000-7000-8000-0000000096a6";
  const revocationEgress = "019f0000-0000-7000-8000-0000000096a7";
  assert.equal(acquire(revocationClaim, revocationIds.admission,
    "8".repeat(64), "9".repeat(64), 0).outcome, "acquired");
  const revocationReservation = reserveForEgress(revocationEgress, revocationClaim, "generation", {
    tenantId: revocationAuthority.tenantId,
    agentId: revocationAuthority.agentId,
  });
  const postRevocationAdmissionIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-0000000096a8",
    session: "019f0000-0000-7000-8000-0000000096a9",
    presenter: "019f0000-0000-7000-8000-0000000096aa",
    identity: "019f0000-0000-7000-8000-0000000096ab",
    dataUse: "019f0000-0000-7000-8000-0000000096ac",
    essential: "019f0000-0000-7000-8000-0000000096ad",
  });
  const membershipDeleteBarrier = "text-preview-membership-delete";
  const membershipAdmissionApplication = "axtro-text-preview-membership-admission";
  const membershipEgressApplication = "axtro-text-preview-membership-egress";
  const membershipDelete = runSqlAsync(databaseUrl, `
    BEGIN;
    DELETE FROM public.user_tenant_memberships
    WHERE tenant_id='${revocationAuthority.tenantId}' AND user_id='${revocationAuthority.userId}';
    SELECT pg_advisory_xact_lock(49_183);
    DO $barrier$
    DECLARE deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${membershipDeleteBarrier}');
        IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'membership deletion barrier timeout'; END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    COMMIT;
  `);
  await waitForAdvisoryLockHolder(databaseUrl, 49_183);
  const admissionAfterDeletePromise = runSqlAsync(databaseUrl, `
    SET application_name='${membershipAdmissionApplication}';
    ${admissionSql({
      ids: postRevocationAdmissionIds,
      userId: revocationAuthority.userId,
      agentId: revocationAuthority.agentId,
      clientHash: "9".repeat(64),
    })}
  `);
  const egressAfterDeletePromise = runSqlAsync(databaseUrl, `
    SET application_name='${membershipEgressApplication}';
    ${asRoleSql("service_role", null,
      `SELECT public.portal_authorize_text_preview_egress_service(
        '${revocationEgress}','${revocationIds.admission}','${revocationClaim}',
        '${attemptForClaim(revocationClaim)}',0,'generation','${revocationReservation}'
      );`)}
  `);
  await waitForBlockedApplicationLocks(databaseUrl, [
    membershipAdmissionApplication,
    membershipEgressApplication,
  ]);
  assertSucceeded(runSql(databaseUrl,
    `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${membershipDeleteBarrier}') ON CONFLICT DO NOTHING;`),
  "release membership deletion holder");
  const [membershipDeleteResult, admissionAfterDelete, egressAfterDelete] = await Promise.all([
    membershipDelete,
    admissionAfterDeletePromise,
    egressAfterDeletePromise,
  ]);
  assertSucceeded(membershipDeleteResult, "commit the concurrent membership revocation");
  assertSucceeded(runSql(databaseUrl,
    `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${membershipDeleteBarrier}';`),
  "clear membership deletion barrier");
  assertFailed(admissionAfterDelete,
    "an admission that observed pre-delete membership must revalidate after its advisory locks",
    /user is not authorized/);
  assertSucceeded(egressAfterDelete, "membership revocation egress denial");
  assert.equal(parseLastJson(egressAfterDelete.stdout).outcome, "not_authorized");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||(provider_dispatched_at is null)::text
     FROM public.ai_usage_reservations WHERE id='${revocationReservation}';`), "reserved:true",
  "membership revocation creates no provider-in-flight transition");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations
     WHERE id='${revocationEgress}';`), "0", "membership revocation creates no egress receipt");
  releaseEgressReservation(revocationEgress);

  const suspensionAuthority = Object.freeze({
    tenantId: "019f0000-0000-7000-8000-00000000000b",
    agentId: "019f0000-0000-7000-8000-00000000010b",
    actorId: "019f0000-0000-7000-8000-00000000020b",
    userId: "10000000-0000-4000-8000-00000000000b",
  });
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users(id,email)
      VALUES ('${suspensionAuthority.userId}','portal-suspension-race@example.test');
    INSERT INTO public.tenants(id,slug,legal_name,status,home_region,default_language,default_timezone)
      VALUES ('${suspensionAuthority.tenantId}','portal-suspension-race','Portal Suspension Race','active','local','en','UTC');
    INSERT INTO public.agents(tenant_id,id,name,role_type,status,disclosure_profile_id)
      VALUES ('${suspensionAuthority.tenantId}','${suspensionAuthority.agentId}','Suspension Race Agent','sales','active','default');
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
      VALUES ('${suspensionAuthority.userId}','${suspensionAuthority.tenantId}','${suspensionAuthority.actorId}','tenant_admin');
  `), "create an isolated authority with no prior spend history for tenant suspension");
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.billing_checkout_intents
    WHERE tenant_id='${suspensionAuthority.tenantId}' OR actor_id='${suspensionAuthority.actorId}';
  `), "0", "the suspension authority has no billing checkout history");
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.ai_usage_reservations
    WHERE tenant_id='${suspensionAuthority.tenantId}' AND state IN ('provider_in_flight','unknown');
  `), "0", "the suspension authority has no ambiguous or in-flight AI usage");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.cost_events WHERE tenant_id='${suspensionAuthority.tenantId}';`),
  "0", "the suspension authority has no prior cost history");
  const suspensionPolicyId = "019f0000-0000-7000-8000-0000000096bf";
  assert.deepEqual(provisionPolicy(suspensionAuthority.tenantId, suspensionPolicyId),
    { outcome: "provisioned", policyId: suspensionPolicyId });
  const suspendedIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-0000000096b0",
    session: "019f0000-0000-7000-8000-0000000096b1",
    presenter: "019f0000-0000-7000-8000-0000000096b2",
    identity: "019f0000-0000-7000-8000-0000000096b3",
    dataUse: "019f0000-0000-7000-8000-0000000096b4",
    essential: "019f0000-0000-7000-8000-0000000096b5",
  });
  admit({
    ids: suspendedIds,
    userId: suspensionAuthority.userId,
    agentId: suspensionAuthority.agentId,
    clientHash: "a".repeat(64),
  });
  const suspendedClaim = "019f0000-0000-7000-8000-0000000096b6";
  const suspendedEgress = "019f0000-0000-7000-8000-0000000096b7";
  assert.equal(acquire(suspendedClaim, suspendedIds.admission,
    "a".repeat(64), "b".repeat(64), 0).outcome, "acquired");
  const suspendedReservation = reserveForEgress(suspendedEgress, suspendedClaim, "generation", {
    tenantId: suspensionAuthority.tenantId,
    agentId: suspensionAuthority.agentId,
  });
  const postSuspensionIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-0000000096b8",
    session: "019f0000-0000-7000-8000-0000000096b9",
    presenter: "019f0000-0000-7000-8000-0000000096ba",
    identity: "019f0000-0000-7000-8000-0000000096bb",
    dataUse: "019f0000-0000-7000-8000-0000000096bc",
    essential: "019f0000-0000-7000-8000-0000000096bd",
  });
  const suspensionUpdateApplication = "axtro-portal-tenant-suspension-update";
  const suspensionAdmissionApplication = "axtro-portal-tenant-suspension-admission";
  const suspensionEgressApplication = "axtro-portal-tenant-suspension-egress";
  const suspensionUpdate = runSqlAsync(databaseUrl, `
    SET application_name='${suspensionUpdateApplication}';
    BEGIN;
    UPDATE public.tenants SET status='suspended' WHERE id='${suspensionAuthority.tenantId}';
    SELECT pg_sleep(1.5);
    COMMIT;
  `);
  await waitForApplicationWait(databaseUrl, suspensionUpdateApplication, "PgSleep");
  const admissionDuringSuspension = runSqlAsync(databaseUrl, `
    SET application_name='${suspensionAdmissionApplication}';
    ${admissionSql({
      ids: postSuspensionIds,
      userId: suspensionAuthority.userId,
      agentId: suspensionAuthority.agentId,
      clientHash: "b".repeat(64),
    })}
  `);
  const egressDuringSuspension = runSqlAsync(databaseUrl, `
    SET application_name='${suspensionEgressApplication}';
    ${asRoleSql("service_role", null,
      `SELECT public.portal_authorize_text_preview_egress_service(
        '${suspendedEgress}','${suspendedIds.admission}','${suspendedClaim}',
        '${attemptForClaim(suspendedClaim)}',0,'generation','${suspendedReservation}'
      );`)}
  `);
  await waitForBlockedApplicationLocks(databaseUrl, [
    suspensionAdmissionApplication,
    suspensionEgressApplication,
  ]);
  assertSucceeded(await suspensionUpdate, "commit the concurrent tenant suspension");
  const [admissionAfterSuspension, egressAfterSuspension] = await Promise.all([
    admissionDuringSuspension,
    egressDuringSuspension,
  ]);
  assertFailed(admissionAfterSuspension,
    "admission waits for concurrent tenant suspension and then denies stale authority",
    /user is not authorized/);
  assertSucceeded(egressAfterSuspension, "tenant suspension egress denial after the row-lock wait");
  assert.equal(parseLastJson(egressAfterSuspension.stdout).outcome, "not_authorized",
    "tenant suspension closes the final provider egress boundary");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_admissions
     WHERE id='${postSuspensionIds.admission}';`), "0",
  "concurrent suspension creates no new admission authority");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||(provider_dispatched_at is null)::text
     FROM public.ai_usage_reservations WHERE id='${suspendedReservation}';`), "reserved:true");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations
     WHERE id='${suspendedEgress}';`), "0");
  releaseEgressReservation(suspendedEgress);

  const temporalAuthority = Object.freeze({
    tenantId: "019f0000-0000-7000-8000-00000000000c",
    agentId: "019f0000-0000-7000-8000-00000000010c",
    actorId: "019f0000-0000-7000-8000-00000000020c",
    userId: "10000000-0000-4000-8000-00000000000c",
  });
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO auth.users(id,email)
      VALUES ('${temporalAuthority.userId}','portal-temporal-authority@example.test');
    INSERT INTO public.tenants(id,slug,legal_name,status,home_region,default_language,default_timezone)
      VALUES ('${temporalAuthority.tenantId}','portal-temporal-authority','Portal Temporal Authority','active','local','en','UTC');
    INSERT INTO public.agents(tenant_id,id,name,role_type,status,disclosure_profile_id)
      VALUES ('${temporalAuthority.tenantId}','${temporalAuthority.agentId}','Temporal Authority Agent','sales','active','default');
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
      VALUES ('${temporalAuthority.userId}','${temporalAuthority.tenantId}','${temporalAuthority.actorId}','tenant_admin');
  `), "create isolated authority for legal-expiry lock races");
  const temporalPolicyId = "019f0000-0000-7000-8000-00000000970f";
  assert.deepEqual(provisionPolicy(temporalAuthority.tenantId, temporalPolicyId),
    { outcome: "provisioned", policyId: temporalPolicyId });
  const temporalIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009700",
    session: "019f0000-0000-7000-8000-000000009701",
    presenter: "019f0000-0000-7000-8000-000000009702",
    identity: "019f0000-0000-7000-8000-000000009703",
    dataUse: "019f0000-0000-7000-8000-000000009704",
    essential: "019f0000-0000-7000-8000-000000009705",
  });
  admit({
    ids: temporalIds,
    userId: temporalAuthority.userId,
    agentId: temporalAuthority.agentId,
    clientHash: "c".repeat(64),
  });
  const temporalClaim = "019f0000-0000-7000-8000-000000009706";
  assert.equal(acquire(temporalClaim, temporalIds.admission,
    "c".repeat(64), "d".repeat(64), 0).outcome, "acquired");
  const temporalEmbeddingEgress = "019f0000-0000-7000-8000-000000009707";
  const temporalEmbeddingReservation = reserveForEgress(
    temporalEmbeddingEgress, temporalClaim, "embedding", {
      tenantId: temporalAuthority.tenantId,
      agentId: temporalAuthority.agentId,
    },
  );
  const setTemporalLegalExpiry = (interval) => assertSucceeded(runSql(databaseUrl, `
    ALTER TABLE public.portal_text_preview_privacy_policies
      DISABLE TRIGGER portal_text_preview_privacy_policies_append_only;
    ALTER TABLE public.consent_evidence DISABLE TRIGGER consent_evidence_append_only;
    UPDATE public.portal_text_preview_privacy_policies
      SET expires_at=clock_timestamp()+interval '${interval}'
      WHERE tenant_id='${temporalAuthority.tenantId}' AND id='${temporalPolicyId}';
    UPDATE public.consent_evidence
      SET expires_at=clock_timestamp()+interval '${interval}'
      WHERE tenant_id='${temporalAuthority.tenantId}' AND id='${temporalIds.essential}';
    ALTER TABLE public.consent_evidence ENABLE TRIGGER consent_evidence_append_only;
    ALTER TABLE public.portal_text_preview_privacy_policies
      ENABLE TRIGGER portal_text_preview_privacy_policies_append_only;
  `), `set temporal policy and consent expiry to ${interval}`);
  setTemporalLegalExpiry("1 second");
  const authorizeLegalLockApplication = "axtro-portal-authorize-legal-expiry";
  const authorizeLegalHolderApplication = "axtro-portal-authorize-legal-holder";
  const authorizeLegalHolder = runSqlAsync(databaseUrl, `
    SET application_name='${authorizeLegalHolderApplication}';
    BEGIN;
    SELECT id FROM public.consent_evidence
    WHERE tenant_id='${temporalAuthority.tenantId}' AND id='${temporalIds.essential}'
    FOR UPDATE;
    SELECT pg_sleep(1.5);
    COMMIT;
  `);
  await waitForApplicationWait(databaseUrl, authorizeLegalHolderApplication, "PgSleep");
  const authorizeAcrossLegalExpiry = runSqlAsync(databaseUrl, `
    SET application_name='${authorizeLegalLockApplication}';
    ${asRoleSql("service_role", null,
      `SELECT public.portal_authorize_text_preview_egress_service(
        '${temporalEmbeddingEgress}','${temporalIds.admission}','${temporalClaim}',
        '${attemptForClaim(temporalClaim)}',0,'embedding','${temporalEmbeddingReservation}'
      );`)}
  `);
  await waitForBlockedApplicationLocks(databaseUrl, [authorizeLegalLockApplication]);
  const authorizeLegalResult = await authorizeAcrossLegalExpiry;
  assertSucceeded(await authorizeLegalHolder, "release authorize legal-evidence row lock after expiry");
  assertSucceeded(authorizeLegalResult, "authorize returns a bounded denial after legal evidence expires");
  assert.equal(parseLastJson(authorizeLegalResult.stdout).outcome, "not_authorized");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||(provider_dispatched_at is null)::text
     FROM public.ai_usage_reservations WHERE id='${temporalEmbeddingReservation}';`), "reserved:true",
  "policy and essential-consent expiry during a row-lock wait cannot cross provider dispatch");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.portal_text_preview_egress_authorizations
     WHERE id='${temporalEmbeddingEgress}';`), "0");
  releaseEgressReservation(temporalEmbeddingEgress);

  setTemporalLegalExpiry("10 minutes");
  const temporalGenerationEgress = "019f0000-0000-7000-8000-000000009708";
  const temporalProviderId = "openrouter-legal-expiry-9706";
  assert.equal(authorizeEgress(temporalGenerationEgress, temporalClaim, "generation", {
    tenantId: temporalAuthority.tenantId,
    agentId: temporalAuthority.agentId,
  }).outcome, "authorized");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(temporalGenerationEgress)}',1,1,null);`)).committed,
  true);
  setTemporalLegalExpiry("1 second");
  const completeLegalLockApplication = "axtro-portal-complete-legal-expiry";
  const completeLegalHolderApplication = "axtro-portal-complete-legal-holder";
  const completeLegalHolder = runSqlAsync(databaseUrl, `
    SET application_name='${completeLegalHolderApplication}';
    BEGIN;
    SELECT id FROM public.consent_evidence
    WHERE tenant_id='${temporalAuthority.tenantId}' AND id='${temporalIds.essential}'
    FOR UPDATE;
    SELECT pg_sleep(1.5);
    COMMIT;
  `);
  await waitForApplicationWait(databaseUrl, completeLegalHolderApplication, "PgSleep");
  const completeAcrossLegalExpiry = runSqlAsync(databaseUrl, `
    SET application_name='${completeLegalLockApplication}';
    ${asRoleSql("service_role", null,
      `SELECT public.portal_complete_text_preview_turn_service(
        '${temporalIds.admission}','${temporalClaim}','${attemptForClaim(temporalClaim)}',0,
        '${"d".repeat(64)}','hmac-sha256:${"e".repeat(64)}','${temporalProviderId}',null,null
      );`)}
  `);
  await waitForBlockedApplicationLocks(databaseUrl, [completeLegalLockApplication]);
  const completeLegalResult = await completeAcrossLegalExpiry;
  assertSucceeded(await completeLegalHolder, "release completion legal-evidence row lock after expiry");
  assertSucceeded(completeLegalResult, "completion records the provider response after legal expiry");
  assert.deepEqual(parseLastJson(completeLegalResult.stdout), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: temporalProviderId,
  }, "completion cannot publish success after policy and consent expire during its lock wait");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||reason_code||':'||provider_request_id
     FROM public.portal_text_preview_turn_claims WHERE id='${temporalClaim}';`),
  `failed:provider_response_uncommitted:${temporalProviderId}`);
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.events_outbox
     WHERE tenant_id='${temporalAuthority.tenantId}'
       AND event_id='${grants.get(temporalClaim).outcomeEventId}';`), "1",
  "legal expiry produces exactly one content-free terminal outcome");

  const membershipPolicyId = "019f0000-0000-7000-8000-000000009681";
  const membershipIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009682",
    session: "019f0000-0000-7000-8000-000000009683",
    presenter: "019f0000-0000-7000-8000-000000009684",
    identity: "019f0000-0000-7000-8000-000000009685",
    dataUse: "019f0000-0000-7000-8000-000000009686",
    essential: "019f0000-0000-7000-8000-000000009687",
  });
  assert.deepEqual(provisionPolicy(fixture.tenantDelta, membershipPolicyId),
    { outcome: "provisioned", policyId: membershipPolicyId });
  const membershipAdmission = admit({
    ids: membershipIds,
    userId: fixture.userDelta,
    agentId: fixture.agentDelta,
    clientHash: "6".repeat(64),
  });
  assert.equal(membershipAdmission.actor_id, fixture.actorDelta);
  const membershipClaim = "019f0000-0000-7000-8000-000000009688";
  assert.equal(acquire(membershipClaim, membershipIds.admission,
    "3".repeat(64), "4".repeat(64), 0).outcome, "acquired");
  assert.equal(fail(membershipClaim, "generation_failed").outcome, "failed");
  assertSucceeded(runSql(databaseUrl, `DELETE FROM public.user_tenant_memberships
    WHERE tenant_id='${fixture.tenantDelta}' AND user_id='${fixture.userDelta}';`),
  "remove the member after immutable admission evidence exists");
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.portal_text_preview_admissions a
    JOIN public.portal_text_preview_turn_claims c
      ON c.tenant_id=a.tenant_id AND c.admission_id=a.id
    JOIN public.events_outbox e
      ON e.tenant_id=c.tenant_id AND e.event_id=c.outcome_event_id
    WHERE a.tenant_id='${fixture.tenantDelta}' AND a.id='${membershipIds.admission}'
      AND a.actor_id='${fixture.actorDelta}' AND c.id='${membershipClaim}';
  `), "1", "membership removal preserves actor identity, claim and canonical outcome evidence");
  assertFailed(runSql(databaseUrl, admissionSql({
    ids: {
      admission: "019f0000-0000-7000-8000-000000009689",
      session: "019f0000-0000-7000-8000-00000000968a",
      presenter: "019f0000-0000-7000-8000-00000000968b",
      identity: "019f0000-0000-7000-8000-00000000968c",
      dataUse: "019f0000-0000-7000-8000-00000000968d",
      essential: "019f0000-0000-7000-8000-00000000968e",
    },
    userId: fixture.userDelta,
    agentId: fixture.agentAlpha,
    clientHash: "7".repeat(64),
  })), "removed membership cannot gain cross-tenant admission", /user is not authorized/);
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
    VALUES ('${fixture.userDelta}','${fixture.tenantDelta}','${fixture.actorDelta}','tenant_admin');`),
  "restore the shared tenant-admin fixture after proving membership removal semantics");

  const cleanupRaceIds = Object.freeze({
    admission: "019f0000-0000-7000-8000-000000009690",
    session: "019f0000-0000-7000-8000-000000009691",
    presenter: "019f0000-0000-7000-8000-000000009692",
    identity: "019f0000-0000-7000-8000-000000009693",
    dataUse: "019f0000-0000-7000-8000-000000009694",
    essential: "019f0000-0000-7000-8000-000000009695",
  });
  admit({ ids: cleanupRaceIds, clientHash: "5".repeat(64) });
  const cleanupRaceClaim = "019f0000-0000-7000-8000-000000009696";
  const cleanupRaceDeniedEgress = "019f0000-0000-7000-8000-000000009697";
  const cleanupRaceGenerationEgress = "019f0000-0000-7000-8000-000000009698";
  const cleanupRaceProviderId = "openrouter-cleanup-race-9696";
  assert.equal(acquire(cleanupRaceClaim, cleanupRaceIds.admission,
    "5".repeat(64), "6".repeat(64), 0).outcome, "acquired");
  assertSucceeded(runSql(databaseUrl, `
    ALTER TABLE public.portal_text_preview_admissions DISABLE TRIGGER portal_text_preview_admissions_append_only;
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_admissions
    SET issued_at=boundary.at-interval '59 minutes 25 seconds',
        expires_at=boundary.at+interval '35 seconds'
    FROM boundary WHERE tenant_id='${fixture.tenantAlpha}' AND id='${cleanupRaceIds.admission}';
    ALTER TABLE public.portal_text_preview_admissions ENABLE TRIGGER portal_text_preview_admissions_append_only;
  `), "set the exact admission egress denial boundary");
  assert.equal(authorizeEgress(cleanupRaceDeniedEgress, cleanupRaceClaim, "embedding").outcome, "expired",
    "admission authority with at most 35 seconds remaining cannot start provider work");
  releaseEgressReservation(cleanupRaceDeniedEgress);
  assertSucceeded(runSql(databaseUrl, `
    ALTER TABLE public.portal_text_preview_admissions DISABLE TRIGGER portal_text_preview_admissions_append_only;
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_admissions
    SET issued_at=boundary.at-interval '59 minutes 24 seconds',
        expires_at=boundary.at+interval '36 seconds'
    FROM boundary WHERE tenant_id='${fixture.tenantAlpha}' AND id='${cleanupRaceIds.admission}';
    ALTER TABLE public.portal_text_preview_admissions ENABLE TRIGGER portal_text_preview_admissions_append_only;
  `), "set the admission egress acceptance side of the boundary");
  assert.equal(authorizeEgress(cleanupRaceGenerationEgress, cleanupRaceClaim, "generation").outcome, "authorized");
  assertSucceeded(runSql(databaseUrl, `
    ALTER TABLE public.portal_text_preview_admissions DISABLE TRIGGER portal_text_preview_admissions_append_only;
    WITH boundary AS (SELECT clock_timestamp() AS at)
    UPDATE public.portal_text_preview_admissions
    SET issued_at=boundary.at-interval '61 minutes',expires_at=boundary.at-interval '1 minute'
    FROM boundary
    WHERE tenant_id='${fixture.tenantAlpha}' AND id='${cleanupRaceIds.admission}';
    ALTER TABLE public.portal_text_preview_admissions ENABLE TRIGGER portal_text_preview_admissions_append_only;
  `), "advance the admission clock beyond expiry after generation dispatch");
  const inFlightCleanup = queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_cleanup_expired_text_preview_sessions_service(100);"));
  assert.ok(inFlightCleanup.operatorRequired >= 1);
  assert.equal(queryScalar(databaseUrl, `
    SELECT c.state||':'||s.status FROM public.portal_text_preview_turn_claims c
    JOIN public.portal_text_preview_admissions a ON a.tenant_id=c.tenant_id AND a.id=c.admission_id
    JOIN public.sessions s ON s.tenant_id=a.tenant_id AND s.id=a.session_id
    WHERE c.tenant_id='${fixture.tenantAlpha}' AND c.id='${cleanupRaceClaim}';
  `), "acquired:active", "cleanup preserves an in-flight generation claim for provider reconciliation");
  assert.deepEqual(reconcileProviderResponse(cleanupRaceClaim, cleanupRaceProviderId), {
    outcome: "failed", reasonCode: "provider_response_uncommitted", providerRequestId: cleanupRaceProviderId,
  }, "provider response arriving after cleanup remains durable exactly once");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationsByEgress.get(cleanupRaceGenerationEgress)}',1,1,null);`)).committed,
  true);
  const postReconcileCleanup = queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_cleanup_expired_text_preview_sessions_service(100);"));
  assert.equal(postReconcileCleanup.sessionsClosed, 1,
    "cleanup may close the expired session only after the provider response receipt is terminal");
  assert.equal(queryScalar(databaseUrl,
    `SELECT state||':'||reason_code||':'||provider_request_id FROM public.portal_text_preview_turn_claims WHERE id='${cleanupRaceClaim}';`),
  `failed:provider_response_uncommitted:${cleanupRaceProviderId}`);

  const activeBeforeCapRace = Number(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.portal_text_preview_admissions
    WHERE tenant_id='${fixture.tenantAlpha}' AND actor_id='${fixture.actorAlpha}' AND expires_at>clock_timestamp();
  `));
  const remainingActorCapacity = 16 - activeBeforeCapRace;
  assert.ok(remainingActorCapacity > 0, "the fixture must leave capacity for a real cap race");
  const sessionsBeforeCapRace = Number(queryScalar(databaseUrl, "SELECT count(*) FROM public.sessions;"));
  const outboxBeforeCapRace = Number(queryScalar(databaseUrl, "SELECT count(*) FROM public.events_outbox;"));
  const capRaceInputs = Array.from({ length: remainingActorCapacity + 3 }, (_, index) => {
    const base = 0xb000 + index * 8;
    const uuid = (offset) => `019f0000-0000-7000-8000-${(base + offset).toString(16).padStart(12, "0")}`;
    return {
      ids: {
        admission: uuid(0), session: uuid(1), presenter: uuid(2),
        identity: uuid(3), dataUse: uuid(4), essential: uuid(5),
      },
      clientHash: (0x100 + index).toString(16).padStart(64, "0"),
    };
  });
  const capRace = await runConcurrentSqlBehindBarrier(databaseUrl,
    capRaceInputs.map((input, index) => ({
      lockId: 49_200 + index,
      sql: admissionSql(input),
    })),
    "text-preview-actor-cap-race");
  const capRaceSuccesses = capRace.filter((result) => result.status === 0);
  const capRaceFailures = capRace.filter((result) => result.status !== 0);
  assert.equal(capRaceSuccesses.length, remainingActorCapacity,
    "the actor advisory lock admits exactly the remaining bounded capacity");
  assert.equal(capRaceFailures.length, 3);
  for (const result of capRaceFailures) {
    assertFailed(result, "concurrent actor admission cap", /actor active admission cap reached/);
  }
  assert.equal(queryScalar(databaseUrl, `
    SELECT count(*) FROM public.portal_text_preview_admissions
    WHERE tenant_id='${fixture.tenantAlpha}' AND actor_id='${fixture.actorAlpha}' AND expires_at>clock_timestamp();
  `), "16", "concurrent distinct admissions cannot exceed the actor active cap");
  assert.equal(Number(queryScalar(databaseUrl, "SELECT count(*) FROM public.sessions;")) - sessionsBeforeCapRace,
    remainingActorCapacity, "cap losers create no partial session projection");
  assert.equal(Number(queryScalar(databaseUrl, "SELECT count(*) FROM public.events_outbox;")) - outboxBeforeCapRace,
    remainingActorCapacity * 5, "cap losers create no partial canonical events");
}

function assertWorkerHeartbeatLifecycle(databaseUrl) {
  const firstBillingRun = "019f0000-0000-7000-8000-000000006500";
  const secondBillingRun = "019f0000-0000-7000-8000-000000006501";
  const reconcilerRun = "019f0000-0000-7000-8000-000000006600";
  const version = "m5-01-v1";
  const deploymentId = "deploy-harness-20260813";
  const billingFingerprint = `sha256:${"a".repeat(64)}`;
  const reconcilerFingerprint = `sha256:${"b".repeat(64)}`;
  const readiness = () => queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_worker_readiness_service();"));

  assert.deepEqual(readiness(), { billingUsage: null, providerEffectReconciler: null },
    "workers are not ready before a successful semantic run");
  const record = (kind, runId, phase, counters = {}) => queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_record_worker_heartbeat_service('${kind}','${runId}','${phase}','${version}','${deploymentId}',
      '${kind === "billing_usage" ? billingFingerprint : reconcilerFingerprint}','${sqlLiteral(JSON.stringify(counters))}'::jsonb);`));

  assert.equal(record("billing_usage", firstBillingRun, "started"), "t");
  assert.deepEqual(readiness().billingUsage, { lastSucceededAt: null, ageSeconds: null, version: null, deploymentId: null, configFingerprint: null },
    "started is never delivery evidence");
  assert.equal(record("billing_usage", firstBillingRun, "succeeded", { delivered: 0, catalogVerified: true }), "t");
  assert.equal(record("billing_usage", firstBillingRun, "succeeded", { delivered: 0, catalogVerified: true }), "t",
    "lost success receipt replays exactly");
  const firstReady = readiness().billingUsage;
  assert.equal(firstReady.version, version);
  assert.equal(firstReady.deploymentId, deploymentId);
  assert.equal(firstReady.configFingerprint, billingFingerprint);
  assert.ok(firstReady.ageSeconds >= 0 && firstReady.ageSeconds <= 10);

  assert.equal(record("billing_usage", secondBillingRun, "started"), "t");
  assert.equal(readiness().billingUsage.version, version, "a current run preserves the last successful readiness receipt");
  assert.equal(record("billing_usage", secondBillingRun, "failed"), "t");
  assert.equal(readiness().billingUsage.version, version, "a failed run never erases last success");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_record_worker_heartbeat_service('billing_usage','${firstBillingRun}','started','${version}','${deploymentId}','${billingFingerprint}','{}'::jsonb);`)),
  "an older run cannot overwrite a newer worker state");

  assert.equal(record("provider_effect_reconciler", reconcilerRun, "started"), "t");
  assert.equal(record("provider_effect_reconciler", reconcilerRun, "succeeded", { processed: 0 }), "t");
  const bothReady = readiness();
  assert.equal(bothReady.providerEffectReconciler.version, version);
  assert.equal(bothReady.providerEffectReconciler.deploymentId, deploymentId);
  assert.equal(bothReady.providerEffectReconciler.configFingerprint, reconcilerFingerprint);
  assert.ok(bothReady.providerEffectReconciler.ageSeconds >= 0 && bothReady.providerEffectReconciler.ageSeconds <= 10);

  assertSucceeded(runSql(databaseUrl, "UPDATE public.worker_heartbeats SET last_succeeded_at=now()+interval '1 minute' WHERE worker_name='provider_effect_reconciler';"),
    "future heartbeat corruption fixture");
  assert.ok(readiness().providerEffectReconciler.ageSeconds < 0, "database readiness exposes impossible future evidence for the app to reject");
  assertSucceeded(runSql(databaseUrl, "UPDATE public.worker_heartbeats SET last_succeeded_at=now() WHERE worker_name='provider_effect_reconciler';"),
    "restore heartbeat fixture");
}

function assertTranscriptValidation(databaseUrl) {
  assertSucceeded(runSql(databaseUrl, `SELECT app.validate_transcript_turns('[{"role":"user","content":"hello"}]'::jsonb);`), "strict transcript valid fixture");
  for (const [label, payload] of [
    ["non-array object", "{}"],
    ["json null", "null"],
    ["null element", "[null]"],
    ["empty object", "[{}]"],
    ["missing content", '[{"role":"user"}]'],
    ["missing role", '[{"content":"hello"}]'],
    ["extra key", '[{"role":"user","content":"hello","instruction":"ignore policy"}]'],
    ["null content", '[{"role":"assistant","content":null}]'],
    ["invalid role", '[{"role":"system","content":"trusted"}]'],
  ]) {
    assertFailed(runSql(databaseUrl, `SELECT app.validate_transcript_turns('${sqlLiteral(payload)}'::jsonb);`), `strict transcript rejects ${label}`);
  }
  assertFailed(runSql(databaseUrl, `SELECT app.validate_transcript_turns((
    SELECT jsonb_agg(jsonb_build_object('role','user','content','x') ORDER BY n)
    FROM generate_series(1,1001) AS n
  ));`), "strict transcript rejects 1001 turns");
  assertFailed(runSql(databaseUrl, `SELECT app.validate_transcript_turns(jsonb_build_array(
    jsonb_build_object('role','assistant','content',repeat('x',8001))
  ));`), "strict transcript rejects 8001-character content");
  assertSucceeded(runSql(databaseUrl, `SELECT app.validate_transcript_turns((
    SELECT jsonb_agg(jsonb_build_object('role','user','content','x') ORDER BY n)
    FROM generate_series(1,1000) AS n
  ));`), "strict transcript accepts exactly 1000 turns");
  assertSucceeded(runSql(databaseUrl, `SELECT app.validate_transcript_turns(jsonb_build_array(
    jsonb_build_object('role','assistant','content',repeat('x',8000))
  ));`), "strict transcript accepts exactly 8000-character content");
}

function assertTranscriptTenantBoundaryAndLimit(databaseUrl) {
  const videoPreclaim = asRoleSql("authenticated", fixture.userAlpha, `
    SELECT public.portal_upsert_conversation_transcript(
      '${fixture.providerTranscript}', '${fixture.agentAlpha}', 'video', 'provider-ref-hostile', '[]'::jsonb, null
    );
  `);
  assertFailed(runSql(databaseUrl, videoPreclaim), "authenticated caller cannot preclaim a provider transcript reference");

  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_register_provider_transcript_service(
      '${fixture.providerTranscript}', '${fixture.tenantAlpha}', '${fixture.agentAlpha}', 'video', 'provider-ref-owned'
    );
  `)), "service role registers provider transcript");
  assert.equal(queryScalar(databaseUrl, `SELECT tenant_id::text FROM public.conversation_transcripts WHERE external_ref = 'provider-ref-owned';`), fixture.tenantAlpha);
  const crossTenantProviderRef = "provider-ref-global-owner";
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_register_provider_transcript_service(
      '019f0000-0000-7000-8000-000000001112', '${fixture.tenantAlpha}', '${fixture.agentAlpha}', 'video', '${crossTenantProviderRef}'
    );
  `)), "service registration establishes the global provider transcript owner");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_register_provider_transcript_service(
      '019f0000-0000-7000-8000-000000001113', '${fixture.tenantBeta}', '${fixture.agentBeta}', 'video', '${crossTenantProviderRef}'
    );
  `)), "same provider transcript reference cannot be claimed by another tenant");
  assert.equal(queryScalar(databaseUrl, `SELECT tenant_id::text || ':' || agent_id::text
    FROM public.conversation_transcripts WHERE surface='video' AND external_ref='${crossTenantProviderRef}';`),
  `${fixture.tenantAlpha}:${fixture.agentAlpha}`, "cross-tenant provider-reference collision preserves the original owner");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.conversation_transcripts
    WHERE surface='video' AND external_ref='${crossTenantProviderRef}';`), "1",
  "cross-tenant provider-reference collision cannot add a second transcript row");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_register_provider_transcript_service(
      '019f0000-0000-7000-8000-000000001101', '${fixture.tenantBeta}', '${fixture.agentAlpha}', 'video', 'provider-ref-cross-tenant'
    );
  `)), "service registration rejects a cross-tenant agent relationship");

  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.user_tenant_memberships (user_id, tenant_id, actor_id, role) VALUES
      ('${fixture.userBeta}', '${fixture.tenantBeta}', '${fixture.actorBeta}', 'tenant_admin');
  `), "deterministic authenticated membership fixtures");

  const inserts = Array.from({ length: 5 }, (_, index) => {
    const id = `019f0000-0000-7000-8000-${String(1200 + index).padStart(12, "0")}`;
    return `INSERT INTO public.conversation_transcripts (id, tenant_id, agent_id, surface, external_ref, turns, started_at)
      VALUES ('${id}', '${fixture.tenantAlpha}', '${fixture.agentAlpha}', 'chat', 'chat-${index}', '[]'::jsonb, now() - interval '${index} minutes');`;
  }).join("\n");
  assertSucceeded(runSql(databaseUrl, inserts), "transcript list fixtures");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.user_tenant_memberships WHERE user_id='${fixture.userAlpha}';`), "1");
  const limited = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, "SELECT public.portal_list_conversation_transcripts(null, 2);"));
  assert.equal(limited.length, 2, "p_limit must be applied before json aggregation");
  const listedAgentId = "019f0000-0000-7000-8000-000000001f01";
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.agents (tenant_id,id,name,role_type,status,disclosure_profile_id)
    VALUES ('${fixture.tenantAlpha}','${listedAgentId}','Transcript List Harness','sales','active','default');`),
  "deterministic transcript-list agent fixture");
  const orderedTranscriptIds = Array.from({ length: 205 }, (_, index) =>
    `019f0000-0000-7000-8000-${(0x3000 + index).toString(16).padStart(12, "0")}`,
  );
  const boundedListInserts = orderedTranscriptIds.map((id, index) => `INSERT INTO public.conversation_transcripts
    (id,tenant_id,agent_id,surface,external_ref,turns,started_at)
    VALUES ('${id}','${fixture.tenantAlpha}','${listedAgentId}','chat','list-bound-${index}',
      '[{"role":"user","content":"list fixture"}]'::jsonb,
      timestamptz '2026-08-14T00:00:00Z'+make_interval(secs=>${index}));`).join("\n");
  assertSucceeded(runSql(databaseUrl, boundedListInserts), "over-cap transcript list fixtures");
  const maxLimited = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userAlpha,
    `SELECT public.portal_list_conversation_transcripts('${listedAgentId}',999);`));
  assert.equal(maxLimited.length, 200, "transcript list clamps limits before aggregation at 200 rows");
  assert.deepEqual(maxLimited.map((row) => row.id), orderedTranscriptIds.slice(-200).reverse(),
    "transcript list returns the deterministic newest-first window before aggregation");
  assert.ok(maxLimited.every((row) => row.turnCount === 1), "bounded transcript listing preserves per-row aggregate fields");
  const minimumLimited = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userAlpha,
    `SELECT public.portal_list_conversation_transcripts('${listedAgentId}',0);`));
  assert.deepEqual(minimumLimited.map((row) => row.id), [orderedTranscriptIds.at(-1)],
    "transcript list clamps non-positive limits to a deterministic one-row window");
  const defaultLimited = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userAlpha,
    `SELECT public.portal_list_conversation_transcripts('${listedAgentId}',null);`));
  assert.deepEqual(defaultLimited.map((row) => row.id), orderedTranscriptIds.slice(-50).reverse(),
    "transcript list applies the default limit before deterministic aggregation");
  const otherTenant = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userBeta, "SELECT public.portal_list_conversation_transcripts(null, 200);"));
  assert.equal(otherTenant.length, 0, "tenant beta cannot list tenant alpha transcripts");
}

async function assertProviderTranscriptConcurrency(databaseUrl) {
  const externalRef = "provider-ref-concurrent";
  const [first, second] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `
      SELECT public.portal_register_provider_transcript_service(
        '019f0000-0000-7000-8000-000000001110', '${fixture.tenantAlpha}', '${fixture.agentAlpha}', 'video', '${externalRef}'
      );
    `)),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `
      SELECT public.portal_register_provider_transcript_service(
        '019f0000-0000-7000-8000-000000001111', '${fixture.tenantAlpha}', '${fixture.agentAlpha}', 'video', '${externalRef}'
      );
    `)),
  ]);
  assertSucceeded(first, "first concurrent provider transcript registration");
  assertSucceeded(second, "second concurrent provider transcript registration");
  const outcomes = [parseLastJson(first.stdout), parseLastJson(second.stdout)];
  assert.deepEqual(outcomes.map((value) => value.replayed).sort(), [false, true],
    "concurrent provider transcript registration produces one insert and one replay");
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.conversation_transcripts WHERE surface='video' AND external_ref='${externalRef}';`), "1");
}

function checkoutBeginSql({ intentId, tenantId, userId, plan = "piloto", expiresAt, basePrice = "price_BasePiloto", overagePrice = "price_OveragePiloto" }) {
  return `SELECT public.portal_begin_billing_checkout_intent_service(
    '${intentId}','${tenantId}','${userId}','${plan}','${basePrice}','${overagePrice}',false,
    49900,2500,'axtro_conversation_overage',null,
    'https://closer.axtroai.com/configuracoes?billing_success=1',
    'https://closer.axtroai.com/configuracoes?billing_error=cancelado','${expiresAt}'::timestamptz
  );`;
}

async function assertBillingCheckoutContract(databaseUrl) {
  const expiry = new Date(Date.now() + 60 * 60 * 1000);
  expiry.setMilliseconds(0);
  const expiresAt = expiry.toISOString();
  const alphaA = "019f0000-0000-7000-8000-000000001300";
  const alphaB = "019f0000-0000-7000-8000-000000001301";
  const begin = (input) => asRoleSql("service_role", null, checkoutBeginSql({ expiresAt, ...input }));
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
    VALUES('${fixture.userGamma}','${fixture.tenantGamma}','${fixture.actorGamma}','tenant_admin');`),
  "checkout tenant gamma membership fixture");

  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha,
    checkoutBeginSql({ intentId: alphaA, tenantId: fixture.tenantAlpha, userId: fixture.userAlpha, expiresAt }))),
  "authenticated caller cannot invoke service-only checkout begin");
  assertFailed(runSql(databaseUrl, begin({ intentId: alphaA, tenantId: fixture.tenantAlpha, userId: fixture.userBeta })),
    "cross-tenant user cannot authorize checkout");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.user_tenant_memberships SET role='tenant_operator' WHERE user_id='${fixture.userAlpha}';`),
    "operator-role authorization fixture");
  assertFailed(runSql(databaseUrl, begin({ intentId: alphaA, tenantId: fixture.tenantAlpha, userId: fixture.userAlpha })),
    "tenant operator cannot authorize a billing checkout");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.user_tenant_memberships SET role='tenant_admin' WHERE user_id='${fixture.userAlpha}';`),
    "restore tenant administrator fixture");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, checkoutBeginSql({
    intentId: alphaA, tenantId: fixture.tenantAlpha, userId: fixture.userAlpha, expiresAt,
  }).replace("https://closer.axtroai.com/configuracoes?billing_success=1", "https://evil.example.test/configuracoes?billing_success=1"))),
  "checkout redirects are restricted to reviewed exact origins and paths");

  const [firstBegin, secondBegin] = await Promise.all([
    runSqlAsync(databaseUrl, begin({ intentId: alphaA, tenantId: fixture.tenantAlpha, userId: fixture.userAlpha })),
    runSqlAsync(databaseUrl, begin({ intentId: alphaB, tenantId: fixture.tenantAlpha, userId: fixture.userAlpha })),
  ]);
  assertSucceeded(firstBegin, "first concurrent checkout begin");
  assertSucceeded(secondBegin, "second concurrent checkout begin");
  const beginReceipts = [parseLastJson(firstBegin.stdout), parseLastJson(secondBegin.stdout)];
  assert.deepEqual(beginReceipts.map((row) => row.outcome).sort(), ["replayed", "reserved"]);
  assert.equal(new Set(beginReceipts.map((row) => row.checkoutIntentId)).size, 1, "same snapshot converges on one durable intent");
  const alphaIntent = beginReceipts[0].checkoutIntentId;
  assert.equal(beginReceipts[0].stripeIdempotencyKey, `billing:checkout:${alphaIntent.replaceAll("-", "")}`);
  assert.deepEqual(Object.keys(beginReceipts[0]).sort(), [
    "basePriceId", "baseUnitAmountCents", "cancelUrl", "checkoutIntentId", "checkoutUrl", "existingStripeCustomerId",
    "expiresAt", "meterEventName", "outcome", "overagePriceId", "overageUnitAmountCents", "planId", "state",
    "stripeIdempotencyKey", "stripeLivemode", "stripeSessionId", "successUrl",
  ].sort(), "begin returns the exact immutable application receipt");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_checkout_intents WHERE tenant_id='${fixture.tenantAlpha}';`), "1");
  const replayExpiry = new Date(expiry.getTime() + 60 * 60 * 1000).toISOString();
  const sameIdExpiryConflict = queryJson(databaseUrl, asRoleSql("service_role", null, checkoutBeginSql({
    intentId: alphaIntent, tenantId: fixture.tenantAlpha, userId: fixture.userAlpha, expiresAt: replayExpiry,
  })));
  assert.equal(sameIdExpiryConflict.outcome, "conflict", "same intent id requires the exact original request fingerprint");
  const expiryReplay = queryJson(databaseUrl, asRoleSql("service_role", null, checkoutBeginSql({
    intentId: "019f0000-0000-7000-8000-000000001305", tenantId: fixture.tenantAlpha,
    userId: fixture.userAlpha, expiresAt: replayExpiry,
  })));
  assert.equal(expiryReplay.outcome, "replayed", "a fresh retry id can recover the same active immutable checkout");
  assert.equal(expiryReplay.expiresAt, expiresAt, "fresh-id recovery returns the stored expiry");
  assert.equal(queryScalar(databaseUrl, `SELECT catalog_fingerprint ~ '^[0-9a-f]{64}$' AND request_fingerprint ~ '^[0-9a-f]{64}$'
    FROM public.billing_checkout_intents WHERE id='${alphaIntent}';`), "t", "SQL mints both canonical SHA-256 fingerprints");
  assertFailed(runSql(databaseUrl, `UPDATE public.billing_checkout_intents SET plan_id='escala' WHERE id='${alphaIntent}';`),
    "checkout catalog/request snapshots are immutable even to migration-owner DML");
  assert.equal(queryJson(databaseUrl, begin({
    intentId: "019f0000-0000-7000-8000-000000001302", tenantId: fixture.tenantAlpha, userId: fixture.userAlpha,
    plan: "crescimento", basePrice: "price_BaseCrescimento", overagePrice: "price_OverageCrescimento",
  })).outcome, "conflict", "a different immutable plan snapshot cannot share an open tenant intent");

  const [dispatchA, dispatchB] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_mark_billing_checkout_dispatched_service('${alphaIntent}');`)),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_mark_billing_checkout_dispatched_service('${alphaIntent}');`)),
  ]);
  assertSucceeded(dispatchA, "first checkout dispatch contender");
  assertSucceeded(dispatchB, "second checkout dispatch contender");
  const dispatchReceipts = [parseLastJson(dispatchA.stdout), parseLastJson(dispatchB.stdout)];
  assert.deepEqual(dispatchReceipts.sort((a,b) => Number(b.acquired)-Number(a.acquired)), [
    { acquired: true, state: "dispatched" }, { acquired: false, state: "unknown" },
  ], "only the dispatch winner receives provider-dispatch disposition");
  assert.equal(queryScalar(databaseUrl, `SELECT catalog_verified_at IS NOT NULL FROM public.billing_checkout_intents WHERE id='${alphaIntent}';`), "t");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.billing_checkout_intents SET state='unknown',updated_at=now() WHERE id='${alphaIntent}';`),
    "simulate an ambiguous process loss after the checkout dispatch fence");
  const unknownReplay = queryJson(databaseUrl, begin({
    intentId: "019f0000-0000-7000-8000-000000001303", tenantId: fixture.tenantAlpha, userId: fixture.userAlpha,
  }));
  assert.equal(unknownReplay.outcome, "replayed");
  assert.equal(unknownReplay.state, "unknown");
  assert.equal(unknownReplay.checkoutIntentId, alphaIntent);
  assert.equal(unknownReplay.stripeIdempotencyKey, `billing:checkout:${alphaIntent.replaceAll("-", "")}`,
    "an exact unknown recovery preserves the original Stripe idempotency key");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_billing_checkout_intent_service('${alphaIntent}','not_dispatched');`)),
  "post-dispatch checkout cannot be released");

  const alphaSession = "cs_test_checkout_alpha";
  const bindAlpha = `SELECT public.portal_bind_billing_checkout_session_service('${alphaIntent}','${alphaSession}',
    'https://checkout.stripe.com/c/pay/${alphaSession}','${expiresAt}'::timestamptz);`;
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, bindAlpha)), { bound: true, state: "bound" });
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, bindAlpha)), { bound: true, state: "bound" });
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, bindAlpha.replace(alphaSession, "cs_test_checkout_other"))),
    "a bound intent rejects a different Stripe session");

  const checkoutAt = new Date().toISOString();
  const checkoutAlphaSql = `SELECT public.portal_apply_billing_checkout_event_service(
    'evt_checkout_alpha','checkout.session.completed','${checkoutAt}'::timestamptz,'${alphaIntent}','${alphaSession}',
    '${fixture.tenantAlpha}','piloto','cus_CheckoutAlpha','sub_CheckoutAlpha','paid');`;
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, checkoutAlphaSql)), { applied: true, replayed: false, state: "completed" });
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, checkoutAlphaSql)), { applied: false, replayed: true, state: "completed" });
  const subAt = new Date(Date.now() + 1000).toISOString();
  const subAlphaSql = `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_alpha','customer.subscription.created','${subAt}'::timestamptz,'${fixture.tenantAlpha}','piloto','active',
    'cus_CheckoutAlpha','sub_CheckoutAlpha','${checkoutAt}'::timestamptz,'${expiresAt}'::timestamptz,'${alphaIntent}');`;
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, subAlphaSql)), { outcome: "applied", applied: true, replayed: false });
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, subAlphaSql)), { outcome: "replayed", applied: false, replayed: true });
  const activeSubscriptionBlock = queryJson(databaseUrl, begin({
    intentId: "019f0000-0000-7000-8000-000000001304", tenantId: fixture.tenantAlpha, userId: fixture.userAlpha,
  }));
  assert.equal(activeSubscriptionBlock.outcome, "blocked_unknown", "any nonterminal tenant subscription blocks a new checkout");
  assert.equal(activeSubscriptionBlock.checkoutIntentId, null, "blocked checkout does not disclose another immutable intent snapshot");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_alpha_stale','customer.subscription.updated','${checkoutAt}'::timestamptz,'${fixture.tenantAlpha}','piloto','past_due',
    'cus_CheckoutAlpha','sub_CheckoutAlpha',null,null,null);`)).outcome, "ignored_stale");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_alpha_conflict','customer.subscription.created','${new Date(Date.now() + 2000).toISOString()}'::timestamptz,'${fixture.tenantAlpha}','crescimento','active',
    'cus_CheckoutAlpha2','sub_CheckoutAlpha2',null,null,null);`)).outcome, "duplicate_subscription_conflict");

  const betaReleased = "019f0000-0000-7000-8000-000000001310";
  assert.equal(queryJson(databaseUrl, begin({ intentId: betaReleased, tenantId: fixture.tenantBeta, userId: fixture.userBeta })).outcome, "reserved");
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_billing_checkout_intent_service('${betaReleased}','catalog_preflight_failed');`)), { released: true, state: "released" });
  const betaIntent = "019f0000-0000-7000-8000-000000001311";
  assert.equal(queryJson(databaseUrl, begin({ intentId: betaIntent, tenantId: fixture.tenantBeta, userId: fixture.userBeta })).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${betaIntent}');`)).acquired, true);
  const betaSession = "cs_test_checkout_beta";
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_bind_billing_checkout_session_service(
    '${betaIntent}','${alphaSession}','https://checkout.stripe.com/c/pay/${alphaSession}','${expiresAt}'::timestamptz);`)),
  "a Stripe checkout session id is globally owned by exactly one tenant intent");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_bind_billing_checkout_session_service(
    '${betaIntent}','${betaSession}','https://checkout.stripe.com/c/pay/${betaSession}','${expiresAt}'::timestamptz);`)).bound, true);
  const betaSubAt = new Date(Date.now() + 2000).toISOString();
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_first','customer.subscription.created','${betaSubAt}'::timestamptz,'${fixture.tenantBeta}','piloto','active',
    'cus_CheckoutBeta','sub_CheckoutBeta','${checkoutAt}'::timestamptz,'${expiresAt}'::timestamptz,'${betaIntent}');`)).outcome, "applied",
  "subscription-before-checkout binds and completes the durable intent");
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_billing_checkout_event_service(
    'evt_checkout_beta_late','checkout.session.completed',now(),'${betaIntent}','${betaSession}','${fixture.tenantBeta}',
    'piloto','cus_CheckoutBeta','sub_CheckoutBeta','paid');`)), { applied: false, replayed: false, state: "completed" },
  "checkout confirmation after subscription never duplicates the subscription");

  const betaCanceledAt = new Date(Date.now() + 3000).toISOString();
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_cancel','customer.subscription.deleted','${betaCanceledAt}'::timestamptz,'${fixture.tenantBeta}','piloto','canceled',
    'cus_CheckoutBeta','sub_CheckoutBeta',null,null,null);`)).outcome, "applied", "legacy same-sub updates remain monotonic without a checkout id");

  const conflictingIntent = "019f0000-0000-7000-8000-000000001312";
  assert.equal(queryJson(databaseUrl, begin({ intentId: conflictingIntent, tenantId: fixture.tenantBeta, userId: fixture.userBeta })).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${conflictingIntent}');`)).acquired, true);
  const conflictingSession = "cs_test_checkout_beta_conflict";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_bind_billing_checkout_session_service(
    '${conflictingIntent}','${conflictingSession}','https://checkout.stripe.com/c/pay/${conflictingSession}','${expiresAt}'::timestamptz);`)).bound, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_billing_checkout_event_service(
    'evt_checkout_beta_conflict','checkout.session.completed','${new Date(Date.now() + 4000).toISOString()}'::timestamptz,
    '${conflictingIntent}','${conflictingSession}','${fixture.tenantBeta}','piloto','cus_CheckoutBeta2','sub_CheckoutBeta2','paid');`)).state, "completed");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_reactivated','customer.subscription.updated','${new Date(Date.now() + 5000).toISOString()}'::timestamptz,
    '${fixture.tenantBeta}','piloto','active','cus_CheckoutBeta','sub_CheckoutBeta',null,null,null);`)).outcome, "applied");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_duplicate','customer.subscription.created','${new Date(Date.now() + 6000).toISOString()}'::timestamptz,
    '${fixture.tenantBeta}','piloto','active','cus_CheckoutBeta2','sub_CheckoutBeta2',null,null,'${conflictingIntent}');`)).outcome,
  "duplicate_subscription_conflict", "a live different subscription yields an explicit safe receipt");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.billing_checkout_intents WHERE id='${conflictingIntent}';`), "conflict",
    "the incoming checkout intent is durably fenced after duplicate-subscription conflict");

  const terminalAgainAt = new Date(Date.now() + 7000).toISOString();
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_cancel_again','customer.subscription.deleted','${terminalAgainAt}'::timestamptz,
    '${fixture.tenantBeta}','piloto','canceled','cus_CheckoutBeta','sub_CheckoutBeta',null,null,null);`)).outcome, "applied");
  const replacementIntent = "019f0000-0000-7000-8000-000000001313";
  assert.equal(queryJson(databaseUrl, begin({ intentId: replacementIntent, tenantId: fixture.tenantBeta, userId: fixture.userBeta })).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${replacementIntent}');`)).acquired, true);
  const replacementSession = "cs_test_checkout_beta_replacement";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_bind_billing_checkout_session_service(
    '${replacementIntent}','${replacementSession}','https://checkout.stripe.com/c/pay/${replacementSession}','${expiresAt}'::timestamptz);`)).bound, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_billing_checkout_event_service(
    'evt_checkout_beta_replacement','checkout.session.completed','${new Date(Date.now() + 8000).toISOString()}'::timestamptz,
    '${replacementIntent}','${replacementSession}','${fixture.tenantBeta}','piloto','cus_CheckoutBeta3','sub_CheckoutBeta3','paid');`)).state, "completed");
  const replacementAt = new Date(Date.now() + 9000).toISOString();
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_replacement','customer.subscription.created','${replacementAt}'::timestamptz,
    '${fixture.tenantBeta}','piloto','active','cus_CheckoutBeta3','sub_CheckoutBeta3',null,null,'${replacementIntent}');`)).outcome,
  "applied", "a terminal subscription can be replaced only by its exact completed checkout intent");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_sub_beta_late_old','customer.subscription.deleted','${new Date(Date.now() + 8500).toISOString()}'::timestamptz,
    '${fixture.tenantBeta}','piloto','canceled','cus_CheckoutBeta','sub_CheckoutBeta',null,null,null);`)).outcome,
  "ignored_superseded_subscription", "a late superseded subscription event cannot overwrite the replacement");
  assert.equal(queryScalar(databaseUrl, `SELECT stripe_subscription_id FROM public.tenant_subscriptions WHERE tenant_id='${fixture.tenantBeta}';`), "sub_CheckoutBeta3");

  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, checkoutAlphaSql.replace("evt_checkout_alpha", "evt_global_reuse").replace(fixture.tenantAlpha, fixture.tenantBeta))),
    "cross-tenant checkout tuple is rejected");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_checkout_alpha','customer.subscription.updated',now(),'${fixture.tenantBeta}','piloto','active',
    'cus_CheckoutBeta','sub_CheckoutBeta',null,null,null);`)), "a global event id cannot be reused across event kinds or tenants");
  assertFailed(runSql(databaseUrl, "UPDATE public.billing_stripe_event_receipts SET event_type=event_type WHERE event_id='evt_checkout_alpha';"),
    "Stripe event receipts are append-only");
  assertSucceeded(runSql(databaseUrl, `DELETE FROM public.tenant_subscriptions
    WHERE tenant_id IN ('${fixture.tenantAlpha}','${fixture.tenantBeta}');`),
  "isolate checkout subscription fixtures from later provider-budget scenarios");
}

async function assertBillingCheckoutP1Hardening(databaseUrl) {
  const expiry = new Date(Date.now() + 60 * 60 * 1000);
  expiry.setMilliseconds(0);
  const expiresAt = expiry.toISOString();
  const begin = (intentId) => queryJson(databaseUrl, asRoleSql("service_role", null, checkoutBeginSql({
    intentId, tenantId: fixture.tenantGamma, userId: fixture.userGamma, expiresAt,
  })));
  const service = (sql) => asRoleSql("service_role", null, sql);
  const eventBase = Date.now();
  const eventAt = (offsetSeconds) => new Date(eventBase + offsetSeconds * 1000).toISOString();
  const ageReservedIntent = (intentId) => assertSucceeded(runSql(databaseUrl, `BEGIN;
    ALTER TABLE public.billing_checkout_intents DISABLE TRIGGER billing_checkout_intents_immutable_snapshot;
    UPDATE public.billing_checkout_intents
      SET expires_at=date_trunc('second',statement_timestamp()+interval '29 minutes')
      WHERE id='${intentId}';
    ALTER TABLE public.billing_checkout_intents ENABLE TRIGGER billing_checkout_intents_immutable_snapshot;
    COMMIT;`), `age reserved checkout ${intentId} below the dispatch safety floor`);

  const dispatchExpiredIntent = "019f0000-0000-7000-8000-000000001320";
  assert.equal(begin(dispatchExpiredIntent).outcome, "reserved");
  ageReservedIntent(dispatchExpiredIntent);
  assert.deepEqual(queryJson(databaseUrl, service(
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${dispatchExpiredIntent}');`)),
  { acquired: false, state: "released" }, "dispatch revalidates the 30-minute provider safety floor");
  assert.equal(queryScalar(databaseUrl, `SELECT state||':'||release_evidence FROM public.billing_checkout_intents
    WHERE id='${dispatchExpiredIntent}';`), "released:not_dispatched");

  const staleIntent = "019f0000-0000-7000-8000-000000001321";
  const recoveredIntent = "019f0000-0000-7000-8000-000000001322";
  assert.equal(begin(staleIntent).outcome, "reserved");
  ageReservedIntent(staleIntent);
  assert.equal(begin(staleIntent).outcome, "replayed",
    "same-id replay uses the exact immutable request fingerprint even after the reserved row ages");
  const recovered = begin(recoveredIntent);
  assert.equal(recovered.outcome, "reserved",
    "fresh-id recovery releases an aged pre-dispatch reservation and creates the replacement atomically");
  assert.equal(recovered.checkoutIntentId, recoveredIntent);
  assert.equal(queryScalar(databaseUrl, `SELECT state||':'||release_evidence FROM public.billing_checkout_intents
    WHERE id='${staleIntent}';`), "released:not_dispatched");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_checkout_intents
    WHERE tenant_id='${fixture.tenantGamma}' AND state IN ('reserved','dispatched','bound','unknown');`), "1");
  assert.deepEqual(queryJson(databaseUrl, service(
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${recoveredIntent}');`)),
  { acquired: true, state: "dispatched" });

  const webhookSession = "cs_test_checkout_gamma_webhook_first";
  const webhookUrl = `https://checkout.stripe.com/c/pay/${webhookSession}`;
  const webhookEventAt = eventAt(1);
  const webhookSql = `SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_checkout_concurrent','checkout.session.completed','${webhookEventAt}'::timestamptz,
    '${recoveredIntent}','${webhookSession}','${fixture.tenantGamma}','piloto',
    'cus_GammaWebhook','sub_GammaWebhook','paid');`;
  const [webhookFirst, webhookSecond] = await Promise.all([
    runSqlAsync(databaseUrl, service(webhookSql)),
    runSqlAsync(databaseUrl, service(webhookSql)),
  ]);
  assertSucceeded(webhookFirst, "first identical signed checkout event contender");
  assertSucceeded(webhookSecond, "second identical signed checkout event contender");
  const webhookReceipts = [parseLastJson(webhookFirst.stdout), parseLastJson(webhookSecond.stdout)];
  assert.equal(webhookReceipts.filter((receipt) => receipt.applied && !receipt.replayed && receipt.state === "completed").length, 1);
  assert.equal(webhookReceipts.filter((receipt) => !receipt.applied && receipt.replayed && receipt.state === "completed").length, 1,
    "identical event concurrency commits once and replays the durable receipt once");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.billing_stripe_event_receipts WHERE event_id='evt_gamma_checkout_concurrent';"), "1");
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_bind_billing_checkout_session_service(
    '${recoveredIntent}','${webhookSession}','${webhookUrl}','${expiresAt}'::timestamptz);`)),
  { bound: true, state: "completed" }, "provider bind after webhook completion persists redirect evidence without state regression");
  assert.equal(queryScalar(databaseUrl, `SELECT state='completed' AND checkout_url='${webhookUrl}' AND bound_at IS NOT NULL
    FROM public.billing_checkout_intents WHERE id='${recoveredIntent}';`), "t");

  assert.equal(queryJson(databaseUrl, service(`SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_gamma_subscription_initial','customer.subscription.created','${eventAt(2)}'::timestamptz,
    '${fixture.tenantGamma}','piloto','active','cus_GammaWebhook','sub_GammaWebhook',null,null,'${recoveredIntent}');`)).outcome, "applied");
  assert.equal(queryJson(databaseUrl, service(`SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_gamma_subscription_cancel','customer.subscription.deleted','${eventAt(3)}'::timestamptz,
    '${fixture.tenantGamma}','piloto','canceled','cus_GammaWebhook','sub_GammaWebhook',null,null,null);`)).outcome, "applied");

  const reverseIntent = "019f0000-0000-7000-8000-000000001323";
  const reverseSession = "cs_test_checkout_gamma_reverse";
  assert.equal(begin(reverseIntent).outcome, "reserved");
  assert.deepEqual(queryJson(databaseUrl, service(
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${reverseIntent}');`)), { acquired: true, state: "dispatched" });
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_bind_billing_checkout_session_service(
    '${reverseIntent}','${reverseSession}','https://checkout.stripe.com/c/pay/${reverseSession}','${expiresAt}'::timestamptz);`)),
  { bound: true, state: "bound" });
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_gamma_reverse_subscription','customer.subscription.created','${eventAt(4)}'::timestamptz,
    '${fixture.tenantGamma}','piloto','active','cus_GammaReverse','sub_GammaReverse',null,null,'${reverseIntent}');`)),
  { outcome: "applied", applied: true, replayed: false },
  "a signed subscription event can replace a terminal subscription from an exactly bound checkout intent");
  assert.equal(queryScalar(databaseUrl, `SELECT state='completed' AND stripe_customer_id='cus_GammaReverse'
    AND stripe_subscription_id='sub_GammaReverse' FROM public.billing_checkout_intents WHERE id='${reverseIntent}';`), "t",
  "reverse-order resubscribe completes the bound intent in the same transaction");

  const tieAt = eventAt(5);
  assert.equal(queryJson(databaseUrl, service(`SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_gamma_tie_z','customer.subscription.deleted','${tieAt}'::timestamptz,
    '${fixture.tenantGamma}','piloto','canceled','cus_GammaReverse','sub_GammaReverse',null,null,null);`)).outcome, "applied");
  assert.equal(queryJson(databaseUrl, service(`SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_gamma_tie_a','customer.subscription.updated','${tieAt}'::timestamptz,
    '${fixture.tenantGamma}','piloto','active','cus_GammaReverse','sub_GammaReverse',null,null,null);`)).outcome, "ignored_stale",
  "equal Stripe timestamps use event id as a deterministic monotonic tie-break");
  assert.equal(queryScalar(databaseUrl, `SELECT status||':'||last_event_id FROM public.tenant_subscriptions
    WHERE tenant_id='${fixture.tenantGamma}';`), "canceled:evt_gamma_tie_z");

  assertFailed(runSql(databaseUrl, service(`SELECT public.portal_apply_tenant_subscription_event_service(
    'evt_gamma_foreign_subscription','customer.subscription.updated','${eventAt(6)}'::timestamptz,
    '${fixture.tenantGamma}','piloto','active','cus_CheckoutAlpha','sub_CheckoutAlpha',null,null,null);`)),
  "a globally owned Stripe subscription cannot be claimed by another tenant's subscription writer");

  const unpaidIntent = "019f0000-0000-7000-8000-000000001324";
  const unpaidSession = "cs_test_checkout_gamma_unpaid";
  assert.equal(begin(unpaidIntent).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, service(
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${unpaidIntent}');`)).acquired, true);
  assertFailed(runSql(databaseUrl, service(`SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_checkout_foreign_sub','checkout.session.completed','${eventAt(7)}'::timestamptz,
    '${unpaidIntent}','${unpaidSession}','${fixture.tenantGamma}','piloto','cus_CheckoutAlpha','sub_CheckoutAlpha','paid');`)),
  "checkout ingestion enforces the same global Stripe subscription ownership fence");
  const completedUnpaidSql = `SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_completed_unpaid','checkout.session.completed','${eventAt(8)}'::timestamptz,
    '${unpaidIntent}','${unpaidSession}','${fixture.tenantGamma}','piloto','cus_GammaUnpaid','sub_GammaUnpaid','unpaid');`;
  assert.deepEqual(queryJson(databaseUrl, service(completedUnpaidSql)), { applied: true, replayed: false, state: "unknown" },
    "checkout.session.completed with unpaid disposition remains recoverable unknown");
  assert.deepEqual(queryJson(databaseUrl, service(completedUnpaidSql)), { applied: false, replayed: true, state: "unknown" });
  assertFailed(runSql(databaseUrl, service(completedUnpaidSql.replace("'unpaid'", "'paid'"))),
    "same Stripe event id rejects any payload fingerprint mismatch");
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_async_unpaid','checkout.session.async_payment_succeeded','${eventAt(9)}'::timestamptz,
    '${unpaidIntent}','${unpaidSession}','${fixture.tenantGamma}','piloto','cus_GammaUnpaid','sub_GammaUnpaid','unpaid');`)),
  { applied: true, replayed: false, state: "unknown" }, "async success requires paid or no_payment_required evidence");
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_async_paid','checkout.session.async_payment_succeeded','${eventAt(10)}'::timestamptz,
    '${unpaidIntent}','${unpaidSession}','${fixture.tenantGamma}','piloto','cus_GammaUnpaid','sub_GammaUnpaid','paid');`)),
  { applied: true, replayed: false, state: "completed" });
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_late_failure','checkout.session.async_payment_failed','${eventAt(11)}'::timestamptz,
    '${unpaidIntent}','${unpaidSession}','${fixture.tenantGamma}','piloto','cus_GammaUnpaid','sub_GammaUnpaid',null);`)),
  { applied: false, replayed: false, state: "expired" },
  "a late signed failure reports its event disposition without regressing a completed checkout");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.billing_checkout_intents WHERE id='${unpaidIntent}';`), "completed");

  const failedIntent = "019f0000-0000-7000-8000-000000001325";
  const failedSession = "cs_test_checkout_gamma_failed";
  assert.equal(begin(failedIntent).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, service(
    `SELECT public.portal_mark_billing_checkout_dispatched_service('${failedIntent}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, service(`SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_failed_pending','checkout.session.completed','${eventAt(12)}'::timestamptz,
    '${failedIntent}','${failedSession}','${fixture.tenantGamma}','piloto','cus_GammaFailed','sub_GammaFailed','unpaid');`)).state, "unknown");
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_apply_billing_checkout_event_service(
    'evt_gamma_failed_terminal','checkout.session.async_payment_failed','${eventAt(13)}'::timestamptz,
    '${failedIntent}','${failedSession}','${fixture.tenantGamma}','piloto','cus_GammaFailed','sub_GammaFailed',null);`)),
  { applied: true, replayed: false, state: "expired" });
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.billing_checkout_intents WHERE id='${failedIntent}';`), "expired");
  const afterFailureIntent = "019f0000-0000-7000-8000-000000001326";
  assert.equal(begin(afterFailureIntent).outcome, "reserved", "a signed terminal failure permits a new checkout intent");
  assert.deepEqual(queryJson(databaseUrl, service(`SELECT public.portal_release_billing_checkout_intent_service(
    '${afterFailureIntent}','not_dispatched');`)), { released: true, state: "released" });

  assertFailed(runSql(databaseUrl, `INSERT INTO public.billing_stripe_event_receipts(
    event_id,event_type,event_created_at,tenant_id,payload_fingerprint,receipt_kind,receipt_state,receipt_applied)
    VALUES('evt_gamma_invalid_shape','checkout.session.expired',now(),'${fixture.tenantGamma}',repeat('a',64),'checkout','expired',false);`),
  "relational receipt checks reject checkout receipts without their required intent and session tuple");
  assertSucceeded(runSql(databaseUrl, `DELETE FROM public.tenant_subscriptions WHERE tenant_id='${fixture.tenantGamma}';`),
    "isolate checkout hardening subscription fixture from later reservation scenarios");
}

function assertUsageSummaryLedgerTotals(databaseUrl) {
  const fixtureIds = [
    "019f0000-0000-7000-8000-000000001130",
    "019f0000-0000-7000-8000-000000001131",
    "019f0000-0000-7000-8000-000000001132",
  ];
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.user_tenant_memberships(user_id,tenant_id,actor_id,role)
    VALUES ('${fixture.userDelta}','${fixture.tenantDelta}','${fixture.actorDelta}','tenant_admin');
    INSERT INTO public.cost_events
    (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,rate_card_ref,rate_card_as_of) VALUES
    ('${fixture.tenantDelta}','${fixtureIds[0]}','tavus','harness.summary.tavus','conversation',1,3.7,3.7,'estimated',now(),'harness.tavus','2026-08-13T00:00:00Z'),
    ('${fixture.tenantDelta}','${fixtureIds[1]}','recall','harness.summary.recall','flat',1.5,0.5,0.75,'estimated',now(),'harness.recall','2026-08-13T00:00:00Z'),
    ('${fixture.tenantGamma}','${fixtureIds[2]}','recall','harness.summary.other_tenant','flat',1,9.9,9.9,'estimated',now(),'harness.other','2026-08-13T00:00:00Z');`),
  "usage summary mixed-provider fixtures");
  const summary = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userDelta, "SELECT public.portal_usage_summary();"));
  assert.equal(summary.total_cost_usd_today, 4.45, "today total sums Tavus and Recall ledger amounts");
  assert.equal(summary.total_cost_usd_7d, 4.45, "7d total sums every in-tenant ledger unit");
  assert.equal(summary.cost_precision, "mixed_estimated_provider_reported");
  assert.equal(summary.conversations_today, 1, "legacy conversation count remains compatible");
  assert.equal(summary.video_cost_floor_usd_today, 0.175, "legacy video floor remains available during UI cutover");
  assert.equal(summary.services_7d.find((row) => row.service === "harness.summary.recall")?.quantity, 1.5,
    "services_7d preserves numeric quantities without bigint coercion");
  assert.equal(summary.services_7d.some((row) => row.service === "harness.summary.other_tenant"), false,
    "usage summary never aggregates another tenant's costs");
}

function assertKnowledgeSourceDeletionRetention(databaseUrl) {
  const sourceId = "019f0000-0000-7000-8000-000000001120";
  const reservationId = "019f0000-0000-7000-8000-000000001121";
  const costEventId = "019f0000-0000-7000-8000-000000001122";
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.knowledge_sources(tenant_id,id,source_type,display_name,data_classification,status)
    VALUES ('${fixture.tenantAlpha}','${sourceId}','document','Deletion retention fixture','internal','disabled');
  `), "knowledge source deletion fixture");
  const reserved = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_begin_ai_usage_reservation_service(
      '${reservationId}','${costEventId}','${fixture.tenantAlpha}',null,'${sourceId}',
      'ai:knowledge_ingestion_embedding:deletion-retention','knowledge_ingestion_embedding',20000,0,0.01
    );
  `));
  assert.equal(reserved.outcome, "reserved");
  const deleted = queryJson(databaseUrl, asRoleSql("authenticated", fixture.userAlpha,
    `SELECT public.portal_delete_knowledge_source('${sourceId}');`));
  assert.equal(deleted.ok, true, "source deletion remains available after an attributable AI reservation");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.knowledge_sources WHERE tenant_id='${fixture.tenantAlpha}' AND id='${sourceId}';`), "0");
  assert.equal(queryScalar(databaseUrl, `SELECT source_id IS NULL FROM public.ai_usage_reservations WHERE id='${reservationId}';`), "t",
    "financial reservation retains minimized evidence without retaining the deleted source identity");
}

async function assertReservationContract(databaseUrl) {
  const reservationTable = queryRows(databaseUrl, `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'provider_effect_reservations'
    ORDER BY ordinal_position;
  `);
  assert.ok(reservationTable.includes("tenant_id"));
  assert.ok(reservationTable.includes("idempotency_key"));
  assert.ok(reservationTable.includes("state"));
  assert.ok(reservationTable.includes("provider_ref"));

  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.tenant_subscriptions
      (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004099','${fixture.tenantGamma}','cus_HarnessGammaRate','sub_HarnessGammaRate','piloto','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
  `), "rate-card reservation subscription fixture");

  const rateCard = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantGamma, fixture.agentGamma, "tavus-rate-card", "019f0000-0000-7000-8000-000000002099", "019f0000-0000-7000-8000-000000003099")));
  assert.equal(Number(rateCard.estimatedCostUsd), 3.7, "600s Tavus reservation uses the conservative USD .37/min published overage");
  assert.equal(queryScalar(databaseUrl, "SELECT cost_rate_card_ref FROM public.provider_effect_reservations WHERE id='019f0000-0000-7000-8000-000000002099';"),
    "tavus.cvi_overage.max_published_0_37_per_minute_2026_08_13");

  const reserveFunction = queryScalar(databaseUrl, `
    SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'portal_begin_provider_effect_service'
    LIMIT 1;
  `);
  assert.notEqual(reserveFunction, "", "0040 must expose a reservation RPC");

  const providerReservationsBeforeInvalidUuid = queryScalar(databaseUrl, "SELECT count(*) FROM public.provider_effect_reservations;");
  const providerCostsBeforeInvalidUuid = queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events;");
  for (const [label, reservationId, costEventId] of [
    ["reservation id", "11111111-1111-4111-8111-111111111111", "019f0000-0000-7000-8000-000000003941"],
    ["cost event id", "019f0000-0000-7000-8000-000000002941", "11111111-1111-4111-8111-111111111111"],
  ]) {
    assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
      fixture.tenantGamma, fixture.agentGamma, `provider-invalid-uuid-${label}`, reservationId, costEventId,
    ))), `provider reservation rejects UUIDv4 ${label}`);
  }
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.provider_effect_reservations;"), providerReservationsBeforeInvalidUuid,
    "UUIDv4 provider reservation inputs write zero reservation rows");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events;"), providerCostsBeforeInvalidUuid,
    "UUIDv4 provider reservation inputs write zero cost rows");

  // The exact application call is asserted once against the ADR-036 RPC
  // signature. Two independent psql connections start together so the
  // database, not an in-process mutex, chooses the single cap winner.
  assertTrialCapFailsClosed(databaseUrl);
  assertSucceeded(runSql(databaseUrl, dailyCostFixturesSql(19)), "daily cap concurrency fixtures");
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.tenant_subscriptions
      (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004100','${fixture.tenantAlpha}','cus_HarnessAlpha','sub_HarnessAlpha','escala','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
  `), "active Scale fixture makes the daily bucket the limiting cap");
  const reserveSql = reservationInvocationSql(
    fixture.tenantAlpha, fixture.agentAlpha, "parallel-a",
    "019f0000-0000-7000-8000-000000002001", "019f0000-0000-7000-8000-000000003001",
  );
  const reserveSqlTwo = reservationInvocationSql(
    fixture.tenantAlpha, fixture.agentAlpha, "parallel-b",
    "019f0000-0000-7000-8000-000000002002", "019f0000-0000-7000-8000-000000003002",
  );
  const [first, second] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, reserveSql)),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, reserveSqlTwo)),
  ]);
  assertSucceeded(first, "first concurrent provider reservation");
  assertSucceeded(second, "second concurrent provider reservation");
  const outcomes = [parseLastJson(first.stdout), parseLastJson(second.stdout)].map((value) => value.outcome ?? value.status).sort();
  assert.deepEqual(outcomes, ["capped", "reserved"], "daily cap one must produce exactly one durable winner");

  const winningReservationId = firstOutcome(first.stdout) === "reserved" ? "019f0000-0000-7000-8000-000000002001" : "019f0000-0000-7000-8000-000000002002";
  const winningKey = firstOutcome(first.stdout) === "reserved" ? "parallel-a" : "parallel-b";
  const replay = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantAlpha, fixture.agentAlpha, winningKey,
    "019f0000-0000-7000-8000-000000002009", "019f0000-0000-7000-8000-000000003009",
  )));
  assert.ok(["replayed", "reserved"].includes(replay.outcome ?? replay.status), "same idempotency key replays its reservation");
  assert.equal(replay.reservationId, winningReservationId, "fresh proposed UUIDs never replace the stable replay identities");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_provider_effect_service(
    '019f0000-0000-7000-8000-000000002008','019f0000-0000-7000-8000-000000003008','${fixture.tenantAlpha}','${fixture.agentAlpha}','${winningKey}',
    'tavus','tavus_conversation','tavus_video_daily',null,'conflicting_meter_event',600
  );`)), "same idempotency key rejects a conflicting meter contract");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_provider_effect_service(
    '019f0000-0000-7000-8000-000000002007','019f0000-0000-7000-8000-000000003007','${fixture.tenantAlpha}','${fixture.agentAlpha}','unsafe-related-ref',
    'recall','recall_bot','recall_bot_active','https://meet.example.test/credential','axtro_conversation_overage',null
  );`)), "durable provider reservations reject raw credential-bearing URLs");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_reservations WHERE tenant_id = '${fixture.tenantAlpha}' AND idempotency_key IN ('parallel-a','parallel-b');`), "1");

  const unknownRpc = queryScalar(databaseUrl, `
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'portal%provider%unknown%service' ORDER BY 1 LIMIT 1;
  `);
  assert.notEqual(unknownRpc, "", "0040 must expose an unknown-outcome transition");
  assertUnknownBarrier(databaseUrl);
  assertGlobalProviderReferenceOwnership(databaseUrl);
  assertFinalizeRollbackAndIdempotency(databaseUrl);
  assertBillingUsageLifecycle(databaseUrl);
  assertActivationBillingSnapshotRollover(databaseUrl);
  await assertConcurrentActivationOrdinal(databaseUrl);
  await assertTerminalActivationRace(databaseUrl);
}

function assertGlobalProviderReferenceOwnership(databaseUrl) {
  const firstReservation = "019f0000-0000-7000-8000-000000002027";
  const secondReservation = "019f0000-0000-7000-8000-000000002028";
  const sharedProviderRef = "recall-provider-ref-global-owner";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantGamma, fixture.agentGamma, "provider-ref-owner-a", firstReservation,
    "019f0000-0000-7000-8000-000000003027", "recall",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantBeta, fixture.agentBeta, "provider-ref-owner-b", secondReservation,
    "019f0000-0000-7000-8000-000000003028", "recall",
  ))).outcome, "reserved");
  for (const reservationId of [firstReservation, secondReservation]) {
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, true);
  }
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${firstReservation}','${sharedProviderRef}',null,null);`)).committed, true);
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${secondReservation}','${sharedProviderRef}',null,null);`)),
  "one provider effect reference cannot be committed for a second tenant");
  assert.equal(queryScalar(databaseUrl, `SELECT state||':'||coalesce(provider_ref,'') FROM public.provider_effect_reservations WHERE id='${secondReservation}';`), "provider_in_flight:",
  "the ownership conflict rolls back without linking or committing the foreign effect");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.cost_events WHERE id='019f0000-0000-7000-8000-000000003028';`), "0");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reconcile_provider_effect_service(
    '019f0000-0000-7000-8000-000000003029','${secondReservation}','reconciliation_absent','recall_lookup_absent_global_owner_b'
  );`)), "t");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_provider_effect_service('${firstReservation}');`)), "t");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_void_unleased_billing_usage_service('${firstReservation}','provider_ref_ownership_fixture');`)), "t",
  "the ownership fixture closes its held delivery state without removing provider cost evidence");
}

function assertTrialCapFailsClosed(databaseUrl) {
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.tenant_subscriptions
      (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004098','${fixture.tenantBeta}','cus_HarnessBetaTrial','sub_HarnessBetaTrial','piloto','trialing',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
    ${Array.from({ length: 6 }, (_, index) => {
    const id = `019f0000-0000-7000-8000-${String(4500 + index).padStart(12, "0")}`;
    return `INSERT INTO public.cost_events (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
      VALUES ('${fixture.tenantBeta}','${id}','tavus','trial.cap.fixture','conversation',1,0,0,'estimated',now());`;
  }).join("\n")}`), "controlled trial cap fixtures");
  const held = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(
      fixture.tenantBeta, fixture.agentBeta, "trial-held-case",
      "019f0000-0000-7000-8000-000000002030", "019f0000-0000-7000-8000-000000003030",
    )));
  assert.equal(held.outcome, "reserved", "the final included Pilot trial slot is held before provider dispatch");
  const result = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(
      fixture.tenantBeta, fixture.agentBeta, "trial-cap-case",
      "019f0000-0000-7000-8000-000000002031", "019f0000-0000-7000-8000-000000003031",
    )));
  assert.equal(result.outcome, "capped");
  assert.equal(result.bucket, "tavus_monthly_trial");
  assert.equal(result.cap, 7);
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.provider_effect_reservations WHERE id='019f0000-0000-7000-8000-000000002031';"), "0");
}

function assertProviderCommitPeriodBoundary(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002450";
  const costEventId = "019f0000-0000-7000-8000-000000003450";
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.tenant_subscriptions
      (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004450','${fixture.tenantEpsilon}','cus_HarnessEpsilon','sub_HarnessEpsilon','piloto','trialing',now()-interval '1 hour',now()+interval '1 month');
    ${Array.from({ length: 6 }, (_, index) => `INSERT INTO public.cost_events
      (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
      VALUES ('${fixture.tenantEpsilon}','019f0000-0000-7000-8000-${String(4640 + index).padStart(12, "0")}','tavus','period.boundary.fixture','conversation',1,0,0,'estimated',now());`).join("\n")}
  `), "provider period-boundary fixtures");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantEpsilon, fixture.agentEpsilon, "period-boundary-commit", reservationId, costEventId,
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${"8".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','period-boundary-provider',null,null);`)).committed, true);
  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_reservations
    SET created_at=(SELECT current_period_start-interval '1 day' FROM public.tenant_subscriptions WHERE tenant_id='${fixture.tenantEpsilon}')
    WHERE id='${reservationId}';`), "simulate reservation created before the billing period but committed inside it");
  const capped = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantEpsilon, fixture.agentEpsilon, "period-boundary-next",
    "019f0000-0000-7000-8000-000000002451", "019f0000-0000-7000-8000-000000003451",
  )));
  assert.equal(capped.outcome, "capped", "linked committed cost is counted by occurred_at, never reservation created_at");
  assert.equal(capped.bucket, "tavus_monthly_trial");
  assert.equal(capped.usage, 7);
}

function assertAiCommitPeriodBoundary(databaseUrl) {
  const tenantId = fixture.tenantZeta;
  const agentId = fixture.agentZeta;
  const reservationId = "019f0000-0000-7000-8000-000000002460";
  const costEventId = "019f0000-0000-7000-8000-000000003460";
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.cost_events
    (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
    VALUES ('${tenantId}','019f0000-0000-7000-8000-000000004460','openrouter','ai.period.boundary.fixture','token',479389,0,0,'estimated',now());`),
  "AI period-boundary baseline");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
    '${reservationId}','${costEventId}','${tenantId}','${agentId}',null,
    'ai-period-boundary-commit','brain_generation',20000,512,0.05
  );`)).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${reservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${reservationId}',60,40,null);`)).committed, true);
  assertSucceeded(runSql(databaseUrl, `UPDATE public.ai_usage_reservations SET created_at=date_trunc('day',now())-interval '1 day'
    WHERE id='${reservationId}';`), "simulate AI reservation created before UTC day but committed inside it");
  const capped = queryJson(databaseUrl, asRoleSql("service_role", null, `SET TIME ZONE 'Pacific/Honolulu';
    SELECT public.portal_begin_ai_usage_reservation_service(
    '019f0000-0000-7000-8000-000000002461','019f0000-0000-7000-8000-000000003461','${tenantId}','${agentId}',null,
    'ai-period-boundary-next','brain_generation',20000,512,0.05
  ); RESET TIME ZONE;`));
  assert.equal(capped.outcome, "capped", "linked AI cost is counted by occurred_at, never reservation created_at");
  assert.equal(capped.bucket, "ai_tokens_daily");
  assert.equal(capped.usage, 479489);
}

async function assertTavusNoDeliveryBudget(databaseUrl) {
  const tenantId = fixture.tenantZeta;
  const agentId = fixture.agentZeta;
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.tenant_subscriptions
    (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004470','${tenantId}','cus_HarnessZeta','sub_HarnessZeta','escala','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');`),
  "no-delivery budget subscription");

  const pending = Array.from({ length: 2 }, (_, index) => ({
    reservationId: `019f0000-0000-7000-8000-00000000248${index}`,
    costEventId: `019f0000-0000-7000-8000-00000000348${index}`,
    key: `no-delivery-pending-${index}`,
  }));
  for (const row of pending) {
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
      tenantId, agentId, row.key, row.reservationId, row.costEventId,
    ))).outcome, "reserved");
  }
  const pendingContenders = [
    { reservationId: "019f0000-0000-7000-8000-000000002482", costEventId: "019f0000-0000-7000-8000-000000003482", key: "no-delivery-pending-2" },
    { reservationId: "019f0000-0000-7000-8000-000000002483", costEventId: "019f0000-0000-7000-8000-000000003483", key: "no-delivery-pending-3" },
  ];
  const contenderResults = await Promise.all(pendingContenders.map((row) => runSqlAsync(databaseUrl,
    asRoleSql("service_role", null, reservationInvocationSql(tenantId, agentId, row.key, row.reservationId, row.costEventId)))));
  contenderResults.forEach((result) => assertSucceeded(result, "concurrent pending-delivery cap contender"));
  const contenderReceipts = contenderResults.map((result) => parseLastJson(result.stdout));
  assert.deepEqual(contenderReceipts.map((receipt) => receipt.outcome).sort(), ["capped", "reserved"],
    "tenant serialization admits exactly one room at the pending-delivery boundary");
  const winner = pendingContenders[contenderReceipts.findIndex((receipt) => receipt.outcome === "reserved")];
  const heldRows = [...pending, winner];

  const activated = heldRows[0];
  const deliveredProviderRef = "no-delivery-human-delivered";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${activated.reservationId}','${"f".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${activated.reservationId}','${deliveredProviderRef}',null,null);`)).committed, true);
  registerVideoTranscriptReceipt(databaseUrl, tenantId, agentId, activated.reservationId, deliveredProviderRef, "f".repeat(64));
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${activated.reservationId}');`)).activated, true);

  const afterActivation = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, "no-delivery-after-activation", "019f0000-0000-7000-8000-000000002484", "019f0000-0000-7000-8000-000000003484",
  )));
  assert.equal(afterActivation.outcome, "reserved", "a proven human delivery leaves the no-delivery budget immediately");
  for (const row of [...heldRows.slice(1), { reservationId: afterActivation.reservationId }]) {
    assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_release_provider_effect_service('${row.reservationId}','not_dispatched');`)), "t");
  }

  const reconciledReservationId = "019f0000-0000-7000-8000-000000002485";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, "no-delivery-reconciled", reconciledReservationId, "019f0000-0000-7000-8000-000000003485",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reconciledReservationId}','${"e".repeat(64)}');`)).acquired, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reconcile_provider_effect_service(
    '019f0000-0000-7000-8000-000000006485','${reconciledReservationId}','reconciliation_absent','tavus_lookup_absent_no_delivery_1'
  );`)), "t", "a dispatched effect released by evidence still consumes no-delivery budget");

  const interleavedHeld = [
    { reservationId: "019f0000-0000-7000-8000-000000002486", costEventId: "019f0000-0000-7000-8000-000000003486", key: "no-delivery-interleaved-held-a" },
    { reservationId: "019f0000-0000-7000-8000-000000002487", costEventId: "019f0000-0000-7000-8000-000000003487", key: "no-delivery-interleaved-held-b" },
  ];
  for (const row of interleavedHeld) {
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
      tenantId, agentId, row.key, row.reservationId, row.costEventId,
    ))).outcome, "reserved", "two held envelopes remain available beside one historical no-delivery attempt");
  }
  const interleavedCap = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, "no-delivery-interleaved-cap", "019f0000-0000-7000-8000-000000002488", "019f0000-0000-7000-8000-000000003488",
  )));
  assert.deepEqual(
    { outcome: interleavedCap.outcome, bucket: interleavedCap.bucket, usage: interleavedCap.usage, cap: interleavedCap.cap, pending: interleavedCap.pending, noDelivery: interleavedCap.noDelivery },
    { outcome: "capped", bucket: "tavus_no_delivery_period", usage: 3, cap: 3, pending: 2, noDelivery: 1 },
    "held plus historical no-delivery attempts share one total budget of three",
  );
  for (const row of interleavedHeld) {
    assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_release_provider_effect_service('${row.reservationId}','not_dispatched');`)), "t");
  }

  for (let index = 0; index < 2; index += 1) {
    const reservationId = `019f0000-0000-7000-8000-00000000249${index}`;
    const costEventId = `019f0000-0000-7000-8000-00000000349${index}`;
    const providerRef = `no-delivery-provider-${index}`;
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
      tenantId, agentId, `no-delivery-voided-${index}`, reservationId, costEventId,
    ))).outcome, "reserved");
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${String(index + 1).repeat(64)}');`)).acquired, true);
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_commit_provider_effect_service('${reservationId}','${providerRef}',null,null);`)).committed, true);
    const noDeliveryDigest = String.fromCharCode(97 + index).repeat(64);
    const noDeliveryClaim = `019f0000-0000-7000-8000-00000000649${index}`;
    const noDeliveryObservedAt = new Date().toISOString();
    assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_register_provider_transcript_service(
      '${reservationId}','${tenantId}','${agentId}','video','${providerRef}');`)), "register no-delivery provider transcript placeholder");
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_claim_tavus_webhook_service(
      '${reservationId}','${providerRef}','${String(index + 1).repeat(64)}','${noDeliveryDigest}','${noDeliveryClaim}','${noDeliveryObservedAt}');`)).outcome, "claimed");
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_record_tavus_no_delivery_service('${reservationId}','${providerRef}','${noDeliveryDigest}','participant_absent_timeout reached','${noDeliveryObservedAt}');`)).voided, true);
  }
  const monthlyCap = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, "no-delivery-monthly-cap", "019f0000-0000-7000-8000-000000002493", "019f0000-0000-7000-8000-000000003493",
  )));
  assert.deepEqual({ outcome: monthlyCap.outcome, bucket: monthlyCap.bucket, usage: monthlyCap.usage, cap: monthlyCap.cap },
    { outcome: "capped", bucket: "tavus_no_delivery_period", usage: 3, cap: 3 },
    "provider-paid rooms without delivery are bounded per billing period");
}

function assertRecallDailyPaidAttemptBudget(databaseUrl) {
  const tenantId = fixture.tenantZeta;
  const agentId = fixture.agentZeta;
  for (let index = 0; index < 20; index += 1) {
    const suffix = String(7000 + index).padStart(12, "0");
    const reservationId = `019f0000-0000-7000-8000-${suffix}`;
    const costEventId = `019f0000-0000-7000-8001-${suffix}`;
    const providerRef = `recall-daily-paid-${index}`;
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
      tenantId, agentId, `recall-daily-paid-${index}`, reservationId, costEventId, "recall",
    ))).outcome, "reserved", `Recall paid attempt ${index + 1} is inside the daily budget`);
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, true);
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_commit_provider_effect_service('${reservationId}','${providerRef}',null,null);`)).committed, true);
    if (index % 3 === 0) {
      assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
        `SELECT public.portal_complete_provider_effect_service('${reservationId}');`)), "t");
    } else if (index % 3 === 1) {
      assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
        `SELECT public.portal_mark_provider_effect_cleanup_pending_service('${reservationId}','${providerRef}','test_compensation');`)), "t");
      const receiptId = `019f0000-0000-7000-8002-${suffix}`;
      assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
        `SELECT public.portal_reconcile_provider_effect_service('${receiptId}','${reservationId}','compensation_confirmed','recall:end:daily:${index}');`)), "t");
    }
  }
  const capped = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    tenantId, agentId, "recall-daily-paid-20", "019f0000-0000-7000-8000-000000007020", "019f0000-0000-7000-8001-000000007020", "recall",
  )));
  assert.deepEqual(
    { outcome: capped.outcome, bucket: capped.bucket, usage: capped.usage, cap: capped.cap },
    { outcome: "capped", bucket: "recall_bot_daily", usage: 20, cap: 20 },
    "completed and compensated Recall effects remain in the daily financial budget",
  );
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events WHERE tenant_id='019f0000-0000-7000-8000-000000000006' AND provider_id='recall' AND service='portal.meeting_bot_session';"), "20");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_reservations
    WHERE tenant_id='${tenantId}' AND provider_id='recall' AND state='committed';`), "6",
  "the daily ledger budget includes paid effects that are still committed");
}

async function assertStaleReservedSweepFencing(databaseUrl) {
  const providerReservation = "019f0000-0000-7000-8000-000000002470";
  const aiReservation = "019f0000-0000-7000-8000-000000002471";
  const aiInFlightReservation = "019f0000-0000-7000-8000-000000002473";
  const recallReservation = "019f0000-0000-7000-8000-000000002475";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantDelta, fixture.agentDelta, "stale-reserved-provider", providerReservation,
    "019f0000-0000-7000-8000-000000003470",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantZeta, fixture.agentZeta, "stale-reserved-recall", recallReservation,
    "019f0000-0000-7000-8000-000000003475", "recall",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
    '${aiReservation}','019f0000-0000-7000-8000-000000003471','${fixture.tenantDelta}','${fixture.agentDelta}',null,
    'ai-stale-reserved-sweep','brain_generation',20000,512,0.05
  );`)).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
    '${aiInFlightReservation}','019f0000-0000-7000-8000-000000003473','${fixture.tenantZeta}','${fixture.agentZeta}',null,
    'ai-stale-inflight-sweep','knowledge_query_embedding',1000,0,0.001
  );`)).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${aiInFlightReservation}');`)).acquired, true);
  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_reservations SET created_at=now()-interval '11 minutes' WHERE id='${providerReservation}';
    UPDATE public.provider_effect_reservations SET created_at=now()-interval '11 minutes' WHERE id='${recallReservation}';
    UPDATE public.ai_usage_reservations SET created_at=now()-interval '11 minutes' WHERE id='${aiReservation}';
    UPDATE public.ai_usage_reservations SET provider_dispatched_at=now()-interval '11 minutes' WHERE id='${aiInFlightReservation}';`), "stale reservation and dispatched-AI sweep fixtures");
  assert.deepEqual(queryJson(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_lease_provider_effect_reconciliation_service('019f0000-0000-7000-8000-000000006700',1,60);")), []);
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${providerReservation}';`), "released");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${recallReservation}';`), "released");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.ai_usage_reservations WHERE id='${aiReservation}';`), "released");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.ai_usage_reservations WHERE id='${aiInFlightReservation}';`), "unknown",
    "process loss after the AI dispatch fence becomes a durable unknown barrier");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${providerReservation}','${"7".repeat(64)}');`)).acquired, false,
  "a swept provider reservation can never cross the dispatch fence");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${recallReservation}');`)).acquired, false,
  "a swept Recall reservation can never cross the generic dispatch fence");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${aiReservation}');`)).acquired, false,
  "a swept AI reservation can never cross the dispatch fence");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
    '019f0000-0000-7000-8000-000000002474','019f0000-0000-7000-8000-000000003474','${fixture.tenantZeta}','${fixture.agentZeta}',null,
    'ai-after-stale-inflight','knowledge_query_embedding',1000,0,0.001
  );`)).outcome, "blocked_unknown", "an aged dispatched AI effect never reopens spend automatically");

  const racedReservation = "019f0000-0000-7000-8000-000000002472";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantDelta, fixture.agentDelta, "stale-sweep-bind-race", racedReservation,
    "019f0000-0000-7000-8000-000000003472",
  ))).outcome, "reserved");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_reservations SET created_at=now()-interval '11 minutes' WHERE id='${racedReservation}';`), "sweep x bind race fixture");
  const [sweep, bind] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      "SELECT public.portal_lease_provider_effect_reconciliation_service('019f0000-0000-7000-8000-000000006701',1,60);")),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_bind_tavus_webhook_capability_service('${racedReservation}','${"6".repeat(64)}');`)),
  ]);
  assertSucceeded(sweep, "stale reservation sweeper contender");
  assertSucceeded(bind, "provider dispatch fence contender");
  assert.equal(parseLastJson(bind.stdout).acquired, false,
    "an 11-minute-old reservation can never win the provider dispatch fence");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${racedReservation}';`), "released",
    "the stale sweeper is the only legal winner after the dispatch deadline");
}

function reservationInvocationSql(tenantId, agentId, idempotencyKey, reservationId, costEventId, provider = "tavus") {
  const tavus = provider === "tavus";
  return `SELECT public.portal_begin_provider_effect_service(
    '${reservationId}', '${costEventId}', '${tenantId}', '${agentId}', '${idempotencyKey}',
    '${provider}', '${tavus ? "tavus_conversation" : "recall_bot"}', '${tavus ? "tavus_video_daily" : "recall_bot_active"}', null,
    'axtro_conversation_overage', ${tavus ? "600" : "null"}
  );`;
}

function assertUnknownBarrier(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002020";
  const reserveSql = reservationInvocationSql(
    fixture.tenantBeta, fixture.agentBeta, "unknown-case", reservationId,
    "019f0000-0000-7000-8000-000000003020", "recall",
  );
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reserveSql)).outcome, "reserved");
  const mark = runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');
    SELECT public.portal_mark_provider_effect_unknown_service('${reservationId}', 'ambiguous_timeout');
  `));
  assertSucceeded(mark, "provider reservation unknown transition");
  const blocked = queryJson(databaseUrl, asRoleSql("service_role", null, reserveSql));
  assert.equal(blocked.outcome, "blocked_unknown");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id = '${reservationId}';`), "unknown");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_provider_effect_service('${reservationId}', 'provider_rejected');`)),
  "request-path release rejects any post-dispatch evidence");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_provider_effect_service('${reservationId}', 'not_dispatched');`)), "f",
  "pre-dispatch evidence cannot release an effect after the dispatch fence");
  const bypass = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantBeta, fixture.agentBeta, "unknown-case:retry:1", "019f0000-0000-7000-8000-000000002021", "019f0000-0000-7000-8000-000000003021", "recall",
  )));
  assert.equal(bypass.outcome, "blocked_unknown", "a new command id cannot bypass an unresolved logical effect");
  const reconcileSql = `SELECT public.portal_reconcile_provider_effect_service(
    '019f0000-0000-7000-8000-000000003022','${reservationId}','reconciliation_absent','recall_lookup_absent_0001'
  );`;
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, reconcileSql)), "t", "persisted reconciliation releases unknown");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, reconcileSql)), "t", "same reconciliation receipt replays successfully");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reconcile_provider_effect_service(
    '019f0000-0000-7000-8000-000000003023','${reservationId}','reconciliation_absent','recall_lookup_absent_0001'
  );`)), "conflicting reconciliation receipt is closed");
  const releasedReplay = queryJson(databaseUrl, asRoleSql("service_role", null, reserveSql));
  assert.equal(releasedReplay.state, "released");
  assert.equal(releasedReplay.retryGeneration, 1, "released replay exposes the exact derived-key generation");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_reconciliation_receipts WHERE reservation_id='${reservationId}';`), "1");

  const foreignReservationId = "019f0000-0000-7000-8000-000000002024";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantGamma, fixture.agentGamma, "receipt-ref-global-owner", foreignReservationId,
    "019f0000-0000-7000-8000-000000003024", "recall",
  ))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${foreignReservationId}');`)).acquired, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_unknown_service('${foreignReservationId}','ambiguous_timeout');`)), "t");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reconcile_provider_effect_service(
    '019f0000-0000-7000-8000-000000003025','${foreignReservationId}','reconciliation_absent','recall_lookup_absent_0001'
  );`)), "one provider reconciliation receipt reference cannot release a second tenant reservation");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${foreignReservationId}';`), "unknown",
  "provider receipt reuse conflicts without mutating the foreign reservation");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_reconciliation_receipts
    WHERE provider_receipt_ref='recall_lookup_absent_0001';`), "1");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_reconcile_provider_effect_service(
    '019f0000-0000-7000-8000-000000003026','${foreignReservationId}','reconciliation_absent','recall_lookup_absent_0002'
  );`)), "t", "a distinct provider receipt resolves the foreign reservation without weakening the global uniqueness fence");

  const retry = queryJson(databaseUrl, asRoleSql("service_role", null, reservationInvocationSql(
    fixture.tenantBeta, fixture.agentBeta, "unknown-case:retry:1", "019f0000-0000-7000-8000-000000002021", "019f0000-0000-7000-8000-000000003021", "recall",
  )));
  assert.equal(retry.outcome, "reserved", "the exact released generation suffix acquires a new reservation after reconciliation");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    "SELECT public.portal_release_provider_effect_service('019f0000-0000-7000-8000-000000002021','not_dispatched');")), "t", "request-path pre-dispatch release CAS succeeds only while reserved");
}

function assertFinalizeRollbackAndIdempotency(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002010";
  const costEventId = "019f0000-0000-7000-8000-000000002011";
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.tenant_subscriptions SET stripe_customer_id='cus_HarnessBeta',stripe_subscription_id='sub_HarnessBeta',
      plan_id='piloto',status='active',current_period_start=date_trunc('month',now()),current_period_end=date_trunc('month',now())+interval '1 month'
      WHERE tenant_id='${fixture.tenantBeta}';
    INSERT INTO public.cost_events (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at) VALUES
      ('${fixture.tenantBeta}','019f0000-0000-7000-8000-000000004102','tavus','overage.fixture','conversation',1,0,0,'estimated',now()),
      ('${fixture.tenantBeta}','019f0000-0000-7000-8000-000000004103','tavus','overage.fixture','conversation',1,0,0,'estimated',now()),
      ('${fixture.tenantBeta}','019f0000-0000-7000-8000-000000004104','tavus','overage.fixture','conversation',1,0,0,'estimated',now());
  `), "active Pilot fixture reaches the overage ordinal before finalize");
  const reserve = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantBeta, fixture.agentBeta, "finalize-case", reservationId, costEventId)));
  assert.equal(reserve.outcome, "reserved");
  assert.equal(reserve.billableOverage, false);
  assert.equal(reserve.customerDeliveryState, "held");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${"8".repeat(64)}');`)).acquired, true,
  "Tavus finalize fixture crosses the provider fence with a callback capability");

  assertSucceeded(runSql(databaseUrl, `ALTER TABLE public.cost_events
    ADD CONSTRAINT harness_reject_finalize_cost CHECK (service <> 'portal.video_conversation') NOT VALID;`), "temporary finalize failure injection");
  const invalidFinalize = runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_commit_provider_effect_service('${reservationId}', 'provider-ref-final', null, null);
  `));
  assertFailed(invalidFinalize, "cost ledger conflict rejects the entire commit transaction");
  assert.equal(queryScalar(databaseUrl, `SELECT state || ':' || coalesce(provider_ref, '') FROM public.provider_effect_reservations WHERE id = '${reservationId}';`), "provider_in_flight:");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.cost_events WHERE tenant_id='${fixture.tenantBeta}' AND id='${costEventId}';`), "0");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}';`), "0", "cost and billing outbox roll back atomically");
  assertSucceeded(runSql(databaseUrl, "ALTER TABLE public.cost_events DROP CONSTRAINT harness_reject_finalize_cost;"), "remove finalize failure injection");

  const finalized = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_commit_provider_effect_service('${reservationId}', 'provider-ref-final', null, null);
  `));
  assert.equal(finalized.committed, true);
  assert.equal(finalized.replayed, false);
  const replay = queryJson(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_commit_provider_effect_service('${reservationId}', 'provider-ref-final', null, null);
  `));
  assert.equal(replay.committed, true);
  assert.equal(replay.replayed, true);
  const beginAfterCommit = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantBeta, fixture.agentBeta, "finalize-case", "019f0000-0000-7000-8000-000000002012", "019f0000-0000-7000-8000-000000002013")));
  assert.equal(beginAfterCommit.reservationId, reservationId);
  assert.equal(beginAfterCommit.customerDeliveryState, "held", "crash recovery distinguishes provider commit from customer delivery");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.cost_events WHERE id = '${costEventId}';`), "1");
  assert.equal(queryScalar(databaseUrl, `SELECT customer_delivery_state FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "held");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}';`), "0", "commit records provider cost without charging before customer delivery");
  registerVideoTranscriptReceipt(databaseUrl, fixture.tenantBeta, fixture.agentBeta, reservationId, "provider-ref-final", "8".repeat(64));
  assertSucceeded(runSql(databaseUrl, `ALTER TABLE public.billing_usage_outbox
    ADD CONSTRAINT harness_reject_activation_outbox CHECK (meter_event_name <> 'axtro_conversation_overage') NOT VALID;`), "temporary activation outbox failure injection");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${reservationId}');`)), "outbox conflict rejects the entire activation transaction");
  assert.equal(queryScalar(databaseUrl, `SELECT customer_delivery_state || ':' || coalesce(stripe_customer_id,'') FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "held:");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}';`), "0");
  assertSucceeded(runSql(databaseUrl, "ALTER TABLE public.billing_usage_outbox DROP CONSTRAINT harness_reject_activation_outbox;"), "remove activation outbox failure injection");
  const activated = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${reservationId}');`));
  assert.deepEqual(activated, { activated: true, replayed: false, customerDeliveryState: "activated", billableOverage: true });
  const activationReplay = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${reservationId}');`));
  assert.deepEqual(activationReplay, { activated: true, replayed: true, customerDeliveryState: "activated", billableOverage: true });
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}' AND billing_period_start IS NOT NULL AND meter_event_name='axtro_conversation_overage';`), "1");
  assert.equal(queryScalar(databaseUrl, `SELECT id=cost_event_id AND id='${costEventId}'::app.uuid_v7 FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}';`), "t",
    "billing outbox reuses the application-generated one-to-one cost UUIDv7 identity");
}

function assertActivationBillingSnapshotRollover(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002150";
  createCommittedEffect(databaseUrl, fixture.tenantBeta, fixture.agentBeta, "billing-rollover", reservationId, "019f0000-0000-7000-8000-000000003150");
  assert.equal(queryScalar(databaseUrl, `SELECT billing_period_start IS NULL AND stripe_customer_id IS NULL FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "t",
    "begin does not poison delivery with a pre-activation billing snapshot");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.tenant_subscriptions SET plan_id='crescimento',stripe_customer_id='cus_HarnessBetaNew',
    current_period_start=date_trunc('day',now()),current_period_end=date_trunc('day',now())+interval '1 month' WHERE tenant_id='${fixture.tenantBeta}';`), "subscription rollover fixture");
  const receipt = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${reservationId}');`));
  assert.equal(receipt.activated, true);
  assert.equal(queryScalar(databaseUrl, `SELECT stripe_customer_id||':'||included_quantity::text FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "cus_HarnessBetaNew:30");
  assert.equal(queryScalar(databaseUrl, `SELECT customer_activated_at=customer_delivery_receipt_at AND meter_event_at=customer_activated_at FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "t");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.tenant_subscriptions SET plan_id='piloto',stripe_customer_id='cus_HarnessBeta',
    current_period_start=date_trunc('month',now()),current_period_end=date_trunc('month',now())+interval '1 month' WHERE tenant_id='${fixture.tenantBeta}';`), "restore Pilot subscription fixture");
}

function assertBillingUsageLifecycle(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002010";
  const firstToken = "019f0000-0000-7000-8000-000000005001";
  const secondToken = "019f0000-0000-7000-8000-000000005002";
  const thirdToken = "019f0000-0000-7000-8000-000000005003";
  const leased = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_lease_billing_usage_service('${firstToken}',20,60);`));
  assert.equal(leased.length, 1);
  assert.equal(leased[0].reservationId, reservationId);
  assert.equal(leased[0].eventName, "axtro_conversation_overage");
  assert.equal(typeof leased[0].billingPeriodStart, "string");
  assert.equal(typeof leased[0].billingPeriodEnd, "string");
  assert.equal(typeof leased[0].meterEventAt, "string");

  assertSucceeded(runSql(databaseUrl, `UPDATE public.billing_usage_outbox SET lease_until=now()-interval '1 second' WHERE reservation_id='${reservationId}';`), "expire first billing lease deterministically");
  const reclaimed = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_lease_billing_usage_service('${secondToken}',20,60);`));
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].attempts, 2);
  const outboxId = reclaimed[0].id;
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_ack_billing_usage_service('${outboxId}','${firstToken}');`)), "f", "stale lease token cannot ack");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_fail_billing_usage_service('${outboxId}','${firstToken}','stale',5,false);`)), "f", "stale lease token cannot fail");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_fail_billing_usage_service('${outboxId}','${secondToken}','stripe_503',5,false);`)), "t");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.billing_usage_outbox SET available_at=now() WHERE id='${outboxId}';`), "advance retry availability deterministically");
  const terminalLease = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_lease_billing_usage_service('${thirdToken}',20,60);`));
  assert.equal(terminalLease.length, 1);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_fail_billing_usage_service('${outboxId}','${thirdToken}','invalid_meter',5,true);`)), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT status FROM public.billing_usage_outbox WHERE id='${outboxId}';`), "dead_letter");

  const voidReservation = createCommittedOverageEffect(databaseUrl, "void-case", "019f0000-0000-7000-8000-000000002040", "019f0000-0000-7000-8000-000000003040");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_void_unleased_billing_usage_service('${voidReservation}','post_provider_delivery_failure');`)), "t");
  assert.equal(queryScalar(databaseUrl, `SELECT customer_delivery_state FROM public.provider_effect_reservations WHERE id='${voidReservation}';`), "voided");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${voidReservation}';`), "0", "void before activation cannot create a charge");
  const voidActivation = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${voidReservation}');`));
  assert.deepEqual(voidActivation, { activated: false, replayed: true, customerDeliveryState: "voided", billableOverage: false });
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_void_unleased_billing_usage_service('${voidReservation}','post_provider_delivery_failure');`)), "t", "void receipt is idempotently resolved");

  const ackReservation = createCommittedOverageEffect(databaseUrl, "ack-case", "019f0000-0000-7000-8000-000000002041", "019f0000-0000-7000-8000-000000003041");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${ackReservation}');`)).activated, true);
  const ackToken = "019f0000-0000-7000-8000-000000005004";
  const ackLease = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_lease_billing_usage_service('${ackToken}',20,60);`));
  assert.equal(ackLease.length, 1);
  assert.equal(ackLease[0].reservationId, ackReservation);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_void_unleased_billing_usage_service('${ackReservation}','too_late');`)), "f", "a leased usage unit cannot be voided");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_ack_billing_usage_service('${ackLease[0].id}','${ackToken}');`)), "t");
  const backlog = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_billing_usage_backlog_service();"));
  assert.equal(backlog.pending, 0);
  assert.equal(backlog.deadLetter, 1);
  assert.equal(backlog.oldestAgeSeconds, 0);
  assert.equal(backlog.held, 0);
  assert.equal(backlog.oldestHeldAgeSeconds, 0);
}

function createCommittedOverageEffect(databaseUrl, idempotencyKey, reservationId, costEventId) {
  const reserve = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantBeta, fixture.agentBeta, idempotencyKey, reservationId, costEventId)));
  assert.equal(reserve.outcome, "reserved");
  assert.equal(reserve.billableOverage, false);
  assert.equal(reserve.customerDeliveryState, "held");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${"9".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','provider-${idempotencyKey}',null,null);`)).committed, true);
  registerVideoTranscriptReceipt(databaseUrl, fixture.tenantBeta, fixture.agentBeta, reservationId, `provider-${idempotencyKey}`, "9".repeat(64));
  return reservationId;
}

async function assertConcurrentActivationOrdinal(databaseUrl) {
  assertSucceeded(runSql(databaseUrl, `
    UPDATE public.tenant_subscriptions SET stripe_customer_id='cus_HarnessGamma',stripe_subscription_id='sub_HarnessGamma',
      plan_id='piloto',status='active',current_period_start=date_trunc('month',now()),current_period_end=date_trunc('month',now())+interval '1 month'
      WHERE tenant_id='${fixture.tenantGamma}';
    ${Array.from({ length: 6 }, (_, index) => `INSERT INTO public.cost_events (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
      VALUES ('${fixture.tenantGamma}','019f0000-0000-7000-8000-${String(4201 + index).padStart(12, "0")}','tavus','activation.ordinal.fixture','conversation',1,0,0,'estimated',now());`).join("\n")}
  `), "activation ordinal fixtures");
  const firstReservation = "019f0000-0000-7000-8000-000000002200";
  const secondReservation = "019f0000-0000-7000-8000-000000002201";
  createCommittedEffect(databaseUrl, fixture.tenantGamma, fixture.agentGamma, "activation-parallel-a", firstReservation, "019f0000-0000-7000-8000-000000003200");
  createCommittedEffect(databaseUrl, fixture.tenantGamma, fixture.agentGamma, "activation-parallel-b", secondReservation, "019f0000-0000-7000-8000-000000003201");
  const backlogBefore = queryJson(databaseUrl, asRoleSql("service_role", null, "SELECT public.portal_billing_usage_backlog_service();"));
  assert.equal(backlogBefore.held, 2, "committed delivery gaps remain observable before activation");
  const [first, second] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_activate_provider_effect_billing_service('${firstReservation}');`)),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_activate_provider_effect_billing_service('${secondReservation}');`)),
  ]);
  assertSucceeded(first, "first concurrent billing activation");
  assertSucceeded(second, "second concurrent billing activation");
  const receipts = [parseLastJson(first.stdout), parseLastJson(second.stdout)];
  assert.deepEqual(receipts.map((row) => row.billableOverage).sort(), [false, true], "tenant serialization assigns the exact Pilot threshold ordinal");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE tenant_id='${fixture.tenantGamma}';`), "1", "two threshold activations produce exactly one overage unit");
}

async function assertTerminalActivationRace(databaseUrl) {
  const recallReservationId = "019f0000-0000-7000-8000-000000002250";
  const tavusReservationId = "019f0000-0000-7000-8000-000000002251";
  const botId = "10000000-0000-4000-8000-000000002250";
  const conversationId = "conversation-terminal-race-2250";
  const deliveryId = "webhook-terminal-before-session-2250";
  const deliveryDigest = "d".repeat(64);
  const deliveryToken = "019f0000-0000-7000-8000-000000006250";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantGamma, fixture.agentGamma, "terminal-recall-race", recallReservationId, "019f0000-0000-7000-8000-000000003250", "recall"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantGamma, fixture.agentGamma, "terminal-tavus-race", tavusReservationId, "019f0000-0000-7000-8000-000000003251", "tavus"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${recallReservationId}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${tavusReservationId}','${"c".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${recallReservationId}','${botId}',null,null);`)).committed, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${tavusReservationId}','${conversationId}','https://tavus.daily.co/terminal-race',null);`)).committed, true);
  const effectStateBeforeInvalidClaims = queryScalar(databaseUrl,
    `SELECT string_agg(id::text||':'||state,',' order by id) FROM public.provider_effect_reservations WHERE id in ('${recallReservationId}','${tavusReservationId}');`);
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended');`)),
  "terminal transition rejects missing delivery evidence");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended','${deliveryId}',null);`)),
  "terminal transition rejects partial delivery evidence");

  const expiredDeliveryId = "webhook-terminal-expired-2250";
  const expiredToken = "019f0000-0000-7000-8000-000000006251";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${expiredDeliveryId}','${deliveryDigest}','${expiredToken}');`)).outcome, "claimed");
  assertSucceeded(runSql(databaseUrl,
    `UPDATE public.recall_webhook_deliveries SET lease_until=now()-interval '1 second' WHERE delivery_id='${expiredDeliveryId}';`),
  "expire terminal delivery claim");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended','${expiredDeliveryId}','${expiredToken}');`)),
  "terminal transition rejects an expired claim");
  assert.equal(queryScalar(databaseUrl,
    `SELECT provider_bot_id is null FROM public.recall_webhook_deliveries WHERE delivery_id='${expiredDeliveryId}';`), "t");

  const completedDeliveryId = "webhook-terminal-completed-2250";
  const completedToken = "019f0000-0000-7000-8000-000000006252";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${completedDeliveryId}','${deliveryDigest}','${completedToken}');`)).outcome, "claimed");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_recall_webhook_service('${completedDeliveryId}','${completedToken}');`)), "t");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended','${completedDeliveryId}','${completedToken}');`)),
  "terminal transition rejects an already completed claim");
  assert.equal(queryScalar(databaseUrl,
    `SELECT provider_bot_id is null FROM public.recall_webhook_deliveries WHERE delivery_id='${completedDeliveryId}';`), "t");

  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${deliveryId}','${deliveryDigest}','${deliveryToken}');`)).outcome, "claimed");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended','${deliveryId}','019f0000-0000-7000-8000-000000006259');`)),
  "terminal transition rejects a wrong claim token");
  assert.equal(queryScalar(databaseUrl,
    `SELECT provider_bot_id is null FROM public.recall_webhook_deliveries WHERE delivery_id='${deliveryId}';`), "t");
  assert.equal(queryScalar(databaseUrl,
    `SELECT string_agg(id::text||':'||state,',' order by id) FROM public.provider_effect_reservations WHERE id in ('${recallReservationId}','${tavusReservationId}');`),
  effectStateBeforeInvalidClaims, "invalid terminal claims roll back every provider-effect mutation");

  const [terminal, registration] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended','${deliveryId}','${deliveryToken}');`)),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_record_meeting_bot_session_service(
      '019f0000-0000-7000-8000-000000001250','${fixture.tenantGamma}','${fixture.agentGamma}','${botId}','meeting:${"a".repeat(64)}','${conversationId}','${recallReservationId}','${tavusReservationId}'
    );`)),
  ]);
  assertSucceeded(terminal, "signed terminal receipt contender");
  assertSucceeded(registration, "meeting session registration contender");
  assert.equal(queryScalar(databaseUrl, `SELECT status||':'||sentinel_camera_state||':'||(sentinel_camera_started_at is null)::text FROM public.meeting_bot_sessions WHERE recall_bot_id='${botId}';`), "ended:conversation_created:true");
  assert.equal(queryScalar(databaseUrl, `SELECT state||':'||customer_delivery_state FROM public.provider_effect_reservations WHERE id='${recallReservationId}';`), "completed:voided");
  assert.equal(queryScalar(databaseUrl, `SELECT state||':'||customer_delivery_state FROM public.provider_effect_reservations WHERE id='${tavusReservationId}';`), "cleanup_pending:voided");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${recallReservationId}');`)).activated, false);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${tavusReservationId}');`)).activated, false);
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id in ('${recallReservationId}','${tavusReservationId}');`), "0");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.cost_events WHERE id in ('019f0000-0000-7000-8000-000000003250','019f0000-0000-7000-8000-000000003251');`), "2", "terminal void preserves provider cost evidence");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_recall_webhook_service('${deliveryId}','${deliveryToken}');`)), "t");

  const foreignDeliveryId = "webhook-terminal-foreign-2250";
  const foreignToken = "019f0000-0000-7000-8000-000000006253";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${foreignDeliveryId}','${deliveryDigest}','${foreignToken}');`)).outcome, "claimed");
  assertSucceeded(runSql(databaseUrl,
    `UPDATE public.recall_webhook_deliveries SET tenant_id='${fixture.tenantAlpha}' WHERE delivery_id='${foreignDeliveryId}';`),
  "cross-tenant terminal claim fixture");
  const sessionStateBeforeForeignClaim = queryScalar(databaseUrl,
    `SELECT status||':'||sentinel_camera_state FROM public.meeting_bot_sessions WHERE recall_bot_id='${botId}';`);
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_update_meeting_bot_session_status_service('${botId}','ended','${foreignDeliveryId}','${foreignToken}');`)),
  "terminal transition rejects a delivery claimed by another tenant");
  assert.equal(queryScalar(databaseUrl,
    `SELECT status||':'||sentinel_camera_state FROM public.meeting_bot_sessions WHERE recall_bot_id='${botId}';`),
  sessionStateBeforeForeignClaim, "cross-tenant terminal claim cannot mutate the meeting session");

  const exactReplay = queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_record_meeting_bot_session_service(
    '019f0000-0000-7000-8000-000000001250','${fixture.tenantGamma}','${fixture.agentGamma}','${botId}','meeting:${"a".repeat(64)}','${conversationId}','${recallReservationId}','${tavusReservationId}'
  );`));
  assert.equal(exactReplay.replayed, true, "exact meeting receipt replays after terminal lifecycle progression");
  assert.equal(exactReplay.terminal, true);
  const stateBeforeConflict = queryScalar(databaseUrl, `SELECT status||':'||sentinel_camera_state FROM public.meeting_bot_sessions WHERE recall_bot_id='${botId}';`);
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_record_meeting_bot_session_service(
    '019f0000-0000-7000-8000-000000001251','${fixture.tenantGamma}','${fixture.agentGamma}','${botId}','meeting:${"a".repeat(64)}','${conversationId}','${recallReservationId}','${tavusReservationId}'
  );`)), "post-terminal replay rejects an altered immutable session id");
  assert.equal(queryScalar(databaseUrl, `SELECT status||':'||sentinel_camera_state FROM public.meeting_bot_sessions WHERE recall_bot_id='${botId}';`), stateBeforeConflict,
    "post-terminal replay conflict cannot mutate the durable session");
}

function createCommittedEffect(databaseUrl, tenantId, agentId, idempotencyKey, reservationId, costEventId) {
  const reserve = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(tenantId, agentId, idempotencyKey, reservationId, costEventId)));
  assert.equal(reserve.outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${"9".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','provider-${idempotencyKey}',null,null);`)).committed, true);
  registerVideoTranscriptReceipt(databaseUrl, tenantId, agentId, reservationId, `provider-${idempotencyKey}`, "9".repeat(64));
}

function registerVideoTranscriptReceipt(databaseUrl, tenantId, agentId, transcriptId, providerRef, capabilityHash) {
  const observedAt = new Date().toISOString();
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_register_provider_transcript_service('${transcriptId}','${tenantId}','${agentId}','video','${providerRef}');`)),
  "durable video transcript placeholder");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_claim_tavus_webhook_service(
    '${transcriptId}','${providerRef}','${capabilityHash}',
    '${"d".repeat(64)}','${transcriptId}','${observedAt}'::timestamptz
  );`)).outcome, "claimed", "the customer-delivery fixture acquires the real callback lease");
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_append_transcript_turns_service('video','${providerRef}','[{"role":"user","content":"human participant spoke"}]'::jsonb,now());
    SELECT public.portal_record_tavus_customer_delivery_service('${transcriptId}','${providerRef}','${"d".repeat(64)}','application.transcription_ready','${observedAt}'::timestamptz);
  `)), "durable video transcript customer-delivery receipt");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_tavus_webhook_service('${transcriptId}','${"d".repeat(64)}','${transcriptId}');`)), "t",
  "the customer-delivery callback completes and revokes its bearer");
}

function assertRecallWebhookLeaseFencing(databaseUrl) {
  const deliveryId = "webhook-delivery-fence-0001";
  const digest = "a".repeat(64);
  const conflictingDigest = "b".repeat(64);
  const firstToken = "019f0000-0000-7000-8000-000000006001";
  const secondToken = "019f0000-0000-7000-8000-000000006002";
  const claim = (token, selectedDigest = digest) => queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${deliveryId}','${selectedDigest}','${token}');`));
  assert.equal(claim(firstToken).outcome, "claimed");
  assert.equal(claim(secondToken).outcome, "busy");
  assert.equal(claim(secondToken, conflictingDigest).outcome, "conflict", "digest conflict remains closed during processing");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.recall_webhook_deliveries SET lease_until=now()-interval '1 second' WHERE delivery_id='${deliveryId}';`), "expire webhook claim deterministically");
  assert.equal(claim(secondToken).outcome, "claimed", "same digest reclaims an expired processing lease");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_recall_webhook_service('${deliveryId}','${firstToken}');`)), "f", "stale webhook token cannot complete");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_recall_webhook_service('${deliveryId}','${digest}','${firstToken}');`)), "f", "stale webhook token cannot release");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_recall_webhook_service('${deliveryId}','${secondToken}');`)), "t");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_recall_webhook_service('${deliveryId}','${secondToken}');`)), "f", "completion receipt is a strict CAS boolean");
  assert.equal(claim(firstToken).outcome, "replayed");
  assert.equal(claim(firstToken, conflictingDigest).outcome, "conflict", "digest conflict remains closed after completion");

  const releaseDelivery = "webhook-delivery-release-0002";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${releaseDelivery}','${digest}','${firstToken}');`)).outcome, "claimed");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_recall_webhook_service('${releaseDelivery}','${digest}','${firstToken}');`)), "t");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_claim_recall_webhook_service('${releaseDelivery}','${digest}','${secondToken}');`)).outcome, "claimed", "released webhook work is recoverable without deleting replay evidence");
}

async function assertTavusWebhookCapabilityFencing(databaseUrl) {
  assertSucceeded(runSql(databaseUrl, `
    INSERT INTO public.tenant_subscriptions
      (id,tenant_id,stripe_customer_id,stripe_subscription_id,plan_id,status,current_period_start,current_period_end)
    VALUES ('019f0000-0000-7000-8000-000000004300','${fixture.tenantDelta}','cus_HarnessDelta','sub_HarnessDelta','escala','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
  `), "Tavus webhook capability subscription fixture");
  const reservationId = "019f0000-0000-7000-8000-000000002300";
  const costEventId = "019f0000-0000-7000-8000-000000003300";
  const reserve = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantDelta, fixture.agentDelta, "tavus-bind-race", reservationId, costEventId)));
  assert.equal(reserve.outcome, "reserved");
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const [first, second] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${hashA}');`)),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${hashB}');`)),
  ]);
  assertSucceeded(first, "first Tavus webhook bind contender");
  assertSucceeded(second, "second Tavus webhook bind contender");
  assert.deepEqual([parseLastJson(first.stdout).acquired, parseLastJson(second.stdout).acquired].sort(), [false, true]);
  const winningBind = [parseLastJson(first.stdout), parseLastJson(second.stdout)].find((receipt) => receipt.acquired === true);
  assert.equal(typeof winningBind.capabilityExpiresAt, "string");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "provider_in_flight");
  assert.equal(queryScalar(databaseUrl, `SELECT tavus_webhook_capability_expires_at=provider_dispatched_at+make_interval(secs=>max_duration_seconds+900)
    FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "t",
  "the callback capability expires at the server-owned duration plus the fixed retry margin");
  const winnerHash = queryScalar(databaseUrl, `SELECT tavus_webhook_capability_hash FROM public.provider_effect_reservations WHERE id='${reservationId}';`);
  assert.ok(winnerHash === hashA || winnerHash === hashB);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${"c".repeat(64)}');`)).acquired, false,
  "a crash after bind remains fenced and cannot rebind");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_provider_effect_in_flight_service('${reservationId}');`)).acquired, false,
  "generic acquire cannot bypass the Tavus capability fence");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${reservationId}','${"0".repeat(64)}');`)).outcome, "unauthorized");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.provider_effect_reservations
    SET provider_dispatched_at=now()-interval '25 minutes',tavus_webhook_capability_expires_at=now(),updated_at=now()
    WHERE id='${reservationId}';`), "expire the Tavus capability while preserving its duration invariant");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${reservationId}','${winnerHash}');`)).outcome, "unauthorized",
  "an expired callback capability cannot authorize provider-controlled bytes");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_reconcile_provider_effect_service(
      '019f0000-0000-7000-8000-000000006301','${reservationId}','reconciliation_absent','tavus_test_no_dispatch_2300'
    );
  `)), "t", "the capability-fence fixture is closed with explicit provider-absence evidence");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${reservationId}','${winnerHash}');`)).outcome, "unauthorized",
  "provider absence reconciliation revokes the callback capability");
}

function assertTavusDeliveryAndStageCapabilities(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002320";
  const costEventId = "019f0000-0000-7000-8000-000000003320";
  const providerRef = "provider-tavus-delivery-stage";
  const reserve = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantDelta, fixture.agentDelta, "tavus-delivery-stage", reservationId, costEventId)));
  assert.equal(reserve.outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${reservationId}','${"e".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${reservationId}','${providerRef}','https://tavus.daily.co/private-stage-room',null);`)).committed, true);
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_register_provider_transcript_service('${reservationId}','${fixture.tenantDelta}','${fixture.agentDelta}','video','${providerRef}');
  `)), "Tavus held transcript placeholder");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${reservationId}','${"e".repeat(64)}');`)).outcome, "authorized");
  const lowerBoundObservedAt = queryScalar(databaseUrl,
    `SELECT (provider_dispatched_at-interval '5 minutes 1 second')::text FROM public.provider_effect_reservations WHERE id='${reservationId}';`);
  const afterExpiryObservedAt = queryScalar(databaseUrl,
    `SELECT (tavus_webhook_capability_expires_at+interval '1 second')::text FROM public.provider_effect_reservations WHERE id='${reservationId}';`);
  for (const [suffix, observedAt] of [["1", lowerBoundObservedAt], ["2", new Date(Date.now() + 301_000).toISOString()], ["3", afterExpiryObservedAt]]) {
    assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_claim_tavus_webhook_service(
      '${reservationId}','${providerRef}','${"e".repeat(64)}','${suffix.repeat(64)}','019f0000-0000-7000-8000-00000000632${suffix}','${sqlLiteral(observedAt)}'::timestamptz
    );`)).outcome, "unauthorized", "out-of-window provider evidence is rejected before durable mutation");
  }
  assert.equal(queryScalar(databaseUrl,
    `SELECT count(*) FROM public.tavus_webhook_deliveries WHERE reservation_id='${reservationId}';`), "0");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${reservationId}');`)),
  "placeholder alone never proves Tavus customer delivery");
  assert.equal(queryScalar(databaseUrl, `SELECT customer_delivery_state FROM public.provider_effect_reservations WHERE id='${reservationId}';`), "held");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}';`), "0");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_record_tavus_no_delivery_service('${reservationId}','${providerRef}','${"0".repeat(64)}','transcript_without_user_turn',now());`)),
  "an in-progress placeholder cannot be forged into final no-delivery evidence");

  const noDeliveryObservedAt = new Date().toISOString();
  const noDeliveryDigest = "f".repeat(64);
  const firstNoDeliveryClaim = "019f0000-0000-7000-8000-000000006324";
  const secondNoDeliveryClaim = "019f0000-0000-7000-8000-000000006325";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_claim_tavus_webhook_service(
    '${reservationId}','${providerRef}','${"e".repeat(64)}','${noDeliveryDigest}','${firstNoDeliveryClaim}','${noDeliveryObservedAt}'::timestamptz
  );`)).outcome, "claimed");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_tavus_webhook_service('${reservationId}','${noDeliveryDigest}','${firstNoDeliveryClaim}');`)), "t");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${reservationId}','${"e".repeat(64)}');`)).outcome, "authorized",
  "a retryable processing release preserves the callback capability");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_claim_tavus_webhook_service(
    '${reservationId}','${providerRef}','${"e".repeat(64)}','${noDeliveryDigest}','${secondNoDeliveryClaim}','${noDeliveryObservedAt}'::timestamptz
  );`)).outcome, "claimed");

  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_append_transcript_turns_service('video','${providerRef}','[{"role":"assistant","content":"greeting only"}]'::jsonb,now());
  `)), "assistant-only final transcript");
  const noDelivery = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_record_tavus_no_delivery_service('${reservationId}','${providerRef}','${noDeliveryDigest}','transcript_without_user_turn','${noDeliveryObservedAt}'::timestamptz);`));
  assert.deepEqual(noDelivery, { voided: true, replayed: false, customerDeliveryState: "voided" });
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_tavus_webhook_service('${reservationId}','${noDeliveryDigest}','${secondNoDeliveryClaim}');`)), "t");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${reservationId}','${"e".repeat(64)}');`)).outcome, "replayed_terminal");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.billing_usage_outbox WHERE reservation_id='${reservationId}';`), "0");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.tavus_customer_delivery_receipts SET observed_at=now()-interval '8 days' WHERE reservation_id='${reservationId}';`),
    "age the durable no-delivery receipt past the first-observation freshness window");
  const persistedNoDeliveryObservedAt = queryScalar(databaseUrl,
    `SELECT observed_at::text FROM public.tavus_customer_delivery_receipts WHERE reservation_id='${reservationId}';`);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_record_tavus_no_delivery_service(
    '${reservationId}','${providerRef}','${noDeliveryDigest}','transcript_without_user_turn',
    '${sqlLiteral(persistedNoDeliveryObservedAt)}'::timestamptz
  );`)).replayed, true, "an exact durable no-delivery receipt replays indefinitely");

  const deliveredId = "019f0000-0000-7000-8000-000000002321";
  const deliveredRef = "provider-tavus-human-delivered";
  const delivered = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantDelta, fixture.agentDelta, "tavus-human-delivered", deliveredId, "019f0000-0000-7000-8000-000000003321")));
  assert.equal(delivered.outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_bind_tavus_webhook_capability_service('${deliveredId}','${"1".repeat(64)}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_provider_effect_service('${deliveredId}','${deliveredRef}','https://tavus.daily.co/private-human-room',null);`)).committed, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${deliveredId}','${"1".repeat(64)}');`)).outcome, "authorized");
  const webhookClaimToken = "019f0000-0000-7000-8000-000000006321";
  const webhookObservedAt = new Date().toISOString();
  const webhookDigest = "6".repeat(64);
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_register_provider_transcript_service('${deliveredId}','${fixture.tenantDelta}','${fixture.agentDelta}','video','${deliveredRef}');
  `)), "Tavus human transcript placeholder");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_claim_tavus_webhook_service(
    '${deliveredId}','${deliveredRef}','${"1".repeat(64)}','${webhookDigest}','${webhookClaimToken}','${webhookObservedAt}'::timestamptz
  );`)).outcome, "claimed");
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_append_transcript_turns_service('video','${deliveredRef}','[{"role":"user","content":"human participant spoke"}]'::jsonb,now());
    SELECT public.portal_record_tavus_customer_delivery_service('${deliveredId}','${deliveredRef}','${webhookDigest}','application.transcription_ready','${webhookObservedAt}'::timestamptz);
  `)), "durable Tavus human delivery receipt");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_complete_tavus_webhook_service('${deliveredId}','${webhookDigest}','${webhookClaimToken}');`)), "t");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_preflight_tavus_webhook_service('${deliveredId}','${"1".repeat(64)}');`)).outcome, "replayed_terminal",
  "a completed callback narrows the matching bearer to a body-free terminal acknowledgement");
  assert.equal(queryScalar(databaseUrl,
    `SELECT tavus_webhook_capability_revoked_at IS NOT NULL FROM public.provider_effect_reservations WHERE id='${deliveredId}';`), "t",
  "terminal completion durably revokes all non-terminal callback authority");
  assertSucceeded(runSql(databaseUrl, `UPDATE public.tavus_customer_delivery_receipts SET observed_at=now()-interval '8 days' WHERE reservation_id='${deliveredId}';`),
    "age the durable customer-delivery receipt past the first-observation freshness window");
  const deliveredObservedAt = queryScalar(databaseUrl,
    `SELECT observed_at::text FROM public.tavus_customer_delivery_receipts WHERE reservation_id='${deliveredId}';`);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_record_tavus_customer_delivery_service(
    '${deliveredId}','${deliveredRef}','${webhookDigest}','application.transcription_ready',
    '${sqlLiteral(deliveredObservedAt)}'::timestamptz
  );`)).replayed, true, "an exact durable customer-delivery receipt replays indefinitely");
  const activation = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${deliveredId}');`));
  assert.equal(activation.activated, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_activate_provider_effect_billing_service('${deliveredId}');`)).replayed, true,
  "first authenticated Tavus human receipt activates exactly once");

  const roomUrl = "https://tavus.daily.co/private-human-room";
  const firstHash = "2".repeat(64);
  const rotatedHash = "3".repeat(64);
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_create_tavus_stage_capability_service('${fixture.tenantBeta}','${fixture.agentBeta}','${deliveredId}','${firstHash}','${roomUrl}');`)),
  "cross-tenant stage capability creation is rejected");
  const created = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_create_tavus_stage_capability_service('${fixture.tenantDelta}','${fixture.agentDelta}','${deliveredId}','${firstHash}','${roomUrl}');`));
  assert.equal(created.created, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${"4".repeat(64)}');`)).found, false,
  "a foreign capability hash cannot resolve another tenant room");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${firstHash}');`)).roomUrl, roomUrl);
  const rotated = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_create_tavus_stage_capability_service('${fixture.tenantDelta}','${fixture.agentDelta}','${deliveredId}','${rotatedHash}','${roomUrl}');`));
  assert.equal(rotated.rotated, true, "lost raw capability can be replaced after process death");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${firstHash}');`)).found, false,
  "rotation invalidates the previously exposed capability");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${rotatedHash}');`)).found, true);
  assertSucceeded(runSql(databaseUrl, `UPDATE public.tavus_stage_capabilities SET expires_at=now()-interval '1 second' WHERE reservation_id='${deliveredId}';`), "expire stage capability deterministically");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_resolve_tavus_stage_capability_service('${rotatedHash}');`)).found, false,
  "expired stage capability is fail-closed");
}

function assertProviderReconciliationLease(databaseUrl) {
  const reservationId = "019f0000-0000-7000-8000-000000002020";
  // Existing unknown-barrier fixture was released; create a fresh durable
  // unknown row and lease only the worker, never the provider-effect state.
  const target = "019f0000-0000-7000-8000-000000002310";
  const reserve = queryJson(databaseUrl, asRoleSql("service_role", null,
    reservationInvocationSql(fixture.tenantGamma, fixture.agentGamma, "reconcile-lease", target, "019f0000-0000-7000-8000-000000003310", "recall")));
  assert.equal(reserve.outcome, "reserved");
  assertSucceeded(runSql(databaseUrl, asRoleSql("service_role", null, `
    SELECT public.portal_mark_provider_effect_in_flight_service('${target}');
    SELECT public.portal_mark_provider_effect_unknown_service('${target}','timeout');
  `)), "unknown reconciliation fixture");
  const token = "019f0000-0000-7000-8000-000000006100";
  const leased = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_lease_provider_effect_reconciliation_service('${token}',20,60);`));
  const row = leased.find((candidate) => candidate.reservationId === target);
  assert.ok(row);
  assert.equal(row.state, "unknown");
  assert.equal(row.leaseToken, token);
  assert.equal(typeof row.nextAttemptAt, "string");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${target}';`), "unknown",
    "worker lease never releases the financial barrier");
  const receipt = "019f0000-0000-7000-8000-000000006101";
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_ack_provider_effect_reconciliation_service('${target}','${token}','${receipt}','reconciliation_absent','recall_lookup_absent_310');`)), "t");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_ack_provider_effect_reconciliation_service('${target}','${token}','${receipt}','reconciliation_absent','recall_lookup_absent_310');`)), "t",
    "ack ambiguity replays the exact durable receipt after the lease is cleared");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.provider_effect_reservations WHERE id='${target}';`), "released");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.provider_effect_reconciliation_receipts WHERE reservation_id='${target}';`), "1");
  assert.equal(reservationId.length, target.length);
}

async function assertAiUsageConcurrencyCap(databaseUrl) {
  const aiMutationNames = [
    "portal_begin_ai_usage_reservation",
    "portal_mark_ai_usage_in_flight",
    "portal_commit_ai_usage",
    "portal_mark_ai_usage_unknown",
    "portal_release_ai_usage",
  ];
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (${aiMutationNames.map((name) => `'${name}'`).join(",")});`), "0",
  "there are no browser-authenticated AI ledger wrappers to call");

  const rowsBeforeAttack = queryScalar(databaseUrl, "SELECT count(*) FROM public.ai_usage_reservations;");
  const costsBeforeAttack = queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events WHERE provider_id='openrouter';");
  assertFailed(runSql(databaseUrl, asRoleSql("authenticated", fixture.userAlpha, `SELECT public.portal_begin_ai_usage_reservation_service(
    '019f0000-0000-7000-8000-000000002890','019f0000-0000-7000-8000-000000003890','${fixture.tenantAlpha}','${fixture.agentAlpha}',null,
    'ai-auth-forged-envelope','chat_generation',2000000,2000000,10
  );`)), "authenticated caller cannot forge an AI token/cost envelope through the service RPC");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.ai_usage_reservations;"), rowsBeforeAttack,
    "denied authenticated AI mutation writes zero reservation rows");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events WHERE provider_id='openrouter';"), costsBeforeAttack,
    "denied authenticated AI mutation writes zero cost rows");

  const aiReservationsBeforeInvalidUuid = queryScalar(databaseUrl, "SELECT count(*) FROM public.ai_usage_reservations;");
  const aiCostsBeforeInvalidUuid = queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events;");
  for (const [label, reservationId, costEventId] of [
    ["reservation id", "11111111-1111-4111-8111-111111111111", "019f0000-0000-7000-8000-000000003942"],
    ["cost event id", "019f0000-0000-7000-8000-000000002942", "11111111-1111-4111-8111-111111111111"],
  ]) {
    assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
      '${reservationId}','${costEventId}','${fixture.tenantAlpha}','${fixture.agentAlpha}',null,
      'ai-invalid-uuid-${label}','chat_generation',20000,512,0.05
    );`)), `AI reservation rejects UUIDv4 ${label}`);
  }
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.ai_usage_reservations;"), aiReservationsBeforeInvalidUuid,
    "UUIDv4 AI reservation inputs write zero reservation rows");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events;"), aiCostsBeforeInvalidUuid,
    "UUIDv4 AI reservation inputs write zero cost rows");

  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
    '019f0000-0000-7000-8000-000000002891','019f0000-0000-7000-8000-000000003891','${fixture.tenantAlpha}','${fixture.agentBeta}',null,
    'ai-cross-tenant-agent','chat_generation',20000,512,0.05
  );`)), "service boundary rejects an agent from another tenant");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.ai_usage_reservations WHERE id='019f0000-0000-7000-8000-000000002891';"), "0",
    "cross-tenant rejection writes no reservation");

  const usageMissingReservation = "019f0000-0000-7000-8000-000000002889";
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null, `SELECT public.portal_begin_ai_usage_reservation_service(
    '${usageMissingReservation}','019f0000-0000-7000-8000-000000003889','${fixture.tenantEpsilon}','${fixture.agentEpsilon}',null,
    'ai-missing-provider-usage','brain_generation',20000,512,0.05
  );`)).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${usageMissingReservation}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${usageMissingReservation}',0,0,null);`)).committed, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${usageMissingReservation}',0,0,null);`)).replayed, true,
  "the same missing-usage tuple replays after worst-case normalization");
  assert.equal(queryScalar(databaseUrl, "SELECT quantity::bigint::text||':'||source FROM public.cost_events WHERE id='019f0000-0000-7000-8000-000000003889';"),
    "20512:estimated", "missing provider usage commits the reserved worst-case envelope instead of zero spend");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events WHERE id='019f0000-0000-7000-8000-000000003889';"), "1");

  // A committed reservation must consume ACTUAL tokens, not retain its max
  // envelope. 458k + 100 actual + two exact 20,512-token envelopes remains
  // under 500k; retaining the first max envelope would reject the third begin.
  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.cost_events
    (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
    VALUES ('${fixture.tenantBeta}','019f0000-0000-7000-8000-000000004890','openrouter','ai.actual-cap.fixture','token',458000,0,0,'estimated',now());`),
  "AI actual-token capacity fixture");
  const actualReservation = "019f0000-0000-7000-8000-000000002892";
  const heldReservation = "019f0000-0000-7000-8000-000000002893";
  const preUnknownReservation = "019f0000-0000-7000-8000-000000002894";
  const beginBeta = (id, costId, key) => `SELECT public.portal_begin_ai_usage_reservation_service(
    '${id}','${costId}','${fixture.tenantBeta}','${fixture.agentBeta}',null,'${key}','chat_generation',20000,512,0.05
  );`;
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    beginBeta(actualReservation, "019f0000-0000-7000-8000-000000003892", "ai-actual-commit"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${actualReservation}');`)).acquired, true);
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${actualReservation}',60,40,null);`)).committed, true);
  const exactCommitReplay = queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${actualReservation}',60,40,null);`));
  assert.equal(exactCommitReplay.replayed, true, "an exact AI commit replay returns the original receipt");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_commit_ai_usage_service('${actualReservation}',61,39,null);`)),
  "AI commit replay with different measured evidence conflicts");
  assert.equal(queryScalar(databaseUrl, "SELECT quantity::bigint::text FROM public.cost_events WHERE id='019f0000-0000-7000-8000-000000003892';"), "100",
    "AI cost evidence records actual committed tokens");
  assert.equal(queryScalar(databaseUrl, `SELECT actual_input_tokens::text||':'||actual_output_tokens::text
    FROM public.ai_usage_reservations WHERE id='${actualReservation}';`), "60:40",
  "a conflicting AI commit replay cannot rewrite measured usage");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.cost_events WHERE id='019f0000-0000-7000-8000-000000003892';"), "1",
  "AI commit replay leaves exactly one ledger row");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    beginBeta(heldReservation, "019f0000-0000-7000-8000-000000003893", "ai-after-actual"))).outcome, "reserved",
  "unused max envelope is returned to daily capacity at commit");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    beginBeta(preUnknownReservation, "019f0000-0000-7000-8000-000000003894", "ai-pre-unknown"))).outcome, "reserved");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${heldReservation}');`)).acquired, true);
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_unknown_service('${heldReservation}','ambiguous_timeout');`)), "t");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_unknown_service('${heldReservation}','ambiguous_timeout');`)), "t",
  "lost unknown receipt replays idempotently without changing the barrier");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_mark_ai_usage_in_flight_service('${preUnknownReservation}');`)).acquired, false,
  "an unknown outcome fences reservations that were acquired earlier but not dispatched");
  assert.equal(queryJson(databaseUrl, asRoleSql("service_role", null,
    beginBeta("019f0000-0000-7000-8000-000000002895", "019f0000-0000-7000-8000-000000003895", "ai-after-unknown"))).outcome, "blocked_unknown",
  "an unresolved ambiguous inference blocks every new AI effect for the tenant");
  assert.equal(queryScalar(databaseUrl, "SELECT count(*) FROM public.ai_usage_reservations WHERE id='019f0000-0000-7000-8000-000000002895';"), "0");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_ai_usage_service('${preUnknownReservation}','not_dispatched');`)), "t");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_ai_usage_service('${preUnknownReservation}','not_dispatched');`)), "t",
  "lost pre-dispatch release receipt replays idempotently");
  assert.equal(queryScalar(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_ai_usage_service('${heldReservation}','not_dispatched');`)), "f",
  "pre-dispatch evidence cannot release an effect that crossed the fence");
  assertFailed(runSql(databaseUrl, asRoleSql("service_role", null,
    `SELECT public.portal_release_ai_usage_service('${heldReservation}','reconciliation_absent');`)),
  "M5-01 has no unaudited OpenRouter reconciliation escape hatch");
  assert.equal(queryScalar(databaseUrl, `SELECT state FROM public.ai_usage_reservations WHERE id='${heldReservation}';`), "unknown",
    "ambiguous OpenRouter usage remains a durable tenant barrier");

  assertSucceeded(runSql(databaseUrl, `INSERT INTO public.cost_events
    (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
    VALUES ('${fixture.tenantGamma}','019f0000-0000-7000-8000-000000004900','openrouter','ai.cap.fixture','token',479488,0,0,'estimated',now());`),
  "AI daily cap-1 fixture");
  const begin = (id, costId, key) => `SELECT public.portal_begin_ai_usage_reservation_service(
    '${id}','${costId}','${fixture.tenantGamma}','${fixture.agentGamma}',null,'${key}','brain_generation',20000,512,0.05
  );`;
  const [first, second] = await Promise.all([
    runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      begin("019f0000-0000-7000-8000-000000002900", "019f0000-0000-7000-8000-000000003900", "ai-cap-parallel-a"))),
    runSqlAsync(databaseUrl, asRoleSql("service_role", null,
      begin("019f0000-0000-7000-8000-000000002901", "019f0000-0000-7000-8000-000000003901", "ai-cap-parallel-b"))),
  ]);
  assertSucceeded(first, "first concurrent AI reservation");
  assertSucceeded(second, "second concurrent AI reservation");
  const receipts = [parseLastJson(first.stdout), parseLastJson(second.stdout)];
  assert.deepEqual(receipts.map((row) => row.outcome).sort(), ["capped", "reserved"],
    "tenant serialization admits exactly one AI reservation at the daily token boundary");
  const winner = receipts[0].outcome === "reserved"
    ? { key: "ai-cap-parallel-a", id: "019f0000-0000-7000-8000-000000002900" }
    : { key: "ai-cap-parallel-b", id: "019f0000-0000-7000-8000-000000002901" };
  const replay = queryJson(databaseUrl, asRoleSql("service_role", null,
    begin("019f0000-0000-7000-8000-000000002909", "019f0000-0000-7000-8000-000000003909", winner.key)));
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.reservationId, winner.id, "AI replay keeps the original reservation identity");
  assert.equal(queryScalar(databaseUrl, `SELECT count(*) FROM public.ai_usage_reservations WHERE tenant_id='${fixture.tenantGamma}' AND idempotency_key IN ('ai-cap-parallel-a','ai-cap-parallel-b');`), "1",
    "AI token cap cannot be oversubscribed by concurrent begins");
}

function dailyCostFixturesSql(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = `019f0000-0000-7000-8000-${String(4000 + index).padStart(12, "0")}`;
    return `INSERT INTO public.cost_events (tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at)
      VALUES ('${fixture.tenantAlpha}','${id}','tavus','cap.fixture','conversation',1,0,0,'estimated',now());`;
  }).join("\n");
}

function authPreludeSql() {
  return `
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
    CREATE ROLE supabase_auth_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
    CREATE SCHEMA auth AUTHORIZATION postgres;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    REVOKE ALL ON SCHEMA auth FROM PUBLIC;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, supabase_auth_admin;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE ON SEQUENCES TO anon, authenticated, service_role;
  `;
}

function postPortablePreludeSql() {
  return `
    GRANT USAGE ON SCHEMA public, app TO anon, authenticated, supabase_auth_admin;
    GRANT USAGE ON TYPE app.uuid_v7 TO anon, authenticated, supabase_auth_admin;
    INSERT INTO auth.users (id, email) VALUES
      ('${fixture.userAlpha}', 'alpha@example.test'),
      ('${fixture.userBeta}', 'beta@example.test'),
      ('${fixture.userGamma}', 'gamma@example.test'),
      ('${fixture.userDelta}', 'delta@example.test');
    INSERT INTO public.tenants (id, slug, legal_name, status, home_region, default_language, default_timezone) VALUES
      ('${fixture.tenantAlpha}', 'portal-harness-alpha', 'Portal Harness Alpha', 'active', 'local', 'en', 'UTC'),
      ('${fixture.tenantBeta}', 'portal-harness-beta', 'Portal Harness Beta', 'active', 'local', 'en', 'UTC'),
      ('${fixture.tenantGamma}', 'portal-harness-gamma', 'Portal Harness Gamma', 'active', 'local', 'en', 'UTC'),
      ('${fixture.tenantDelta}', 'portal-harness-delta', 'Portal Harness Delta', 'active', 'local', 'en', 'UTC'),
      ('${fixture.tenantEpsilon}', 'portal-harness-epsilon', 'Portal Harness Epsilon', 'active', 'local', 'en', 'UTC'),
      ('${fixture.tenantZeta}', 'portal-harness-zeta', 'Portal Harness Zeta', 'active', 'local', 'en', 'UTC');
    INSERT INTO public.agents (tenant_id, id, name, role_type, status, disclosure_profile_id) VALUES
      ('${fixture.tenantAlpha}', '${fixture.agentAlpha}', 'Harness Agent Alpha', 'sales', 'active', 'default'),
      ('${fixture.tenantBeta}', '${fixture.agentBeta}', 'Harness Agent Beta', 'sales', 'active', 'default'),
      ('${fixture.tenantGamma}', '${fixture.agentGamma}', 'Harness Agent Gamma', 'sales', 'active', 'default'),
      ('${fixture.tenantDelta}', '${fixture.agentDelta}', 'Harness Agent Delta', 'sales', 'active', 'default'),
      ('${fixture.tenantEpsilon}', '${fixture.agentEpsilon}', 'Harness Agent Epsilon', 'sales', 'active', 'default'),
      ('${fixture.tenantZeta}', '${fixture.agentZeta}', 'Harness Agent Zeta', 'sales', 'active', 'default'),
      ('${fixture.tenantAlpha}', '019f6de0-0000-7000-8000-0000000a0001', 'Rafaela Harness Seed', 'sales', 'active', 'default');
    CREATE TABLE public.axtro_supabase_test_migrations (
      version integer PRIMARY KEY,
      filename text NOT NULL,
      checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.axtro_supabase_test_barriers (
      name text PRIMARY KEY
    );
  `;
}

// Minimal stand-in for the real Supabase Vault (pgsodium-backed) extension,
// which does not exist in a vanilla local PostgreSQL 17 cluster. Mirrors
// only the surface 0052's and 0053's RPCs call (vault.create_secret,
// vault.secrets for direct delete, vault.decrypted_secrets for the 0053
// read) so those migrations can be proven end to end locally; there is no
// encryption at rest here (fine for a disposable test cluster torn down at
// the end of this run) and production runs against the real managed Vault,
// never this stub. secrets_name_idx replicates the real Vault's own unique
// partial index on name -- without it this stub is unfaithful in exactly the
// way that let portal_connect_google_calendar_service's original
// create-before-delete ordering bug (reconnect collides on the tenant's
// deterministic secret name) pass the harness silently; see the reconnect
// assertions below, which now depend on this index actually being enforced.
//
// vault.decrypted_secrets: this view's column shape (id, name, description,
// secret, decrypted_secret, created_at, updated_at -- omitting the real
// extension's key_id/nonce, internal encryption metadata 0053's RPC never
// reads) matches the real column set confirmed empirically against this
// project's own hosted Supabase instance (ovctadcrvnfpgxzplupp) via
// information_schema.columns -- see 0053's own header comment. Since this
// stub's vault.secrets never actually encrypts anything (secret is already
// plaintext, same disposable-cluster rationale as above), decrypted_secret
// here is simply secret verbatim -- faithful to the real view's *shape*,
// not its cryptography.
function vaultPreludeSql() {
  return `
    CREATE SCHEMA vault AUTHORIZATION postgres;
    CREATE TABLE vault.secrets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text,
      description text NOT NULL DEFAULT '',
      secret text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets(name) WHERE name IS NOT NULL;
    CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT NULL)
    RETURNS uuid LANGUAGE plpgsql AS $$
    DECLARE v_id uuid;
    BEGIN
      INSERT INTO vault.secrets(name, description, secret) VALUES (new_name, coalesce(new_description, ''), new_secret) RETURNING id INTO v_id;
      RETURN v_id;
    END $$;
    CREATE VIEW vault.decrypted_secrets AS
      SELECT id, name, description, secret, secret AS decrypted_secret, created_at, updated_at
      FROM vault.secrets;
    REVOKE ALL ON SCHEMA vault FROM PUBLIC;
  `;
}

function asRoleSql(role, userId, sql) {
  const claim = userId === null ? "" : `SET request.jwt.claim.sub = '${userId}';`;
  return `SET ROLE ${role}; ${claim} ${sql} RESET ROLE;`;
}

async function resolveBaseDatabaseUrl() {
  if (externalDatabaseUrl !== undefined) {
    if (process.env.AXTRO_ALLOW_LOCAL_DATABASE_URL !== "1") {
      throw new Error("AXTRO_LOCAL_DATABASE_URL requires AXTRO_ALLOW_LOCAL_DATABASE_URL=1");
    }
    return database.parseLocalDatabaseUrl(externalDatabaseUrl);
  }
  if (postgresBin === null) throw new Error("PostgreSQL 17 binaries are required for the Supabase portal integration test");
  assertPostgres17WithPgvector(postgresBin);
  temporaryDirectory = mkdtempSync(join(tmpdir(), "axtro-portal-postgres-"));
  const port = await reserveLocalPort();
  run(join(postgresBin, "initdb"), [
    "--no-locale", "--encoding=UTF8", "--username=postgres", "--auth=trust", "--pgdata", temporaryDirectory,
  ], "cluster initialization");
  run(join(postgresBin, "pg_ctl"), [
    "--pgdata", temporaryDirectory,
    "--log", join(temporaryDirectory, "postgres.log"),
    "--options", `-h 127.0.0.1 -p ${port}`,
    "--wait", "start",
  ], "cluster startup");
  cluster = { pgCtl: join(postgresBin, "pg_ctl"), dataDirectory: temporaryDirectory };
  return `postgresql://postgres@127.0.0.1:${port}/postgres`;
}

function runFile(databaseUrl, path) {
  return spawnSync(psqlPath, psqlArgs(databaseUrl, ["--file", path]), { encoding: "utf8", env: childEnvironment() });
}

function runSql(databaseUrl, sql) {
  return spawnSync(psqlPath, psqlArgs(databaseUrl, ["--command", sql]), { encoding: "utf8", env: childEnvironment() });
}

function runSqlAsync(databaseUrl, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(psqlPath, psqlArgs(databaseUrl, ["--command", sql]), { env: childEnvironment() });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function waitForMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runConcurrentSqlBehindBarrier(databaseUrl, entries, barrierName) {
  const promises = entries.map(({ lockId, sql }) => runSqlAsync(databaseUrl, `
    BEGIN;
    SELECT pg_advisory_xact_lock(${lockId});
    DO $barrier$
    DECLARE
      deadline timestamptz := clock_timestamp() + interval '5 seconds';
    BEGIN
      LOOP
        EXIT WHEN EXISTS (
          SELECT 1 FROM public.axtro_supabase_test_barriers WHERE name='${sqlLiteral(barrierName)}'
        );
        IF clock_timestamp() >= deadline THEN
          RAISE EXCEPTION 'concurrency barrier timeout';
        END IF;
        PERFORM pg_sleep(0.01);
      END LOOP;
    END
    $barrier$;
    ${sql}
    COMMIT;
  `));
  try {
    await Promise.all(entries.map(({ lockId }) => waitForAdvisoryLockHolder(databaseUrl, lockId)));
    assertSucceeded(runSql(databaseUrl,
      `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${sqlLiteral(barrierName)}') ON CONFLICT DO NOTHING;`),
    `release ${barrierName} barrier`);
    return await Promise.all(promises);
  } finally {
    runSql(databaseUrl,
      `INSERT INTO public.axtro_supabase_test_barriers(name) VALUES ('${sqlLiteral(barrierName)}') ON CONFLICT DO NOTHING;`);
    await Promise.allSettled(promises);
    runSql(databaseUrl,
      `DELETE FROM public.axtro_supabase_test_barriers WHERE name='${sqlLiteral(barrierName)}';`);
  }
}

async function waitForApplicationWait(databaseUrl, applicationName, waitEvent) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = queryScalar(databaseUrl, `
      SELECT EXISTS(
        SELECT 1
        FROM pg_stat_activity
        WHERE datname=current_database()
          AND application_name='${sqlLiteral(applicationName)}'
          AND state='active'
          AND wait_event='${sqlLiteral(waitEvent)}'
      );
    `);
    if (waiting === "t") return;
    assert.equal(waiting, "f", `unexpected application waiter probe for ${applicationName}`);
    await waitForMilliseconds(10);
  }
  throw new Error(`timed out waiting for ${applicationName} on ${waitEvent}`);
}

async function waitForBlockedApplicationLocks(databaseUrl, applicationNames) {
  const deadline = Date.now() + 3_000;
  const expected = [...applicationNames].sort();
  const namesSql = applicationNames.map((name) => `'${sqlLiteral(name)}'`).join(",");
  while (Date.now() < deadline) {
    const blocked = queryRows(databaseUrl, `
      SELECT DISTINCT a.application_name
      FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid=a.pid
      WHERE a.datname=current_database()
        AND a.application_name IN (${namesSql})
        AND a.state='active'
        AND a.wait_event_type='Lock'
        AND NOT l.granted
      ORDER BY a.application_name;
    `);
    if (blocked.length === expected.length && blocked.every((name, index) => name === expected[index])) return;
    await waitForMilliseconds(10);
  }
  throw new Error(`timed out waiting for blocked application locks ${expected.join(",")}`);
}

async function waitForAdvisoryLockHolder(databaseUrl, lockId) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const acquired = queryScalar(databaseUrl, `SELECT pg_try_advisory_lock(${lockId});`);
    if (acquired === "f") return;
    assert.equal(acquired, "t", `unexpected advisory lock probe result for ${lockId}`);
    await waitForMilliseconds(10);
  }
  throw new Error(`timed out waiting for advisory lock ${lockId}`);
}

function psqlArgs(databaseUrl, tail) {
  return ["--no-psqlrc", "--no-password", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", databaseUrl, ...tail];
}

function queryScalar(databaseUrl, sql) {
  const result = runSql(databaseUrl, sql);
  assertSucceeded(result, `scalar query: ${sql.trim().slice(0, 100)}`);
  return result.stdout.trim().split("\n").filter((line) => line !== "SET" && line !== "RESET").at(-1) ?? "";
}

function queryRows(databaseUrl, sql) {
  const result = runSql(databaseUrl, sql);
  assertSucceeded(result, "row query");
  return result.stdout.trim().split("\n").filter(Boolean);
}

function queryJson(databaseUrl, sql) {
  const result = runSql(databaseUrl, sql);
  assertSucceeded(result, "JSON query");
  return parseLastJson(result.stdout);
}

function parseLastJson(output) {
  const line = output.trim().split("\n").filter((value) => value.startsWith("{") || value.startsWith("[")).at(-1);
  if (line === undefined) throw new Error(`Expected JSON output, received: ${output.trim()}`);
  return JSON.parse(line);
}

function firstOutcome(output) {
  return parseLastJson(output).outcome;
}

function assertSucceeded(result, phase) {
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Supabase portal integration failed during ${phase}${detail === "" ? "" : `: ${detail}`}`);
  }
}

function assertFailed(result, phase, expectedDetail = null) {
  if (result.status === 0) throw new Error(`Supabase portal integration expected failure during ${phase}`);
  if (expectedDetail !== null) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n");
    assert.match(detail, expectedDetail, `${phase} must fail with the expected SQLSTATE`);
  }
}

function createDatabase(baseUrl, executable, name) {
  const result = spawnSync(executable, psqlArgs(baseUrl, ["--command", `CREATE DATABASE ${quoteIdentifier(name)};`]), { encoding: "utf8", env: childEnvironment() });
  assertSucceeded(result, "test database creation");
}

function dropDatabase(baseUrl, executable, name) {
  const result = spawnSync(executable, psqlArgs(baseUrl, ["--command", `DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE);`]), { encoding: "utf8", env: childEnvironment() });
  assertSucceeded(result, "test database cleanup");
}

function databaseUrlFor(baseUrl, databaseName) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function databaseUrlWithUser(databaseUrl, username) {
  const parsed = new URL(databaseUrl);
  parsed.username = username;
  parsed.password = "";
  return parsed.toString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  return value.replaceAll("'", "''");
}

function childEnvironment() {
  return database.createSanitizedPsqlEnvironment(process.env);
}

function resolvePostgresBin() {
  const configured = process.env.AXTRO_POSTGRES_BIN;
  if (configured !== undefined) return configured;
  const homebrewPostgres17 = "/opt/homebrew/opt/postgresql@17/bin";
  return existsSync(join(homebrewPostgres17, "initdb")) ? homebrewPostgres17 : null;
}

function assertPostgres17WithPgvector(directory) {
  const version = spawnSync(join(directory, "postgres"), ["--version"], { encoding: "utf8", env: childEnvironment() });
  if (version.status !== 0 || !/\b17\./.test(version.stdout ?? "")) throw new Error("AXTRO_POSTGRES_BIN must contain PostgreSQL 17 binaries");
  const sharedir = spawnSync(join(directory, "pg_config"), ["--sharedir"], { encoding: "utf8", env: childEnvironment() });
  if (sharedir.status !== 0 || !existsSync(join((sharedir.stdout ?? "").trim(), "extension", "vector.control"))) {
    throw new Error("PostgreSQL 17 with pgvector is required. Install matching pgvector or set AXTRO_POSTGRES_BIN.");
  }
}

function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Unable to reserve a local PostgreSQL port")));
        return;
      }
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

function run(executable, args, phase) {
  const result = spawnSync(executable, args, { encoding: "utf8", env: childEnvironment() });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Local PostgreSQL ${phase} failed${detail === "" ? "" : `: ${detail}`}`);
  }
}

function cleanupResources() {
  if (cleanupStarted) return [];
  cleanupStarted = true;
  const errors = [];
  if (baseDatabaseUrl !== undefined && testDatabaseName !== undefined) {
    try { dropDatabase(baseDatabaseUrl, psqlPath, testDatabaseName); } catch (error) { errors.push(error instanceof Error ? error.message : "test database cleanup failed"); }
    const dropProbe = runSql(baseDatabaseUrl, "DROP ROLE IF EXISTS portal_runtime_probe;");
    if (dropProbe.status !== 0) errors.push("portal runtime probe role cleanup failed");
  }
  let clusterStopped = cluster === undefined;
  if (cluster !== undefined) {
    const stop = spawnSync(cluster.pgCtl, ["--pgdata", cluster.dataDirectory, "--wait", "--mode", "immediate", "stop"], { encoding: "utf8", env: childEnvironment() });
    if (stop.status === 0) clusterStopped = true;
    else errors.push("temporary PostgreSQL cluster did not stop cleanly");
  }
  if (temporaryDirectory !== undefined && clusterStopped) {
    try { rmSync(temporaryDirectory, { recursive: true, force: true }); } catch (error) { errors.push(error instanceof Error ? error.message : "temporary directory cleanup failed"); }
  } else if (temporaryDirectory !== undefined) {
    errors.push(`temporary PostgreSQL directory retained for inspection: ${temporaryDirectory}`);
  }
  return errors;
}
