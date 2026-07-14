import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const security = await import(pathToFileURL(join(root, "packages/security/dist/index.js")).href);

function id(offset) {
  return domain.uuidV7FromParts(1_700_000_000_000 + offset, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, offset]));
}

function context(tenantId, purposes = ["provider_auth"], grantedScopes = ["provider:use"]) {
  return domain.createTenantContext({
    tenantId,
    actorId: id(10),
    actorType: "workflow",
    grantedScopes,
    purposes,
  });
}

test("secret handles are opaque references and reject raw or decorated credential shapes", () => {
  const valid = security.parseSecretHandle("secret://local/tenant-broker");
  const rawCredential = ["sk", "fake", "x".repeat(24)].join("-");

  assert.equal(valid, "secret://local/tenant-broker");
  assert.equal(Object.isFrozen(security.createSecretHandleReference(valid)), true);
  assert.throws(() => security.parseSecretHandle(rawCredential), security.SecretHandleValidationError);
  assert.throws(() => security.parseSecretHandle("secret://local/tenant-broker?token=x"), security.SecretHandleValidationError);
  assert.throws(() => security.parseSecretHandle("secret://local/tenant\nbroker"), security.SecretHandleValidationError);
  assert.throws(() => security.parseSecretHandle("secret://local/tenant=broker"), security.SecretHandleValidationError);
});

test("deterministic secret broker binds tenancy, scope, provider, and no network resolution", () => {
  const firstTenant = id(1);
  const secondTenant = id(2);
  const handle = security.parseSecretHandle("secret://local/tenant-broker");
  const registrations = [{
    tenantId: firstTenant,
    handle,
    providerId: "local-model-fake",
    purposes: ["provider_auth"],
  }];
  const broker = new security.DeterministicFakeSecretBroker(context(firstTenant), registrations);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network access is prohibited in deterministic fake broker");
  };
  try {
    const firstLease = broker.acquireLease({
      handle,
      purpose: "provider_auth",
      providerId: "local-model-fake",
    });
    const repeatedLease = broker.acquireLease({ handle, purpose: "provider_auth", providerId: "local-model-fake" });
    assert.equal(firstLease.materialized, false);
    assert.equal(firstLease.tenantId, firstTenant);
    assert.equal(firstLease.leaseId, repeatedLease.leaseId);
    assert.equal(firstLease.leaseId.includes(handle), false);
    assert.equal("resolve" in firstLease, false);
    assert.equal(Object.isFrozen(firstLease), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const crossTenantBroker = new security.DeterministicFakeSecretBroker(context(secondTenant), registrations);
  assert.throws(() => crossTenantBroker.acquireLease({ handle, purpose: "provider_auth", providerId: "local-model-fake" }), security.SecretAccessDeniedError);
  assert.throws(() => broker.acquireLease({
    handle,
    purpose: "provider_auth",
    providerId: "other-provider",
  }), security.SecretAccessDeniedError);
  const missingProviderScopeBroker = new security.DeterministicFakeSecretBroker(
    context(firstTenant, ["provider_auth"], ["session:read"]),
    registrations,
  );
  assert.throws(
    () => missingProviderScopeBroker.acquireLease({ handle, purpose: "provider_auth", providerId: "local-model-fake" }),
    security.SecretAccessDeniedError,
  );
  assert.throws(
    () => new security.DeterministicFakeSecretBroker({ ...context(firstTenant), purposes: "provider_auth" }, registrations),
    security.SecretAccessDeniedError,
  );
  assert.throws(
    () => new security.DeterministicFakeSecretBroker(context(firstTenant), [...registrations, registrations[0]]),
    security.SecretAccessDeniedError,
  );

  const toolHandle = security.parseSecretHandle("secret://local/tool-broker");
  const toolRegistration = [{
    tenantId: firstTenant,
    handle: toolHandle,
    providerId: "local-tool-fake",
    purposes: ["tool_auth"],
  }];
  const toolBroker = new security.DeterministicFakeSecretBroker(
    context(firstTenant, ["tool_auth"], ["tool:use"]),
    toolRegistration,
  );
  assert.equal(
    toolBroker.acquireLease({ handle: toolHandle, purpose: "tool_auth", providerId: "local-tool-fake" }).purpose,
    "tool_auth",
  );
  const missingToolScopeBroker = new security.DeterministicFakeSecretBroker(
    context(firstTenant, ["tool_auth"], ["provider:use"]),
    toolRegistration,
  );
  assert.throws(
    () => missingToolScopeBroker.acquireLease({ handle: toolHandle, purpose: "tool_auth", providerId: "local-tool-fake" }),
    security.SecretAccessDeniedError,
  );
  const crossPurposeBroker = new security.DeterministicFakeSecretBroker(
    context(firstTenant, ["provider_auth", "tool_auth"], ["provider:use", "tool:use"]),
    toolRegistration,
  );
  assert.throws(
    () => crossPurposeBroker.acquireLease({ handle: toolHandle, purpose: "provider_auth", providerId: "local-tool-fake" }),
    security.SecretAccessDeniedError,
  );
});
