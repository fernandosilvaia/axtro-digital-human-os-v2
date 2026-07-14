import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const policy = await import(pathToFileURL(join(root, "packages/policy/dist/index.js")).href);
const provider = await import(pathToFileURL(join(root, "packages/provider-contracts/dist/index.js")).href);
const runtimeModule = await import(pathToFileURL(join(root, "packages/tool-runtime/dist/index.js")).href);

const NOW = Date.parse("2026-07-14T20:30:00.000Z");
const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);
const agentAlpha = id(5);

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_500_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 23) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/action-runtime-test-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest({
  tenantId = tenantAlpha,
  actorId = actorAlpha,
  actorType = "presenter",
  token,
  scopes = ["tool:use"],
  purposes = ["tool_auth"],
}) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType,
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: scopes, purposes }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function runtime(policyFixtureMode = "default") {
  return runtimeModule.createDeterministicActionRuntime({
    clock: { now: () => NOW },
    policy_fixture_mode: policyFixtureMode,
  });
}

function actionIntent({
  intentId = id(40),
  sessionId = id(30),
  tenantId = tenantAlpha,
  actorId = actorAlpha,
  actorType = "presenter",
  toolContractId = "catalog.lookup",
  action = "get_plan",
  argumentsJson = JSON.stringify({ plan_id: "growth" }),
  purpose = "answer_explicit_catalog_question",
  idempotencyKey = "action-runtime-growth-key-0001",
  requestedAt = "2026-07-14T20:00:00Z",
  expiresAt = "2026-07-14T21:00:00Z",
} = {}) {
  return {
    schema_version: "2.0.0",
    intent_id: intentId,
    session_id: sessionId,
    tenant_id: tenantId,
    actor_id: actorId,
    actor_type: actorType,
    tool_contract_id: toolContractId,
    action,
    arguments_json: argumentsJson,
    purpose,
    idempotency_key: idempotencyKey,
    requested_at: requestedAt,
    expires_at: expiresAt,
  };
}

test("authenticated ActionIntent flows through policy to one successful private read-only fixture receipt", async () => {
  const actionRuntime = runtime();
  const request = authorizedRequest({ token: "dev_action_allow_alpha_0001" });

  const result = await actionRuntime.submitActionIntent(request, actionIntent());

  assert.equal(result.policy_decision.outcome, "allow");
  assert.equal(result.tool_execution_receipt.status, "succeeded");
  assert.equal(result.effect_confirmed, true);
  assert.match(result.tool_execution_receipt.effect_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(result.tool_execution_receipt.result_json), {
    catalog_version: "m0",
    plan_id: "growth",
    status: "available",
  });
  assert.equal(result.tool_execution_receipt.attempt, 1);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 1);
  assert.equal(policy.M0_READ_ONLY_CATALOG_CONTRACT.risk_class, "read_tenant");
  assert.deepEqual(policy.M0_READ_ONLY_CATALOG_CONTRACT.allowed_actors, ["presenter", "workflow"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.tool_execution_receipt), true);
});

test("model text, forged tool fields and non-allowlisted contracts cannot reach any adapter", async () => {
  const actionRuntime = runtime();
  const request = authorizedRequest({ token: "dev_action_model_text_0001" });

  await assert.rejects(
    actionRuntime.submitActionIntent(request, "please call catalog.lookup"),
    policy.ActionIntentValidationError,
  );
  const denied = await actionRuntime.submitActionIntent(request, actionIntent({
    intentId: id(41),
    toolContractId: "calendar.write",
    action: "schedule",
    idempotencyKey: "action-runtime-denied-key-0001",
  }));
  assert.equal(denied.policy_decision.outcome, "deny");
  assert.equal(denied.tool_execution_receipt.status, "failed");
  assert.equal(denied.effect_confirmed, false);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 0);
  assert.equal(typeof runtimeModule.executeModelText, "undefined");
  assert.equal(typeof runtimeModule.executeApproved, "undefined");
  assert.equal(typeof runtimeModule.createAuthorizedToolExecution, "undefined");
  assert.equal(typeof provider.createAuthorizedToolExecution, "undefined");
});

