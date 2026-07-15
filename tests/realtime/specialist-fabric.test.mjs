import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const specialistFabric = await import(pathToFileURL(join(root, "packages/specialist-fabric/dist/index.js")).href);

const { createSpecialistFabric, isSpecialistResultExpired } = specialistFabric;

function baseRequest(overrides = {}) {
  return {
    requestId: "req-pricing-001",
    tenantId: "tenant-alpha",
    sessionId: "session-alpha",
    specialistType: "pricing",
    task: "Confirm the enterprise tier discount ceiling for this account.",
    allowedSources: ["catalog_v3"],
    contextVersion: 1,
    deadlineMs: 200,
    dataClassification: "internal",
    ...overrides,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("specialist fabric: a completed request returns structured, untrusted, expiring data", async () => {
  const fabric = createSpecialistFabric();
  fabric.registerHandler("pricing", async () => ({
    answer: { discountCeilingPercent: 15 },
    sources: ["catalog_v3"],
    confidence: 0.9,
    assumptions: ["account is enterprise tier"],
    prohibitedClaims: [],
    ttlMs: 60_000,
  }));

  const result = await fabric.request(baseRequest());
  assert.equal(result.status, "completed");
  assert.equal(result.untrusted, true);
  assert.deepEqual(result.answer, { discountCeilingPercent: 15 });
  assert.equal(isSpecialistResultExpired(result, Date.now()), false);
  assert.equal(isSpecialistResultExpired(result, result.expiresAtMs + 1), true);
});

test("specialist fabric: a slow specialist times out at its own deadline instead of blocking the caller", async () => {
  const fabric = createSpecialistFabric();
  fabric.registerHandler("research", async (_request, control) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ answer: {}, sources: [], confidence: 0.5, assumptions: [], prohibitedClaims: [], ttlMs: 1000 }), 2000);
      control.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    });
    return { answer: {}, sources: [], confidence: 0.5, assumptions: [], prohibitedClaims: [], ttlMs: 1000 };
  });

  const startedAtMs = Date.now();
  const result = await fabric.request(baseRequest({ specialistType: "research", deadlineMs: 50 }));
  assert.equal(result.status, "timeout");
  assert.ok(Date.now() - startedAtMs < 500, "the caller is released near the request deadline, not the handler's real duration");
  assert.equal(fabric.metrics("research").timedOut, 1);
});

test("specialist fabric: a late resolution after timeout is never delivered or counted as completed", async () => {
  const fabric = createSpecialistFabric();
  let lateResolve;
  fabric.registerHandler("fact_checker", () => new Promise((resolve) => { lateResolve = resolve; }));

  const result = await fabric.request(baseRequest({ specialistType: "fact_checker", deadlineMs: 30 }));
  assert.equal(result.status, "timeout");
  lateResolve({ answer: { verified: true }, sources: [], confidence: 1, assumptions: [], prohibitedClaims: [], ttlMs: 1000 });
  await wait(50);
  assert.equal(fabric.metrics("fact_checker").completed, 0, "a late resolution never retroactively completes a timed-out request");
});

test("specialist fabric: an invalid handler output is rejected instead of propagating a malformed result", async () => {
  const fabric = createSpecialistFabric();
  fabric.registerHandler("compliance", async () => ({ answer: { ok: true }, sources: [], confidence: 5, assumptions: [], prohibitedClaims: [], ttlMs: 1000 }));

  const result = await fabric.request(baseRequest({ specialistType: "compliance" }));
  assert.equal(result.status, "invalid_result");
  assert.equal(result.answer, null);
  assert.equal(fabric.metrics("compliance").invalidResult, 1);
});

test("specialist fabric: a bulkhead per type rejects excess concurrent requests instead of queuing forever", async () => {
  const fabric = createSpecialistFabric({ maxConcurrencyPerType: 1, maxQueueDepthPerType: 1 });
  let releaseAll;
  const gate = new Promise((resolve) => { releaseAll = resolve; });
  fabric.registerHandler("product", async () => {
    await gate;
    return { answer: {}, sources: [], confidence: 0.5, assumptions: [], prohibitedClaims: [], ttlMs: 1000 };
  });

  const inFlight = fabric.request(baseRequest({ specialistType: "product", requestId: "req-product-001", deadlineMs: 500 }));
  const queued = fabric.request(baseRequest({ specialistType: "product", requestId: "req-product-002", deadlineMs: 500 }));
  await wait(10);
  const overflow = await fabric.request(baseRequest({ specialistType: "product", requestId: "req-product-003", deadlineMs: 500 }));
  assert.equal(overflow.status, "rejected_queue_full");
  assert.equal(fabric.metrics("product").rejectedQueueFull, 1);

  releaseAll();
  const [firstResult, secondResult] = await Promise.all([inFlight, queued]);
  assert.equal(firstResult.status, "completed");
  assert.equal(secondResult.status, "completed", "a queued request still completes once a slot frees up");
});

test("specialist fabric: One Mouth Rule is mechanically enforced — no publish or speak surface exists", () => {
  const fabric = createSpecialistFabric();
  const methods = Object.keys(fabric);
  assert.deepEqual(methods.sort(), ["metrics", "registerHandler", "request"]);
  for (const method of methods) assert.ok(!/speak|publish|present/i.test(method), "the fabric can never address the channel directly");
});

test("specialist fabric: an unregistered specialist type is a wiring error, not a silent no-op", async () => {
  const fabric = createSpecialistFabric();
  await assert.rejects(fabric.request(baseRequest({ specialistType: "proposal" })));
});

test("specialist fabric: a malformed request is rejected before it reaches any handler", async () => {
  const fabric = createSpecialistFabric();
  let called = false;
  fabric.registerHandler("tool_planner", async () => {
    called = true;
    return { answer: {}, sources: [], confidence: 0.5, assumptions: [], prohibitedClaims: [], ttlMs: 1000 };
  });
  await assert.rejects(fabric.request(baseRequest({ specialistType: "tool_planner", deadlineMs: -5 })));
  assert.equal(called, false);
});
