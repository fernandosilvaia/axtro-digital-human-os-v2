/**
 * M2-09: perception is evidence, not truth (Constitution Art. 4). Every
 * signal carries source, evidence, confidence, a versioned detector,
 * purpose, privacy class and a TTL. Only the M2-allowed categories from
 * docs/architecture/MULTIMODAL_PERCEPTION_ENGINE.md exist as types — there
 * is no way to construct a lie-detection, diagnosis, protected-attribute,
 * solvency/risk, biometric-identity or emotion-as-fact signal because those
 * kinds are simply not in the closed vocabulary below.
 */
export const DIALOGUE_SIGNAL_TYPES = [
  "repeated_question",
  "explicit_uncertainty",
  "long_silence",
  "interruption_frequency",
  "speaker_change",
  "explicit_sentiment",
] as const;
export const TECHNICAL_SIGNAL_TYPES = ["packet_loss", "low_audio_level", "echo", "frozen_video", "reconnect_count"] as const;
export const VISUAL_PRESENCE_SIGNAL_TYPES = ["face_visible", "away_from_camera", "presentation_focus_event", "hand_raised"] as const;
export const PERCEPTION_SIGNAL_TYPES = [
  ...DIALOGUE_SIGNAL_TYPES,
  ...TECHNICAL_SIGNAL_TYPES,
  ...VISUAL_PRESENCE_SIGNAL_TYPES,
] as const;
export type PerceptionSignalType = (typeof PERCEPTION_SIGNAL_TYPES)[number];
export type PerceptionSignalCategory = "dialogue" | "technical" | "visual_presence";

export type PrivacyClass = "internal" | "confidential" | "restricted";

/** docs/architecture/MULTIMODAL_PERCEPTION_ENGINE.md TTL table; visual-presence types are opt-in and additionally consent-gated. */
export const RECOMMENDED_SIGNAL_TTL_MS: Readonly<Record<PerceptionSignalType, number>> = Object.freeze({
  repeated_question: 120_000,
  explicit_uncertainty: 30_000,
  long_silence: 15_000,
  interruption_frequency: 300_000,
  speaker_change: 3_600_000,
  explicit_sentiment: 30_000,
  packet_loss: 15_000,
  low_audio_level: 10_000,
  echo: 10_000,
  frozen_video: 5_000,
  reconnect_count: 3_600_000,
  face_visible: 5_000,
  away_from_camera: 5_000,
  presentation_focus_event: 30_000,
  hand_raised: 10_000,
});
const MAX_TTL_MS = 14_400_000;

export interface PerceptionSignal {
  readonly signalId: string;
  readonly type: PerceptionSignalType;
  readonly category: PerceptionSignalCategory;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly purpose: string;
  readonly privacyClass: PrivacyClass;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
}

export interface DetectorDescriptor {
  readonly detectorId: string;
  readonly version: string;
  readonly signalTypes: readonly PerceptionSignalType[];
  readonly requiredConsentPurpose: string | null;
  readonly inputModalities: readonly string[];
}

export type SignalRejectionReason =
  | "detector_not_registered"
  | "signal_type_not_owned_by_detector"
  | "consent_missing"
  | "invalid_confidence"
  | "invalid_evidence"
  | "invalid_ttl";

export interface SignalAccepted {
  readonly outcome: "accepted";
  readonly signal: PerceptionSignal;
}
export interface SignalRejected {
  readonly outcome: "rejected";
  readonly reason: SignalRejectionReason;
}
export type SignalEmissionResult = SignalAccepted | SignalRejected;

export const HYPOTHESIS_KINDS = ["possible_confusion", "technical_adjustment_needed", "presence_check_needed", "active_speaker_updated"] as const;
export type HypothesisKind = (typeof HYPOTHESIS_KINDS)[number];

export interface DerivedHypothesis {
  readonly hypothesisId: string;
  readonly kind: HypothesisKind;
  readonly evidenceSignalIds: readonly string[];
  readonly confidence: number;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
}

export type HypothesisRejectionReason = "unknown_kind" | "invalid_confidence" | "invalid_ttl" | "no_evidence" | "evidence_not_found" | "evidence_expired";
export interface HypothesisAccepted {
  readonly outcome: "accepted";
  readonly hypothesis: DerivedHypothesis;
}
export interface HypothesisRejected {
  readonly outcome: "rejected";
  readonly reason: HypothesisRejectionReason;
}
export type HypothesisDerivationResult = HypothesisAccepted | HypothesisRejected;

export interface PerceptionBusClock {
  now(): number;
}

