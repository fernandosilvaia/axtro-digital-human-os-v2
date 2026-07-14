import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);

function validEnvironment(overrides = {}) {
  return {
    AXTRO_ENV: "development",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/development-broker",
    AXTRO_PORT: "3100",
    AXTRO_REQUEST_TIMEOUT_MS: "5000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "debug",
    ...overrides,
  };
}

test("runtime configuration exposes an opaque handle to a trusted adapter only", () => {
  const loaded = config.loadRuntimeConfig(validEnvironment());
  const adapterConfiguration = config.createProviderAdapterConfiguration(loaded);
  const modelMetadata = config.createModelRuntimeMetadata(loaded);

  assert.equal(loaded.schema_version, "2.0.0");
  assert.equal(loaded.provider_mode, "fake");
  assert.equal(loaded.secret_broker_handle, "secret://local/development-broker");
  assert.equal(loaded.port, 3100);
  assert.equal(loaded.request_timeout_ms, 5000);
  assert.equal(loaded.dev_auth_enabled, true);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(adapterConfiguration), true);
  assert.deepEqual(adapterConfiguration, {
    provider_mode: "fake",
    secret_broker_handle: "secret://local/development-broker",
  });
  assert.equal(JSON.stringify(modelMetadata).includes(loaded.secret_broker_handle), false);
  assert.deepEqual(modelMetadata, { environment: "development", service_name: "api", provider_mode: "fake" });
  assert.equal("createModelProviderConfiguration" in config, false);
});

test("runtime configuration applies only non-sensitive defaults", () => {
  const environment = validEnvironment({
    AXTRO_PORT: undefined,
    AXTRO_REQUEST_TIMEOUT_MS: undefined,
    AXTRO_DEV_AUTH_ENABLED: undefined,
    AXTRO_LOG_LEVEL: undefined,
  });
  const loaded = config.loadRuntimeConfig(environment);

  assert.equal(loaded.port, 3000);
  assert.equal(loaded.request_timeout_ms, 10000);
  assert.equal(loaded.dev_auth_enabled, false);
  assert.equal(loaded.log_level, "info");
});

test("configuration errors expose field names and codes but never raw values", () => {
  const credentialCanary = ["sk", "config", "x".repeat(24)].join("-");
  const cases = [
    ["missing environment", validEnvironment({ AXTRO_ENV: undefined }), "AXTRO_ENV", "missing"],
    ["empty service", validEnvironment({ AXTRO_SERVICE_NAME: "" }), "AXTRO_SERVICE_NAME", "missing"],
    ["unknown service", validEnvironment({ AXTRO_SERVICE_NAME: "unknown" }), "AXTRO_SERVICE_NAME", "invalid"],
    ["real provider", validEnvironment({ AXTRO_PROVIDER_MODE: "live" }), "AXTRO_PROVIDER_MODE", "not_allowed"],
    ["malformed handle", validEnvironment({ AXTRO_SECRET_BROKER_HANDLE: "secret://local/broker?value" }), "AXTRO_SECRET_BROKER_HANDLE", "invalid"],
    ["invalid port", validEnvironment({ AXTRO_PORT: "zero" }), "AXTRO_PORT", "invalid"],
    ["port range", validEnvironment({ AXTRO_PORT: "65536" }), "AXTRO_PORT", "out_of_range"],
    ["timeout range", validEnvironment({ AXTRO_REQUEST_TIMEOUT_MS: "99" }), "AXTRO_REQUEST_TIMEOUT_MS", "out_of_range"],
    ["invalid boolean", validEnvironment({ AXTRO_DEV_AUTH_ENABLED: "yes" }), "AXTRO_DEV_AUTH_ENABLED", "invalid"],
    ["dev auth in staging", validEnvironment({ AXTRO_ENV: "staging" }), "AXTRO_DEV_AUTH_ENABLED", "not_allowed"],
    ["dev auth in canary", validEnvironment({ AXTRO_ENV: "canary" }), "AXTRO_DEV_AUTH_ENABLED", "not_allowed"],
    ["dev auth in production", validEnvironment({ AXTRO_ENV: "production" }), "AXTRO_DEV_AUTH_ENABLED", "not_allowed"],
    ["unknown input", validEnvironment({ AXTRO_UNDOCUMENTED: "value" }), "AXTRO_UNDOCUMENTED", "unexpected"],
    ["raw credential input", validEnvironment({ AXTRO_OPENAI_API_KEY: credentialCanary }), "AXTRO_OPENAI_API_KEY", "not_allowed"],
    ["bare credential input", validEnvironment({ OPENAI_API_KEY: credentialCanary }), "OPENAI_API_KEY", "not_allowed"],
    ["livekit credential input", validEnvironment({ LIVEKIT_API_KEY: credentialCanary }), "LIVEKIT_API_KEY", "not_allowed"],
    ["liveavatar credential input", validEnvironment({ LIVEAVATAR_API_KEY: credentialCanary }), "LIVEAVATAR_API_KEY", "not_allowed"],
  ];

  for (const [label, environment, key, code] of cases) {
    assert.throws(
      () => config.loadRuntimeConfig(environment),
      (error) => {
        assert.equal(error instanceof config.ConfigValidationError, true, label);
        assert.equal(error.issues.some((issue) => issue.key === key && issue.code === code), true, label);
        assert.equal(error.message.includes(credentialCanary), false, label);
        return true;
      },
    );
  }
});

test("untrusted runtime inputs fail closed without invoking unsafe values", () => {
  const malformed = validEnvironment({ AXTRO_PORT: { toString: () => "3100" } });
  assert.throws(
    () => config.loadRuntimeConfig(malformed),
    (error) => error instanceof config.ConfigValidationError && error.issues.some((issue) => issue.key === "AXTRO_PORT"),
  );
  assert.throws(() => config.loadRuntimeConfig(null), config.ConfigValidationError);
});

test("invalid configuration fails before any runtime startup callback", () => {
  let starts = 0;
  assert.throws(() => config.bootstrapRuntime(validEnvironment({ AXTRO_PROVIDER_MODE: "real" }), () => {
    starts += 1;
  }));
  assert.equal(starts, 0);

  const started = config.bootstrapRuntime(validEnvironment(), (loaded) => {
    starts += 1;
    return loaded.service_name;
  });
  assert.equal(started, "api");
  assert.equal(starts, 1);
});
