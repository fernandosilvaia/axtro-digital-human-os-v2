import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);
const developmentToken = "dev_alpha_token_0001";

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_200_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

function runtimeConfiguration(overrides = {}) {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/auth-test-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
    ...overrides,
  });
}

function alphaRegistration(overrides = {}) {
  return {
    token: developmentToken,
    actorId: actorAlpha,
    actorType: "human_operator",
    identityKind: "service",
    tenantGrants: [{
      tenantId: tenantAlpha,
      grantedScopes: ["session:read", "session:write"],
      purposes: ["essential_processing"],
    }],
    ...overrides,
  };
}

function authorizedAlpha() {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [alphaRegistration()]);
  return auth.resolveAuthorizedRequestContext({
    authorization: `Bearer ${developmentToken}`,
    requestedTenantId: tenantAlpha,
  }, verifier);
}

test("development auth maps only server-side grants into an immutable tenant context", () => {
  const registration = alphaRegistration();
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [registration]);
  registration.tenantGrants[0].grantedScopes.push("admin:all");

  const resolved = auth.resolveAuthorizedRequestContext({
    authorization: `Bearer ${developmentToken}`,
    requestedTenantId: tenantAlpha,
    actorId: actorBeta,
    actorType: "workflow",
    grantedScopes: ["admin:all"],
    purposes: ["tool_auth"],
  }, verifier);

  assert.equal(resolved.tenantContext.tenantId, tenantAlpha);
  assert.equal(resolved.tenantContext.actorId, actorAlpha);
  assert.equal(resolved.tenantContext.actorType, "human_operator");
  assert.deepEqual(resolved.tenantContext.grantedScopes, ["session:read", "session:write"]);
  assert.deepEqual(resolved.tenantContext.purposes, ["essential_processing"]);
  assert.equal(resolved.principal.identityKind, "service");
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.tenantContext.grantedScopes), true);
  assert.throws(() => auth.assertAuthorizedTenantMatch(resolved, tenantBeta));
});

test("auth matrix fails closed for disabled development mode, malformed inputs, and confused deputies", () => {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [alphaRegistration()]);
  const invalidRequests = [
    { authorization: undefined, requestedTenantId: tenantAlpha },
    { authorization: `Bearer ${developmentToken}`, requestedTenantId: undefined },
    { authorization: `bearer ${developmentToken}`, requestedTenantId: tenantAlpha },
    { authorization: "Bearer dev_unknown_token_0001", requestedTenantId: tenantAlpha },
    { authorization: `Bearer ${developmentToken}`, requestedTenantId: "not-a-tenant" },
    { authorization: { toString: () => `Bearer ${developmentToken}` }, requestedTenantId: tenantAlpha },
  ];
  for (const request of invalidRequests) {
    assert.throws(
      () => auth.resolveAuthorizedRequestContext(request, verifier),
      auth.AuthenticationError,
    );
  }
  assert.throws(
    () => auth.resolveAuthorizedRequestContext({
      authorization: `Bearer ${developmentToken}`,
      requestedTenantId: tenantBeta,
    }, verifier),
    auth.TenantAuthorizationError,
  );

  const disabled = runtimeConfiguration({ AXTRO_DEV_AUTH_ENABLED: "false" });
  assert.throws(
    () => auth.createDevelopmentIdentityVerifier(disabled, [alphaRegistration()]),
    auth.DevelopmentAuthConfigurationError,
  );
  for (const environment of ["staging", "canary", "production"]) {
    assert.throws(
      () => auth.createDevelopmentIdentityVerifier({ environment, dev_auth_enabled: true }, [alphaRegistration()]),
      auth.DevelopmentAuthConfigurationError,
    );
  }
});

test("M0 rejects a tenant header selector for user identities", () => {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [alphaRegistration({ identityKind: "user" })]);
  assert.throws(
    () => auth.resolveAuthorizedRequestContext({
      authorization: `Bearer ${developmentToken}`,
      requestedTenantId: tenantAlpha,
    }, verifier),
    auth.TenantAuthorizationError,
  );
});

