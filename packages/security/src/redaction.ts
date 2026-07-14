export const REDACTED_VALUE = "[REDACTED]";
export const CIRCULAR_VALUE = "[CIRCULAR]";
export const UNSAFE_VALUE = "[UNSAFE_VALUE]";

export interface RedactionOptions {
  readonly secretValues?: readonly string[];
}

export interface SafeError {
  readonly code: string;
  readonly message: string;
}

const SENSITIVE_KEY = /secret|token|authorization|api[_-]?key|password|credential|cookie|stack|cause/i;
const SECRET_LIKE_VALUE = /(?:sk-|gh[pousr]_|xox[baprs]-|AKIA|-----BEGIN)/i;

/**
 * Builds a JSON-safe copy for logs and exceptions without invoking getters,
 * toJSON, toString, or arbitrary user-controlled methods.
 */
export function redactForLog(value: unknown, options: RedactionOptions = {}): unknown {
  const knownSecrets = new Set(
    (options.secretValues ?? []).filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0),
  );
  return redact(value, knownSecrets, new WeakSet<object>());
}

/** Never return a raw Error or stack to callers outside the current trust boundary. */
export function toSafeError(_error: unknown, code = "internal_error"): SafeError {
  const safeCode = /^[a-z0-9_]{1,80}$/.test(code) ? code : "internal_error";
  return Object.freeze({ code: safeCode, message: "Operation failed" });
}

function redact(value: unknown, knownSecrets: ReadonlySet<string>, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return Number.isFinite(value) ? value : UNSAFE_VALUE;
  if (typeof value === "string") return redactString(value, knownSecrets);
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return UNSAFE_VALUE;
  }
  if (value instanceof Error) return redactError(value, knownSecrets);
  if (seen.has(value)) return CIRCULAR_VALUE;
  seen.add(value);
  if (Array.isArray(value)) return redactArray(value, knownSecrets, seen);
  return redactObject(value, knownSecrets, seen);
}

function redactString(value: string, knownSecrets: ReadonlySet<string>): string {
  if (SECRET_LIKE_VALUE.test(value)) return REDACTED_VALUE;
  let redacted = value;
  for (const secret of knownSecrets) redacted = redacted.split(secret).join(REDACTED_VALUE);
  return redacted;
}

function redactError(error: Error, knownSecrets: ReadonlySet<string>): Record<string, string> {
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  const message = descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? redactString(descriptor.value, knownSecrets)
    : UNSAFE_VALUE;
  return { name: "Error", message };
}

function redactArray(value: readonly unknown[], knownSecrets: ReadonlySet<string>, seen: WeakSet<object>): unknown[] {
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = safeDescriptor(value, String(index));
    output.push(descriptor !== undefined && "value" in descriptor ? redact(descriptor.value, knownSecrets, seen) : UNSAFE_VALUE);
  }
  return output;
}

function redactObject(value: object, knownSecrets: ReadonlySet<string>, seen: WeakSet<object>): Record<string, unknown> | string {
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return UNSAFE_VALUE;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    const descriptor = descriptors[key];
    output[key] = descriptor !== undefined && "value" in descriptor
      ? redact(descriptor.value, knownSecrets, seen)
      : UNSAFE_VALUE;
  }
  return output;
}

function safeDescriptor(value: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}
