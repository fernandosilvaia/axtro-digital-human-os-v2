import { createHash } from "node:crypto";

/**
 * M2-05: converts dialogue intent into bounded, provider-capability-validated
 * avatar/voice behavior, per docs/architecture/BEHAVIOR_PRESENCE_DIRECTOR.md.
 * `BehaviorIntent` carries goal/energy/warmth/pacing/pause-profile/nonverbal
 * intent only — never a free animation command or raw text.
 */
export const BEHAVIOR_CANONICAL_STATES = [
  "idle_ready",
  "listening_neutral",
  "listening_affirming",
  "thinking_brief",
  "speaking_explaining",
  "speaking_empathic",
  "presenting",
  "interrupted_recovering",
  "handoff_intro",
  "technical_degraded",
] as const;
export type BehaviorCanonicalState = (typeof BEHAVIOR_CANONICAL_STATES)[number];

export const BEHAVIOR_NONVERBAL_INTENTS = ["nod", "smile", "tilt_head", "lean_in", "raise_eyebrows", "soft_gaze_break"] as const;
export type BehaviorNonverbalIntent = (typeof BEHAVIOR_NONVERBAL_INTENTS)[number];
const QUIET_GESTURES: readonly BehaviorNonverbalIntent[] = ["nod", "soft_gaze_break", "tilt_head"];

export type BehaviorPacing = "slow" | "normal" | "fast";
export type BehaviorPauseProfile = "minimal" | "standard" | "generous";
export type BehaviorGazeTarget = "camera" | "away" | "none";

export interface BehaviorIntent {
  readonly goal: BehaviorCanonicalState;
  readonly energy: number;
  readonly warmth: number;
  readonly pacing: BehaviorPacing;
  readonly pauseProfile: BehaviorPauseProfile;
  readonly nonverbalIntent: readonly BehaviorNonverbalIntent[];
  readonly generationId: number;
  readonly reducedMotion?: boolean;
}

export interface ProviderBehaviorCapability {
  readonly allowedMicrogestures: readonly BehaviorNonverbalIntent[];
  readonly speakingRateRange: { readonly minRatePercent: number; readonly maxRatePercent: number };
  readonly supportsGaze: boolean;
  readonly voiceStyles: readonly string[];
}

export interface BehaviorDirective {
  readonly canonicalState: BehaviorCanonicalState;
  readonly voiceStyle: string;
  readonly speakingRatePercent: number;
  readonly preSpeechPauseMs: number;
  readonly allowedMicrogestures: readonly BehaviorNonverbalIntent[];
  readonly gazeTarget: BehaviorGazeTarget;
  readonly maxDurationMs: number;
  readonly cancellationGenerationId: number;
}

interface StateGestureAllowance {
  readonly probability: number;
  readonly maxCount: number;
  readonly quietOnly: boolean;
}

const STATE_ALLOWANCE: Readonly<Record<BehaviorCanonicalState, StateGestureAllowance>> = Object.freeze({
  idle_ready: { probability: 0.15, maxCount: 1, quietOnly: true },
  listening_neutral: { probability: 0.35, maxCount: 1, quietOnly: true },
  listening_affirming: { probability: 0.55, maxCount: 1, quietOnly: true },
  thinking_brief: { probability: 0.3, maxCount: 1, quietOnly: true },
  speaking_explaining: { probability: 0.7, maxCount: 2, quietOnly: false },
  speaking_empathic: { probability: 0.75, maxCount: 2, quietOnly: false },
  presenting: { probability: 0.65, maxCount: 2, quietOnly: false },
  interrupted_recovering: { probability: 0, maxCount: 0, quietOnly: true },
  handoff_intro: { probability: 0.5, maxCount: 1, quietOnly: false },
  technical_degraded: { probability: 0, maxCount: 0, quietOnly: true },
});

const STATE_GAZE: Readonly<Record<BehaviorCanonicalState, BehaviorGazeTarget>> = Object.freeze({
  idle_ready: "camera",
  listening_neutral: "camera",
  listening_affirming: "camera",
  thinking_brief: "away",
  speaking_explaining: "camera",
  speaking_empathic: "camera",
  presenting: "away",
  interrupted_recovering: "camera",
  handoff_intro: "camera",
  technical_degraded: "none",
});

