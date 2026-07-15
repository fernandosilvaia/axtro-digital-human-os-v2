import { reduceTurnCoordinatorState, type TurnCoordinatorState, type TurnCoordinatorTransitionEvent } from "./state-machine.js";
import type { TurnCoordinatorProfile } from "./profiles.js";

export class TurnCoordinatorInputError extends Error {
  constructor(readonly reason: string) {
    super(`turn coordinator rejected the signal: ${reason}`);
    this.name = "TurnCoordinatorInputError";
  }
}

export interface TurnCoordinatorSpeechEnergySignal {
  readonly type: "speech_energy";
  readonly atMs: number;
  readonly durationMs: number;
  readonly voiced: boolean;
  readonly energy: number;
  readonly isBackchannel?: boolean;
  readonly participantId?: string;
}

export interface TurnCoordinatorTranscriptUpdateSignal {
  readonly type: "transcript_update";
  readonly atMs: number;
  readonly punctuationComplete: boolean;
  readonly semanticComplete: boolean;
}

export interface TurnCoordinatorPushToTalkSignal {
  readonly type: "push_to_talk_pressed" | "push_to_talk_released";
  readonly atMs: number;
  readonly participantId?: string;
}

export interface TurnCoordinatorPresenterCompletedSignal {
  readonly type: "presenter_turn_completed";
  readonly atMs: number;
  readonly generationId: number;
}

export interface TurnCoordinatorNetworkJitterSignal {
  readonly type: "network_jitter_observed";
  readonly atMs: number;
  readonly delayMs: number;
}

export type TurnCoordinatorSignal =
  | TurnCoordinatorSpeechEnergySignal
  | TurnCoordinatorTranscriptUpdateSignal
  | TurnCoordinatorPushToTalkSignal
  | TurnCoordinatorPresenterCompletedSignal
  | TurnCoordinatorNetworkJitterSignal;

export type TurnCoordinatorDirective =
  | { readonly type: "state_changed"; readonly sequence: number; readonly atMs: number; readonly from: TurnCoordinatorState; readonly to: TurnCoordinatorState; readonly event: TurnCoordinatorTransitionEvent }
  | { readonly type: "speculative_generation_started"; readonly sequence: number; readonly atMs: number; readonly generationId: number }
  | { readonly type: "generation_committed"; readonly sequence: number; readonly atMs: number; readonly generationId: number; readonly mode: "fresh" | "promoted_speculative" }
  | { readonly type: "generation_cancelled"; readonly sequence: number; readonly atMs: number; readonly generationId: number; readonly reason: "speech_resumed" | "interruption_confirmed" }
  | { readonly type: "playback_paused"; readonly sequence: number; readonly atMs: number; readonly generationId: number }
  | { readonly type: "playback_resumed"; readonly sequence: number; readonly atMs: number; readonly generationId: number }
  | { readonly type: "scene_cancelled"; readonly sequence: number; readonly atMs: number; readonly generationId: number }
  | { readonly type: "crosstalk_ignored"; readonly sequence: number; readonly atMs: number; readonly ignoredParticipantId: string }
  | { readonly type: "false_start_abandoned"; readonly sequence: number; readonly atMs: number };

type DistributiveOmit<Value, Keys extends keyof never> = Value extends unknown ? Omit<Value, Keys> : never;
type TurnCoordinatorDirectiveInput = DistributiveOmit<TurnCoordinatorDirective, "sequence">;

export interface TurnCoordinator {
  readonly profile: TurnCoordinatorProfile;
  handleSignal(signal: unknown): void;
  state(): TurnCoordinatorState;
  currentGenerationId(): number | null;
  isGenerationActive(generationId: unknown): boolean;
  directives(): readonly TurnCoordinatorDirective[];
}

const MAX_DIRECTIVES = 4096;
const MAX_DURATION_MS = 600_000;

