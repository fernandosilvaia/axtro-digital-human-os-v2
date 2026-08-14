import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { StripeBillingError } from "../../packages/provider-stripe/dist/index.js";

import {
  authorizeBillingDispatch,
  dispatchBillingUsageOutbox,
  isBillingUsageDispatchEnabled,
} from "../../apps/portal/src/lib/billing/usage-outbox.ts";

const SECRET = "billing-dispatch-secret-for-tests";
const ROW = Object.freeze({
  id: "0198f5d0-45c0-7000-8000-000000000001",
  reservationId: "0198f5d0-45c0-7000-8000-000000000002",
  costEventId: "0198f5d0-45c0-7000-8000-000000000003",
  stripeCustomerId: "cus_T3st0000000000",
  eventName: "axtro_conversation_overage",
  quantity: 1,
  idempotencyKey: "billing:cost:0198f5d0-45c0-7000-8000-000000000003",
  billingPeriodStart: "2026-08-01T00:00:00.000Z",
  billingPeriodEnd: "2026-09-01T00:00:00.000Z",
  meterEventAt: "2026-08-13T12:00:00.000Z",
  attempts: 1,
});

const BACKLOG = Object.freeze({
  pending: 0,
  oldestAgeSeconds: 0,
  deadLetter: 0,
  held: 0,
  oldestHeldAgeSeconds: 0,
  providerInFlight: 0,
  unknown: 0,
  cleanupPending: 0,
  oldestProviderPendingAgeSeconds: 0,
});

