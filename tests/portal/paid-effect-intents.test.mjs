import assert from "node:assert/strict";
import { test } from "node:test";

const effects = await import("../../apps/portal/src/lib/paid-effects/index.ts");

const COMMAND_A = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const COMMAND_B = "0198a8b2-3c4d-7e5f-8a90-1234567890ac";

function fakeRpc(responses) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        const response = responses[name];
        return typeof response === "function" ? response(args) : response;
      },
    },
  };
}

test("same command id remains the same paid intention after more than 30 seconds", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000;
    const first = effects.paidEffectIntentKey(COMMAND_A, "tavus:video");
    Date.now = () => 61_001;
    const retry = effects.paidEffectIntentKey(COMMAND_A, "tavus:video");
    assert.equal(retry, first);
  } finally {
    Date.now = originalNow;
  }
});

test("a recurring meeting URL with a new human command id is a new paid intention", () => {
  const first = effects.paidEffectIntentKey(COMMAND_A, "recall:meeting");
  const recurring = effects.paidEffectIntentKey(COMMAND_B, "recall:meeting");
  assert.notEqual(recurring, first);
});

test("provider-facing labels retain the full UUIDv7 correlation token within provider limits", () => {
  const tavus = effects.providerCorrelationLabel("Lead " + "x".repeat(200), COMMAND_A, 120);
  const recall = effects.providerCorrelationLabel("Consultora de IA " + "y".repeat(200), COMMAND_A, 100);
  assert.equal(tavus.length, 120);
  assert.equal(recall.length, 100);
  assert.equal(tavus.endsWith(`-${COMMAND_A}`), true);
  assert.equal(recall.endsWith(`-${COMMAND_A}`), true);
});

test("every provider failure remains unknown regardless of HTTP status", async () => {
  const { client, calls } = fakeRpc({
    portal_mark_provider_effect_unknown_service: { data: true, error: null },
  });
  for (const [index, error] of [
    { code: "provider_rejected", httpStatus: 400 },
    { code: "provider_rejected", httpStatus: 401 },
    { code: "provider_rejected", httpStatus: 404 },
    { code: "provider_rejected", httpStatus: 422 },
    { code: "provider_rejected" },
    { code: "provider_rejected", httpStatus: 408 },
    { code: "provider_rejected", httpStatus: 409 },
    { code: "provider_rejected", httpStatus: 425 },
    { code: "provider_rejected", httpStatus: 429 },
    { code: "provider_timeout" },
    { code: "provider_unavailable", httpStatus: 503 },
  ].entries()) {
    assert.equal(effects.deterministicProviderRejection(error), false);
    await effects.fenceProviderFailure(index % 2 === 0 ? COMMAND_A : COMMAND_B, error, client);
  }
  assert.deepEqual(calls.map((call) => call.name), Array(11).fill("portal_mark_provider_effect_unknown_service"));
  assert.equal(calls.some((call) => call.name === "portal_release_provider_effect_service"), false);
});

test("provider create success followed by commit failure retains the known provider ref in cleanup_pending", async () => {
  const { client, calls } = fakeRpc({
    portal_commit_provider_effect_service: { data: null, error: { message: "db unavailable" } },
    portal_mark_provider_effect_cleanup_pending_service: { data: true, error: null },
  });
  await assert.rejects(
    () => effects.commitKnownProviderEffect(COMMAND_A, "conversation-known-123", "https://example.test/room", null, client),
    /provider effect commit failed/,
  );
  assert.deepEqual(calls.map((call) => call.name), [
    "portal_commit_provider_effect_service",
    "portal_mark_provider_effect_cleanup_pending_service",
  ]);
  assert.equal(calls[1].args.p_provider_ref, "conversation-known-123");
  assert.equal(calls[1].args.p_failure_code, "provider_created_commit_failed");
  assert.equal(calls.some((call) => call.name === "portal_release_provider_effect_service"), false);
});

test("known provider ref is terminated exactly once when commit fails, then reconciled", async () => {
  let terminations = 0;
  const { client, calls } = fakeRpc({
    portal_commit_provider_effect_service: { data: null, error: { message: "db unavailable" } },
    portal_mark_provider_effect_cleanup_pending_service: { data: true, error: null },
    portal_reconcile_provider_effect_service: { data: true, error: null },
  });
  await assert.rejects(
    () => effects.commitProviderEffectOrCompensate(
      COMMAND_A,
      "tavus",
      "conversation-known-123",
      async () => { terminations += 1; },
      "https://example.test/room",
      null,
      client,
    ),
    /terminated and reconciled/,
  );
  assert.equal(terminations, 1);
  assert.deepEqual(calls.map((call) => call.name), [
    "portal_commit_provider_effect_service",
    "portal_mark_provider_effect_cleanup_pending_service",
    "portal_reconcile_provider_effect_service",
  ]);
});