export function createTurnCoordinator(profile: TurnCoordinatorProfile): TurnCoordinator {
  let state: TurnCoordinatorState = "idle";
  let sequence = 0;
  const directives: TurnCoordinatorDirective[] = [];

  let totalVoicedMs = 0;
  let silenceMs = 0;
  let utteranceElapsedMs = 0;
  let forcedEndpoint = false;
  let activeParticipantId: string | null = null;

  let candidateVoicedMs = 0;
  let latestPunctuationComplete = false;
  let latestSemanticComplete = false;

  let generationCounter = 0;
  let pendingGenerationId: number | null = null;
  let currentGenerationId: number | null = null;

  const emit = (directive: TurnCoordinatorDirectiveInput): void => {
    if (directives.length >= MAX_DIRECTIVES) directives.shift();
    directives.push(Object.freeze({ ...directive, sequence: sequence += 1 }) as TurnCoordinatorDirective);
  };

  const transition = (event: TurnCoordinatorTransitionEvent, atMs: number): void => {
    const from = state;
    const to = reduceTurnCoordinatorState(from, event);
    state = to;
    emit({ type: "state_changed", atMs, from, to, event });
  };

  const resetUtteranceTracking = (): void => {
    totalVoicedMs = 0;
    silenceMs = 0;
    utteranceElapsedMs = 0;
    forcedEndpoint = false;
    activeParticipantId = null;
    latestPunctuationComplete = false;
    latestSemanticComplete = false;
  };

  const startSpeculativeGenerationIfEnabled = (atMs: number): void => {
    if (!profile.speculativeGenerationEnabled || pendingGenerationId !== null) return;
    pendingGenerationId = generationCounter += 1;
    emit({ type: "speculative_generation_started", atMs, generationId: pendingGenerationId });
  };

  const cancelPendingGeneration = (atMs: number, reason: "speech_resumed" | "interruption_confirmed"): void => {
    if (pendingGenerationId === null) return;
    emit({ type: "generation_cancelled", atMs, generationId: pendingGenerationId, reason });
    pendingGenerationId = null;
  };

  const confirmEndpointEligible = (): boolean => {
    if (forcedEndpoint) return true;
    if (silenceMs < profile.endpointSilenceMs) return false;
    if (profile.requiresSemanticCompletion && !latestSemanticComplete) return false;
    if (profile.requiresPunctuationComplete && !latestPunctuationComplete) return false;
    return true;
  };

  const commitEndpoint = (atMs: number): void => {
    transition("endpoint_confirmed", atMs);
    if (pendingGenerationId !== null) {
      currentGenerationId = pendingGenerationId;
      pendingGenerationId = null;
      emit({ type: "generation_committed", atMs, generationId: currentGenerationId, mode: "promoted_speculative" });
    } else {
      currentGenerationId = generationCounter += 1;
      emit({ type: "generation_committed", atMs, generationId: currentGenerationId, mode: "fresh" });
    }
    candidateVoicedMs = 0;
  };

  const handleSpeechEnergyDuringUserTurn = (signal: TurnCoordinatorSpeechEnergySignal): void => {
    if (signal.participantId !== undefined && activeParticipantId !== null && signal.participantId !== activeParticipantId) {
      emit({ type: "crosstalk_ignored", atMs: signal.atMs, ignoredParticipantId: signal.participantId });
      return;
    }
    const qualifies = signal.voiced && signal.energy >= profile.minSpeechEnergyToStart && signal.isBackchannel !== true;
    if (state === "endpoint_candidate" && qualifies) {
      if (forcedEndpoint) {
        // A max-utterance timeout is a hard cap: continued speech cannot cancel it back
        // into user_speaking the way an ordinary pause candidate can. Commit immediately.
        commitEndpoint(signal.atMs);
        return;
      }
      cancelPendingGeneration(signal.atMs, "speech_resumed");
      transition("speech_resumed", signal.atMs);
      totalVoicedMs += signal.durationMs;
      silenceMs = 0;
      utteranceElapsedMs += signal.durationMs;
      return;
    }
    if (qualifies) {
      totalVoicedMs += signal.durationMs;
      silenceMs = 0;
      utteranceElapsedMs += signal.durationMs;
    } else {
      silenceMs += signal.durationMs;
      utteranceElapsedMs += signal.durationMs;
      if (totalVoicedMs < profile.minSpeechDurationMsToStart) {
        transition("false_start_abandoned", signal.atMs);
        emit({ type: "false_start_abandoned", atMs: signal.atMs });
        resetUtteranceTracking();
        return;
      }
      if (state === "user_speaking" && silenceMs >= profile.pauseSilenceMs) {
        transition("pause_detected", signal.atMs);
        startSpeculativeGenerationIfEnabled(signal.atMs);
      }
      // Re-check with the (possibly just-updated) state: a single silence chunk long
      // enough to satisfy both thresholds must not wait for a second signal to commit.
      if (state === "endpoint_candidate" && confirmEndpointEligible()) {
        commitEndpoint(signal.atMs);
        return;
      }
    }
    if (state === "user_speaking" && utteranceElapsedMs >= profile.maxUtteranceMs) {
      forcedEndpoint = true;
      transition("max_utterance_timeout", signal.atMs);
      startSpeculativeGenerationIfEnabled(signal.atMs);
    }
  };

  const handleSpeechEnergyDuringPresenterFloor = (signal: TurnCoordinatorSpeechEnergySignal): void => {
    const qualifies = signal.voiced && signal.energy >= profile.bargeInMinEnergy && signal.isBackchannel !== true;
    if (state === "committed") {
      if (!qualifies) {
        candidateVoicedMs = 0;
        return;
      }
      candidateVoicedMs += signal.durationMs;
      if (candidateVoicedMs >= profile.bargeInMinDurationMs) {
        transition("interruption_candidate", signal.atMs);
        if (currentGenerationId !== null) emit({ type: "playback_paused", atMs: signal.atMs, generationId: currentGenerationId });
      }
      return;
    }
    if (state === "agent_interrupted") {
      if (!qualifies) {
        transition("interruption_false_positive", signal.atMs);
        if (currentGenerationId !== null) {
          transition("playback_recovered", signal.atMs);
          emit({ type: "playback_resumed", atMs: signal.atMs, generationId: currentGenerationId });
        }
        candidateVoicedMs = 0;
        return;
      }
      candidateVoicedMs += signal.durationMs;
      if (candidateVoicedMs >= profile.bargeInMinDurationMs + profile.bargeInConfirmDurationMs) {
        const cancelledGenerationId = currentGenerationId;
        transition("interruption_confirmed", signal.atMs);
        if (cancelledGenerationId !== null) {
          emit({ type: "generation_cancelled", atMs: signal.atMs, generationId: cancelledGenerationId, reason: "interruption_confirmed" });
          emit({ type: "scene_cancelled", atMs: signal.atMs, generationId: cancelledGenerationId });
        }
        currentGenerationId = null;
        candidateVoicedMs = 0;
        resetUtteranceTracking();
        totalVoicedMs = signal.durationMs;
        activeParticipantId = signal.participantId ?? null;
      }
    }
  };

  const handleSignal = (rawSignal: unknown): void => {
    const signal = parseSignal(rawSignal);
    switch (signal.type) {
      case "speech_energy": {
        if (state === "idle") {
          if (signal.voiced && signal.energy >= profile.minSpeechEnergyToStart && signal.isBackchannel !== true) {
            activeParticipantId = signal.participantId ?? null;
            transition("speech_started", signal.atMs);
            totalVoicedMs = signal.durationMs;
            utteranceElapsedMs = signal.durationMs;
          }
          return;
        }
        if (state === "user_speaking" || state === "endpoint_candidate") {
          handleSpeechEnergyDuringUserTurn(signal);
          return;
        }
        if (state === "committed" || state === "agent_interrupted") {
          handleSpeechEnergyDuringPresenterFloor(signal);
        }
        return;
      }
      case "transcript_update": {
        latestPunctuationComplete = signal.punctuationComplete;
        latestSemanticComplete = signal.semanticComplete;
        if (state === "endpoint_candidate" && confirmEndpointEligible()) commitEndpoint(signal.atMs);
        return;
      }
      case "push_to_talk_pressed": {
        if (!profile.pushToTalkRequired) return;
        if (state !== "idle") return;
        activeParticipantId = signal.participantId ?? null;
        transition("speech_started", signal.atMs);
        totalVoicedMs = profile.minSpeechDurationMsToStart;
        utteranceElapsedMs = 0;
        return;
      }
      case "push_to_talk_released": {
        if (!profile.pushToTalkRequired) return;
        if (state === "user_speaking") {
          transition("pause_detected", signal.atMs);
          forcedEndpoint = true;
          commitEndpoint(signal.atMs);
        } else if (state === "endpoint_candidate") {
          forcedEndpoint = true;
          commitEndpoint(signal.atMs);
        }
        return;
      }
      case "presenter_turn_completed": {
        if (state !== "committed" || signal.generationId !== currentGenerationId) return;
        transition("presenter_turn_completed", signal.atMs);
        currentGenerationId = null;
        candidateVoicedMs = 0;
        resetUtteranceTracking();
        return;
      }
      case "network_jitter_observed": {
        return;
      }
    }
  };

  return Object.freeze({
    profile,
    handleSignal,
    state: () => state,
    currentGenerationId: () => currentGenerationId,
    isGenerationActive: (generationId: unknown) => typeof generationId === "number" && generationId === currentGenerationId,
    directives: () => Object.freeze([...directives]),
  });
}

