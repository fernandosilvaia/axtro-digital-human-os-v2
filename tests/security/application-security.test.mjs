import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const security = await import(pathToFileURL(join(root, "packages/security/dist/index.js")).href);

class ManualRuntime {
  nowValue = 10_000;
  nextId = 1;
  timers = new Map();

  now = () => this.nowValue;

  setTimeout = (callback, delayMs) => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { callback, dueAt: this.nowValue + delayMs });
    return id;
  };

  clearTimeout = (id) => {
    this.timers.delete(id);
  };

  advance(milliseconds) {
    this.nowValue += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueAt <= this.nowValue)
      .sort(([left], [right]) => left - right);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

function gate(runtime = new ManualRuntime()) {
  return {
    runtime,
    gate: security.createApplicationSecurityGate({
      requestTimeoutMs: 100,
      clock: { now: runtime.now },
      timer: { setTimeout: runtime.setTimeout, clearTimeout: runtime.clearTimeout },
    }),
  };
}

test("application ingress measures actual bytes, bounds chunk collection, and keeps response headers closed", () => {
  const fixture = gate();
  const collector = fixture.gate.createBodyCollector();
  collector.append(new Uint8Array(65_535));
  assert.throws(
    () => collector.append(new Uint8Array(2)),
    (error) => error instanceof security.ApplicationSecurityError && error.code === "request_body_too_large",
  );
  assert.throws(() => collector.finish(), security.ApplicationSecurityError);
  const singleOversizedChunk = fixture.gate.createBodyCollector();
  assert.throws(
    () => singleOversizedChunk.append(new Uint8Array(65_537)),
    (error) => error instanceof security.ApplicationSecurityError && error.code === "request_body_too_large",
  );
  assert.throws(() => singleOversizedChunk.append(new Uint8Array([7])), security.ApplicationSecurityError);
  assert.throws(() => singleOversizedChunk.finish(), security.ApplicationSecurityError);

  const rawBody = new Uint8Array([1, 2, 3]);
  const ingress = fixture.gate.inspectInboundRequest({
    headers: { "Content-Length": "1", "X-Request-Id": "safe" },
    body: rawBody,
  });
  rawBody[0] = 99;
  assert.deepEqual([...fixture.gate.readInboundBody(ingress)], [1, 2, 3]);
  assert.deepEqual(fixture.gate.readInboundHeaders(ingress), {
    "content-length": "1",
    "x-request-id": "safe",
  });
  assert.throws(
    () => fixture.gate.inspectInboundRequest({
      headers: { "Content-Length": "1" },
      body: new Uint8Array(65_537),
    }),
    (error) => error instanceof security.ApplicationSecurityError && error.code === "request_body_too_large",
  );

  const hostileHeaders = {};
  Object.defineProperty(hostileHeaders, "Authorization", {
    enumerable: true,
    get() {
      throw new Error("must not be evaluated");
    },
  });
  assert.throws(
    () => fixture.gate.inspectInboundRequest({ headers: hostileHeaders, body: new Uint8Array() }),
    (error) => error instanceof security.ApplicationSecurityError && error.code === "invalid_ingress",
  );
  assert.deepEqual(fixture.gate.responseHeaders, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "content-type": "application/json; charset=utf-8",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  assert.equal("access-control-allow-origin" in fixture.gate.responseHeaders, false);
  assert.equal("strict-transport-security" in fixture.gate.responseHeaders, false);
});

test("application gate rate limits a trusted identity with a manual clock and aborts a late result", async () => {
  const fixture = gate();
  const admission = { tenantId: "tenant-alpha", actorId: "actor-alpha", routeId: "api.m0" };
  for (let index = 0; index < security.APPLICATION_SECURITY_LIMITS.maxRequestsPerWindow; index += 1) {
    fixture.gate.admitAuthenticatedRequest(admission).dispose();
  }
  assert.throws(
    () => fixture.gate.admitAuthenticatedRequest(admission),
    (error) => error instanceof security.ApplicationSecurityError
      && error.code === "rate_limited"
      && error.retryAfterMs === security.APPLICATION_SECURITY_LIMITS.rateLimitWindowMs,
  );
  fixture.runtime.advance(security.APPLICATION_SECURITY_LIMITS.rateLimitWindowMs);
  fixture.gate.admitAuthenticatedRequest(admission).dispose();

  const budget = gate().gate.admitAuthenticatedRequest(admission);
  let observedSignal;
  let resolveLateWork;
  const pending = budget.run((signal) => {
    observedSignal = signal;
    return new Promise((resolve) => {
      resolveLateWork = resolve;
    });
  });
  await Promise.resolve();
  assert.equal(observedSignal.aborted, false);
  const timeoutFixture = gate();
  const timeoutBudget = timeoutFixture.gate.admitAuthenticatedRequest(admission);
  let timeoutSignal;
  let resolveTimedWork;
  const timed = timeoutBudget.run((signal) => {
    timeoutSignal = signal;
    return new Promise((resolve) => {
      resolveTimedWork = resolve;
    });
  });
  await Promise.resolve();
  timeoutFixture.runtime.advance(100);
  await assert.rejects(
    timed,
    (error) => error instanceof security.ApplicationSecurityError && error.code === "request_timed_out",
  );
  assert.equal(timeoutSignal.aborted, true);
  resolveTimedWork("late");
  await Promise.resolve();
  resolveLateWork("cleanup");
  await pending;
});

test("egress is default deny and a capability accepts only an exact HTTPS adapter origin", () => {
  const registry = security.createAdapterEgressRegistry([
    { adapterId: "fake-catalog-adapter", allowedOrigins: ["https://catalog.example.invalid"] },
    { adapterId: "fake-no-egress-adapter", allowedOrigins: [] },
  ]);
  const capability = registry.capabilityFor("fake-catalog-adapter");
  const originalFetch = globalThis.fetch;
  let dispatchedCalls = 0;
  let networkCalls = 0;
  globalThis.fetch = () => {
    networkCalls += 1;
    throw new Error("network must not be used by egress policy");
  };
  try {
    const authorized = capability.authorize("https://catalog.example.invalid/v1/records?fixed=true");
    assert.equal(Object.isFrozen(authorized), true);
    assert.deepEqual(Object.keys(authorized), []);
    let dispatchedTarget;
    assert.equal(
      capability.dispatch(authorized, (target) => {
        dispatchedCalls += 1;
        dispatchedTarget = target.href;
        return "sent";
      }),
      "sent",
    );
    assert.equal(dispatchedTarget, "https://catalog.example.invalid/v1/records?fixed=true");
    assert.throws(
      () => capability.dispatch(Object.freeze({}), () => {
        dispatchedCalls += 1;
        return "forged";
      }),
      (error) => error instanceof security.EgressPolicyError && error.code === "egress_forbidden",
    );
    for (const destination of [
      "http://catalog.example.invalid/v1/records",
      "https://catalog.example.invalid.evil.invalid/v1/records",
      "https://catalog.example.invalid:444/v1/records",
      "https://user@catalog.example.invalid/v1/records",
      "https://127.0.0.1/v1/records",
      "https://localhost/v1/records",
      "https://catalog.example.invalid/v1/records#fragment",
    ]) {
      assert.throws(
        () => capability.authorize(destination),
        (error) => error instanceof security.EgressPolicyError && error.code === "egress_forbidden",
      );
    }
    assert.throws(
      () => capability.authorizeRedirect(authorized, "https://other.example.invalid/redirected"),
      (error) => error instanceof security.EgressPolicyError && error.code === "egress_forbidden",
    );
    assert.doesNotThrow(() => capability.authorizeRedirect(authorized, "https://catalog.example.invalid/v1/redirected"));
    assert.throws(
      () => registry.capabilityFor("fake-no-egress-adapter").authorize("https://catalog.example.invalid/v1/records"),
      security.EgressPolicyError,
    );
    assert.throws(() => registry.capabilityFor("unknown-adapter"), security.EgressPolicyError);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(dispatchedCalls, 1);
  assert.equal(networkCalls, 0);
});
