import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../../database/supabase-only/", import.meta.url);

async function sha256(filename) {
  return createHash("sha256").update(await readFile(new URL(filename, migrationDirectory))).digest("hex");
}

test("Supabase lineage is contiguous through v57 and immutable historical blobs keep their checksums", async () => {
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  assert.equal(migrations.length, 57);
  assert.deepEqual(
    migrations.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 57 }, (_, index) => index + 1),
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
