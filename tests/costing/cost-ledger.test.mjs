import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const costing = await import(pathToFileURL(join(root, "packages/costing/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);
const sessionAlpha = id(10);
const sessionBeta = id(11);

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_700_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 17) & 0xff)),
  );
}

function trace(offset) {
  return offset.toString(16).padStart(32, "0");
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/cost-test-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest(
  tenantId,
  actorId,
  token,
  scopes = ["provider:use", "session:read"],
  purposes = ["essential_processing", "provider_auth"],
) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{
      tenantId,
      grantedScopes: scopes,
      purposes,
    }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function rateCard(authority, unitCostUsd, service = "model", unitType = "token") {
  return authority.issueRateCard({
    rate_card_ref: "catalog/fake-realtime-2026-07-14",
    rate_card_as_of: "2026-07-14T00:00:00Z",
    provider_id: "fake-realtime",
    service,
    unit_type: unitType,
    unit_cost_usd: unitCostUsd,
  });
}

function providerRequest(authority, issuedRateCard, tenantId, sessionId) {
  return authority.issueProviderRequestReference({
    rate_card: issuedRateCard,
    tenant_id: tenantId,
    session_id: sessionId,
  });
}

function costInput({ eventId, tenantId, sessionId, source, quantity, rateCard: issuedRateCard, providerRequest, offset, reconcilesCostEventId, declaredAmountUsd }) {
  return {
    cost_event_id: eventId,
    tenant_id: tenantId,
    session_id: sessionId,
    source,
    quantity,
    occurred_at: "2026-07-14T12:00:00Z",
    trace_id: trace(offset),
    rate_card: issuedRateCard,
    provider_request: providerRequest,
    ...(reconcilesCostEventId === undefined ? {} : { reconciles_cost_event_id: reconcilesCostEventId }),
    ...(declaredAmountUsd === undefined ? {} : { declared_amount_usd: declaredAmountUsd }),
  };
}

test("ledger computes decimal costs with explicit half-up rounding and rejects inconsistent caller totals", () => {
  const ledger = costing.createDeterministicCostLedger();
  const authority = costing.createCostAttributionAuthority();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_cost_rounding_alpha");
  const normalCard = rateCard(authority, "0.2");
  const normalRequest = providerRequest(authority, normalCard, tenantAlpha, sessionAlpha);
  const normal = ledger.record(request, costInput({
    eventId: id(20), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 0.1,
    rateCard: normalCard, providerRequest: normalRequest, offset: 20, declaredAmountUsd: 0.02,
  }));
  assert.equal(normal.amount_usd_decimal, "0.02");
  assert.equal(normal.event.amount_usd, 0.02);

  const tieCard = rateCard(authority, "0.000000005");
  const tieRequest = providerRequest(authority, tieCard, tenantAlpha, sessionAlpha);
  const tie = ledger.record(request, costInput({
    eventId: id(21), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: tieCard, providerRequest: tieRequest, offset: 21, declaredAmountUsd: 0.00000001,
  }));
  assert.equal(tie.amount_usd_decimal, "0.00000001");

  assert.throws(() => ledger.record(request, costInput({
    eventId: id(22), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 0.1,
    rateCard: normalCard, providerRequest: normalRequest, offset: 22, declaredAmountUsd: 0.03,
  })), costing.CostLedgerValidationError);
  assert.equal(ledger.list(request).length, 2);
});

test("estimated, measured, and provider-reported evidence stays append-only and aggregates separately", () => {
  const ledger = costing.createDeterministicCostLedger();
  const authority = costing.createCostAttributionAuthority();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_cost_sources_alpha");
  const estimatedCard = rateCard(authority, "0.034");
  const measuredCard = rateCard(authority, "0.04");
  const reportedCard = rateCard(authority, "0.038");
  const estimateId = id(30);
  const estimate = ledger.record(request, costInput({
    eventId: estimateId, tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 10,
    rateCard: estimatedCard, providerRequest: providerRequest(authority, estimatedCard, tenantAlpha, sessionAlpha), offset: 30,
  }));
  const measured = ledger.record(request, costInput({
    eventId: id(31), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "measured", quantity: 10,
    rateCard: measuredCard, providerRequest: providerRequest(authority, measuredCard, tenantAlpha, sessionAlpha), offset: 31,
    reconcilesCostEventId: estimateId,
  }));
  const reported = ledger.record(request, costInput({
    eventId: id(32), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "provider_reported", quantity: 10,
    rateCard: reportedCard, providerRequest: providerRequest(authority, reportedCard, tenantAlpha, sessionAlpha), offset: 32,
    reconcilesCostEventId: estimateId,
  }));

  assert.equal(estimate.amount_usd_decimal, "0.34");
  assert.equal(measured.amount_usd_decimal, "0.4");
  assert.equal(reported.amount_usd_decimal, "0.38");
  assert.equal(Object.isFrozen(estimate.event), true);
  assert.deepEqual(ledger.aggregate(request, { session_id: sessionAlpha }).buckets.map((bucket) => [
    bucket.source, bucket.unit_type, bucket.amount_usd_decimal,
  ]), [
    ["estimated", "token", "0.34"],
    ["measured", "token", "0.4"],
    ["provider_reported", "token", "0.38"],
  ]);
  assert.deepEqual(ledger.aggregate(request, { session_id: sessionAlpha }).reconciliations, [{
    estimated_cost_event_id: estimateId,
    estimated_amount_usd_decimal: "0.34",
    measured_amount_usd_decimal: "0.4",
    provider_reported_amount_usd_decimal: "0.38",
    measured_variance_usd_decimal: "0.06",
    provider_reported_variance_usd_decimal: "0.04",
  }]);
});

test("record identity is tenant-scoped, idempotent, and immutable under duplicate delivery", async () => {
  const ledger = costing.createDeterministicCostLedger();
  const authority = costing.createCostAttributionAuthority();
  const alpha = authorizedRequest(tenantAlpha, actorAlpha, "dev_cost_identity_alpha");
  const beta = authorizedRequest(tenantBeta, actorBeta, "dev_cost_identity_beta");
  const alphaCard = rateCard(authority, "0.1");
  const betaCard = rateCard(authority, "0.1");
  const eventId = id(40);
  const alphaInput = costInput({
    eventId, tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: alphaCard, providerRequest: providerRequest(authority, alphaCard, tenantAlpha, sessionAlpha), offset: 40,
  });
  const first = ledger.record(alpha, alphaInput);
  const replayed = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => ledger.record(alpha, alphaInput))));
  assert.equal(replayed.every((record) => record === first), true);
  assert.equal(ledger.list(alpha).length, 1);
  assert.throws(() => ledger.record(alpha, { ...alphaInput, quantity: 2 }), costing.CostLedgerConflictError);

  ledger.record(beta, costInput({
    eventId, tenantId: tenantBeta, sessionId: sessionBeta, source: "estimated", quantity: 1,
    rateCard: betaCard, providerRequest: providerRequest(authority, betaCard, tenantBeta, sessionBeta), offset: 41,
  }));
  assert.equal(ledger.get(alpha, eventId), first);
  assert.equal(ledger.get(beta, eventId)?.event.tenant_id, tenantBeta);
  assert.throws(() => ledger.record(alpha, costInput({
    eventId: id(42), tenantId: tenantBeta, sessionId: sessionBeta, source: "estimated", quantity: 1,
    rateCard: alphaCard, providerRequest: providerRequest(authority, alphaCard, tenantAlpha, sessionAlpha), offset: 42,
  })), domain.TenantBoundaryError);
  assert.throws(() => ledger.list({}), auth.TenantAuthorizationError);
});

