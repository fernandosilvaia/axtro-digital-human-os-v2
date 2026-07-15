import type { RuntimeConfiguration } from "@axtro/contracts-ts";
import { parseSecretHandle, type SecretHandle } from "@axtro/security";

export type EnvironmentSource = Readonly<Record<string, unknown>>;
export type RuntimeEnvironment = RuntimeConfiguration["environment"];
export type RuntimeServiceName = RuntimeConfiguration["service_name"];
export type RuntimeLogLevel = RuntimeConfiguration["log_level"];

export interface RuntimeConfig extends Omit<RuntimeConfiguration, "secret_broker_handle"> {
  readonly secret_broker_handle: SecretHandle;
}

export interface ConfigIssue {
  readonly key: string;
  readonly code: "missing" | "invalid" | "out_of_range" | "not_allowed" | "unexpected" | "unreadable";
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const safeIssues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
    super(`Runtime configuration is invalid: ${safeIssues.map((issue) => `${issue.key}:${issue.code}`).join(", ")}`);
    this.name = "ConfigValidationError";
    this.issues = safeIssues;
  }
}

/** Only a trusted provider adapter may receive a broker handle. Model prompts do not. */
export interface ProviderAdapterConfiguration {
  readonly provider_mode: "fake";
  readonly secret_broker_handle: SecretHandle;
}

/** Model-facing metadata is deliberately narrower than adapter configuration. */
export interface ModelRuntimeMetadata {
  readonly environment: RuntimeEnvironment;
  readonly service_name: RuntimeServiceName;
  readonly provider_mode: "fake";
}

const ENVIRONMENTS = ["development", "test", "staging", "canary", "production"] as const;
const SERVICE_NAMES = ["api", "realtime-worker", "axtro-supervisor", "meeting-bot-worker", "workflow-worker", "event-relay"] as const;
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const INPUT_KEYS = new Set([
  "AXTRO_ENV",
  "AXTRO_SERVICE_NAME",
  "AXTRO_PROVIDER_MODE",
  "AXTRO_SECRET_BROKER_HANDLE",
  "AXTRO_PORT",
  "AXTRO_REQUEST_TIMEOUT_MS",
  "AXTRO_DEV_AUTH_ENABLED",
  "AXTRO_LOG_LEVEL",
]);
/** Fake-only M0-M1 credential denylist for provider families and deployment control planes. */
const RAW_SECRET_VALUE_KEYS = new Set([
  "AXTRO_PROVIDER_API_KEY",
  "AXTRO_OPENAI_API_KEY",
  "AXTRO_TAVUS_API_KEY",
  "AXTRO_LIVEKIT_API_SECRET",
  "AXTRO_TELNYX_API_KEY",
  "OPENAI_API_KEY",
  "TAVUS_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "TELNYX_API_KEY",
  "RECALLAI_API_KEY",
  "HEYGEN_API_KEY",
  "LIVEAVATAR_API_KEY",
  "LIVEAVATAR_API_SECRET",
  "LIVE_AVATAR_API_KEY",
  "DEEPGRAM_API_KEY",
  "ELEVENLABS_API_KEY",
  "CARTESIA_API_KEY",
  "ANTHROPIC_API_KEY",
  "RECALL_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "VERCEL_TOKEN",
  "RAILWAY_TOKEN",
  "DOPPLER_TOKEN",
]);

/**
 * Parse environment input without starting a service or contacting a provider.
 * Invalid configuration is terminal before any adapter, database, or listener
 * can be initialized.
 */
export function loadRuntimeConfig(source: EnvironmentSource = process.env): RuntimeConfig {
  if (source === null || typeof source !== "object") {
    throw new ConfigValidationError([{ key: "environment", code: "invalid" }]);
  }
  const issues: ConfigIssue[] = [];
  rejectUnexpectedInput(source, issues);
  rejectRawSecretInput(source, issues);

  const environment = parseEnum(source, "AXTRO_ENV", ENVIRONMENTS, "development", issues, true);
  const serviceName = parseEnum(source, "AXTRO_SERVICE_NAME", SERVICE_NAMES, "api", issues, true);
  const providerMode = parseProviderMode(source, issues);
  const secretBrokerHandle = parseBrokerHandle(source, issues);
  const port = parseInteger(source, "AXTRO_PORT", 3000, 1, 65535, issues);
  const requestTimeoutMs = parseInteger(source, "AXTRO_REQUEST_TIMEOUT_MS", 10_000, 100, 120_000, issues);
  const devAuthEnabled = parseBoolean(source, "AXTRO_DEV_AUTH_ENABLED", false, issues);
  const logLevel = parseEnum(source, "AXTRO_LOG_LEVEL", LOG_LEVELS, "info", issues, false);

  if (devAuthEnabled && environment !== "development" && environment !== "test") {
    issues.push({ key: "AXTRO_DEV_AUTH_ENABLED", code: "not_allowed" });
  }
  if (issues.length > 0) throw new ConfigValidationError(issues);

  return Object.freeze({
    schema_version: "2.0.0",
    environment,
    service_name: serviceName,
    provider_mode: providerMode,
    secret_broker_handle: secretBrokerHandle,
    port,
    request_timeout_ms: requestTimeoutMs,
    dev_auth_enabled: devAuthEnabled,
    log_level: logLevel,
  });
}