test("known provider ref is still terminated once if cleanup fence persistence fails", async () => {
  let terminations = 0;
  const { client, calls } = fakeRpc({
    portal_commit_provider_effect_service: { data: null, error: { message: "db unavailable" } },
    portal_mark_provider_effect_cleanup_pending_service: { data: false, error: { message: "db unavailable" } },
    portal_reconcile_provider_effect_service: { data: true, error: null },
  });
  await assert.rejects(
    () => effects.commitProviderEffectOrCompensate(
      COMMAND_A, "recall", "550e8400-e29b-41d4-a716-446655440000",
      async () => { terminations += 1; }, null, null, client,
    ),
    /terminated and reconciled/,
  );
  assert.equal(terminations, 1);
  assert.equal(calls.at(-1).args.p_provider_receipt_ref, "recall:leave:550e8400-e29b-41d4-a716-446655440000");
});

test("request compensation terminates Tavus and Recall exactly once even when billing void fails", async (t) => {
  for (const scenario of [
    { provider: "tavus", providerRef: "conversation-known-123" },
    { provider: "recall", providerRef: "550e8400-e29b-41d4-a716-446655440000" },
  ]) {
    await t.test(scenario.provider, async () => {
      const events = [];
      let state = "committed";
      let terminations = 0;
      await assert.rejects(
        () => effects.compensateCommittedProviderEffect(
          {
            reservationId: COMMAND_A,
            provider: scenario.provider,
            providerRef: scenario.providerRef,
            failureCode: "delivery_persistence_failed",
            terminate: async () => {
              events.push("terminate");
              terminations += 1;
            },
          },
          {
            markCleanupPending: async () => {
              events.push("cleanup_pending");
              state = "cleanup_pending";
            },
            voidUnleasedBillingUsage: async () => {
              events.push("billing_void_failed");
              throw new Error("billing outbox is delivering");
            },
            reconcileProviderEffect: async () => {
              events.push("released");
              state = "released";
            },
          },
        ),
        /compensation remains pending/,
      );
      assert.equal(terminations, 1);
      assert.equal(state, "cleanup_pending");
      assert.deepEqual(events, ["cleanup_pending", "billing_void_failed", "terminate"]);
    });
  }
});

test("successful compensation and its idempotent replay use the same canonical receipt", async () => {
  const receipts = [];
  let terminations = 0;
  const compensate = () => effects.compensateCommittedProviderEffect(
    {
      reservationId: COMMAND_A,
      provider: "tavus",
      providerRef: "conversation-known-123",
      failureCode: "delivery_persistence_failed",
      terminate: async () => { terminations += 1; },
    },
    {
      markCleanupPending: async () => {},
      voidUnleasedBillingUsage: async () => {},
      reconcileProviderEffect: async (...args) => { receipts.push(args); },
    },
  );

  await compensate();
  await compensate();
  assert.equal(terminations, 2, "one provider termination attempt per request-path invocation");
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts[0], receipts[1]);
  assert.equal(receipts[0][3], "tavus:end:conversation-known-123");
  assert.equal(receipts[0][0], effects.stableProviderReconciliationReceiptId(
    COMMAND_A,
    "compensation_confirmed",
    "tavus:end:conversation-known-123",
  ));
});

test("state transition helpers require an explicit true receipt", async () => {
  const { client } = fakeRpc({
    portal_mark_provider_effect_unknown_service: { data: false, error: null },
  });
  await assert.rejects(
    () => effects.markProviderEffectUnknown(COMMAND_A, "provider_timeout", client),
    /transition not applied/,
  );
});

