/**
 * M2-10: executes docs/operations/CAPABILITY_DEGRADATION_MATRIX.md as typed
 * directives instead of prose, and tracks per-session degradation state so
 * a recovery (S2S back up, avatar warm again, network improved) never
 * causes the Presenter to deliver the same logical turn's output twice.
 * Art. 14: reconnection and termination are explicit states — nothing here
 * auto-recovers silently; a caller must call `recover` once it has verified
 * the capability is actually healthy again.
 */
export const CAPABILITY_FAILURE_KINDS = [
  "avatar_unavailable",
  "tts_primary_down",
  "stt_degraded",
  "s2s_down",
  "rag_down",
  "tool_timeout",
  "axtro_daemon_down",
  "meeting_bot_removed",
  "network_poor",
  "budget_reached",
] as const;
export type CapabilityFailureKind = (typeof CAPABILITY_FAILURE_KINDS)[number];

export type SystemActionKind =
  | "disable_avatar_for_session"
  | "switch_tts_adapter"
  | "lower_stt_confidence_and_fallback"
  | "switch_to_modular_pipeline"
  | "state_known_limits_no_unsupported_claims"
  | "mark_receipt_unknown_and_reconcile"
  | "stop_axtro_suggestions"
  | "terminate_or_offer_native_room"
  | "reduce_video_or_voice_only"
  | "block_new_spend";

export type DataActionKind =
  | "health_event_and_cost_stop"
  | "record_provider_failure"
  | "do_not_persist_uncertain_fact"
  | "new_provider_session_ref"
  | "create_incident_metric"
  | "no_duplicate_retry"
  | "health_only"
  | "save_timeline"
  | "quality_metrics"
  | "budget_event";

export interface CapabilityDegradationRule {
  readonly failure: CapabilityFailureKind;
  readonly userExperience: string;
  readonly systemAction: SystemActionKind;
  readonly dataAction: DataActionKind;
}

/** The exact ten rows of the operations matrix, verbatim in meaning, closed and immutable. */
export const CAPABILITY_DEGRADATION_MATRIX: readonly CapabilityDegradationRule[] = Object.freeze([
  Object.freeze({ failure: "avatar_unavailable", userExperience: "voice continues, visual fallback", systemAction: "disable_avatar_for_session", dataAction: "health_event_and_cost_stop" }),
  Object.freeze({ failure: "tts_primary_down", userExperience: "brief pause, fallback voice", systemAction: "switch_tts_adapter", dataAction: "record_provider_failure" }),
  Object.freeze({ failure: "stt_degraded", userExperience: "ask repetition or use alternate", systemAction: "lower_stt_confidence_and_fallback", dataAction: "do_not_persist_uncertain_fact" }),
  Object.freeze({ failure: "s2s_down", userExperience: "switch modular pipeline", systemAction: "switch_to_modular_pipeline", dataAction: "new_provider_session_ref" }),
  Object.freeze({ failure: "rag_down", userExperience: "state known limits", systemAction: "state_known_limits_no_unsupported_claims", dataAction: "create_incident_metric" }),
  Object.freeze({ failure: "tool_timeout", userExperience: "say still pending or cannot confirm", systemAction: "mark_receipt_unknown_and_reconcile", dataAction: "no_duplicate_retry" }),
  Object.freeze({ failure: "axtro_daemon_down", userExperience: "no visible impact", systemAction: "stop_axtro_suggestions", dataAction: "health_only" }),
  Object.freeze({ failure: "meeting_bot_removed", userExperience: "explain via alternate channel if possible", systemAction: "terminate_or_offer_native_room", dataAction: "save_timeline" }),
  Object.freeze({ failure: "network_poor", userExperience: "reduce video or voice-only", systemAction: "reduce_video_or_voice_only", dataAction: "quality_metrics" }),
  Object.freeze({ failure: "budget_reached", userExperience: "no premium features or end per policy", systemAction: "block_new_spend", dataAction: "budget_event" }),
]);