export interface EmitSignalInput {
  readonly type: string;
  readonly detectorId: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly purpose: string;
  readonly privacyClass: PrivacyClass;
  readonly ttlMs?: number;
  readonly grantedConsentPurposes: readonly string[];
}

export interface DeriveHypothesisInput {
  readonly kind: string;
  readonly evidenceSignalIds: readonly string[];
  readonly confidence: number;
  readonly ttlMs: number;
}

export interface PerceptionBus {
  registerDetector(descriptor: unknown): void;
  emitSignal(input: unknown): SignalEmissionResult;
  activeSignals(atMs: number): readonly PerceptionSignal[];
  deriveHypothesis(input: unknown, atMs: number): HypothesisDerivationResult;
}

const DETECTOR_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const MAX_SIGNALS_RETAINED = 2_000;

const systemClock: PerceptionBusClock = Object.freeze({ now: () => Date.now() });

export function createPerceptionBus(clock: PerceptionBusClock = systemClock): PerceptionBus {
  const detectors = new Map<string, DetectorDescriptor>();
  const signals = new Map<string, PerceptionSignal>();
  let signalSequence = 0;
  let hypothesisSequence = 0;

  const pruneIfNeeded = (): void => {
    if (signals.size <= MAX_SIGNALS_RETAINED) return;
    const oldest = [...signals.values()].sort((a, b) => a.observedAtMs - b.observedAtMs)[0];
    if (oldest !== undefined) signals.delete(oldest.signalId);
  };

  return Object.freeze({
    registerDetector(rawDescriptor: unknown): void {
      const descriptor = parseDetectorDescriptor(rawDescriptor);
      detectors.set(descriptor.detectorId, descriptor);
    },

    emitSignal(rawInput: unknown): SignalEmissionResult {
      const input = parseEmitInput(rawInput);
      const detector = detectors.get(input.detectorId);
      if (detector === undefined) return { outcome: "rejected", reason: "detector_not_registered" };
      if (!detector.signalTypes.includes(input.type as PerceptionSignalType)) {
        return { outcome: "rejected", reason: "signal_type_not_owned_by_detector" };
      }
      if (detector.requiredConsentPurpose !== null && !input.grantedConsentPurposes.includes(detector.requiredConsentPurpose)) {
        return { outcome: "rejected", reason: "consent_missing" };
      }
      if (input.confidence < 0 || input.confidence > 1) return { outcome: "rejected", reason: "invalid_confidence" };
      const ttlMs = input.ttlMs ?? RECOMMENDED_SIGNAL_TTL_MS[input.type as PerceptionSignalType];
      if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) return { outcome: "rejected", reason: "invalid_ttl" };

      const observedAtMs = clock.now();
      const type = input.type as PerceptionSignalType;
      signalSequence += 1;
      const signal: PerceptionSignal = Object.freeze({
        signalId: `sig_${observedAtMs}_${signalSequence}`,
        type,
        category: categoryOf(type),
        evidence: Object.freeze({ ...input.evidence }),
        confidence: input.confidence,
        detectorId: detector.detectorId,
        detectorVersion: detector.version,
        purpose: input.purpose,
        privacyClass: input.privacyClass,
        observedAtMs,
        expiresAtMs: observedAtMs + ttlMs,
      });
      signals.set(signal.signalId, signal);
      pruneIfNeeded();
      return { outcome: "accepted", signal };
    },

    activeSignals(atMs: number): readonly PerceptionSignal[] {
      return Object.freeze([...signals.values()].filter((signal) => signal.expiresAtMs > atMs));
    },

    deriveHypothesis(rawInput: unknown, atMs: number): HypothesisDerivationResult {
      const input = parseHypothesisInput(rawInput);
      if (!(HYPOTHESIS_KINDS as readonly string[]).includes(input.kind)) return { outcome: "rejected", reason: "unknown_kind" };
      if (input.confidence < 0 || input.confidence > 1) return { outcome: "rejected", reason: "invalid_confidence" };
      if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_TTL_MS) return { outcome: "rejected", reason: "invalid_ttl" };
      if (input.evidenceSignalIds.length === 0) return { outcome: "rejected", reason: "no_evidence" };
      for (const signalId of input.evidenceSignalIds) {
        const evidence = signals.get(signalId);
        if (evidence === undefined) return { outcome: "rejected", reason: "evidence_not_found" };
        if (evidence.expiresAtMs <= atMs) return { outcome: "rejected", reason: "evidence_expired" };
      }
      hypothesisSequence += 1;
      const hypothesis: DerivedHypothesis = Object.freeze({
        hypothesisId: `hyp_${atMs}_${hypothesisSequence}`,
        kind: input.kind as HypothesisKind,
        evidenceSignalIds: Object.freeze([...input.evidenceSignalIds]),
        confidence: input.confidence,
        observedAtMs: atMs,
        expiresAtMs: atMs + input.ttlMs,
      });
      return { outcome: "accepted", hypothesis };
    },
  });
}