function testUuid(sequence) {
  return `0198f5d0-45c0-7000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function dependencies(rpc, reportOverageUsage, options = {}) {
  let leaseCalls = 0;
  let tokenCalls = 0;
  const boundedRpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") {
      leaseCalls += 1;
      if (options.multipleLeases !== true && leaseCalls > 1) return ok([]);
    }
    return rpc(name, parameters);
  };
  return {
    env: {
      STRIPE_SECRET_KEY: "sk_test_dispatcher",
      STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "axtro_conversation_overage",
      STRIPE_PRICE_PILOTO_BASE: "price_piloto_base_123",
      STRIPE_PRICE_PILOTO_OVERAGE: "price_piloto_over_123",
      STRIPE_PRICE_CRESCIMENTO_BASE: "price_growth_base_123",
      STRIPE_PRICE_CRESCIMENTO_OVERAGE: "price_growth_over_123",
      STRIPE_PRICE_ESCALA_BASE: "price_scale_base_123",
      STRIPE_PRICE_ESCALA_OVERAGE: "price_scale_over_123",
    },
    createClient: () => ({ rpc: boundedRpc }),
    createPort: () => ({
      reportOverageUsage,
      verifyBillingCatalog: options.verifyBillingCatalog ?? (async (expectation) => ({
        verified: true,
        meterId: "mtr_test_axtro",
        eventName: expectation.eventName,
        livemode: expectation.livemode,
        priceCount: expectation.prices.length,
      })),
    }),
    createLeaseToken: options.createLeaseToken ?? (() => testUuid(0x100 + tokenCalls++)),
    logEvent: () => {},
    logError: () => {},
  };
}

function ok(data) {
  return { data, error: null };
}

test("billing dispatcher auth fails closed for missing config, missing bearer and a wrong secret", () => {
  assert.equal(authorizeBillingDispatch(`Bearer ${SECRET}`, undefined), "not_configured");
  assert.equal(authorizeBillingDispatch(null, SECRET), "unauthorized");
  assert.equal(authorizeBillingDispatch("Basic ignored", SECRET), "unauthorized");
  assert.equal(authorizeBillingDispatch(`Bearer ${"x".repeat(SECRET.length)}`, SECRET), "unauthorized");
  assert.equal(authorizeBillingDispatch(`Bearer ${SECRET}`, SECRET), "authorized");
  assert.equal(isBillingUsageDispatchEnabled({ BILLING_USAGE_OUTBOX_ENABLED: "true" }), true);
  assert.equal(isBillingUsageDispatchEnabled({ BILLING_USAGE_OUTBOX_ENABLED: "false" }), false);
  assert.equal(isBillingUsageDispatchEnabled({ BILLING_USAGE_OUTBOX_ENABLED: "yes" }), false);
});

test("catalog preflight rejects semantic drift before leasing a billable row", async () => {
  let rpcCalls = 0;
  const deps = dependencies(
    async () => { rpcCalls += 1; return ok([]); },
    async () => {},
    {
      verifyBillingCatalog: async () => {
        throw new StripeBillingError("invalid_request", "old US$10 overage price");
      },
    },
  );
  await assert.rejects(() => dispatchBillingUsageOutbox(20, deps), /old US\$10 overage price/);
  assert.equal(rpcCalls, 0, "a mismatched Stripe catalog cannot acquire an outbox lease");
});

test("transient retry carries meter name and persisted meter timestamp with one stable idempotency key", async () => {
  const providerRequests = [];
  let run = 0;
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") {
      run += 1;
      return ok([{ ...ROW, attempts: run }]);
    }
    if (name === "portal_fail_billing_usage_service") {
      assert.equal(parameters.p_permanent, false);
      return ok(true);
    }
    if (name === "portal_ack_billing_usage_service") return ok(true);
    if (name === "portal_billing_usage_backlog_service") {
      return ok({
        ...BACKLOG,
        pending: run === 1 ? 1 : 0,
        oldestAgeSeconds: run === 1 ? 30 : 0,
        held: 2,
        oldestHeldAgeSeconds: 45,
        providerInFlight: 3,
        unknown: 1,
        cleanupPending: 1,
        oldestProviderPendingAgeSeconds: 90,
      });
    }
    throw new Error(`unexpected RPC ${name}`);
  };
  const report = async (request) => {
    providerRequests.push(request);
    if (providerRequests.length === 1) {
      const error = new Error("ambiguous timeout");
      error.name = "StripeBillingError";
      // A non-provider exception is deliberately transient too: it covers an
      // ambiguous adapter/ack path while retaining the stable Stripe key.
      throw error;
    }
  };

  const first = await dispatchBillingUsageOutbox(20, dependencies(rpc, report));
  const second = await dispatchBillingUsageOutbox(20, dependencies(rpc, report));

  assert.equal(first.failed, 1);
  assert.deepEqual(
    {
      held: first.held,
      oldestHeldAgeSeconds: first.oldestHeldAgeSeconds,
      providerInFlight: first.providerInFlight,
      unknown: first.unknown,
      cleanupPending: first.cleanupPending,
      oldestProviderPendingAgeSeconds: first.oldestProviderPendingAgeSeconds,
    },
    {
      held: 2,
      oldestHeldAgeSeconds: 45,
      providerInFlight: 3,
      unknown: 1,
      cleanupPending: 1,
      oldestProviderPendingAgeSeconds: 90,
    },
  );
  assert.equal(second.delivered, 1);
  assert.equal(providerRequests.length, 2);
  assert.equal(providerRequests[0].idempotencyKey, ROW.idempotencyKey);
  assert.equal(providerRequests[1].idempotencyKey, ROW.idempotencyKey);
  assert.equal(providerRequests[0].eventName, ROW.eventName);
  assert.equal(providerRequests[0].eventTimestamp, ROW.meterEventAt);
  assert.notEqual(providerRequests[0].eventTimestamp, ROW.billingPeriodStart);
});

test("a malformed row is dead-lettered without blocking a valid row in the same bounded run", async () => {
  const providerRequests = [];
  const failures = [];
  const leaseTokens = [];
  const acknowledgements = [];
  const poison = { ...ROW, id: "0198f5d0-45c0-7000-8000-000000000099", stripeCustomerId: null };
  const candidates = [poison, ROW];
  let candidateIndex = 0;
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") {
      leaseTokens.push(parameters.p_lease_token);
      const candidate = candidates[candidateIndex++];
      return ok(candidate === undefined ? [] : [candidate]);
    }
    if (name === "portal_fail_billing_usage_service") {
      failures.push(parameters);
      return ok(true);
    }
    if (name === "portal_ack_billing_usage_service") {
      acknowledgements.push(parameters);
      return ok(true);
    }
    if (name === "portal_billing_usage_backlog_service") return ok({ ...BACKLOG, deadLetter: 1 });
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await dispatchBillingUsageOutbox(
    20,
    dependencies(rpc, async (request) => providerRequests.push(request), { multipleLeases: true }),
  );
  assert.equal(result.leased, 2);
  assert.equal(result.deadLettered, 1);
  assert.equal(result.delivered, 1);
  assert.equal(providerRequests.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].p_id, poison.id);
  assert.equal(failures[0].p_error_code, "invalid_outbox_row");
  assert.equal(failures[0].p_permanent, true);
  assert.equal(failures[0].p_lease_token, leaseTokens[0]);
  assert.equal(acknowledgements[0].p_lease_token, leaseTokens[1]);
  assert.notEqual(leaseTokens[0], leaseTokens[1]);
});

test("meter event instants outside the frozen billing period are isolated as poison rows", async () => {
  for (const row of [
    { ...ROW, meterEventAt: "2026-07-31T23:59:59.999Z" },
    { ...ROW, meterEventAt: ROW.billingPeriodEnd },
    { ...ROW, billingPeriodEnd: "not-an-instant" },
  ]) {
    let poisonFailure;
    const rpc = async (name, parameters) => {
      if (name === "portal_lease_billing_usage_service") return ok([row]);
      if (name === "portal_fail_billing_usage_service") {
        poisonFailure = parameters;
        return ok(true);
      }
      if (name === "portal_billing_usage_backlog_service") return ok({ ...BACKLOG, deadLetter: 1 });
      throw new Error(`unexpected RPC ${name}`);
    };
    const result = await dispatchBillingUsageOutbox(20, dependencies(rpc, async () => {}));
    assert.equal(result.deadLettered, 1);
    assert.equal(poisonFailure.p_permanent, true);
  }
});

test("ack data=false is not a receipt and schedules a retry with the same durable row", async () => {
  const failures = [];
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") return ok([ROW]);
    if (name === "portal_ack_billing_usage_service") return ok(false);
    if (name === "portal_fail_billing_usage_service") {
      failures.push(parameters);
      return ok(true);
    }
    if (name === "portal_billing_usage_backlog_service") return ok({ ...BACKLOG, pending: 1, oldestAgeSeconds: 12 });
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await dispatchBillingUsageOutbox(20, dependencies(rpc, async () => {}));
  assert.deepEqual(
    { delivered: result.delivered, failed: result.failed, backlog: result.backlog, oldest: result.oldestAgeSeconds },
    { delivered: 0, failed: 1, backlog: 1, oldest: 12 },
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].p_permanent, false);
});

test("fail data=false is rejected instead of being counted as persisted", async () => {
  const rpc = async (name) => {
    if (name === "portal_lease_billing_usage_service") return ok([ROW]);
    if (name === "portal_fail_billing_usage_service") return ok(false);
    throw new Error(`unexpected RPC ${name}`);
  };

  await assert.rejects(
    () => dispatchBillingUsageOutbox(20, dependencies(rpc, async () => { throw new Error("network"); })),
    /billing usage batch completed with unpersisted row failures/,
  );
});

test("a failure-receipt outage is reported after later rows still finish", async () => {
  const second = {
    ...ROW,
    id: "0198f5d0-45c0-7000-8000-000000000020",
    idempotencyKey: "billing:cost:0198f5d0-45c0-7000-8000-000000000020",
  };
  const reports = [];
  const acknowledgements = [];
  const rows = [ROW, second];
  let rowIndex = 0;
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") {
      const row = rows[rowIndex++];
      return ok(row === undefined ? [] : [row]);
    }
    if (name === "portal_fail_billing_usage_service") return ok(false);
    if (name === "portal_ack_billing_usage_service") {
      acknowledgements.push(parameters.p_id);
      return ok(true);
    }
    if (name === "portal_billing_usage_backlog_service") return ok(BACKLOG);
    throw new Error(`unexpected RPC ${name}`);
  };

  await assert.rejects(
    () => dispatchBillingUsageOutbox(20, dependencies(rpc, async (request) => {
      reports.push(request.idempotencyKey);
      if (request.idempotencyKey === ROW.idempotencyKey) throw new Error("ambiguous network failure");
    }, { multipleLeases: true })),
    /billing usage batch completed with unpersisted row failures/,
  );
  assert.deepEqual(reports, [ROW.idempotencyKey, second.idempotencyKey]);
  assert.deepEqual(acknowledgements, [second.id]);
});

test("retry budget is bounded and moves an exhausted event to the durable dead letter", async () => {
  let failureParameters;
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") return ok([{ ...ROW, attempts: 8 }]);
    if (name === "portal_fail_billing_usage_service") {
      failureParameters = parameters;
      return ok(true);
    }
    if (name === "portal_billing_usage_backlog_service") return ok({ ...BACKLOG, deadLetter: 1 });
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await dispatchBillingUsageOutbox(20, dependencies(rpc, async () => { throw new Error("still ambiguous"); }));
  assert.equal(failureParameters.p_permanent, true);
  assert.equal(failureParameters.p_error_code, "retry_exhausted");
  assert.equal(result.deadLettered, 1);
  assert.equal(result.deadLetterBacklog, 1);
});

test("a deterministic Stripe rejection goes directly to dead letter without blind retries", async () => {
  let failureParameters;
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") return ok([ROW]);
    if (name === "portal_fail_billing_usage_service") {
      failureParameters = parameters;
      return ok(true);
    }
    if (name === "portal_billing_usage_backlog_service") return ok({ ...BACKLOG, deadLetter: 1 });
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await dispatchBillingUsageOutbox(
    20,
    dependencies(rpc, async () => { throw new StripeBillingError("provider_rejected", "HTTP 400", 400); }),
  );
  assert.equal(failureParameters.p_permanent, true);
  assert.equal(failureParameters.p_error_code, "provider_rejected");
  assert.equal(result.deadLettered, 1);
});

test("Stripe 408/409/425/429 permanece retryable e respeita Retry-After com a mesma chave", async () => {
  for (const status of [408, 409, 425, 429]) {
    let failureParameters;
    const rpc = async (name, parameters) => {
      if (name === "portal_lease_billing_usage_service") return ok([ROW]);
      if (name === "portal_fail_billing_usage_service") {
        failureParameters = parameters;
        return ok(true);
      }
      if (name === "portal_billing_usage_backlog_service") return ok({ ...BACKLOG, pending: 1 });
      throw new Error(`unexpected RPC ${name}`);
    };
    const result = await dispatchBillingUsageOutbox(
      20,
      dependencies(rpc, async () => { throw new StripeBillingError("provider_rejected", `HTTP ${status}`, status, 17); }),
    );
    assert.equal(failureParameters.p_permanent, false, `HTTP ${status}`);
    assert.equal(failureParameters.p_retry_seconds, 17, `HTTP ${status}`);
    assert.equal(result.failed, 1, `HTTP ${status}`);
    assert.equal(result.deadLettered, 0, `HTTP ${status}`);
  }
});

test("twenty legal 20-second calls receive fresh one-row leases instead of aging inside one batch lease", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    ...ROW,
    id: testUuid(0x2000 + index),
    idempotencyKey: `billing:cost:${testUuid(0x3000 + index)}`,
  }));
  const activeLeases = new Map();
  const leaseInstants = [];
  const leaseTokens = [];
  const acknowledgementAges = [];
  let fakeNowMs = 0;
  let rowIndex = 0;
  let tokenIndex = 0;

  const rpc = async (name, parameters) => {
    if (name === "portal_lease_billing_usage_service") {
      assert.equal(parameters.p_limit, 1);
      assert.equal(parameters.p_lease_seconds, 60);
      const row = rows[rowIndex++];
      assert.ok(row, "the bounded loop must not request more than twenty rows");
      leaseInstants.push(fakeNowMs);
      leaseTokens.push(parameters.p_lease_token);
      activeLeases.set(row.id, { token: parameters.p_lease_token, leasedAt: fakeNowMs });
      return ok([row]);
    }
    if (name === "portal_ack_billing_usage_service") {
      const active = activeLeases.get(parameters.p_id);
      assert.ok(active);
      assert.equal(parameters.p_lease_token, active.token);
      acknowledgementAges.push(fakeNowMs - active.leasedAt);
      return ok(true);
    }
    if (name === "portal_billing_usage_backlog_service") return ok(BACKLOG);
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await dispatchBillingUsageOutbox(
    20,
    dependencies(
      rpc,
      async (request) => {
        assert.ok(rows.some((row) => row.idempotencyKey === request.idempotencyKey));
        fakeNowMs += 20_000;
      },
      {
        multipleLeases: true,
        createLeaseToken: () => testUuid(0x5000 + tokenIndex++),
      },
    ),
  );

  assert.equal(result.leased, 20);
  assert.equal(result.delivered, 20);
  assert.equal(new Set(leaseTokens).size, 20);
  assert.deepEqual(leaseInstants, Array.from({ length: 20 }, (_, index) => index * 20_000));
  assert.deepEqual(acknowledgementAges, Array.from({ length: 20 }, () => 20_000));
  assert.equal(leaseInstants.at(-1), 380_000);
});

test("a repeated lease token fails closed before a second row can be claimed", async () => {
  const fixedToken = testUuid(0x6000);
  let leaseCalls = 0;
  const providerRequests = [];
  const rpc = async (name) => {
    if (name === "portal_lease_billing_usage_service") {
      leaseCalls += 1;
      return ok([ROW]);
    }
    if (name === "portal_ack_billing_usage_service") return ok(true);
    throw new Error(`unexpected RPC ${name}`);
  };

  await assert.rejects(
    () => dispatchBillingUsageOutbox(
      2,
      dependencies(
        rpc,
        async (request) => providerRequests.push(request),
        { multipleLeases: true, createLeaseToken: () => fixedToken },
      ),
    ),
    /lease token must be unique per row/,
  );
  assert.equal(leaseCalls, 1);
  assert.deepEqual(providerRequests.map((request) => request.idempotencyKey), [ROW.idempotencyKey]);
});

test("scheduled dispatcher is periodic, manually runnable and validates URL/secret before curl", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/billing-usage-dispatch.yml", import.meta.url), "utf8");
  assert.match(workflow, /schedule:\s*\n\s*- cron: ['"]\*\/5 \* \* \* \*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| vars\.BILLING_DISPATCH_SCHEDULE_ENABLED == 'true'/);
  assert.match(workflow, /timeout-minutes:\s*10/);
  assert.match(workflow, /vars\.BILLING_DISPATCH_URL/);
  assert.match(workflow, /secrets\.BILLING_DISPATCH_SECRET/);
  assert.match(workflow, /BILLING_DISPATCH_URL must be an https URL/);
  assert.match(workflow, /BILLING_DISPATCH_SECRET is not configured/);
  assert.match(workflow, /--max-time 480/);
  assert.doesNotMatch(workflow, /^\s*--retry\b/m);
  assert.match(workflow, /Authorization: Bearer \$\{BILLING_DISPATCH_SECRET\}/);
  assert.match(workflow, /jq -e -f scripts\/worker-response-gate\.jq/);
  assert.match(workflow, /held,oldestHeldAgeSeconds,providerInFlight,unknown,cleanupPending,oldestProviderPendingAgeSeconds/);
  const route = await readFile(new URL("../../apps/portal/src/app/api/internal/billing-usage/route.ts", import.meta.url), "utf8");
  assert.match(route, /isBillingUsageDispatchEnabled\(env\)/);
  const runbook = await readFile(new URL("../../docs/operations/BILLING_USAGE_DISPATCHER.md", import.meta.url), "utf8");
  assert.match(runbook, /BILLING_DISPATCH_SCHEDULE_ENABLED=true/);
  assert.match(runbook, /URL\/ID da execução, commit SHA/);
  assert.match(runbook, /failed=0.*deadLettered=0.*deadLetterBacklog=0.*unknown=0.*cleanupPending=0/s);
  assert.match(runbook, /test mode/);
});

test("worker response gate fails closed for every critical result and backlog counter", () => {
  const gate = fileURLToPath(new URL("../../scripts/worker-response-gate.jq", import.meta.url));
  const run = (payload) => spawnSync("jq", ["-e", "-f", gate], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  }).status;

  const billingSuccess = Object.freeze({
    ok: true,
    catalogVerified: true,
    failed: 0,
    deadLettered: 0,
    deadLetterBacklog: 0,
    unknown: 0,
    cleanupPending: 0,
  });
  assert.equal(run(billingSuccess), 0, "billing payload may omit operatorRequired");
  const reconcilerSuccess = { ...billingSuccess, operatorRequired: 0 };
  delete reconcilerSuccess.catalogVerified;
  assert.equal(run(reconcilerSuccess), 0, "reconciler payload requires zero operator work");

  assert.notEqual(run({ ...billingSuccess, ok: false }), 0);
  assert.notEqual(run({ ...billingSuccess, catalogVerified: false }), 0);
  const missingCatalog = { ...billingSuccess };
  delete missingCatalog.catalogVerified;
  assert.notEqual(run(missingCatalog), 0, "billing payload cannot omit catalog verification");
  for (const counter of ["failed", "deadLettered", "deadLetterBacklog", "unknown", "cleanupPending"]) {
    const absent = { ...billingSuccess };
    delete absent[counter];
    assert.notEqual(run(absent), 0, `${counter} cannot be absent`);
    for (const value of [null, "0", 1]) {
      assert.notEqual(run({ ...billingSuccess, [counter]: value }), 0, `${counter}=${String(value)} must fail`);
    }
  }
  for (const value of [null, "0", 1]) {
    assert.notEqual(
      run({ ...billingSuccess, operatorRequired: value }),
      0,
      `operatorRequired=${String(value)} must fail when present`,
    );
  }
});