test("development registration validation rejects invalid actors, broad grants, duplicate tenants, and unknown fields", () => {
  const invalidActor = alphaRegistration({ actorId: "550e8400-e29b-41d4-a716-446655440000" });
  const duplicateTenant = alphaRegistration({
    tenantGrants: [
      ...alphaRegistration().tenantGrants,
      { tenantId: tenantAlpha, grantedScopes: ["session:read"], purposes: ["essential_processing"] },
    ],
  });
  const emptyScopes = alphaRegistration({
    tenantGrants: [{ tenantId: tenantAlpha, grantedScopes: [], purposes: ["essential_processing"] }],
  });
  const privilegedScope = alphaRegistration({
    tenantGrants: [{ tenantId: tenantAlpha, grantedScopes: ["admin:all"], purposes: ["essential_processing"] }],
  });
  const privilegedPurpose = alphaRegistration({
    tenantGrants: [{ tenantId: tenantAlpha, grantedScopes: ["session:read"], purposes: ["bypass:policy"] }],
  });
  const extraClaim = { ...alphaRegistration(), unexpected: true };
  for (const registration of [invalidActor, duplicateTenant, emptyScopes, privilegedScope, privilegedPurpose, extraClaim]) {
    assert.throws(
      () => auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [registration]),
      auth.DevelopmentAuthConfigurationError,
    );
  }
});

test("authorized tenant transaction applies parameterized local context before work and rolls back failures", async () => {
  const authorized = authorizedAlpha();
  const success = createTransactionRunner();
  const result = await auth.withAuthorizedTenantTransaction(authorized, success.runner, async ({ tenantContext, transaction }) => {
    success.events.push(["WORK", tenantContext.tenantId, transaction === success.transaction]);
    return "committed";
  });
  assert.equal(result, "committed");
  assert.deepEqual(success.events, [
    "BEGIN",
    ["QUERY", auth.SET_LOCAL_TENANT_CONTEXT_SQL, [tenantAlpha]],
    ["WORK", tenantAlpha, true],
    "COMMIT",
  ]);
  assert.equal(auth.SET_LOCAL_TENANT_CONTEXT_SQL.includes(`'${tenantAlpha}'`), false);
  assert.equal(/\bSET\s+app\.tenant_id\b/.test(auth.SET_LOCAL_TENANT_CONTEXT_SQL), false);

  const setFailure = createTransactionRunner({ failSet: true });
  let setFailureWorkStarted = false;
  await assert.rejects(
    () => auth.withAuthorizedTenantTransaction(authorized, setFailure.runner, async () => {
      setFailureWorkStarted = true;
      return "unreachable";
    }),
    auth.TenantTransactionContextError,
  );
  assert.equal(setFailureWorkStarted, false);
  assert.deepEqual(setFailure.events, [
    "BEGIN",
    ["QUERY", auth.SET_LOCAL_TENANT_CONTEXT_SQL, [tenantAlpha]],
    "ROLLBACK",
  ]);

  const workFailure = createTransactionRunner();
  await assert.rejects(
    () => auth.withAuthorizedTenantTransaction(authorized, workFailure.runner, async () => {
      throw new Error("fixture work failure");
    }),
    /fixture work failure/,
  );
  assert.equal(workFailure.events.at(-1), "ROLLBACK");

  const commitFailure = createTransactionRunner({ failCommit: true });
  await assert.rejects(
    () => auth.withAuthorizedTenantTransaction(authorized, commitFailure.runner, async () => "not returned"),
    /fixture commit failure/,
  );
  assert.equal(commitFailure.events.at(-1), "ROLLBACK");

  const forged = {
    tenantContext: authorized.tenantContext,
    principal: authorized.principal,
  };
  await assert.rejects(
    () => auth.withAuthorizedTenantTransaction(forged, success.runner, async () => "forbidden"),
    auth.TenantAuthorizationError,
  );
});

function createTransactionRunner({ failSet = false, failCommit = false } = {}) {
  const events = [];
  const transaction = {
    async execute(statement, values) {
      events.push(["QUERY", statement, [...values]]);
      if (failSet) throw new Error("fixture set failure");
    },
  };
  const runner = {
    async withinTransaction(work) {
      events.push("BEGIN");
      try {
        const result = await work(transaction);
        if (failCommit) throw new Error("fixture commit failure");
        events.push("COMMIT");
        return result;
      } catch (error) {
        events.push("ROLLBACK");
        throw error;
      }
    },
  };
  return { events, runner, transaction };
}