export function isPerceptionSignalExpired(signal: PerceptionSignal, atMs: number): boolean {
  return signal.expiresAtMs <= atMs;
}

function categoryOf(type: PerceptionSignalType): PerceptionSignalCategory {
  if ((DIALOGUE_SIGNAL_TYPES as readonly string[]).includes(type)) return "dialogue";
  if ((TECHNICAL_SIGNAL_TYPES as readonly string[]).includes(type)) return "technical";
  return "visual_presence";
}

function parseDetectorDescriptor(value: unknown): DetectorDescriptor {
  if (value === null || typeof value !== "object") throw new RangeError("invalid detector descriptor");
  const record = value as Record<string, unknown>;
  if (typeof record.detectorId !== "string" || !DETECTOR_ID_PATTERN.test(record.detectorId)) throw new RangeError("invalid detectorId");
  if (typeof record.version !== "string" || !VERSION_PATTERN.test(record.version)) throw new RangeError("invalid detector version");
  if (!Array.isArray(record.signalTypes) || record.signalTypes.length === 0 || record.signalTypes.some((t) => !(PERCEPTION_SIGNAL_TYPES as readonly string[]).includes(t))) {
    throw new RangeError("invalid detector signalTypes");
  }
  if (record.requiredConsentPurpose !== null && typeof record.requiredConsentPurpose !== "string") {
    throw new RangeError("invalid detector requiredConsentPurpose");
  }
  if (!Array.isArray(record.inputModalities) || record.inputModalities.some((m) => typeof m !== "string")) {
    throw new RangeError("invalid detector inputModalities");
  }
  return Object.freeze({
    detectorId: record.detectorId,
    version: record.version,
    signalTypes: Object.freeze([...(record.signalTypes as PerceptionSignalType[])]),
    requiredConsentPurpose: record.requiredConsentPurpose as string | null,
    inputModalities: Object.freeze([...(record.inputModalities as string[])]),
  });
}

function parseEmitInput(value: unknown): EmitSignalInput {
  if (value === null || typeof value !== "object") throw new RangeError("invalid signal emission input");
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") throw new RangeError("invalid signal type");
  if (typeof record.detectorId !== "string") throw new RangeError("invalid signal detectorId");
  if (record.evidence === null || typeof record.evidence !== "object" || Array.isArray(record.evidence)) throw new RangeError("invalid signal evidence");
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)) throw new RangeError("invalid signal confidence");
  if (typeof record.purpose !== "string" || record.purpose.length === 0) throw new RangeError("invalid signal purpose");
  if (record.privacyClass !== "internal" && record.privacyClass !== "confidential" && record.privacyClass !== "restricted") {
    throw new RangeError("invalid signal privacyClass");
  }
  if (record.ttlMs !== undefined && (typeof record.ttlMs !== "number" || !Number.isFinite(record.ttlMs))) throw new RangeError("invalid signal ttlMs");
  if (!Array.isArray(record.grantedConsentPurposes) || record.grantedConsentPurposes.some((p) => typeof p !== "string")) {
    throw new RangeError("invalid grantedConsentPurposes");
  }
  return Object.freeze({
    type: record.type,
    detectorId: record.detectorId,
    evidence: Object.freeze({ ...(record.evidence as Record<string, unknown>) }),
    confidence: record.confidence,
    purpose: record.purpose,
    privacyClass: record.privacyClass,
    ...(record.ttlMs === undefined ? {} : { ttlMs: record.ttlMs }),
    grantedConsentPurposes: Object.freeze([...(record.grantedConsentPurposes as string[])]),
  });
}

function parseHypothesisInput(value: unknown): DeriveHypothesisInput {
  if (value === null || typeof value !== "object") throw new RangeError("invalid hypothesis input");
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string") throw new RangeError("invalid hypothesis kind");
  if (!Array.isArray(record.evidenceSignalIds) || record.evidenceSignalIds.some((id) => typeof id !== "string")) {
    throw new RangeError("invalid hypothesis evidenceSignalIds");
  }
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)) throw new RangeError("invalid hypothesis confidence");
  if (typeof record.ttlMs !== "number" || !Number.isFinite(record.ttlMs)) throw new RangeError("invalid hypothesis ttlMs");
  return Object.freeze({
    kind: record.kind,
    evidenceSignalIds: Object.freeze([...(record.evidenceSignalIds as string[])]),
    confidence: record.confidence,
    ttlMs: record.ttlMs,
  });
}