function parseSignal(value: unknown): TurnCoordinatorSignal {
  if (value === null || typeof value !== "object") throw new TurnCoordinatorInputError("signal must be an object");
  const record = value as Record<string, unknown>;
  const atMs = parseNonNegativeInteger(record.atMs, "atMs");
  switch (record.type) {
    case "speech_energy":
      return Object.freeze({
        type: "speech_energy",
        atMs,
        durationMs: parseNonNegativeInteger(record.durationMs, "durationMs"),
        voiced: parseBoolean(record.voiced, "voiced"),
        energy: parseUnitInterval(record.energy, "energy"),
        ...(record.isBackchannel === undefined ? {} : { isBackchannel: parseBoolean(record.isBackchannel, "isBackchannel") }),
        ...(record.participantId === undefined ? {} : { participantId: parseParticipantId(record.participantId) }),
      }) as TurnCoordinatorSpeechEnergySignal;
    case "transcript_update":
      return Object.freeze({
        type: "transcript_update",
        atMs,
        punctuationComplete: parseBoolean(record.punctuationComplete, "punctuationComplete"),
        semanticComplete: parseBoolean(record.semanticComplete, "semanticComplete"),
      });
    case "push_to_talk_pressed":
    case "push_to_talk_released":
      return Object.freeze({
        type: record.type,
        atMs,
        ...(record.participantId === undefined ? {} : { participantId: parseParticipantId(record.participantId) }),
      }) as TurnCoordinatorPushToTalkSignal;
    case "presenter_turn_completed":
      return Object.freeze({ type: "presenter_turn_completed", atMs, generationId: parseNonNegativeInteger(record.generationId, "generationId") });
    case "network_jitter_observed":
      return Object.freeze({ type: "network_jitter_observed", atMs, delayMs: parseNonNegativeInteger(record.delayMs, "delayMs") });
    default:
      throw new TurnCoordinatorInputError("unknown signal type");
  }
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_DURATION_MS) {
    throw new TurnCoordinatorInputError(`${field} must be a bounded non-negative number`);
  }
  return value;
}

function parseUnitInterval(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TurnCoordinatorInputError(`${field} must be between 0 and 1`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TurnCoordinatorInputError(`${field} must be a boolean`);
  return value;
}

function parseParticipantId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) throw new TurnCoordinatorInputError("participantId is invalid");
  return value;
}