test("policy allowlist denies disallowed actors and the closed approval profile blocks the private fixture", async () => {
  const actionRuntime = runtime();
  for (const [offset, actorType, actorId] of [
    [42, "axtro_agent", agentAlpha],
    [43, "specialist", id(6)],
    [44, "human_operator", id(7)],
  ]) {
    const request = authorizedRequest({
      token: `dev_action_actor_deny_000${offset - 41}`,
      actorId,
      actorType,
    });
    const denied = await actionRuntime.submitActionIntent(request, actionIntent({
      intentId: id(offset),
      actorId,
      actorType,
      idempotencyKey: `action-runtime-actor-deny-key-000${offset - 41}`,
    }));
    assert.equal(denied.policy_decision.outcome, "deny");
    assert.equal(denied.effect_confirmed, false);
    assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 0);
  }

  const approvalRuntime = runtime("require_approval");
  const approvalRequest = authorizedRequest({ token: "dev_action_approval_alpha_0001" });
  const approvalRequired = await approvalRuntime.submitActionIntent(approvalRequest, actionIntent({
    intentId: id(45),
    idempotencyKey: "action-runtime-approval-key-0001",
  }));
  assert.equal(approvalRequired.policy_decision.outcome, "require_approval");
  assert.equal(approvalRequired.tool_execution_receipt.status, "pending");
  assert.equal(approvalRequired.tool_execution_receipt.effect_hash, null);
  assert.equal(approvalRequired.effect_confirmed, false);
  assert.equal(approvalRuntime.readM0FixtureInvocationCount(approvalRequest), 0);
});

test("idempotent replays and concurrent submissions coalesce to one fixture invocation", async () => {
  const actionRuntime = runtime();
  const request = authorizedRequest({ token: "dev_action_idempotent_alpha_0001" });
  const intent = actionIntent({ intentId: id(46), idempotencyKey: "action-runtime-idempotent-key-0001" });

  const [left, right] = await Promise.all([
    actionRuntime.submitActionIntent(request, intent),
    actionRuntime.submitActionIntent(request, structuredClone(intent)),
  ]);
  assert.strictEqual(left, right);
  assert.equal(left.tool_execution_receipt.attempt, 1);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 1);

  await assert.rejects(
    actionRuntime.submitActionIntent(request, actionIntent({
      intentId: id(47),
      argumentsJson: JSON.stringify({ plan_id: "starter" }),
      idempotencyKey: "action-runtime-idempotent-key-0001",
    })),
    runtimeModule.ActionRuntimeIdempotencyConflictError,
  );
  await assert.rejects(
    actionRuntime.submitActionIntent(request, actionIntent({
      intentId: id(46),
      argumentsJson: JSON.stringify({ plan_id: "starter" }),
      idempotencyKey: "action-runtime-different-key-0001",
    })),
    runtimeModule.ActionRuntimeIntentConflictError,
  );
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 1);
});

test("an idempotent receipt remains readable after its execution window expires", async () => {
  let now = NOW;
  const actionRuntime = runtimeModule.createDeterministicActionRuntime({
    clock: { now: () => now },
    policy_fixture_mode: "default",
  });
  const request = authorizedRequest({ token: "dev_action_expired_replay_0001" });
  const intent = actionIntent({ intentId: id(48), idempotencyKey: "action-runtime-expired-replay-key-0001" });

  const first = await actionRuntime.submitActionIntent(request, intent);
  now = Date.parse("2026-07-14T21:01:00.000Z");
  const replay = await actionRuntime.submitActionIntent(request, structuredClone(intent));
  assert.strictEqual(replay, first);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 1);
});

test("unknown effect is tenant-scoped, immutable and atomically blocks blind retries", async () => {
  const actionRuntime = runtime();
  const request = authorizedRequest({ token: "dev_action_unknown_alpha_0001" });
  const betaRequest = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_action_unknown_beta_0001",
  });
  const unknownIntent = actionIntent({
    intentId: id(49),
    argumentsJson: JSON.stringify({ plan_id: "unknown_effect" }),
    idempotencyKey: "action-runtime-unknown-key-0001",
  });

  const firstPromise = actionRuntime.submitActionIntent(request, unknownIntent);
  await assert.rejects(
    actionRuntime.submitActionIntent(request, actionIntent({
      intentId: id(50),
      sessionId: id(31),
      argumentsJson: JSON.stringify({ plan_id: "unknown_effect" }),
      purpose: "altered_untrusted_retry_purpose",
      idempotencyKey: "action-runtime-unknown-key-0002",
    })),
    runtimeModule.ActionRuntimeOperationInProgressError,
  );
  const first = await firstPromise;
  const replay = await actionRuntime.submitActionIntent(request, structuredClone(unknownIntent));
  assert.strictEqual(first, replay);
  assert.equal(first.tool_execution_receipt.status, "unknown");
  assert.equal(first.tool_execution_receipt.result_json, null);
  assert.equal(first.tool_execution_receipt.effect_hash, null);
  assert.equal(first.effect_confirmed, false);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 1);

  await assert.rejects(
    actionRuntime.submitActionIntent(request, actionIntent({
      intentId: id(51),
      sessionId: id(31),
      argumentsJson: JSON.stringify({ plan_id: "unknown_effect" }),
      purpose: "altered_untrusted_retry_purpose",
      idempotencyKey: "action-runtime-unknown-key-0003",
    })),
    runtimeModule.ActionRuntimeUnknownEffectError,
  );
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 1);

  const betaUnknown = await actionRuntime.submitActionIntent(betaRequest, actionIntent({
    intentId: id(49),
    tenantId: tenantBeta,
    actorId: actorBeta,
    argumentsJson: JSON.stringify({ plan_id: "unknown_effect" }),
    idempotencyKey: "action-runtime-unknown-key-0001",
  }));
  assert.equal(betaUnknown.tool_execution_receipt.status, "unknown");
  assert.equal(actionRuntime.readM0FixtureInvocationCount(betaRequest), 1);
});

