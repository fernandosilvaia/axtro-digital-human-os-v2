import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../../database/supabase-only/", import.meta.url);

async function sha256(filename) {
  return createHash("sha256").update(await readFile(new URL(filename, migrationDirectory))).digest("hex");
}

test("Supabase lineage is contiguous through v58 and immutable historical blobs keep their checksums", async () => {
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  assert.equal(migrations.length, 58);
  assert.deepEqual(
    migrations.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 58 }, (_, index) => index + 1),
  );
  assert.equal(migrations[48], "0049_portal_text_preview_admission.sql");
  assert.equal(migrations[49], "0050_meeting_terminal_notification_claim.sql");
  assert.equal(
    await sha256(migrations[48]),
    "79b24e7fdc768a30b02d3596b71799fae484043e37561ddfcd435f46076b3100",
  );
  assert.equal(
    await sha256(migrations[49]),
    "262e033328175f704f8cfef1cafdcb0a2ef9b9aac7e4cc86f2b33890044c7224",
  );
  assert.equal(migrations[57], "0058_portal_text_preview_authority_repair.sql");
});

test("v58 keeps recovered admission owner-only, derives auth identity and closes persistence", async () => {
  const migration = await readFile(
    new URL("0058_portal_text_preview_authority_repair.sql", migrationDirectory),
    "utf8",
  );

  assert.match(migration, /create or replace function public\.portal_admit_text_preview_authenticated\(/);
  const authenticatedAdmission = migration.slice(
    migration.indexOf("create or replace function public.portal_admit_text_preview_authenticated("),
    migration.indexOf("-- Preserve the audited v49 implementations"),
  );
  assert.doesNotMatch(authenticatedAdmission, /p_(?:tenant|user)_id/);
  assert.match(authenticatedAdmission, /v_user_id:=auth\.uid\(\)/);
  assert.match(authenticatedAdmission, /if p_persistent_transcript is true then[\s\S]*remains closed until M6-04/);
  assert.doesNotMatch(authenticatedAdmission, /grant execute on function public\.portal_admit_text_preview_authenticated/);
  assert.match(authenticatedAdmission, /revoke all on function public\.portal_admit_text_preview_authenticated\([\s\S]*\) from public,anon,authenticated,service_role;/);
  assert.match(migration, /revoke all on function public\.portal_admit_text_preview_service\([\s\S]*?\) from public,anon,authenticated,service_role;/);
  assert.match(migration, /app\.portal_external_roles_revoked\('public\.portal_admit_text_preview_authenticated\(/);
  assert.match(migration, /app\.portal_external_roles_revoked\('public\.portal_admit_text_preview_service\(/);
});

test("v58 fences every preview effect to generations zero through nine", async () => {
  const migration = await readFile(
    new URL("0058_portal_text_preview_authority_repair.sql", migrationDirectory),
    "utf8",
  );

  assert.match(migration, /historical generation outside 0\.\.9 requires operator reconciliation/);
  assert.equal(migration.match(/p_expected_generation not between 0 and 9/g)?.length, 5);
  assert.equal(migration.match(/check \(generation between 0 and 9\) not valid;/g)?.length, 3);
  for (const constraint of [
    "portal_text_preview_turn_claims_generation_chk",
    "portal_text_preview_egress_generation_chk",
    "portal_text_preview_transcript_writes_generation_chk",
  ]) {
    assert.match(migration, new RegExp(`validate constraint ${constraint};`));
  }
});

test("v58 links transcripts by tenant and unlinks only the deleted transcript reference", async () => {
  const migration = await readFile(
    new URL("0058_portal_text_preview_authority_repair.sql", migrationDirectory),
    "utf8",
  );

  assert.match(migration, /unique \(tenant_id,id\)/);
  assert.equal(migration.match(/foreign key \(tenant_id,transcript_id\)/g)?.length, 2);
  assert.equal(
    migration.match(/references public\.conversation_transcripts\(tenant_id,id\)\s+on delete set null \(transcript_id\) not valid;/g)?.length,
    2,
  );
  assert.match(migration, /alter column transcript_id drop not null/);
  assert.match(migration, /old\.transcript_id is not null[\s\S]*new\.transcript_id is null/);
  assert.match(migration, /\(to_jsonb\(new\)-'transcript_id'\)=\(to_jsonb\(old\)-'transcript_id'\)/);
  assert.match(migration, /not exists\([\s\S]*where tenant_id=old\.tenant_id and id=old\.transcript_id/);
  const admissionNormalization = migration.indexOf("update public.portal_text_preview_admissions a");
  const writeNormalization = migration.indexOf("update public.portal_text_preview_transcript_writes w");
  const admissionForeignKey = migration.indexOf("add constraint portal_text_preview_admissions_transcript_fkey");
  assert.ok(admissionNormalization > 0 && admissionNormalization < admissionForeignKey);
  assert.ok(writeNormalization > admissionNormalization && writeNormalization < admissionForeignKey);
  assert.match(migration, /c\.confdelsetcols=array\[\(select attnum[\s\S]*attname='transcript_id'\)\]::smallint\[\]/);
  assert.match(migration, /t\.tgfoid='app\.prevent_text_preview_reference_mutation\(\)'::regprocedure/);
});

test("v58 extends the v57 capability union and replaces only repaired preview facts", async () => {
  const migration = await readFile(
    new URL("0058_portal_text_preview_authority_repair.sql", migrationDirectory),
    "utf8",
  );

  assert.match(migration, /alter function public\.portal_schema_capabilities_service\(\) set schema app;/);
  assert.match(migration, /rename to portal_schema_capabilities_v57;/);
  assert.match(migration, /select \(app\.portal_schema_capabilities_v57\(\)\s+-'version'\s+-'portalTextPreviewAdmission'\s+-'portalTextPreviewSecurityBoundary'\s+-'portalTextTranscriptOptIn'\)/);
  assert.match(migration, /'version',58/);
  assert.match(migration, /'portalTextPreviewAuthorityRepair'/);
  assert.doesNotMatch(migration, /-'meetingTerminalNotification/);
  assert.match(migration, /grant execute on function public\.portal_schema_capabilities_service\(\)\s+to service_role;/);
});

test("v57 replaces claim-before-send with a bounded tenant-scoped outbox", async () => {
  const migration = await readFile(new URL("0057_meeting_terminal_notification_outbox.sql", migrationDirectory), "utf8");
  assert.match(migration, /'version',57/);
  for (const capability of [
    "meetingTerminalNotificationOutbox",
    "meetingTerminalNotificationAtomicEnqueue",
    "meetingTerminalNotificationLegacyClaimDisabled",
    "meetingTerminalNotificationBoundedUnknown",
    "meetingTerminalNotificationWorkerHeartbeat",
  ]) assert.match(migration, new RegExp(`'${capability}'`), capability);
  assert.match(migration, /provider_idempotency_key='meeting-terminal:v1:'\|\|meeting_session_id::text/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /force row level security/gi);
});

test("v56 republishes the complete v49, v50 and business-action capability union", async () => {
  const migration = await readFile(new URL("0056_schema_capability_lineage_repair.sql", migrationDirectory), "utf8");
  assert.match(migration, /'version',56/);
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
    "meetingTerminalNotificationClaim",
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
  ]) assert.match(migration, new RegExp(`'${capability}'`), capability);
  assert.match(migration, /revoke all on function public\.portal_schema_capabilities_service\(\) from public,anon,authenticated;/);
  assert.match(migration, /grant execute on function public\.portal_schema_capabilities_service\(\) to service_role;/);
});