const STATE_MAX_DURATION_MS: Readonly<Record<BehaviorCanonicalState, number>> = Object.freeze({
  idle_ready: 30_000,
  listening_neutral: 30_000,
  listening_affirming: 20_000,
  thinking_brief: 1_500,
  speaking_explaining: 12_000,
  speaking_empathic: 12_000,
  presenting: 15_000,
  interrupted_recovering: 800,
  handoff_intro: 4_000,
  technical_degraded: 5_000,
});

const PAUSE_PROFILE_BASE_MS: Readonly<Record<BehaviorPauseProfile, number>> = Object.freeze({
  minimal: 80,
  standard: 220,
  generous: 450,
});

const GESTURE_COOLDOWN_MS = 8_000;
const MAX_NODS_PER_MINUTE = 6;
const MAX_SMILES_PER_MINUTE = 4;
const WINDOW_MS = 60_000;
const SEED_PATTERN = /^[a-z][a-z0-9_-]{3,63}$/;

export interface BehaviorDirector {
  produce(intent: unknown, atMs: unknown): BehaviorDirective;
  interrupted(generationId: unknown, atMs: unknown): BehaviorDirective;
}

/** One director per session; `sessionSeed` makes gesture selection deterministic and reproducible for a replay. */
export function createBehaviorDirector(sessionSeed: string, capability: ProviderBehaviorCapability): BehaviorDirector {
  if (!SEED_PATTERN.test(sessionSeed)) throw new RangeError("invalid behavior director session seed");
  const lastUsedAtMs = new Map<BehaviorNonverbalIntent, number>();
  const recentUsage: { readonly gesture: BehaviorNonverbalIntent; readonly atMs: number }[] = [];
  let callIndex = 0;

  const pruneWindow = (atMs: number): void => {
    while (recentUsage.length > 0 && atMs - recentUsage[0]!.atMs > WINDOW_MS) recentUsage.shift();
  };
  const countInWindow = (gesture: BehaviorNonverbalIntent): number => recentUsage.filter((entry) => entry.gesture === gesture).length;

  const selectMicrogestures = (candidates: readonly BehaviorNonverbalIntent[], state: BehaviorCanonicalState, atMs: number): readonly BehaviorNonverbalIntent[] => {
    pruneWindow(atMs);
    const allowance = STATE_ALLOWANCE[state];
    if (allowance.maxCount === 0) return Object.freeze([]);
    const capabilityFiltered = candidates.filter((gesture) => capability.allowedMicrogestures.includes(gesture));
    const stateFiltered = allowance.quietOnly ? capabilityFiltered.filter((gesture) => QUIET_GESTURES.includes(gesture)) : capabilityFiltered;
    const selected: BehaviorNonverbalIntent[] = [];
    for (const gesture of stateFiltered) {
      if (selected.length >= allowance.maxCount) break;
      const lastUsed = lastUsedAtMs.get(gesture);
      if (lastUsed !== undefined && atMs - lastUsed < GESTURE_COOLDOWN_MS) continue;
      if (gesture === "nod" && countInWindow("nod") >= MAX_NODS_PER_MINUTE) continue;
      if (gesture === "smile" && countInWindow("smile") >= MAX_SMILES_PER_MINUTE) continue;
      const roll = deterministicUnitInterval(sessionSeed, callIndex, gesture);
      if (roll > allowance.probability) continue;
      selected.push(gesture);
      lastUsedAtMs.set(gesture, atMs);
      recentUsage.push({ gesture, atMs });
    }
    return Object.freeze(selected);
  };

  const chooseVoiceStyle = (state: BehaviorCanonicalState, warmth: number): string => {
    if (capability.voiceStyles.length === 0) throw new RangeError("provider capability declares no voice style");
    const defaultStyle = capability.voiceStyles[0]!;
    if (state === "technical_degraded") return capability.voiceStyles.find((style) => style === "neutral_fallback") ?? defaultStyle;
    if (warmth >= 0.6) return capability.voiceStyles.find((style) => style === "warm") ?? defaultStyle;
    return defaultStyle;
  };

  const speakingRatePercent = (pacing: BehaviorPacing, energy: number): number => {
    const { minRatePercent, maxRatePercent } = capability.speakingRateRange;
    const pacingBase = { slow: 0.25, normal: 0.5, fast: 0.85 }[pacing];
    const t = clamp(pacingBase + (energy - 0.5) * 0.2, 0, 1);
    return Math.round(minRatePercent + t * (maxRatePercent - minRatePercent));
  };

  return Object.freeze({
    produce(rawIntent: unknown, rawAtMs: unknown): BehaviorDirective {
      const intent = parseIntent(rawIntent);
      const atMs = parseAtMs(rawAtMs);
      callIndex += 1;
      const reducedMotion = intent.reducedMotion === true;
      const candidates = reducedMotion ? [] : intent.nonverbalIntent;
      const allowedMicrogestures = selectMicrogestures(candidates, intent.goal, atMs);
      return Object.freeze({
        canonicalState: intent.goal,
        voiceStyle: chooseVoiceStyle(intent.goal, intent.warmth),
        speakingRatePercent: speakingRatePercent(intent.pacing, intent.energy),
        preSpeechPauseMs: Math.round(PAUSE_PROFILE_BASE_MS[intent.pauseProfile] + intent.warmth * 40),
        allowedMicrogestures,
        gazeTarget: capability.supportsGaze && !reducedMotion ? STATE_GAZE[intent.goal] : "none",
        maxDurationMs: STATE_MAX_DURATION_MS[intent.goal],
        cancellationGenerationId: intent.generationId,
      });
    },
    interrupted(rawGenerationId: unknown, rawAtMs: unknown): BehaviorDirective {
      const generationId = parseGenerationId(rawGenerationId);
      const atMs = parseAtMs(rawAtMs);
      void atMs;
      return Object.freeze({
        canonicalState: "interrupted_recovering",
        voiceStyle: chooseVoiceStyle("interrupted_recovering", 0.5),
        speakingRatePercent: speakingRatePercent("normal", 0.5),
        preSpeechPauseMs: PAUSE_PROFILE_BASE_MS.minimal,
        allowedMicrogestures: Object.freeze([]),
        gazeTarget: capability.supportsGaze ? "camera" : "none",
        maxDurationMs: STATE_MAX_DURATION_MS.interrupted_recovering,
        cancellationGenerationId: generationId,
      });
    },
  });
}