test("a released deterministic rejection retries with the exact durable generation", async () => {
  const { client, calls } = fakeRpc({
    portal_begin_provider_effect_service: {
      data: { outcome: "reserved", reservationId: COMMAND_B, state: "reserved", billableOverage: false, retryGeneration: 1, customerDeliveryState: "held" },
      error: null,
    },
  });
  const input = { tenantId: COMMAND_A, agentId: COMMAND_B, provider: "tavus", idempotencyKey: "effect:base-key", relatedRef: "portal-video" };
  const released = {
    outcome: "replayed",
    reservationId: COMMAND_A,
    state: "released",
    providerRef: null,
    providerUrl: null,
    billableOverage: false,
    retryGeneration: 1,
    customerDeliveryState: "voided",
    maxDurationSeconds: 600,
    estimatedCostUsd: "3.70",
  };
  const result = await effects.retryReleasedProviderEffect(input, released, client);
  assert.equal(result.state, "reserved");
  assert.equal(result.customerDeliveryState, "held");
  assert.equal(calls[0].args.p_idempotency_key, "effect:base-key:retry:1");
  assert.equal(calls[0].args.p_meter_event_name, "axtro_conversation_overage");
});

test("begin receipt preserves held versus activated delivery state for crash recovery", async () => {
  for (const customerDeliveryState of ["held", "activated"]) {
    const { client } = fakeRpc({
      portal_begin_provider_effect_service: {
        data: { outcome: "replayed", reservationId: COMMAND_A, state: "committed", providerRef: "conv-123", providerUrl: "https://example.test/room", billableOverage: true, retryGeneration: 0, customerDeliveryState },
        error: null,
      },
    });
    const result = await effects.beginProviderEffect({ tenantId: COMMAND_A, agentId: COMMAND_B, provider: "tavus", idempotencyKey: "effect:crash-replay", relatedRef: "portal-video" }, client);
    assert.equal(result.customerDeliveryState, customerDeliveryState);
  }
});

test("begin forwards server-owned max duration and preserves conservative estimate receipt", async () => {
  const { client, calls } = fakeRpc({
    portal_begin_provider_effect_service: {
      data: { outcome: "reserved", reservationId: COMMAND_A, state: "reserved", providerRef: null, providerUrl: null, billableOverage: false, retryGeneration: 0, customerDeliveryState: "held", maxDurationSeconds: 900, estimatedCostUsd: "5.55000000" },
      error: null,
    },
  });
  const receipt = await effects.beginProviderEffect({
    tenantId: COMMAND_A, agentId: COMMAND_B, provider: "tavus",
    idempotencyKey: "effect:max-duration", maxDurationSeconds: 900,
  }, client);
  assert.equal(calls[0].args.p_max_duration_seconds, 900);
  assert.equal(receipt.maxDurationSeconds, 900);
  assert.equal(receipt.estimatedCostUsd, "5.55000000");
});

test("confirmed compensation records a strict durable reconciliation receipt", async () => {
  const { client, calls } = fakeRpc({
    portal_reconcile_provider_effect_service: { data: true, error: null },
  });
  const receiptId = effects.stableProviderReconciliationReceiptId(COMMAND_A, "compensation_confirmed", "tavus:end:conversation-123");
  await effects.reconcileProviderEffect(receiptId, COMMAND_A, "compensation_confirmed", "tavus:end:conversation-123", client);
  assert.equal(calls[0].name, "portal_reconcile_provider_effect_service");
  assert.equal(calls[0].args.p_reservation_id, COMMAND_A);
  assert.equal(calls[0].args.p_evidence, "compensation_confirmed");
  assert.equal(calls[0].args.p_provider_receipt_ref, "tavus:end:conversation-123");
  assert.equal(calls[0].args.p_receipt_id, receiptId);
  assert.equal(effects.stableProviderReconciliationReceiptId(COMMAND_A, "compensation_confirmed", "tavus:end:conversation-123"), receiptId);
});

test("reconciliation helper rejects missing database receipt", async () => {
  const { client } = fakeRpc({
    portal_reconcile_provider_effect_service: { data: false, error: null },
  });
  await assert.rejects(
    () => effects.reconcileProviderEffect(COMMAND_B, COMMAND_A, "reconciliation_absent", "lookup-none-123", client),
    /transition not applied/,
  );
});

test("billing activation requires an explicit activated receipt", async () => {
  const success = fakeRpc({
    portal_activate_provider_effect_billing_service: { data: { activated: true, replayed: false, customerDeliveryState: "activated", billableOverage: true }, error: null },
  });
  await assert.doesNotReject(() => effects.activateProviderEffectBilling(COMMAND_A, success.client));
  const missing = fakeRpc({
    portal_activate_provider_effect_billing_service: { data: { activated: false, replayed: false, customerDeliveryState: "voided", billableOverage: true }, error: null },
  });
  await assert.rejects(() => effects.activateProviderEffectBilling(COMMAND_A, missing.client), /activation receipt missing/);
});
