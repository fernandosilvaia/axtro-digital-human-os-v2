import type { PortalPublicDemoActionResult } from "@axtro/contracts-ts";

const RESULT_KEYS = Object.freeze([
  "schema_version",
  "outcome",
  "revision",
  "surface",
  "step",
  "commands_remaining",
  "reason_code",
] as const);
const SURFACES = new Set(["overview", "agent", "knowledge", "conversation"]);
const STEPS = new Set(["welcome", "context", "conversation", "handoff"]);

function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Object.keys(value);
  if (keys.length !== RESULT_KEYS.length || !RESULT_KEYS.every((key) => Object.hasOwn(value, key))) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

export function parsePublicDemoActionResult(value: unknown): PortalPublicDemoActionResult | null {
  const result = ownDataRecord(value);
  if (result === null || result.schema_version !== "2.0.0") return null;

  if (result.outcome === "expired") {
    if (result.revision !== null
      || result.surface !== null
      || result.step !== null
      || result.commands_remaining !== null
      || result.reason_code !== "state_expired") return null;
    return Object.freeze({
      schema_version: "2.0.0",
      outcome: "expired",
      revision: null,
      surface: null,
      step: null,
      commands_remaining: null,
      reason_code: "state_expired",
    });
  }
  if (result.outcome === "unavailable") {
    if (result.revision !== null
      || result.surface !== null
      || result.step !== null
      || result.commands_remaining !== null
      || result.reason_code !== "demo_unavailable") return null;
    return Object.freeze({
      schema_version: "2.0.0",
      outcome: "unavailable",
      revision: null,
      surface: null,
      step: null,
      commands_remaining: null,
      reason_code: "demo_unavailable",
    });
  }

  if (result.outcome !== "applied" && result.outcome !== "replayed" && result.outcome !== "stale") {
    return null;
  }
  if (!Number.isInteger(result.revision)
    || Number(result.revision) < 0
    || Number(result.revision) > 12
    || !SURFACES.has(String(result.surface))
    || !STEPS.has(String(result.step))
    || result.commands_remaining !== 12 - Number(result.revision)) return null;

  const expectedReason = result.outcome === "applied"
    ? null
    : result.outcome === "replayed" ? "duplicate_command" : "revision_mismatch";
  if (result.reason_code !== expectedReason) return null;
  return Object.freeze({
    schema_version: "2.0.0",
    outcome: result.outcome,
    revision: Number(result.revision),
    surface: result.surface as "overview" | "agent" | "knowledge" | "conversation",
    step: result.step as "welcome" | "context" | "conversation" | "handoff",
    commands_remaining: Number(result.commands_remaining),
    reason_code: expectedReason,
  }) as PortalPublicDemoActionResult;
}
