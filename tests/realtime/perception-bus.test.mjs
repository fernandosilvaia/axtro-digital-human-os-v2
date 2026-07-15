import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const perception = await import(pathToFileURL(join(root, "packages/perception/dist/index.js")).href);

const { createPerceptionBus, RECOMMENDED_SIGNAL_TTL_MS, isPerceptionSignalExpired } = perception;

function manualClock(startMs = 0) {
  let value = startMs;
  return { now: () => value, advance: (deltaMs) => { value += deltaMs; } };
}

function registerTechnicalDetector(bus) {
  bus.registerDetector({
    detectorId: "technical-quality-v1",
    version: "1.0.0",
    signalTypes: ["low_audio_level", "frozen_video", "packet_loss", "echo", "reconnect_count"],
    requiredConsentPurpose: null,
    inputModalities: ["audio", "video"],
  });
}

function registerVisualDetector(bus) {
  bus.registerDetector({
    detectorId: "visual-presence-v1",
    version: "1.0.0",
    signalTypes: ["face_visible", "away_from_camera", "presentation_focus_event", "hand_raised"],
    requiredConsentPurpose: "visual_analysis",
    inputModalities: ["video"],
  });
}

test("perception bus: every signal carries evidence, confidence, detector version, purpose, privacy class and TTL", () => {
  const clock = manualClock(1_000);
  const bus = createPerceptionBus(clock);
  registerTechnicalDetector(bus);

  const result = bus.emitSignal({
    type: "low_audio_level",
    detectorId: "technical-quality-v1",
    evidence: { rmsDb: -42 },
    confidence: 0.85,
    purpose: "technical_quality_monitoring",
    privacyClass: "internal",
    grantedConsentPurposes: [],
  });
  assert.equal(result.outcome, "accepted");
  assert.equal(result.signal.category, "technical");
  assert.equal(result.signal.detectorVersion, "1.0.0");
  assert.equal(result.signal.expiresAtMs, 1_000 + RECOMMENDED_SIGNAL_TTL_MS.low_audio_level);
  assert.equal(isPerceptionSignalExpired(result.signal, 1_000), false);
  assert.equal(isPerceptionSignalExpired(result.signal, result.signal.expiresAtMs), true);
});