const RULE_BY_FAILURE = new Map<CapabilityFailureKind, CapabilityDegradationRule>(
  CAPABILITY_DEGRADATION_MATRIX.map((rule) => [rule.failure, rule]),
);

export function ruleFor(failure: CapabilityFailureKind): CapabilityDegradationRule {
  const rule = RULE_BY_FAILURE.get(failure);
  if (rule === undefined) throw new RangeError(`unknown capability failure kind: ${failure}`);
  return rule;
}

export interface DegradationEvent {
  readonly sequence: number;
  readonly atMs: number;
  readonly type: "failure_declared" | "recovered";
  readonly failure: CapabilityFailureKind;
  readonly rule: CapabilityDegradationRule;
  readonly generationId: number | null;
}

export interface DegradationControllerClock {
  now(): number;
}

export interface HandleFailureInput {
  readonly failure: CapabilityFailureKind;
  readonly generationId?: number;
}

export interface DegradationController {
  handleFailure(input: unknown): DegradationEvent;
  recover(failure: unknown): void;
  isDegraded(failure: unknown): boolean;
  activeFailures(): readonly CapabilityFailureKind[];
  markPresented(generationId: unknown): void;
  shouldSuppressDuplicatePresentation(generationId: unknown): boolean;
  events(): readonly DegradationEvent[];
}

const systemClock: DegradationControllerClock = Object.freeze({ now: () => Date.now() });

export function createDegradationController(clock: DegradationControllerClock = systemClock): DegradationController {
  const active = new Set<CapabilityFailureKind>();
  const events: DegradationEvent[] = [];
  let sequence = 0;
  let highestPresentedGenerationId: number | null = null;
  const presentedGenerationIds = new Set<number>();

  const emit = (type: DegradationEvent["type"], failure: CapabilityFailureKind, generationId: number | null): DegradationEvent => {
    const event: DegradationEvent = Object.freeze({ sequence: sequence += 1, atMs: clock.now(), type, failure, rule: ruleFor(failure), generationId });
    events.push(event);
    return event;
  };

  return Object.freeze({
    handleFailure(rawInput: unknown): DegradationEvent {
      const input = parseHandleFailureInput(rawInput);
      active.add(input.failure);
      return emit("failure_declared", input.failure, input.generationId ?? null);
    },

    recover(rawFailure: unknown): void {
      const failure = parseFailureKind(rawFailure);
      if (!active.has(failure)) return;
      active.delete(failure);
      emit("recovered", failure, null);
    },

    isDegraded(rawFailure: unknown): boolean {
      return active.has(parseFailureKind(rawFailure));
    },

    activeFailures(): readonly CapabilityFailureKind[] {
      return Object.freeze([...active]);
    },

    markPresented(rawGenerationId: unknown): void {
      const generationId = parseGenerationId(rawGenerationId);
      presentedGenerationIds.add(generationId);
      highestPresentedGenerationId = highestPresentedGenerationId === null ? generationId : Math.max(highestPresentedGenerationId, generationId);
    },

    shouldSuppressDuplicatePresentation(rawGenerationId: unknown): boolean {
      const generationId = parseGenerationId(rawGenerationId);
      if (presentedGenerationIds.has(generationId)) return true;
      return highestPresentedGenerationId !== null && generationId < highestPresentedGenerationId;
    },

    events(): readonly DegradationEvent[] {
      return Object.freeze([...events]);
    },
  });
}

function parseFailureKind(value: unknown): CapabilityFailureKind {
  if (typeof value !== "string" || !(CAPABILITY_FAILURE_KINDS as readonly string[]).includes(value)) {
    throw new RangeError("invalid capability failure kind");
  }
  return value as CapabilityFailureKind;
}

function parseGenerationId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new RangeError("invalid generationId");
  return value;
}

function parseHandleFailureInput(value: unknown): HandleFailureInput {
  if (value === null || typeof value !== "object") throw new RangeError("invalid failure input");
  const record = value as Record<string, unknown>;
  const failure = parseFailureKind(record.failure);
  if (record.generationId === undefined) return Object.freeze({ failure });
  return Object.freeze({ failure, generationId: parseGenerationId(record.generationId) });
}
