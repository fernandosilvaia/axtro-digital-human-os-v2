import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

const domainModuleUrl = new URL("../../packages/domain/dist/index.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@axtro/domain") return { url: domainModuleUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  createPortalTextPreviewRuntime,
  PORTAL_TEXT_PREVIEW_RPC,
  PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS,
  PortalTextPreviewRuntimeError,
} = await import("../../apps/portal/src/lib/runtime/portal-text-preview-runtime.ts");

const NOW = new Date("2026-08-31T12:00:00.000Z");
const SECRET = "a".repeat(64);
const PROFILE_CONFIGURATION_FINGERPRINT = "sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de";
const ESSENTIAL_PROFILE_FINGERPRINT = "sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173";
const PERSISTED_PROFILE_FINGERPRINT = "sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8";
const IDS = Object.freeze({
  user: "550e8400-e29b-41d4-a716-446655440000",
  client: "550e8400-e29b-41d4-a716-446655440001",
  command: "550e8400-e29b-41d4-a716-446655440002",
  tenant: "019f0000-0000-7000-8000-000000000001",
  actor: "019f0000-0000-7000-8000-000000000002",
  agent: "019f0000-0000-7000-8000-000000000003",
});

function id(index) {
  return `019f0000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

const profiles = Object.freeze({
  essential: Object.freeze({
    profileId: "openrouter_portal_text_essential_v1",
    profileVersion: "1.0.0",
    profileFingerprint: ESSENTIAL_PROFILE_FINGERPRINT,
    providerConfigurationFingerprint: PROFILE_CONFIGURATION_FINGERPRINT,
    persistentTranscript: false,
  }),
  persisted: Object.freeze({
    profileId: "openrouter_portal_text_persisted_v1",
    profileVersion: "1.0.0",
    profileFingerprint: PERSISTED_PROFILE_FINGERPRINT,
    providerConfigurationFingerprint: PROFILE_CONFIGURATION_FINGERPRINT,
    persistentTranscript: true,
  }),
});

const disclosures = Object.freeze({
  identityVersion: "portal.text.identity.v1",
  identityHash: "1".repeat(64),
  dataUseVersion: "portal.text.data_use.v1",
  dataUseHash: "2".repeat(64),
});

const admitInput = Object.freeze({
  authenticatedUserId: IDS.user,
  expectedTenantId: IDS.tenant,
  agentId: IDS.agent,
  clientConversationId: IDS.client,
  aiIdentityAcknowledged: true,
  essentialProcessingAccepted: true,
  persistentTranscript: false,
  expectExisting: false,
});

function admissionReceipt(args, persistent = false, overrides = {}) {
  return {
    schema_version: "2.0.0",
    admission_id: args.p_admission_id,
    tenant_id: IDS.tenant,
    actor_id: IDS.actor,
    agent_id: IDS.agent,
    session_id: args.p_session_id,
    presenter_id: args.p_presenter_id,
    profile_id: persistent
      ? "openrouter_portal_text_persisted_v1"
      : "openrouter_portal_text_essential_v1",
    profile_version: "1.0.0",
    profile_fingerprint: persistent
      ? PERSISTED_PROFILE_FINGERPRINT
      : ESSENTIAL_PROFILE_FINGERPRINT,
    provider_configuration_fingerprint: PROFILE_CONFIGURATION_FINGERPRINT,
    client_session_ref_hash: args.p_client_session_ref_hash,
    command_fingerprint: args.p_command_fingerprint,
    identity_disclosure_id: args.p_identity_disclosure_id,
    data_use_disclosure_id: args.p_data_use_disclosure_id,
    essential_consent_id: args.p_essential_consent_id,
    privacy_policy_id: id(800),
    jurisdiction: "US-FL",
    privacy_policy_version: "1.0.0",
    privacy_policy_fingerprint: `sha256:${"3".repeat(64)}`,
    transcript_consent_id: persistent ? args.p_transcript_consent_id : null,
    transcript_id: persistent ? args.p_transcript_id : null,
    persistent_transcript: persistent,
    status: "issued",
    ttl_seconds: 3600,
    issued_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
    ...overrides,
  };
}

function harness(options = {}) {
  let nextId = 100;
  const calls = [];
  const record = (port, args) => calls.push({ port, args });
  const ports = {
    admission: {
      async admit(args) {
        record("admission", args);
        return options.admit?.(args) ?? admissionReceipt(args, args.p_persistent_transcript);
      },
    },
    claim: {
      async acquire(args) {
        record("claim", args);
        return options.claim?.(args) ?? {
          outcome: "acquired",
          claimId: args.p_claim_id,
          attemptId: args.p_attempt_id,
          generation: args.p_expected_generation,
          leaseExpiresAt: new Date(NOW.getTime() + 90_000).toISOString(),
        };
      },
    },
    egress: {
      async authorize(args) {
        record("egress", args);
        return options.egress?.(args) ?? {
          outcome: "authorized",
          egressId: args.p_egress_id,
          kind: args.p_kind,
          authorizedAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + 15_000).toISOString(),
        };
      },
    },
    completion: {
      async complete(args) {
        record("completion", args);
        if (options.complete) return options.complete(args);
        return {
          outcome: "succeeded",
          persistence: options.persistence ?? "disabled",
          providerRequestId: args.p_provider_request_id,
        };
      },
      async reconcile(args) {
        record("reconciliation", args);
        return options.reconcile?.(args) ?? {
          outcome: "failed",
          reasonCode: "provider_response_uncommitted",
          providerRequestId: args.p_provider_request_id,
        };
      },
    },
    failure: {
      async fail(args) {
        record("failure", args);
        return options.fail?.(args) ?? { outcome: "failed" };
      },
    },
  };
  return {
    calls,
    runtime: createPortalTextPreviewRuntime({
      ports,
      profiles,
      disclosures,
      idGenerator: () => id(nextId++),
      traceIdGenerator: () => "4".repeat(32),
      now: options.now ?? (() => new Date(NOW)),
      monotonicNow: options.monotonicNow ?? (() => 100),
      ...(options.portTimeoutMs === undefined ? {} : { portTimeoutMs: options.portTimeoutMs }),
    }),
  };
}

async function acquiredTurn(h, input = admitInput) {
  const admission = await h.runtime.admitPortalTextPreview(input);
  const state = h.runtime.stateForAdmission(admission, IDS.user, null, SECRET);
  const acquisition = await h.runtime.acquireTurn({
    admission,
    state,
    commandId: IDS.command,
    userMessage: "Hello",
    stateSecret: SECRET,
  });
  assert.equal(acquisition.acquired, true);
  return { admission, state, grant: acquisition.grant };
}

test("runtime core has no framework, Supabase, provider or environment dependency", async () => {
  const source = await readFile(
    new URL("../../apps/portal/src/lib/runtime/portal-text-preview-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /@supabase|next\/|provider-openrouter|process\.env|createClient|fetch\(/);
  assert.match(source, /PortalTextPreviewAdmissionPort/);
  assert.match(source, /PortalTextPreviewClaimPort/);
  assert.match(source, /PortalTextPreviewEgressPort/);
  assert.match(source, /PortalTextPreviewCompletionPort/);
  assert.match(source, /PortalTextPreviewFailurePort/);
});

test("runtime RPC argument contracts match the immutable 0049 and authenticated 0058 boundaries", async () => {
  const historicalSql = await readFile(
    new URL("../../database/supabase-only/0049_portal_text_preview_admission.sql", import.meta.url),
    "utf8",
  );
  const authorityRepairSql = await readFile(
    new URL("../../database/supabase-only/0058_portal_text_preview_authority_repair.sql", import.meta.url),
    "utf8",
  );
  for (const [key, functionName] of Object.entries(PORTAL_TEXT_PREVIEW_RPC)) {
    const sql = key === "admit" ? authorityRepairSql : historicalSql;
    const match = sql.match(new RegExp(
      `create or replace function public\\.${functionName}\\(([\\s\\S]*?)\\) returns jsonb`,
    ));
    assert.ok(match, `${functionName} signature missing`);
    const sqlNames = [...match[1].matchAll(/^\s*(p_[a-z0-9_]+)\s+/gm)].map((item) => item[1]);
    assert.deepEqual(PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS[key], sqlNames);
  }
});

test("admission uses authenticated authority, mints unique evidence and accepts only exact receipt", async () => {
  const h = harness();
  const admission = await h.runtime.admitPortalTextPreview(admitInput);
  assert.equal(admission.tenant_id, IDS.tenant);
  assert.equal(admission.persistent_transcript, false);
  assert.equal(admission.transcript_id, null);
  assert.equal(h.calls.length, 1);
  const args = h.calls[0].args;
  assert.equal(args.p_agent_id, IDS.agent);
  assert.equal(Object.hasOwn(args, "p_user_id"), false);
  assert.equal(Object.hasOwn(args, "p_tenant_id"), false);
  assert.deepEqual(Object.keys(args), PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.admit);

  const malformed = harness({
    admit: (portArgs) => ({ ...admissionReceipt(portArgs), unexpected: true }),
  });
  await assert.rejects(
    () => malformed.runtime.admitPortalTextPreview(admitInput),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "admission_invalid",
  );

  const accessor = harness({
    admit: (portArgs) => {
      const receipt = admissionReceipt(portArgs);
      Object.defineProperty(receipt, "status", {
        enumerable: true,
        get: () => "issued",
      });
      return receipt;
    },
  });
  await assert.rejects(
    () => accessor.runtime.admitPortalTextPreview(admitInput),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "admission_invalid",
  );
});

test("admission fails closed on expired, cross-tenant and persistence/profile drift", async () => {
  for (const overrides of [
    { tenant_id: id(999) },
    { status: "expired" },
    { expires_at: NOW.toISOString() },
    {
      issued_at: new Date(NOW.getTime() + 60_000).toISOString(),
      expires_at: new Date(NOW.getTime() + 3_660_000).toISOString(),
    },
    { persistent_transcript: true },
    { provider_configuration_fingerprint: `sha256:${"9".repeat(64)}` },
  ]) {
    const h = harness({ admit: (args) => admissionReceipt(args, false, overrides) });
    await assert.rejects(
      () => h.runtime.admitPortalTextPreview(admitInput),
      PortalTextPreviewRuntimeError,
    );
  }
});

test("signed state is bound to authenticated user and admission policy", async () => {
  const h = harness();
  const admission = await h.runtime.admitPortalTextPreview(admitInput);
  const initial = h.runtime.stateForAdmission(admission, IDS.user, null, SECRET);
  assert.equal(initial.generation, 0);
  assert.equal(initial.turns.length, 0);
  const token = h.runtime.issueNextState(admission, initial, "Hello", "Hi", SECRET);
  const resumed = h.runtime.stateForAdmission(admission, IDS.user, token, SECRET);
  assert.equal(resumed.generation, 1);
  await assert.rejects(
    async () => h.runtime.stateForAdmission(
      admission,
      "550e8400-e29b-41d4-a716-446655440099",
      token,
      SECRET,
    ),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "admission_mismatch",
  );
});

test("claim, egress and completion preserve authority order and revalidate at every port", async () => {
  const h = harness();
  const { admission, grant } = await acquiredTurn(h);
  const reservationId = id(700);
  const firstEgress = await h.runtime.authorizeTurnEgress(grant, "generation", reservationId);
  const replayedEgress = await h.runtime.authorizeTurnEgress(grant, "generation", reservationId);
  assert.equal(replayedEgress, firstEgress);
  assert.equal(firstEgress.aiUsageReservationId, reservationId);
  assert.doesNotThrow(() => h.runtime.assertTurnEgressGrantCurrent(grant, firstEgress));
  assert.throws(
    () => h.runtime.assertTurnEgressGrantCurrent(grant, { ...firstEgress }),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  await assert.rejects(
    () => h.runtime.authorizeTurnEgress(grant, "generation", id(701)),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_replay_conflict",
  );
  assert.equal(h.calls.filter((call) => call.port === "egress").length, 1);

  const persistence = await h.runtime.completeTurn(
    admission,
    grant,
    "Hello",
    "Safe committed reply",
    "provider-request-1",
    SECRET,
  );
  assert.equal(persistence, "disabled");
  const replay = await h.runtime.completeTurn(
    admission,
    grant,
    "Hello",
    "Safe committed reply",
    "provider-request-1",
    SECRET,
  );
  assert.equal(replay, "disabled");
  assert.throws(
    () => h.runtime.assertTurnEgressGrantCurrent(grant, firstEgress),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  assert.deepEqual(h.calls.map((call) => call.port), [
    "admission",
    "claim",
    "egress",
    "completion",
  ]);
  const completion = h.calls.at(-1).args;
  assert.equal(completion.p_user_turn, null);
  assert.equal(completion.p_assistant_turn, null);
  assert.match(completion.p_completion_fingerprint, /^hmac-sha256:[0-9a-f]{64}$/);
});

test("forged, stale and out-of-order grants cannot cross the egress or completion fence", async () => {
  const h = harness();
  const { admission, grant } = await acquiredTurn(h);
  assert.throws(
    () => h.runtime.assertTurnGrantCurrent({ ...grant }),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  const forgedEgress = Object.freeze({
    egressId: id(700),
    admissionId: grant.admissionId,
    claimId: grant.claimId,
    attemptId: grant.attemptId,
    generation: grant.generation,
    kind: "generation",
    aiUsageReservationId: id(701),
    authorizedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 15_000).toISOString(),
    ttlMs: 15_000,
    localAuthorizedAtMonotonicMs: 100,
  });
  assert.throws(
    () => h.runtime.assertTurnEgressGrantCurrent(grant, forgedEgress),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  await assert.rejects(
    () => h.runtime.authorizeTurnEgress({ ...grant, claimId: id(999) }, "generation", id(700)),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  await assert.rejects(
    () => h.runtime.completeTurn(admission, grant, "Hello", "Reply", null, SECRET),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  assert.equal(h.calls.filter((call) => call.port === "egress").length, 0);
  assert.equal(h.calls.filter((call) => call.port === "completion").length, 0);
});

test("claim maps consent revoke, stale generation and replay without leaking content", async () => {
  const matrix = new Map([
    ["not_authorized", "admission_required"],
    ["stale_generation", "stale_generation"],
    ["in_flight", "turn_in_flight"],
    ["already_processed", "turn_already_processed"],
    ["conflict", "turn_replay_conflict"],
    ["failed", "turn_failed"],
  ]);
  for (const [outcome, reason] of matrix) {
    const h = harness({ claim: () => outcome === "failed" ? { outcome, reasonCode: "worker_lost" } : { outcome } });
    const admission = await h.runtime.admitPortalTextPreview(admitInput);
    const state = h.runtime.stateForAdmission(admission, IDS.user, null, SECRET);
    const result = await h.runtime.acquireTurn({
      admission,
      state,
      commandId: IDS.command,
      userMessage: "Sensitive input",
      stateSecret: SECRET,
    });
    assert.deepEqual(result, { acquired: false, reason });
    assert.equal(JSON.stringify(result).includes("Sensitive input"), false);
  }
});

test("generation ten is terminal and cannot create an eleventh claim", async () => {
  const h = harness();
  const admission = await h.runtime.admitPortalTextPreview(admitInput);
  const state = {
    ...h.runtime.stateForAdmission(admission, IDS.user, null, SECRET),
    generation: 10,
    turns: Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x",
    })),
  };
  const result = await h.runtime.acquireTurn({
    admission,
    state,
    commandId: IDS.command,
    userMessage: "No eleventh turn",
    stateSecret: SECRET,
  });
  assert.deepEqual(result, { acquired: false, reason: "invalid_request" });
  assert.equal(h.calls.filter((call) => call.port === "claim").length, 0);
});

test("transcript content crosses completion only after explicit persisted admission", async () => {
  const h = harness({ persistence: "saved" });
  const input = { ...admitInput, persistentTranscript: true };
  const { admission, grant } = await acquiredTurn(h, input);
  await h.runtime.authorizeTurnEgress(grant, "generation", id(700));
  const persistence = await h.runtime.completeTurn(
    admission,
    grant,
    "Persisted user turn",
    "Persisted assistant turn",
    "provider-request-2",
    SECRET,
  );
  assert.equal(persistence, "saved");
  const completion = h.calls.at(-1).args;
  assert.equal(completion.p_user_turn, "Persisted user turn");
  assert.equal(completion.p_assistant_turn, "Persisted assistant turn");
});

test("revoked egress authority fails closed before provider use", async () => {
  const h = harness({ egress: () => ({ outcome: "not_authorized" }) });
  const { grant } = await acquiredTurn(h);
  await assert.rejects(
    () => h.runtime.authorizeTurnEgress(grant, "generation", id(700)),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_failed",
  );
  assert.equal(h.calls.filter((call) => call.port === "completion").length, 0);
});

test("an uncommitted provider response can only reconcile to content-free failure", async () => {
  const h = harness({
    complete: () => { throw new Error("ambiguous database response"); },
    reconcile: (args) => ({
      outcome: "failed",
      reasonCode: "provider_response_uncommitted",
      providerRequestId: args.p_provider_request_id,
    }),
  });
  const { admission, grant } = await acquiredTurn(h);
  await h.runtime.authorizeTurnEgress(grant, "generation", id(700));
  await assert.rejects(
    () => h.runtime.completeTurn(
      admission,
      grant,
      "Private user content",
      "Uncommitted provider reply",
      "provider-request-3",
      SECRET,
    ),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "service_unavailable",
  );
  assert.equal(await h.runtime.reconcileProviderResponse(grant, "provider-request-3"), "failed");
  const reconciliation = h.calls.at(-1);
  assert.equal(reconciliation.port, "reconciliation");
  assert.deepEqual(Object.keys(reconciliation.args), PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.reconcileProviderResponse);
  assert.equal(JSON.stringify(reconciliation.args).includes("Private user content"), false);
  assert.equal(JSON.stringify(reconciliation.args).includes("Uncommitted provider reply"), false);
  assert.equal(await h.runtime.failTurn(grant, "provider_response_uncommitted", "provider-request-3"), false);
});

test("malformed completion never becomes success and exact replay conflicts are rejected", async () => {
  const malformed = harness({
    complete: (args) => ({
      outcome: "succeeded",
      persistence: "disabled",
      providerRequestId: args.p_provider_request_id,
      extra: true,
    }),
  });
  const { admission, grant } = await acquiredTurn(malformed);
  await malformed.runtime.authorizeTurnEgress(grant, "generation", id(700));
  await assert.rejects(
    () => malformed.runtime.completeTurn(admission, grant, "Hello", "Reply", null, SECRET),
    PortalTextPreviewRuntimeError,
  );

  const good = harness();
  const ready = await acquiredTurn(good);
  await good.runtime.authorizeTurnEgress(ready.grant, "generation", id(700));
  await good.runtime.completeTurn(ready.admission, ready.grant, "Hello", "Reply", null, SECRET);
  await assert.rejects(
    () => good.runtime.completeTurn(ready.admission, ready.grant, "Hello", "Different reply", null, SECRET),
    (error) => error instanceof PortalTextPreviewRuntimeError && error.code === "turn_replay_conflict",
  );
});
