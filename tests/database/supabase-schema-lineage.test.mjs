import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../../database/supabase-only/", import.meta.url);

async function sha256(filename) {
  return createHash("sha256").update(await readFile(new URL(filename, migrationDirectory))).digest("hex");
}

test("Supabase lineage is contiguous through v60 and immutable historical blobs keep their checksums", async () => {
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  assert.equal(migrations.length, 60);
  assert.deepEqual(
    migrations.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 60 }, (_, index) => index + 1),
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
  assert.equal(migrations[58], "0059_data_governance_disposition_workflow.sql");
  assert.equal(migrations[59], "0060_business_action_meeting_slot_lookup.sql");
});

test("v60 resolves a proposal's slotIndex to slot_id through a read-only, service_role-only, anti-oracle lookup", async () => {
  const migration = await readFile(
    new URL("0060_business_action_meeting_slot_lookup.sql", migrationDirectory),
    "utf8",
  );

  assert.match(migration, /create or replace function public\.portal_business_action_resolve_meeting_slot_service\(/);
  assert.match(migration, /language sql stable security definer/);
  assert.match(migration, /'outcome','not_found'/);
  assert.match(migration, /'outcome','found','slotId',s\.id,'startAt',s\.start_at,'endAt',s\.end_at,'timezone',s\.timezone/);
  assert.match(migration, /left join public\.portal_business_action_proposal_slots s\s*\n\s*on s\.tenant_id=p_tenant_id and s\.proposal_id=p_proposal_id and s\.slot_index=p_slot_index/);
  assert.match(
    migration,
    /revoke all on function public\.portal_business_action_resolve_meeting_slot_service\(app\.uuid_v7,app\.uuid_v7,integer\) from public,anon,authenticated,service_role;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.portal_business_action_resolve_meeting_slot_service\(app\.uuid_v7,app\.uuid_v7,integer\) to service_role;/,
  );
  // Same precedent 0055 already documented for itself: no caller branches on whether this fix is
  // live, so this migration deliberately never redefines portal_schema_capabilities_service()
  // (the migration's own header comment names it only in prose, explaining that omission).
  assert.doesNotMatch(migration, /create or replace function public\.portal_schema_capabilities_service/);
  assert.doesNotMatch(migration, /alter function public\.portal_schema_capabilities_service/);
});

test("v59 keeps disposition admission, execution and evidence fail closed", async () => {
  const migration = await readFile(
    new URL("0059_data_governance_disposition_workflow.sql", migrationDirectory),
    "utf8",
  );

  for (const rpc of [
    "portal_request_data_governance_authenticated",
    "portal_decide_data_governance_policy_service",
    "portal_approve_data_governance_authenticated",
    "portal_authorize_data_governance_request_service",
    "portal_register_data_governance_subject_link_service",
    "portal_attest_data_governance_subject_coverage_service",
    "portal_inventory_data_governance_request_service",
    "portal_create_data_legal_hold_authenticated",
    "portal_release_data_legal_hold_authenticated",
    "portal_expire_data_legal_hold_service",
    "portal_lease_data_governance_work_items_service",
    "portal_begin_data_governance_external_operation_service",
    "portal_apply_data_governance_database_item_service",
    "portal_record_data_governance_item_outcome_service",
    "portal_complete_data_governance_request_service",
    "portal_data_governance_status_authenticated",
    "portal_cancel_data_governance_request_authenticated",
    "portal_expire_data_governance_request_service",
  ]) assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(`), rpc);

  const requestAdmission = migration.slice(
    migration.indexOf("create or replace function public.portal_request_data_governance_authenticated("),
    migration.indexOf("create or replace function public.portal_decide_data_governance_policy_service("),
  );
  assert.match(requestAdmission, /p_scope='tenant' and p_requested_action='redact'/);
  assert.match(requestAdmission, /'requested',auth\.uid\(\),v_member\.actor_id/);
  assert.match(requestAdmission, /'pending','awaiting_approval'/);
  assert.doesNotMatch(requestAdmission, /'allow','policy_allowed'/);
  assert.match(requestAdmission, /canonical governance fingerprint mismatch/);

  const lease = migration.slice(
    migration.indexOf("create or replace function public.portal_lease_data_governance_work_items_service("),
    migration.indexOf("create or replace function public.portal_apply_data_governance_database_item_service("),
  );
  assert.match(lease, /for update of i skip locked limit p_limit/i);
  assert.match(lease, /i\.resource_code='db_tenants' and i\.state='verification_pending'/);
  assert.match(lease, /dispatch_fenced_at is not null then 'effect_unknown'/);
  assert.match(lease, /when 'retry_wait' then i\.resume_operation/);
  assert.match(lease, /c\.deletion_order=\(/);
  assert.match(lease, /i2\.state not in \('verified','retained_exception'\)/);
  assert.match(lease, /external_catalog\.surface<>'database'/);
  assert.match(migration, /portal_decide_data_governance_policy_service\([\s\S]*p_tenant_id app\.uuid_v7/);
  assert.match(migration, /portal_authorize_data_governance_request_service\([\s\S]*p_tenant_id app\.uuid_v7/);
  assert.match(migration, /portal_expire_data_governance_request_service\([\s\S]*p_tenant_id app\.uuid_v7/);

  const databaseExecutor = migration.slice(
    migration.indexOf("create or replace function public.portal_apply_data_governance_database_item_service("),
    migration.indexOf("create or replace function public.portal_record_data_governance_item_outcome_service("),
  );
  assert.match(databaseExecutor, /v_item\.current_operation not in \('apply','verify'\)/);
  assert.match(databaseExecutor, /retain_content_free/);
  assert.match(databaseExecutor, /redacted-/);
  assert.match(databaseExecutor, /verification_pending/);

  assert.match(migration, /p_evidence_kind text/);
  assert.match(migration, /p_evidence_fingerprint text/);
  assert.match(migration, /evidence_attestation_hmac/);
  assert.match(migration, /'dataGovernanceControlProjection'/);
  assert.match(migration, /app\.data_governance_controls_projected/);
  assert.match(migration, /app\.data_governance_cycle_break_complete/);
  assert.match(migration, /data_governance_relation_shape_fingerprint/);
  assert.match(migration, /conversation-transcript-redaction@1/);
  assert.match(migration, /fk\.confkey=array\[participant_tenant_column\.attnum,participant_session_column\.attnum,participant_id_column\.attnum\]::smallint\[\]/);
  assert.match(migration, /coalesce\(i\.database_row_id,i\.verification_database_row_id\)=v_row_id/);
  assert.match(migration, /i\.verification_locator_hmac=l\.resource_locator_hmac/);
  assert.match(migration, /for share;/i);
  assert.match(migration, /app\.prevent_text_preview_reference_mutation\(\)[\s\S]*app\.data_governance_disposition_allowed/);
  assert.match(migration, /app\.prevent_meeting_notification_receipt_mutation\(\)[\s\S]*app\.data_governance_disposition_allowed/);
  assert.match(migration, /set subject_id=null[\s\S]*delete from public\.data_governance_subjects/);
  assert.doesNotMatch(migration, /session_replication_role|disable trigger|set_config\s*\(/i);
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