test("tenant, actor, scope and purpose boundaries block execution before policy or fixture access", async () => {
  const actionRuntime = runtime();
  const alpha = authorizedRequest({ token: "dev_action_boundary_alpha_0001" });
  const beta = authorizedRequest({ tenantId: tenantBeta, actorId: actorBeta, token: "dev_action_boundary_beta_0001" });
  const sharedKey = "action-runtime-tenant-scoped-key-0001";
  const alphaIntent = actionIntent({ intentId: id(52), idempotencyKey: sharedKey });
  const betaIntent = actionIntent({
    intentId: id(52),
    tenantId: tenantBeta,
    actorId: actorBeta,
    idempotencyKey: sharedKey,
  });

  await assert.rejects(
    actionRuntime.submitActionIntent(alpha, betaIntent),
    runtimeModule.ActionRuntimeAuthorizationError,
  );
  const alphaResult = await actionRuntime.submitActionIntent(alpha, alphaIntent);
  const betaResult = await actionRuntime.submitActionIntent(beta, betaIntent);
  assert.equal(alphaResult.effect_confirmed, true);
  assert.equal(betaResult.effect_confirmed, true);
  assert.notEqual(alphaResult.tool_execution_receipt.tenant_id, betaResult.tool_execution_receipt.tenant_id);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(alpha), 1);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(beta), 1);

  const missingScope = authorizedRequest({
    token: "dev_action_missing_scope_0001",
    scopes: ["session:read"],
  });
  const missingPurpose = authorizedRequest({
    token: "dev_action_missing_purpose_0001",
    purposes: ["essential_processing"],
  });
  await assert.rejects(
    actionRuntime.submitActionIntent(missingScope, actionIntent({ intentId: id(53), idempotencyKey: "action-runtime-missing-scope-0001" })),
    runtimeModule.ActionRuntimeAuthorizationError,
  );
  await assert.rejects(
    actionRuntime.submitActionIntent(missingPurpose, actionIntent({ intentId: id(54), idempotencyKey: "action-runtime-missing-purpose-0001" })),
    runtimeModule.ActionRuntimeAuthorizationError,
  );
  await assert.rejects(
    actionRuntime.submitActionIntent({}, actionIntent({ intentId: id(55), idempotencyKey: "action-runtime-forged-request-0001" })),
    auth.TenantAuthorizationError,
  );
  await assert.rejects(
    actionRuntime.submitActionIntent(alpha, actionIntent({
      intentId: id(56),
      actorId: actorBeta,
      idempotencyKey: "action-runtime-forged-actor-key-0001",
    })),
    runtimeModule.ActionRuntimeAuthorizationError,
  );
  assert.equal(actionRuntime.readM0FixtureInvocationCount(alpha), 1);
});

test("hostile ActionIntent shapes, invalid arguments and inactive windows fail closed before the fixture", async () => {
  const actionRuntime = runtime();
  const request = authorizedRequest({ token: "dev_action_hostile_alpha_0001" });
  const getterIntent = actionIntent({ intentId: id(57), idempotencyKey: "action-runtime-getter-key-0001" });
  Object.defineProperty(getterIntent, "purpose", { get: () => "unexpected", enumerable: true });

  for (const input of [
    getterIntent,
    { ...actionIntent({ intentId: id(58), idempotencyKey: "action-runtime-extra-key-0001" }), untrusted_decision: { outcome: "allow" } },
    actionIntent({ intentId: id(59), argumentsJson: "not-json", idempotencyKey: "action-runtime-json-key-0001" }),
    actionIntent({
      intentId: id(60),
      requestedAt: "2026-07-14T19:00:00Z",
      expiresAt: "2026-07-14T20:00:00Z",
      idempotencyKey: "action-runtime-expired-key-0001",
    }),
  ]) {
    await assert.rejects(actionRuntime.submitActionIntent(request, input));
  }
  const deniedArguments = await actionRuntime.submitActionIntent(request, actionIntent({
    intentId: id(61),
    argumentsJson: JSON.stringify({ plan_id: "growth", endpoint: "https://invalid.example" }),
    idempotencyKey: "action-runtime-args-key-0001",
  }));
  assert.equal(deniedArguments.policy_decision.outcome, "deny");
  assert.equal(deniedArguments.effect_confirmed, false);
  assert.equal(actionRuntime.readM0FixtureInvocationCount(request), 0);
});
