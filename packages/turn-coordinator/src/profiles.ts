/** Per-profile endpoint and barge-in policy, per docs/architecture/TURN_COORDINATOR.md config table. */
export type TurnCoordinatorProfileId = "conversational" | "presentation" | "noisy_phone" | "accessibility";

export interface TurnCoordinatorProfile {
  readonly id: TurnCoordinatorProfileId;
  /** Normalized 0..1 energy a chunk must reach to count as speech rather than noise. */
  readonly minSpeechEnergyToStart: number;
  /** Accumulated voiced duration required before a pause can end the turn; below this, a pause is a false start. */
  readonly minSpeechDurationMsToStart: number;
  /** Silence duration that raises an endpoint candidate (may still return to user_speaking). */
  readonly pauseSilenceMs: number;
  /** Silence duration, combined with transcript completeness, required to confirm an endpoint. */
  readonly endpointSilenceMs: number;
  readonly requiresSemanticCompletion: boolean;
  readonly requiresPunctuationComplete: boolean;
  readonly maxUtteranceMs: number;
  readonly bargeInMinEnergy: number;
  readonly bargeInMinDurationMs: number;
  readonly bargeInConfirmDurationMs: number;
  readonly pushToTalkRequired: boolean;
  readonly speculativeGenerationEnabled: boolean;
}

function profile(id: TurnCoordinatorProfileId, overrides: Omit<TurnCoordinatorProfile, "id">): TurnCoordinatorProfile {
  return Object.freeze({ id, ...overrides });
}

export const CONVERSATIONAL_PROFILE: TurnCoordinatorProfile = profile("conversational", {
  minSpeechEnergyToStart: 0.25,
  minSpeechDurationMsToStart: 150,
  pauseSilenceMs: 350,
  endpointSilenceMs: 600,
  requiresSemanticCompletion: false,
  requiresPunctuationComplete: false,
  maxUtteranceMs: 15_000,
  bargeInMinEnergy: 0.3,
  bargeInMinDurationMs: 120,
  bargeInConfirmDurationMs: 80,
  pushToTalkRequired: false,
  speculativeGenerationEnabled: true,
});

export const PRESENTATION_PROFILE: TurnCoordinatorProfile = profile("presentation", {
  minSpeechEnergyToStart: 0.25,
  minSpeechDurationMsToStart: 150,
  pauseSilenceMs: 500,
  endpointSilenceMs: 900,
  requiresSemanticCompletion: true,
  requiresPunctuationComplete: false,
  maxUtteranceMs: 25_000,
  bargeInMinEnergy: 0.3,
  bargeInMinDurationMs: 120,
  bargeInConfirmDurationMs: 80,
  pushToTalkRequired: false,
  speculativeGenerationEnabled: true,
});

export const NOISY_PHONE_PROFILE: TurnCoordinatorProfile = profile("noisy_phone", {
  minSpeechEnergyToStart: 0.4,
  minSpeechDurationMsToStart: 200,
  pauseSilenceMs: 450,
  endpointSilenceMs: 800,
  requiresSemanticCompletion: false,
  requiresPunctuationComplete: true,
  maxUtteranceMs: 15_000,
  bargeInMinEnergy: 0.5,
  bargeInMinDurationMs: 200,
  bargeInConfirmDurationMs: 250,
  pushToTalkRequired: false,
  speculativeGenerationEnabled: false,
});

export const ACCESSIBILITY_PROFILE: TurnCoordinatorProfile = profile("accessibility", {
  minSpeechEnergyToStart: 0.2,
  minSpeechDurationMsToStart: 100,
  pauseSilenceMs: 600,
  endpointSilenceMs: 1_200,
  requiresSemanticCompletion: false,
  requiresPunctuationComplete: false,
  maxUtteranceMs: 30_000,
  bargeInMinEnergy: 0.3,
  bargeInMinDurationMs: 150,
  bargeInConfirmDurationMs: 150,
  pushToTalkRequired: false,
  speculativeGenerationEnabled: false,
});

export const TURN_COORDINATOR_PROFILES: Readonly<Record<TurnCoordinatorProfileId, TurnCoordinatorProfile>> = Object.freeze({
  conversational: CONVERSATIONAL_PROFILE,
  presentation: PRESENTATION_PROFILE,
  noisy_phone: NOISY_PHONE_PROFILE,
  accessibility: ACCESSIBILITY_PROFILE,
});

/** Accessibility explicitly allows optional push-to-talk; every other profile keeps signal-driven endpointing. */
export function withPushToTalkRequired(base: TurnCoordinatorProfile, required: boolean): TurnCoordinatorProfile {
  return Object.freeze({ ...base, pushToTalkRequired: required });
}