function deterministicUnitInterval(seed: string, callIndex: number, salt: string): number {
  const digest = createHash("sha256").update(`${seed}:${callIndex}:${salt}`, "utf8").digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseAtMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new RangeError("invalid atMs");
  return value;
}

function parseGenerationId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new RangeError("invalid generationId");
  return value;
}

function parseIntent(value: unknown): BehaviorIntent {
  if (value === null || typeof value !== "object") throw new RangeError("invalid behavior intent");
  const record = value as Record<string, unknown>;
  if (typeof record.goal !== "string" || !(BEHAVIOR_CANONICAL_STATES as readonly string[]).includes(record.goal)) {
    throw new RangeError("invalid behavior intent goal");
  }
  const energy = parseUnitInterval(record.energy);
  const warmth = parseUnitInterval(record.warmth);
  if (record.pacing !== "slow" && record.pacing !== "normal" && record.pacing !== "fast") throw new RangeError("invalid pacing");
  if (record.pauseProfile !== "minimal" && record.pauseProfile !== "standard" && record.pauseProfile !== "generous") {
    throw new RangeError("invalid pause profile");
  }
  if (!Array.isArray(record.nonverbalIntent) || record.nonverbalIntent.some((item) => !(BEHAVIOR_NONVERBAL_INTENTS as readonly string[]).includes(item))) {
    throw new RangeError("invalid nonverbal intent");
  }
  return Object.freeze({
    goal: record.goal as BehaviorCanonicalState,
    energy,
    warmth,
    pacing: record.pacing,
    pauseProfile: record.pauseProfile,
    nonverbalIntent: Object.freeze([...(record.nonverbalIntent as BehaviorNonverbalIntent[])]),
    generationId: parseGenerationId(record.generationId),
    ...(record.reducedMotion === undefined ? {} : { reducedMotion: Boolean(record.reducedMotion) }),
  });
}

function parseUnitInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("invalid unit interval");
  return value;
}