test("perception bus: a visual-presence signal without the matching consent is rejected, never silently dropped without reason", () => {
  const bus = createPerceptionBus(manualClock());
  registerVisualDetector(bus);
  const result = bus.emitSignal({
    type: "face_visible",
    detectorId: "visual-presence-v1",
    evidence: { visible: true },
    confidence: 1,
    purpose: "presence_awareness",
    privacyClass: "confidential",
    grantedConsentPurposes: ["essential_processing"],
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "consent_missing");
});

test("perception bus: the same signal is accepted once visual_analysis consent is granted", () => {
  const bus = createPerceptionBus(manualClock());
  registerVisualDetector(bus);
  const result = bus.emitSignal({
    type: "face_visible",
    detectorId: "visual-presence-v1",
    evidence: { visible: true },
    confidence: 1,
    purpose: "presence_awareness",
    privacyClass: "confidential",
    grantedConsentPurposes: ["essential_processing", "visual_analysis"],
  });
  assert.equal(result.outcome, "accepted");
  assert.equal(result.signal.category, "visual_presence");
});

test("perception bus: a detector cannot emit a signal type it was not registered for", () => {
  const bus = createPerceptionBus(manualClock());
  registerTechnicalDetector(bus);
  const result = bus.emitSignal({
    type: "speaker_change",
    detectorId: "technical-quality-v1",
    evidence: {},
    confidence: 0.9,
    purpose: "turn_taking",
    privacyClass: "internal",
    grantedConsentPurposes: [],
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "signal_type_not_owned_by_detector");
});

test("perception bus: an unsupported inference kind cannot be constructed — there is no lie-detection, diagnosis or emotion-as-fact type", () => {
  const bus = createPerceptionBus(manualClock());
  registerTechnicalDetector(bus);
  for (const forbiddenType of ["lie_detected", "medical_diagnosis", "race_inferred", "solvency_risk_score", "voiceprint_identity", "emotion_state"]) {
    const result = bus.emitSignal({
      type: forbiddenType,
      detectorId: "technical-quality-v1",
      evidence: {},
      confidence: 0.5,
      purpose: "unsupported",
      privacyClass: "internal",
      grantedConsentPurposes: [],
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.reason, "signal_type_not_owned_by_detector", `${forbiddenType} is not in the closed vocabulary, so no detector can own it`);
  }
});

test("perception bus: expired signals drop out of the active snapshot", () => {
  const clock = manualClock(0);
  const bus = createPerceptionBus(clock);
  registerTechnicalDetector(bus);
  bus.emitSignal({
    type: "frozen_video",
    detectorId: "technical-quality-v1",
    evidence: { frozenMs: 2_000 },
    confidence: 0.9,
    purpose: "technical_quality_monitoring",
    privacyClass: "internal",
    grantedConsentPurposes: [],
  });
  assert.equal(bus.activeSignals(0).length, 1);
  clock.advance(RECOMMENDED_SIGNAL_TTL_MS.frozen_video + 1);
  assert.equal(bus.activeSignals(clock.now()).length, 0, "frozen_video expires after its 5s TTL");
});

test("perception bus: a derived hypothesis must cite non-expired evidence and cannot invent an unsupported kind", () => {
  const clock = manualClock(0);
  const bus = createPerceptionBus(clock);
  registerTechnicalDetector(bus);
  const emitted = bus.emitSignal({
    type: "packet_loss",
    detectorId: "technical-quality-v1",
    evidence: { lossPercent: 12 },
    confidence: 0.8,
    purpose: "technical_quality_monitoring",
    privacyClass: "internal",
    grantedConsentPurposes: [],
  });

  const supported = bus.deriveHypothesis(
    { kind: "technical_adjustment_needed", evidenceSignalIds: [emitted.signal.signalId], confidence: 0.7, ttlMs: 30_000 },
    clock.now(),
  );
  assert.equal(supported.outcome, "accepted");
  assert.equal(supported.hypothesis.evidenceSignalIds.length, 1);

  const noEvidence = bus.deriveHypothesis({ kind: "possible_confusion", evidenceSignalIds: [], confidence: 0.5, ttlMs: 30_000 }, clock.now());
  assert.equal(noEvidence.outcome, "rejected");
  assert.equal(noEvidence.reason, "no_evidence");

  const unsupportedKind = bus.deriveHypothesis(
    { kind: "is_lying", evidenceSignalIds: [emitted.signal.signalId], confidence: 0.5, ttlMs: 30_000 },
    clock.now(),
  );
  assert.equal(unsupportedKind.outcome, "rejected");
  assert.equal(unsupportedKind.reason, "unknown_kind");

  clock.advance(RECOMMENDED_SIGNAL_TTL_MS.packet_loss + 1);
  const staleEvidence = bus.deriveHypothesis(
    { kind: "technical_adjustment_needed", evidenceSignalIds: [emitted.signal.signalId], confidence: 0.7, ttlMs: 30_000 },
    clock.now(),
  );
  assert.equal(staleEvidence.outcome, "rejected");
  assert.equal(staleEvidence.reason, "evidence_expired");
});

test("perception bus: an unregistered detector or out-of-range confidence is rejected with a specific reason", () => {
  const bus = createPerceptionBus(manualClock());
  const unregistered = bus.emitSignal({
    type: "long_silence",
    detectorId: "ghost-detector",
    evidence: {},
    confidence: 0.5,
    purpose: "turn_taking",
    privacyClass: "internal",
    grantedConsentPurposes: [],
  });
  assert.equal(unregistered.outcome, "rejected");
  assert.equal(unregistered.reason, "detector_not_registered");

  registerTechnicalDetector(bus);
  const badConfidence = bus.emitSignal({
    type: "echo",
    detectorId: "technical-quality-v1",
    evidence: {},
    confidence: 1.5,
    purpose: "technical_quality_monitoring",
    privacyClass: "internal",
    grantedConsentPurposes: [],
  });
  assert.equal(badConfidence.outcome, "rejected");
  assert.equal(badConfidence.reason, "invalid_confidence");
});