/** Boundary helper used by service entry points to prove validation precedes startup. */
export function bootstrapRuntime<Result>(
  source: EnvironmentSource,
  start: (config: RuntimeConfig) => Result,
): Result {
  return start(loadRuntimeConfig(source));
}

/** A provider adapter receives a reference only, never a credential value. */
export function createProviderAdapterConfiguration(config: RuntimeConfig): ProviderAdapterConfiguration {
  return Object.freeze({
    provider_mode: config.provider_mode,
    secret_broker_handle: config.secret_broker_handle,
  });
}

export function createModelRuntimeMetadata(config: RuntimeConfig): ModelRuntimeMetadata {
  return Object.freeze({
    environment: config.environment,
    service_name: config.service_name,
    provider_mode: config.provider_mode,
  });
}

function rejectUnexpectedInput(source: EnvironmentSource, issues: ConfigIssue[]): void {
  let keys: string[];
  try {
    keys = Object.keys(source).sort();
  } catch {
    issues.push({ key: "environment", code: "unreadable" });
    return;
  }
  for (const key of keys) {
    if (key.startsWith("AXTRO_") && !INPUT_KEYS.has(key) && !RAW_SECRET_VALUE_KEYS.has(key)) {
      issues.push({ key, code: "unexpected" });
    }
  }
}

function rejectRawSecretInput(source: EnvironmentSource, issues: ConfigIssue[]): void {
  for (const key of RAW_SECRET_VALUE_KEYS) {
    const value = read(source, key, issues);
    if (value !== undefined && value.trim().length > 0) issues.push({ key, code: "not_allowed" });
  }
}

function parseProviderMode(source: EnvironmentSource, issues: ConfigIssue[]): "fake" {
  const value = read(source, "AXTRO_PROVIDER_MODE", issues);
  if (value === undefined || value.trim().length === 0) {
    issues.push({ key: "AXTRO_PROVIDER_MODE", code: "missing" });
  } else if (value !== "fake") {
    issues.push({ key: "AXTRO_PROVIDER_MODE", code: "not_allowed" });
  }
  return "fake";
}

function parseBrokerHandle(source: EnvironmentSource, issues: ConfigIssue[]): SecretHandle {
  const value = read(source, "AXTRO_SECRET_BROKER_HANDLE", issues);
  if (value === undefined || value.trim().length === 0) {
    issues.push({ key: "AXTRO_SECRET_BROKER_HANDLE", code: "missing" });
  } else {
    try {
      return parseSecretHandle(value);
    } catch {
      issues.push({ key: "AXTRO_SECRET_BROKER_HANDLE", code: "invalid" });
    }
  }
  return parseSecretHandle("secret://invalid/fallback");
}

function parseEnum<const Value extends string>(
  source: EnvironmentSource,
  key: string,
  values: readonly Value[],
  fallback: Value,
  issues: ConfigIssue[],
  required: boolean,
): Value {
  const value = read(source, key, issues);
  if (value === undefined || value.trim().length === 0) {
    if (required) issues.push({ key, code: "missing" });
    return fallback;
  }
  if (!(values as readonly string[]).includes(value)) {
    issues.push({ key, code: "invalid" });
    return fallback;
  }
  return value as Value;
}

function parseInteger(
  source: EnvironmentSource,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
  issues: ConfigIssue[],
): number {
  const value = read(source, key, issues);
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    issues.push({ key, code: "invalid" });
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push({ key, code: "out_of_range" });
    return fallback;
  }
  return parsed;
}

function parseBoolean(source: EnvironmentSource, key: string, fallback: boolean, issues: ConfigIssue[]): boolean {
  const value = read(source, key, issues);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  issues.push({ key, code: "invalid" });
  return fallback;
}

function read(source: EnvironmentSource, key: string, issues: ConfigIssue[]): string | undefined {
  try {
    const value = source[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      issues.push({ key, code: "invalid" });
      return undefined;
    }
    return value;
  } catch {
    issues.push({ key, code: "unreadable" });
    return undefined;
  }
}