test("ledger fails closed for invalid precision, overflow, forged capabilities, scopes, and injected rollback", () => {
  const authority = costing.createCostAttributionAuthority();
  const card = rateCard(authority, "0.1");
  const requestReference = providerRequest(authority, card, tenantAlpha, sessionAlpha);
  const writer = authorizedRequest(tenantAlpha, actorAlpha, "dev_cost_validation_alpha");
  const readOnly = authorizedRequest(tenantAlpha, actorAlpha, "dev_cost_readonly_alpha", ["session:read"]);
  const wrongPurpose = authorizedRequest(
    tenantAlpha,
    actorAlpha,
    "dev_cost_wrong_purpose_alpha",
    ["provider:use", "session:read"],
    ["provider_auth"],
  );
  const ledger = costing.createDeterministicCostLedger();
  const valid = costInput({
    eventId: id(50), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: card, providerRequest: requestReference, offset: 50,
  });

  for (const invalid of [
    { ...valid, cost_event_id: id(51), quantity: 0.000000001 },
    { ...valid, cost_event_id: id(52), quantity: Number.NaN },
    { ...valid, cost_event_id: id(53), quantity: -1 },
    { ...valid, cost_event_id: id(54), quantity: 1000000000000 },
    { ...valid, cost_event_id: id(55), rate_card: {} },
    { ...valid, cost_event_id: id(56), unexpected: "field" },
  ]) {
    assert.throws(() => ledger.record(writer, invalid), costing.CostLedgerValidationError);
  }
  assert.throws(() => ledger.record(readOnly, valid), costing.CostLedgerAuthorizationError);
  assert.throws(() => ledger.record(wrongPurpose, valid), costing.CostLedgerAuthorizationError);
  assert.throws(() => ledger.aggregate(wrongPurpose, { session_id: sessionAlpha }), costing.CostLedgerAuthorizationError);
  assert.equal(ledger.list(writer).length, 0);

  assert.throws(() => ledger.record(writer, costInput({
    eventId: id(57), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: card, providerRequest: providerRequest(authority, rateCard(authority, "0.2"), tenantAlpha, sessionAlpha), offset: 57,
  })), costing.CostLedgerValidationError);
  const otherSessionRequest = providerRequest(authority, card, tenantAlpha, sessionAlpha);
  assert.throws(() => ledger.record(writer, costInput({
    eventId: id(58), tenantId: tenantAlpha, sessionId: sessionBeta, source: "estimated", quantity: 1,
    rateCard: card, providerRequest: otherSessionRequest, offset: 58,
  })), costing.CostLedgerValidationError);
  assert.throws(() => ledger.record(writer, {
    ...valid,
    cost_event_id: id(59),
    occurred_at: "2026-02-31T00:00:00Z",
    trace_id: trace(59),
    provider_request: providerRequest(authority, card, tenantAlpha, sessionAlpha),
  }), costing.CostLedgerValidationError);

  const lossyCard = rateCard(authority, "9999999999.1234567890");
  assert.throws(() => ledger.record(writer, costInput({
    eventId: id(60), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: lossyCard, providerRequest: providerRequest(authority, lossyCard, tenantAlpha, sessionAlpha), offset: 60,
  })), costing.CostLedgerValidationError);

  const accepted = ledger.record(writer, valid);
  assert.equal(accepted.event.cost_event_id, id(50));
  assert.throws(() => ledger.record(writer, {
    ...valid,
    cost_event_id: id(61),
    trace_id: trace(61),
  }), costing.CostLedgerConflictError);

  const secondAuthority = costing.createCostAttributionAuthority();
  const secondCard = rateCard(secondAuthority, "0.1");
  const fromSecondAuthority = ledger.record(writer, costInput({
    eventId: id(64), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: secondCard, providerRequest: providerRequest(secondAuthority, secondCard, tenantAlpha, sessionAlpha), offset: 64,
  }));
  assert.notEqual(fromSecondAuthority.event.provider_request_ref, accepted.event.provider_request_ref);

  for (const [faultPoint, retryId] of [["after_cost_event_insert", 62], ["before_commit", 63]]) {
    const rollbackLedger = costing.createDeterministicCostLedger({ faultPoints: [faultPoint] });
    const retryInput = {
      ...valid,
      cost_event_id: id(retryId),
      trace_id: trace(retryId),
      provider_request: providerRequest(authority, card, tenantAlpha, sessionAlpha),
    };
    assert.throws(() => rollbackLedger.record(writer, retryInput), costing.CostLedgerTransactionError);
    assert.deepEqual(rollbackLedger.list(writer), []);
    assert.equal(rollbackLedger.record(writer, retryInput).event.cost_event_id, id(retryId));
    assert.equal(rollbackLedger.list(writer).length, 1);
  }
});

