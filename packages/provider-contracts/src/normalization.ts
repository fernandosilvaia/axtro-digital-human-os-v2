import type { ProviderCapability, ProviderRegistryEntry } from "@axtro/contracts-ts";

declare const providerIdBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: "ProviderId" };
export const PROVIDER_PORT_KINDS = [
  "channel",
  "realtime_model",
  "stt",
  "tts",
  "avatar",
  "meeting",
  "telephony",
  "tool",
  "storage",
] as const;
export type ProviderPortKind = (typeof PROVIDER_PORT_KINDS)[number];
export const PROVIDER_HEALTH_STATUSES = ["healthy", "degraded", "unavailable", "unknown"] as const;
export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];
export const PROVIDER_CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type ProviderCircuitState = (typeof PROVIDER_CIRCUIT_STATES)[number];
export const PROVIDER_FAILURE_CODES = [
  "invalid_configuration",
  "authentication",
  "rate_limited",
  "capacity",
  "timeout",
  "transient_network",
  "provider_internal",
  "unsupported_capability",
  "policy_blocked",
  "budget_blocked",
  "cancelled",
  "unknown",
] as const;
export type ProviderFailureCode = (typeof PROVIDER_FAILURE_CODES)[number];

export type ProviderContractErrorCode =
  | "invalid_contract"
  | "duplicate_provider"
  | "incompatible_port"
  | "provider_not_found"
  | "provider_unavailable"
  | "unsupported_capability"
  | "unauthorized_tool_execution"
  | "action_runtime_required"
  | "invalid_operation_control"
  | "invalid_storage_reference";

/** Intentionally generic: provider input must never expose raw validation details. */
export class ProviderContractError extends Error {
  constructor(readonly code: ProviderContractErrorCode = "invalid_contract") {
    super("Provider contract is invalid");
    this.name = "ProviderContractError";
  }
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,119}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]{0,99}$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const REGION_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const COST_MODEL_REFERENCE_PATTERN = /^(?!.*:\/\/)[a-z][a-z0-9_./-]{0,499}$/;

export function parseProviderId(value: unknown): ProviderId {
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) throw new ProviderContractError();
  return value as ProviderId;
}

export function parseProviderPortKind(value: unknown): ProviderPortKind {
  if (typeof value !== "string" || !(PROVIDER_PORT_KINDS as readonly string[]).includes(value)) {
    throw new ProviderContractError();
  }
  return value as ProviderPortKind;
}

export function parseProviderHealthStatus(value: unknown): ProviderHealthStatus {
  if (typeof value !== "string" || !(PROVIDER_HEALTH_STATUSES as readonly string[]).includes(value)) {
    throw new ProviderContractError();
  }
  return value as ProviderHealthStatus;
}

export function parseProviderCircuitState(value: unknown): ProviderCircuitState {
  if (typeof value !== "string" || !(PROVIDER_CIRCUIT_STATES as readonly string[]).includes(value)) {
    throw new ProviderContractError();
  }
  return value as ProviderCircuitState;
}

export function parseProviderFailureCode(value: unknown): ProviderFailureCode {
  if (typeof value !== "string" || !(PROVIDER_FAILURE_CODES as readonly string[]).includes(value)) {
    throw new ProviderContractError();
  }
  return value as ProviderFailureCode;
}

/** Parse the new registry contract before any provider port is made available. */
export function parseProviderRegistryEntry(value: unknown): ProviderRegistryEntry {
  const record = plainRecord(value);
  assertExactKeys(record, [
    "schema_version",
    "port_kind",
    "provider_mode",
    "provider_capabilities",
    "default_timeout_ms",
    "supports_cancellation",
    "health_status",
    "circuit_state",
    "fallback_provider_ids",
  ]);
  const portKind = parseProviderPortKind(readRequired(record, "port_kind"));
  const providerMode = readRequired(record, "provider_mode");
  if (providerMode !== "fake") throw new ProviderContractError();
  const providerCapabilities = parseProviderCapabilities(readRequired(record, "provider_capabilities"), portKind);
  const fallbackProviderIds = parseProviderIds(readRequired(record, "fallback_provider_ids"));
  if (fallbackProviderIds.includes(providerCapabilities[0]!.provider_id as ProviderId)) throw new ProviderContractError();
  const entry = {
    schema_version: parseSchemaVersion(readRequired(record, "schema_version")),
    port_kind: portKind,
    provider_mode: "fake" as const,
    provider_capabilities: [...providerCapabilities],
    default_timeout_ms: parseTimeout(readRequired(record, "default_timeout_ms")),
    supports_cancellation: parseBoolean(readRequired(record, "supports_cancellation")),
    health_status: parseProviderHealthStatus(readRequired(record, "health_status")),
    circuit_state: parseProviderCircuitState(readRequired(record, "circuit_state")),
    fallback_provider_ids: [...fallbackProviderIds],
  } satisfies ProviderRegistryEntry;
  return deepFreeze(entry);
}

