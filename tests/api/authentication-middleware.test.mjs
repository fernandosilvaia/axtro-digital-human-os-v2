import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const api = await import(pathToFileURL(join(root, "apps/api/dist/index.js")).href);
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);

const tenantAlpha = id(21);
const tenantBeta = id(22);
const actorAlpha = id(23);
const token = "dev_api_token_0001";

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_300_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

function middleware(identityKind = "service") {
  const transactions = [];
  const transactionRunner = {
    async withinTransaction(work) {
      transactions.push("BEGIN");
      try {
        const result = await work({
          async execute(statement, values) {
            transactions.push([statement, [...values]]);
          },
        });
        transactions.push("COMMIT");
        return result;
      } catch (error) {
        transactions.push("ROLLBACK");
        throw error;
      }
    },
  };
  const runtimeConfig = config.loadRuntimeConfig({
    AXTRO_ENV: "development",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/api-auth-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
  return {
    transactions,
    middleware: api.createDevelopmentApiAuthenticationMiddleware({
      config: runtimeConfig,
      registrations: [{
        token,
        actorId: actorAlpha,
        actorType: "human_operator",
        identityKind,
        tenantGrants: [{
          tenantId: tenantAlpha,
          grantedScopes: ["session:read"],
          purposes: ["essential_processing"],
        }],
      }],
      transactionRunner,
    }),
  };
}

test("API middleware treats headers as selectors only and does not expose them to handlers", async () => {
  const fixture = middleware();
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Tenant-Id": tenantAlpha,
    "X-Actor-Id": id(24),
    "X-Scopes": "admin:all",
  };
  const authorized = fixture.middleware.authenticate(headers);

  assert.equal(authorized.tenantContext.tenantId, tenantAlpha);
  assert.equal(authorized.tenantContext.actorId, actorAlpha);
  assert.equal(authorized.principal.identityKind, "service");
  assert.equal(api.assertApiResourceTenant(authorized, tenantAlpha), tenantAlpha);
  assert.throws(() => api.assertApiResourceTenant(authorized, tenantBeta));

  const handlerInput = await fixture.middleware.runWithTenantTransaction(headers, async (input) => ({
    keys: Object.keys(input).sort(),
    tenantId: input.tenantContext.tenantId,
    hasAuthorization: "authorization" in input,
  }));
  assert.deepEqual(handlerInput, {
    keys: ["tenantContext", "transaction"],
    tenantId: tenantAlpha,
    hasAuthorization: false,
  });
  assert.deepEqual(fixture.transactions, [
    "BEGIN",
    [auth.SET_LOCAL_TENANT_CONTEXT_SQL, [tenantAlpha]],
    "COMMIT",
  ]);
});

test("API middleware rejects duplicate headers and confused-deputy requests before transaction work", async () => {
  const fixture = middleware();
  assert.throws(
    () => fixture.middleware.authenticate({
      authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantAlpha,
      "x-tenant-id": tenantAlpha,
    }),
    auth.AuthenticationError,
  );
  assert.throws(
    () => fixture.middleware.authenticate({
      authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantBeta,
    }),
    auth.TenantAuthorizationError,
  );
  await assert.rejects(
    () => fixture.middleware.runWithTenantTransaction({
      authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantBeta,
    }, async () => "forbidden"),
    auth.TenantAuthorizationError,
  );
  assert.deepEqual(fixture.transactions, []);
  assert.throws(
    () => api.extractApiAuthenticationInput(new Map()),
    auth.AuthenticationError,
  );

  const userFixture = middleware("user");
  assert.throws(
    () => userFixture.middleware.authenticate({
      authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantAlpha,
    }),
    auth.TenantAuthorizationError,
  );
  assert.deepEqual(userFixture.transactions, []);
});