test("reconciliation requires same-tenant estimated evidence with matching attribution dimensions", () => {
  const ledger = costing.createDeterministicCostLedger();
  const authority = costing.createCostAttributionAuthority();
  const alpha = authorizedRequest(tenantAlpha, actorAlpha, "dev_cost_reconcile_alpha");
  const beta = authorizedRequest(tenantBeta, actorBeta, "dev_cost_reconcile_beta");
  const card = rateCard(authority, "0.1");
  const estimateId = id(60);
  ledger.record(alpha, costInput({
    eventId: estimateId, tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: card, providerRequest: providerRequest(authority, card, tenantAlpha, sessionAlpha), offset: 60,
  }));
  const betaCard = rateCard(authority, "0.1");
  assert.throws(() => ledger.record(beta, costInput({
    eventId: id(61), tenantId: tenantBeta, sessionId: sessionBeta, source: "measured", quantity: 1,
    rateCard: betaCard, providerRequest: providerRequest(authority, betaCard, tenantBeta, sessionBeta), offset: 61,
    reconcilesCostEventId: estimateId,
  })), costing.CostLedgerReconciliationError);
  assert.throws(() => ledger.record(alpha, costInput({
    eventId: id(62), tenantId: tenantAlpha, sessionId: sessionAlpha, source: "estimated", quantity: 1,
    rateCard: card, providerRequest: providerRequest(authority, card, tenantAlpha, sessionAlpha), offset: 62,
    reconcilesCostEventId: estimateId,
  })), costing.CostLedgerReconciliationError);
});