export function parseProviderCapabilityRecord(
  value: unknown,
  expectedPortKind: ProviderPortKind,
): ProviderCapability {
  const record = plainRecord(value);
  assertExactKeys(record, [
    "schema_version",
    "provider_id",
    "provider_type",
    "capability",
    "version",
    "supported_regions",
    "languages",
    "max_session_minutes",
    "supports_streaming",
    "supports_barge_in",
    "supports_data_residency",
    "latency_class",
    "cost_model_ref",
    "status",
    "evaluated_at",
  ]);
  const providerType = parseProviderPortKind(readRequired(record, "provider_type"));
  if (providerType !== expectedPortKind) throw new ProviderContractError("incompatible_port");
  const capability = {
    schema_version: parseSchemaVersion(readRequired(record, "schema_version")),
    provider_id: parseProviderId(readRequired(record, "provider_id")),
    provider_type: providerType,
    capability: parsePattern(readRequired(record, "capability"), CAPABILITY_PATTERN),
    version: parsePattern(readRequired(record, "version"), VERSION_PATTERN),
    supported_regions: parseStringArray(readRequired(record, "supported_regions"), REGION_PATTERN, 1, 100),
    languages: parseStringArray(readRequired(record, "languages"), LANGUAGE_PATTERN, 1, 200),
    max_session_minutes: parseInteger(readRequired(record, "max_session_minutes"), 1, 1440),
    supports_streaming: parseBoolean(readRequired(record, "supports_streaming")),
    supports_barge_in: parseBoolean(readRequired(record, "supports_barge_in")),
    supports_data_residency: parseBoolean(readRequired(record, "supports_data_residency")),
    latency_class: parseEnum(readRequired(record, "latency_class"), ["ultra_low", "low", "medium", "batch"] as const),
    cost_model_ref: parsePattern(readRequired(record, "cost_model_ref"), COST_MODEL_REFERENCE_PATTERN),
    status: parseEnum(readRequired(record, "status"), ["candidate", "approved", "fallback", "deprecated", "disabled"] as const),
    evaluated_at: parseTimestamp(readRequired(record, "evaluated_at")),
  } satisfies ProviderCapability;
  return deepFreeze(capability);
}

function parseProviderCapabilities(value: unknown, expectedPortKind: ProviderPortKind): readonly ProviderCapability[] {
  const values = arrayValues(value, 1, 100);
  const capabilities = values.map((item) => parseProviderCapabilityRecord(item, expectedPortKind));
  const providerId = capabilities[0]!.provider_id;
  if (capabilities.some((capability) => capability.provider_id !== providerId)) throw new ProviderContractError("incompatible_port");
  if (new Set(capabilities.map((capability) => capability.capability)).size !== capabilities.length) {
    throw new ProviderContractError("incompatible_port");
  }
  return Object.freeze(capabilities);
}

function parseSchemaVersion(value: unknown): "2.0.0" {
  if (value !== "2.0.0") throw new ProviderContractError();
  return value;
}

function parseTimeout(value: unknown): number {
  return parseInteger(value, 50, 120_000);
}

function parseInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProviderContractError();
  }
  return value;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ProviderContractError();
  return value;
}

function parsePattern(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new ProviderContractError();
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ProviderContractError();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new ProviderContractError();
  return value;
}

function parseProviderIds(value: unknown): ProviderId[] {
  const values = arrayValues(value, 0, 8);
  const parsed = values.map(parseProviderId);
  if (new Set(parsed).size !== parsed.length) throw new ProviderContractError();
  return parsed;
}

function parseStringArray(value: unknown, pattern: RegExp, minimum: number, maximum: number): string[] {
  const values = arrayValues(value, minimum, maximum).map((item) => parsePattern(item, pattern));
  if (new Set(values).size !== values.length) throw new ProviderContractError();
  return values;
}

function arrayValues(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new ProviderContractError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError();
    items.push(descriptor.value);
  }
  return Object.freeze(items);
}

function parseEnum<const Value extends string>(value: unknown, values: readonly Value[]): Value {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) throw new ProviderContractError();
  return value as Value;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ProviderContractError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ProviderContractError();
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new ProviderContractError();
  }
}

function readRequired(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError();
  return descriptor.value;
}

function deepFreeze<const Value>(value: Value): Value {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}
