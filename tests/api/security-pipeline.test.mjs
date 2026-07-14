import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const api = await import(pathToFileURL(join(root, "apps/api/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const security = await import(pathToFileURL(join(root, "packages/security/dist/index.js")).href);

const tenantAlpha = id(51);
const tenantBeta = id(52);
const actor = id(53);
const token = "dev_pipeline_token_0001";

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_500_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

class ManualRuntime {
  nowValue = 20_000;
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

function createPipeline(runtime = new ManualRuntime(), timeoutMs = "10000") {
  const runtimeConfig = config.loadRuntimeConfig({
    AXTRO_ENV: "development",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/api-security-pipeline",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: timeoutMs,
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
  const transactionRunner = {
    async withinTransaction(work) {
      return work({ async execute() {} });
    },
  };
  return {
    runtime,
    pipeline: api.createDevelopmentApiSecurityPipeline({
      config: runtimeConfig,
      registrations: [{
        token,
        actorId: actor,
        actorType: "workflow",
        identityKind: "service",
        tenantGrants: [
          { tenantId: tenantAlpha, grantedScopes: ["session:read"], purposes: ["essential_processing"] },
          { tenantId: tenantBeta, grantedScopes: ["session:read"], purposes: ["essential_processing"] },
        ],
      }],
      transactionRunner,
      clock: { now: runtime.now },
      timer: { setTimeout: runtime.setTimeout, clearTimeout: runtime.clearTimeout },
    }),
  };
}

function headers(tenantId, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    ...extra,
  };
}

test("security pipeline rejects measured oversized input before authentication, parsing, or handler work", async () => {
  const fixture = createPipeline();
  let handlerCalled = false;
  const utf8Oversized = new TextEncoder().encode("€".repeat(21_846));
  await assert.rejects(
    fixture.pipeline.run({
      headers: {
        authorization: "not-a-bearer-token",
        "x-tenant-id": tenantAlpha,
        "content-length": "1",
      },
      body: utf8Oversized,
    }, async () => {
      handlerCalled = true;
      return "unreachable";
    }),
    (error) => error instanceof security.ApplicationSecurityError && error.code === "request_body_too_large",
  );
  assert.equal(handlerCalled, false);
  assert.throws(
    () => fixture.pipeline.authorize({
      headers: {
        Authorization: `Bearer ${token}`,
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantAlpha,
      },
      body: new Uint8Array(),
    }),
    (error) => error instanceof security.ApplicationSecurityError && error.code === "invalid_ingress",
  );
  assert.equal("access-control-allow-origin" in fixture.pipeline.responseHeaders, false);
});

test("security pipeline scopes rate buckets to authenticated tenant and ignores forwarded-header spoofing", () => {
  const fixture = createPipeline();
  for (let index = 0; index < security.APPLICATION_SECURITY_LIMITS.maxRequestsPerWindow; index += 1) {
    fixture.pipeline.authorize({
      headers: headers(tenantAlpha, { "x-forwarded-for": `198.51.100.${index + 1}` }),
      body: new Uint8Array(),
    }).dispose();
  }
  assert.throws(
    () => fixture.pipeline.authorize({
      headers: headers(tenantAlpha, { "x-forwarded-for": "203.0.113.200" }),
      body: new Uint8Array(),
    }),
    (error) => error instanceof security.ApplicationSecurityError
      && error.code === "rate_limited"
      && error.retryAfterMs === security.APPLICATION_SECURITY_LIMITS.rateLimitWindowMs,
  );
  assert.doesNotThrow(() => fixture.pipeline.authorize({
    headers: headers(tenantBeta, { "x-forwarded-for": "203.0.113.200" }),
    body: new Uint8Array(),
  }).dispose());
  fixture.runtime.advance(security.APPLICATION_SECURITY_LIMITS.rateLimitWindowMs);
  assert.doesNotThrow(() => fixture.pipeline.authorize({
    headers: headers(tenantAlpha),
    body: new Uint8Array(),
  }).dispose());
});

test("security pipeline aborts timeout work, discards late results, and returns a contract-aligned redacted problem", async () => {
  const fixture = createPipeline(new ManualRuntime(), "100");
  let observedSignal;
  let resolveLateWork;
  const requestCanary = "request-body-must-not-appear";
  const pending = fixture.pipeline.run({
    headers: headers(tenantAlpha),
    body: new TextEncoder().encode(requestCanary),
  }, (request) => {
    observedSignal = request.signal;
    return new Promise((resolve) => {
      resolveLateWork = resolve;
    });
  });
  await Promise.resolve();
  fixture.runtime.advance(100);
  let timeoutError;
  await assert.rejects(pending, (error) => {
    timeoutError = error;
    return error instanceof security.ApplicationSecurityError && error.code === "request_timed_out";
  });
  assert.equal(observedSignal.aborted, true);
  resolveLateWork("must be discarded");
  await Promise.resolve();
  const traceId = "a".repeat(32);
  const problem = api.toApiSecurityProblem(timeoutError, traceId);
  const serialized = JSON.stringify(problem);
  assert.equal(serialized.includes(requestCanary), false);
  assert.equal(serialized.includes(token), false);
  assert.equal(problem.trace_id, traceId);
  assert.deepEqual(Object.keys(problem).sort(), [
    "detail",
    "status",
    "title",
    "trace_id",
    "type",
  ]);
});
