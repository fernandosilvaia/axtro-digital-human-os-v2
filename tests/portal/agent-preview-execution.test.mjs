import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const domainModuleUrl = new URL("../../packages/domain/dist/index.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@axtro/domain") return { url: domainModuleUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { executeAgentPreviewCommand } = await import(
  "../../apps/portal/src/lib/agent-preview/execute.ts"
);

const IDS = Object.freeze({
  user: "550e8400-e29b-41d4-a716-446655440000",
  client: "550e8400-e29b-41d4-a716-446655440001",
  command: "550e8400-e29b-41d4-a716-446655440002",
  tenant: "019f0000-0000-7000-8000-000000000001",
  actor: "019f0000-0000-7000-8000-000000000002",
  agent: "019f0000-0000-7000-8000-000000000003",
  session: "019f0000-0000-7000-8000-000000000004",
  presenter: "019f0000-0000-7000-8000-000000000005",
  admission: "019f0000-0000-7000-8000-000000000006",
  claim: "019f0000-0000-7000-8000-000000000007",
  attempt: "019f0000-0000-7000-8000-000000000008",
  egress: "019f0000-0000-7000-8000-000000000009",
});

const VALID_STATE_TOKEN = `ptsv1.${"a".repeat(16)}.${"b".repeat(43)}`;
const command = Object.freeze({
  schema_version: "2.0.0",
  agentId: IDS.agent,
  clientConversationId: IDS.client,
  commandId: IDS.command,
  userMessage: "Quero entender como funciona.",
  stateToken: null,
  aiIdentityAcknowledged: true,
  essentialProcessingAccepted: true,
  persistentTranscript: false,
});

function admission(overrides = {}) {
  return Object.freeze({
    schema_version: "2.0.0",
    admission_id: IDS.admission,
    tenant_id: IDS.tenant,
    actor_id: IDS.actor,
    agent_id: IDS.agent,
    session_id: IDS.session,
    presenter_id: IDS.presenter,
    profile_id: "openrouter_portal_text_essential_v1",
    profile_version: "1.0.0",
    profile_fingerprint: `sha256:${"1".repeat(64)}`,
    provider_configuration_fingerprint: `sha256:${"2".repeat(64)}`,
    client_session_ref_hash: "3".repeat(64),
    command_fingerprint: "4".repeat(64),
    identity_disclosure_id: IDS.claim,
    data_use_disclosure_id: IDS.attempt,
    essential_consent_id: IDS.claim,
    privacy_policy_id: IDS.attempt,
    jurisdiction: "BR",
    privacy_policy_version: "1.0.0",
    privacy_policy_fingerprint: `sha256:${"5".repeat(64)}`,
    transcript_consent_id: null,
    transcript_id: null,
    persistent_transcript: false,
    status: "issued",
    ttl_seconds: 3600,
    issued_at: "2026-08-31T18:00:00.000Z",
    expires_at: "2026-08-31T19:00:00.000Z",
    ...overrides,
  });
}

function state() {
  return Object.freeze({
    schema_version: "2.0.0",
    admission_id: IDS.admission,
    binding_fingerprint: `sha256:${"6".repeat(64)}`,
    profile_id: "openrouter_portal_text_essential_v1",
    profile_version: "1.0.0",
    profile_fingerprint: `sha256:${"1".repeat(64)}`,
    generation: 0,
    turns: Object.freeze([]),
    issued_at: "2026-08-31T18:00:00.000Z",
    expires_at: "2026-08-31T19:00:00.000Z",
  });
}

function harness(overrides = {}) {
  const order = [];
  const failures = [];
  const reconciliations = [];
  const calls = {
    secret: 0,
    tokenPreverify: 0,
    context: 0,
    admit: 0,
    state: 0,
    preflight: 0,
    claim: 0,
    current: 0,
    egress: 0,
    egressCurrent: 0,
    generation: 0,
    issue: 0,
    complete: 0,
    fail: 0,
    reconcile: 0,
  };
  const grant = Object.freeze({
    claimId: IDS.claim,
    attemptId: IDS.attempt,
    admissionId: IDS.admission,
    generation: 0,
    commandFingerprint: "7".repeat(64),
    leaseExpiresAt: "2026-08-31T18:01:30.000Z",
  });
  const egressGrant = Object.freeze({
    egressId: IDS.egress,
    admissionId: IDS.admission,
    claimId: IDS.claim,
    attemptId: IDS.attempt,
    generation: 0,
    kind: "generation",
    aiUsageReservationId: "019f0000-0000-7000-8000-000000000010",
    authorizedAt: "2026-08-31T18:00:00.000Z",
    expiresAt: "2026-08-31T18:00:15.000Z",
    ttlMs: 15_000,
    localAuthorizedAtMonotonicMs: 100,
  });
  const dependencies = {
    stateSecret: () => {
      calls.secret += 1;
      order.push("state-secret");
      return "a".repeat(64);
    },
    preverifyStateToken: () => {
      calls.tokenPreverify += 1;
      order.push("token-preverify");
    },
    resolveContext: async () => {
      calls.context += 1;
      order.push("auth-context");
      return {
        userId: IDS.user,
        tenantId: IDS.tenant,
        tenantName: "Alpha",
        agent: { id: IDS.agent, name: "Rafaela" },
      };
    },
    admit: async () => {
      calls.admit += 1;
      order.push("admission");
      return admission();
    },
    stateForAdmission: (_admission, authenticatedUserId) => {
      calls.state += 1;
      order.push("signed-state");
      assert.equal(authenticatedUserId, IDS.user);
      return state();
    },
    preflightNextStateCapacity: () => {
      calls.preflight += 1;
      order.push("preflight");
    },
    acquireTurn: async () => {
      calls.claim += 1;
      order.push("claim");
      return { acquired: true, grant };
    },
    assertTurnGrantCurrent: () => {
      calls.current += 1;
      order.push("current-grant");
    },
    authorizeGenerationEgress: async () => {
      calls.egress += 1;
      order.push("generation-egress");
      return egressGrant;
    },
    assertGenerationEgressGrantCurrent: () => {
      calls.egressCurrent += 1;
      order.push("current-generation-egress");
    },
    generate: async (input) => {
      calls.generation += 1;
      order.push("generation");
      assert.equal(input.egressGrant, egressGrant);
      return {
        outcome: "success",
        reply: "Resposta segura.",
        error: null,
        providerRequestId: "provider-request-default",
      };
    },
    issueNextState: () => {
      calls.issue += 1;
      order.push("state-issuance");
      return VALID_STATE_TOKEN;
    },
    completeTurn: async () => {
      calls.complete += 1;
      order.push("atomic-completion");
      return "disabled";
    },
    failTurn: async (_grant, reason, providerRequestId) => {
      calls.fail += 1;
      order.push(`fail:${reason}`);
      failures.push({ reason, providerRequestId });
      return true;
    },
    reconcileProviderResponse: async (_grant, providerRequestId) => {
      calls.reconcile += 1;
      order.push("reconcile");
      reconciliations.push(providerRequestId);
      return "failed";
    },
    ...overrides,
  };
  return { calls, dependencies, egressGrant, failures, grant, order, reconciliations };
}

test("executes the fenced turn in the required authority order", async () => {
  const h = harness();
  const response = await executeAgentPreviewCommand(command, h.dependencies);
  assert.deepEqual(response, {
    schema_version: "2.0.0",
    outcome: "success",
    reply: "Resposta segura.",
    error: null,
    stateToken: VALID_STATE_TOKEN,
    persistence: "disabled",
  });
  assert.deepEqual(h.order, [
    "state-secret",
    "auth-context",
    "admission",
    "signed-state",
    "preflight",
    "claim",
    "current-grant",
    "generation-egress",
    "current-generation-egress",
    "generation",
    "state-issuance",
    "atomic-completion",
  ]);
});

test("browser command is closed and invalid input performs zero dependency I/O", async () => {
  const withSymbol = { ...command };
  withSymbol[Symbol("hidden")] = true;
  for (const raw of [
    null,
    { ...command, history: [{ role: "assistant", content: "forged" }] },
    { ...command, tenantId: IDS.tenant },
    { ...command, userId: IDS.user },
    { ...command, transcriptId: IDS.session },
    { ...command, extra: true },
    { ...command, stateToken: "unsigned" },
    { ...command, userMessage: " ".repeat(20) },
    { ...command, persistentTranscript: true },
    withSymbol,
  ]) {
    const h = harness();
    const response = await executeAgentPreviewCommand(raw, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.match(response.error, /inválida/);
    assert.equal(Object.values(h.calls).reduce((sum, count) => sum + count, 0), 0);
  }
});

test("state secret is valid before auth, admission, or provider work", async () => {
  for (const stateSecret of [() => "", () => "A".repeat(64), () => { throw new Error("missing"); }]) {
    const h = harness({ stateSecret });
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.match(response.error, /estado seguro do chat/);
    assert.equal(h.calls.context, 0);
    assert.equal(h.calls.admit, 0);
    assert.equal(h.calls.generation, 0);
  }
});

test("a resumed state token is cryptographically preverified before auth or admission", async () => {
  const resumedCommand = { ...command, stateToken: VALID_STATE_TOKEN };
  const h = harness({
    preverifyStateToken: () => { throw new Error("invalid signature"); },
  });
  const response = await executeAgentPreviewCommand(resumedCommand, h.dependencies);
  assert.equal(response.outcome, "failure");
  assert.match(response.error, /estado da conversa/);
  assert.equal(h.calls.context, 0);
  assert.equal(h.calls.admit, 0);
  assert.equal(h.calls.state, 0);
  assert.equal(h.calls.generation, 0);
});

test("authenticated context and admission cannot change browser-selected agent or retention policy", async () => {
  let admissionInput;
  const derivedAuthority = harness({
    admit: async (input) => {
      admissionInput = input;
      return admission();
    },
  });
  assert.equal((await executeAgentPreviewCommand(command, derivedAuthority.dependencies)).outcome, "success");
  assert.deepEqual(admissionInput, {
    authenticatedUserId: IDS.user,
    expectedTenantId: IDS.tenant,
    agentId: IDS.agent,
    clientConversationId: IDS.client,
    aiIdentityAcknowledged: true,
    essentialProcessingAccepted: true,
    persistentTranscript: false,
    expectExisting: false,
  });

  const wrongContext = harness({
    resolveContext: async () => ({
      userId: IDS.user,
      tenantId: IDS.tenant,
      tenantName: "Alpha",
      agent: { id: IDS.session, name: "Outro" },
    }),
  });
  assert.equal((await executeAgentPreviewCommand(command, wrongContext.dependencies)).outcome, "failure");
  assert.equal(wrongContext.calls.admit, 0);

  for (const forgedAdmission of [
    admission({ tenant_id: IDS.session }),
    admission({ agent_id: IDS.session }),
    admission({ persistent_transcript: true, transcript_consent_id: IDS.claim, transcript_id: IDS.session }),
    admission({ status: "expired" }),
  ]) {
    const h = harness({ admit: async () => forgedAdmission });
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.equal(h.calls.state, 0);
    assert.equal(h.calls.generation, 0);
  }
});

test("signed-state, capacity, claim, and current-grant failures stop before generation", async () => {
  const cases = [
    {
      override: { stateForAdmission: () => { throw new Error("tampered"); } },
      expected: /estado da conversa/,
    },
    {
      override: { preflightNextStateCapacity: () => { throw new Error("full"); } },
      expected: /limite seguro de estado/,
    },
    {
      override: { acquireTurn: async () => ({ acquired: false, reason: "stale_generation" }) },
      expected: /não é mais válido/,
    },
  ];
  for (const { override, expected } of cases) {
    const h = harness(override);
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.match(response.error, expected);
    assert.equal(h.calls.generation, 0);
  }

  const expired = harness({
    assertTurnGrantCurrent: () => { throw new Error("expired"); },
  });
  const response = await executeAgentPreviewCommand(command, expired.dependencies);
  assert.equal(response.outcome, "failure");
  assert.equal(expired.calls.generation, 0);
  assert.equal(expired.calls.fail, 1);
});

test("generation requires a current generation egress grant bound to the acquired turn", async () => {
  const denied = harness({
    authorizeGenerationEgress: async () => { throw new Error("denied"); },
  });
  const deniedResponse = await executeAgentPreviewCommand(command, denied.dependencies);
  assert.equal(deniedResponse.outcome, "failure");
  assert.equal(denied.calls.generation, 0);
  assert.deepEqual(denied.failures, [{ reason: "generation_failed", providerRequestId: null }]);

  const wrongKind = harness();
  wrongKind.dependencies.authorizeGenerationEgress = async () => ({
    ...wrongKind.egressGrant,
    kind: "embedding",
  });
  const wrongKindResponse = await executeAgentPreviewCommand(command, wrongKind.dependencies);
  assert.equal(wrongKindResponse.outcome, "failure");
  assert.equal(wrongKind.calls.generation, 0);
  assert.equal(wrongKind.calls.egressCurrent, 0);

  const forgedValid = harness();
  const forgedGrant = Object.freeze({
    ...forgedValid.egressGrant,
    egressId: "019f0000-0000-7000-8000-000000000011",
    aiUsageReservationId: "019f0000-0000-7000-8000-000000000012",
  });
  forgedValid.dependencies.authorizeGenerationEgress = async () => forgedGrant;
  forgedValid.dependencies.assertGenerationEgressGrantCurrent = (_turnGrant, candidate) => {
    forgedValid.calls.egressCurrent += 1;
    if (candidate !== forgedValid.egressGrant) throw new Error("unowned egress grant");
  };
  const forgedResponse = await executeAgentPreviewCommand(command, forgedValid.dependencies);
  assert.equal(forgedResponse.outcome, "failure");
  assert.equal(forgedValid.calls.generation, 0);
  assert.equal(forgedValid.calls.fail, 1);

  const expired = harness({
    assertGenerationEgressGrantCurrent: () => { throw new Error("expired"); },
  });
  const expiredResponse = await executeAgentPreviewCommand(command, expired.dependencies);
  assert.equal(expiredResponse.outcome, "failure");
  assert.equal(expired.calls.generation, 0);
  assert.equal(expired.calls.fail, 1);
});

test("provider response ambiguity is never browser success and reconciles at most once", async () => {
  for (const failMode of ["false", "throw"]) {
    const h = harness({
      generate: async () => ({
        outcome: "failure",
        reply: null,
        error: "A resposta não foi confirmada.",
        reason: "provider_response_uncommitted",
        providerRequestId: "provider-request-001",
      }),
      failTurn: async (_grant, reason, providerRequestId) => {
        h.calls.fail += 1;
        h.failures.push({ reason, providerRequestId });
        if (failMode === "throw") throw new Error("ambiguous failure receipt");
        return false;
      },
      reconcileProviderResponse: async (_grant, providerRequestId) => {
        h.calls.reconcile += 1;
        h.reconciliations.push(providerRequestId);
        return "succeeded";
      },
    });
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.equal(response.stateToken, null);
    assert.equal(JSON.stringify(response).includes("provider-request-001"), false);
    assert.deepEqual(h.failures, [{
      reason: "provider_response_uncommitted",
      providerRequestId: "provider-request-001",
    }]);
    assert.deepEqual(h.reconciliations, ["provider-request-001"]);
    assert.equal(h.calls.complete, 0);
  }
});

test("provider-supplied failure text is never reflected to the browser", async () => {
  const h = harness({
    generate: async () => ({
      outcome: "failure",
      reply: null,
      error: "raw-provider-secret provider-request-004",
      reason: "generation_failed",
      providerRequestId: null,
    }),
  });
  const response = await executeAgentPreviewCommand(command, h.dependencies);
  assert.equal(response.outcome, "failure");
  assert.equal(JSON.stringify(response).includes("raw-provider-secret"), false);
  assert.equal(JSON.stringify(response).includes("provider-request-004"), false);
});

test("provider request ID reaches atomic completion but never reaches the browser", async () => {
  let completionProviderId;
  const h = harness({
    generate: async () => ({
      outcome: "success",
      reply: "Resposta segura.",
      error: null,
      providerRequestId: "provider-request-002",
    }),
    completeTurn: async (_admission, _grant, _userMessage, _reply, providerRequestId) => {
      completionProviderId = providerRequestId;
      return "disabled";
    },
  });
  const response = await executeAgentPreviewCommand(command, h.dependencies);
  assert.equal(response.outcome, "success");
  assert.equal(completionProviderId, "provider-request-002");
  assert.equal(JSON.stringify(response).includes("provider-request-002"), false);
  assert.deepEqual(Object.keys(response).sort(), [
    "error",
    "outcome",
    "persistence",
    "reply",
    "schema_version",
    "stateToken",
  ]);
});

test("missing or malformed provider request identity can never become browser success", async () => {
  for (const providerRequestId of [null, "provider id with spaces", "p".repeat(129)]) {
    const h = harness({
      generate: async () => ({
        outcome: "success",
        reply: "Resposta sem identidade confiável.",
        error: null,
        providerRequestId,
      }),
    });
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.equal(response.reply, null);
    assert.equal(h.calls.issue, 0);
    assert.equal(h.calls.complete, 0);
    assert.deepEqual(h.failures, [{ reason: "generation_failed", providerRequestId: null }]);
  }
});

test("state issuance failure cannot reach atomic completion", async () => {
  for (const issueNextState of [
    () => "unsigned",
    () => { throw new Error("signer unavailable"); },
  ]) {
    const h = harness({ issueNextState });
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.equal(response.stateToken, null);
    assert.equal(h.calls.complete, 0);
    assert.equal(h.calls.fail, 1);
  }
});

test("ambiguous atomic completion never returns reply or signed state", async () => {
  const h = harness({
    generate: async () => ({
      outcome: "success",
      reply: "Resposta segura.",
      error: null,
      providerRequestId: "provider-request-003",
    }),
    completeTurn: async () => { throw new Error("transport ambiguity"); },
    reconcileProviderResponse: async (_grant, providerRequestId) => {
      h.reconciliations.push(providerRequestId);
      return "succeeded";
    },
  });
  const response = await executeAgentPreviewCommand(command, h.dependencies);
  assert.equal(response.outcome, "failure");
  assert.equal(response.reply, null);
  assert.equal(response.stateToken, null);
  assert.deepEqual(h.reconciliations, ["provider-request-003"]);
  assert.equal(h.calls.fail, 0);
});

test("M6-02 cannot claim transcript persistence even from a faulty completion adapter", async () => {
  for (const persistence of ["saved", "not_saved"]) {
    const h = harness({ completeTurn: async () => persistence });
    const response = await executeAgentPreviewCommand(command, h.dependencies);
    assert.equal(response.outcome, "failure");
    assert.equal(response.reply, null);
    assert.equal(response.stateToken, null);
    assert.notEqual(response.persistence, "saved");
  }
});

test("invalid generated reply and oversized error remain within the browser result contract", async () => {
  const invalidReply = harness({
    generate: async () => ({
      outcome: "success",
      reply: " ",
      error: null,
      providerRequestId: "provider-request-invalid-reply",
    }),
  });
  const replyResponse = await executeAgentPreviewCommand(command, invalidReply.dependencies);
  assert.equal(replyResponse.outcome, "failure");
  assert.equal(invalidReply.calls.issue, 0);
  assert.equal(invalidReply.calls.complete, 0);

  const oversizedError = harness({
    generate: async () => ({
      outcome: "failure",
      reply: null,
      error: "x".repeat(1001),
      reason: "generation_failed",
      providerRequestId: null,
    }),
  });
  const errorResponse = await executeAgentPreviewCommand(command, oversizedError.dependencies);
  assert.equal(errorResponse.outcome, "failure");
  assert.ok(errorResponse.error.length <= 1000);
});
