import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const security = await import(pathToFileURL(join(root, "packages/security/dist/index.js")).href);

test("redaction removes sensitive keys and known values without mutating input", () => {
  const credentialCanary = ["canary", "$[]", "value"].join(":");
  const source = {
    authorization: credentialCanary,
    nested: {
      apiKey: credentialCanary,
      client_secret: credentialCanary,
      detail: `prefix ${credentialCanary} suffix`,
    },
    records: [{ password: credentialCanary }, { token: credentialCanary }],
  };
  const before = JSON.stringify(source);
  const result = security.redactForLog(source, { secretValues: [credentialCanary] });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(credentialCanary), false);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result, {
    authorization: security.REDACTED_VALUE,
    nested: {
      apiKey: security.REDACTED_VALUE,
      client_secret: security.REDACTED_VALUE,
      detail: `prefix ${security.REDACTED_VALUE} suffix`,
    },
    records: [{ password: security.REDACTED_VALUE }, { token: security.REDACTED_VALUE }],
  });
});

test("redaction safely handles errors, cycles, getters, and hostile serializers", () => {
  const credentialCanary = ["sk", "error", "x".repeat(24)].join("-");
  const error = new Error(`failure ${credentialCanary}`);
  error.cause = new Error(`cause ${credentialCanary}`);
  const cyclic = { name: "cycle" };
  cyclic.self = cyclic;
  const cyclicArray = [];
  cyclicArray.push(cyclicArray);
  let getterRead = false;
  const hostile = { ordinary: "safe", toJSON: () => { throw new Error("not called"); } };
  Object.defineProperty(hostile, "getter", {
    enumerable: true,
    get() {
      getterRead = true;
      throw new Error("not called");
    },
  });

  const result = security.redactForLog({ error, cyclic, cyclicArray, hostile }, { secretValues: [credentialCanary] });
  const serialized = JSON.stringify(result);
  const safeError = security.toSafeError(error, "config_invalid");

  assert.equal(serialized.includes(credentialCanary), false);
  assert.equal(serialized.includes("cause"), false);
  assert.equal(getterRead, false);
  assert.equal(result.cyclic.self, security.CIRCULAR_VALUE);
  assert.equal(result.cyclicArray[0], security.CIRCULAR_VALUE);
  assert.equal(result.hostile.getter, security.UNSAFE_VALUE);
  assert.equal(result.hostile.toJSON, security.UNSAFE_VALUE);
  assert.deepEqual(safeError, { code: "config_invalid", message: "Operation failed" });
  assert.deepEqual(security.toSafeError(error, "bad code"), { code: "internal_error", message: "Operation failed" });
});
